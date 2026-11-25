/*
 * Proprietaerer Bestandteil der Easy-Slicer-Slice-Engine.
 * Copyright (c) 2026 Michael Becker. Alle Rechte vorbehalten.
 * Nutzung nur im Rahmen von LICENSE und LICENSE-SLICE-ENGINE.md.
 */
import type {
  BedMesh,
  CustomGcode,
  PathOrder,
  PreviewFeatureKind,
  PrintSettings,
  PrinterProfile,
  SliceFeatureStats,
  SliceResult,
  SupportPattern,
} from '../../shared/types.ts'
import { booleanPolys, offsetPolys, signedArea, unionPolys, type Poly } from './clipper.ts'
import { pathLength, polysBounds, sliceAtZ } from './geom.ts'
import {
  clipLines,
  infillSpacing,
  orderSegments,
  patternSegments,
  type InfillReport,
  type Segment,
} from './infill.ts'
import {
  GcodeWriter,
  withGcodeMetadata,
  type GcodeFilamentMetadata,
  type LayerOverride,
  type PathKind,
  type PrintPath,
} from './gcode.ts'
import { scaleMesh, transformMesh, type Mesh } from './stl.ts'
import { planLayers, type LayerBand, type LayerPlan } from './layerPlan.ts'
import { heightRangeSettings } from '../../shared/heightRanges.ts'
import { applyPrinterLimits } from '../../shared/limits.ts'
import { orderThin, planWalls } from './walls.ts'
import { meshOverhangSeeds, planSupport, type PaintSupport, type SupportPlan } from './support.ts'
import { planPrimeLine } from '../../shared/gcode-templates.ts'
import { bridgeArea, planBridges } from './bridges.ts'
import {
  topSurfaceTextureAmplitude,
  topSurfaceTextureSpacing,
  textureZoneAt,
} from '../../shared/surfaceTexture.ts'
import { mergeSettings } from '../../shared/types.ts'

type LayerData = {
  z: number
  height: number
  loops: Poly[]
  inner: Poly[]
  skin: Poly[]
  sparse: Poly[]
  /** Einstellungen nach dem ersten passenden Höhenbereich. */
  settings: PrintSettings
}

/** Alle Konturen und Füllflächen eines einzelnen Bauteils in einer Schicht. */
type LayerObject = {
  loops: Poly[]
  inner: Poly[]
  skin: Poly[]
  sparse: Poly[]
}

const MAX_LAYERS = 2000

/**
 * Verschiebt die Konturen der ersten Schicht horizontal. Positive Werte
 * ziehen nach innen (gegen den Elefantenfuß), negative weiten nach außen.
 * "outer-wall" lässt Bohrungen unverändert; "first-layer" verschiebt auch
 * deren Ränder, also die gesamte erste Schicht.
 */
export function compensateFirstLayer(
  loops: Poly[],
  amount: number,
  scope: 'outer-wall' | 'first-layer',
): Poly[] {
  if (!loops.length || Math.abs(amount) < 1e-9) return loops
  const delta = -amount
  if (scope === 'first-layer') return offsetPolys(loops, delta)

  const outer = loops.filter((poly) => signedArea(poly) >= 0)
  const holes = loops.filter((poly) => signedArea(poly) < 0)
  // Falls eine Datei unerwartet nur negativ orientierte Konturen liefert,
  // bleibt die Kompensation trotzdem wirksam.
  if (!outer.length) return offsetPolys(loops, delta)
  return [...offsetPolys(outer, delta), ...holes]
}

export type SlicePlacement = { placed: Mesh; cuts: Mesh[]; warnings: string[] }

/**
 * Schrumpfkompensation und Bettlage eines Netzes. Getrennt von `sliceMesh`,
 * damit der Mehrfarbdruck die Schichthöhen einmal für alle Farben berechnen
 * kann; sonst läge jede Farbe auf einem eigenen Raster.
 */
export function placeForSlice(
  mesh: Mesh,
  settings: PrintSettings,
  profile: PrinterProfile,
  opts: { center?: boolean; offset?: { x: number; y: number }; subtract?: Mesh[] } = {},
): SlicePlacement {
  const warnings: string[] = []
  const shrink = settings.shrinkage ?? { x: 0, y: 0, z: 0 }
  const factor = (v: number) => 1 + (Number.isFinite(v) ? v : 0) / 100
  const fx = factor(shrink.x)
  const fy = factor(shrink.y)
  const fz = factor(shrink.z)
  const source = Math.abs(fx - 1) > 1e-6 || Math.abs(fy - 1) > 1e-6 || Math.abs(fz - 1) > 1e-6 ? scaleMesh(mesh, fx, fy, fz) : mesh
  if (Math.max(Math.abs(shrink.x), Math.abs(shrink.y), Math.abs(shrink.z)) > 5) {
    warnings.push(
      `Schrumpfkompensation über 5 % — das Modell wird deutlich größer. Prüfen, ob der Wert wirklich zum Material passt.`,
    )
  }
  const { min, max } = source.bbox
  const offsetX = Number.isFinite(opts.offset?.x) ? opts.offset!.x : 0
  const offsetY = Number.isFinite(opts.offset?.y) ? opts.offset!.y : 0
  const shiftX = (opts.center === false ? 0 : profile.bed.x / 2 - (min.x + max.x) / 2) + offsetX
  const shiftY = (opts.center === false ? 0 : profile.bed.y / 2 - (min.y + max.y) / 2) + offsetY
  const placed = transformMesh(source, { x: shiftX, y: shiftY, z: -min.z })
  const cuts = (opts.subtract ?? []).map((m) => transformMesh(m, { x: shiftX, y: shiftY, z: -min.z }))
  return { placed, cuts, warnings }
}

/**
 * Schichtplanung für ein Netz, ohne G-Code zu schreiben. Der Mehrfarbdruck
 * übergibt diese Bänder an alle Farben, damit sie Schicht für Schicht exakt
 * übereinander liegen.
 */
export function planSliceBands(
  mesh: Mesh,
  settings: PrintSettings,
  profile: PrinterProfile,
  opts: { center?: boolean; offset?: { x: number; y: number } } = {},
): LayerPlan {
  return planLayers(placeForSlice(mesh, settings, profile, opts).placed, settings, MAX_LAYERS)
}

export function sliceMesh(
  mesh: Mesh,
  settings: PrintSettings,
  profile: PrinterProfile,
  bedMesh: BedMesh | null,
  overrides: LayerOverride[] = [],
  /** Start-/Endsequenz, Zentrierung und abzuziehende Körper (eingelassener Text) */
  opts: {
    start?: boolean
    end?: boolean
    center?: boolean
    /** Zusätzlicher Bettversatz in mm, angewendet nach Schrumpf/Zentrierung. */
    offset?: { x: number; y: number }
    subtract?: Mesh[]
    /** Eigener G-Code des gewählten Druckers */
    customGcode?: CustomGcode
    /** Filament für den Mainsail-Metadatenblock */
    filament?: GcodeFilamentMetadata
    /** Bei zusammengesetzten Mehrfarbdateien erst am Ende einmal schreiben. */
    metadata?: boolean
    /** Gemalte Stützen-Bereiche (Taste L) */
    paint?: PaintSupport
    /** Diagnose/Test: erhält den tatsächlich geplanten Stützbereich. */
    onSupportPlan?: (plan: SupportPlan | null) => void
    /**
     * Feste Schichtplanung. Mehrfarbdruck schneidet jede Farbe einzeln; nur mit
     * derselben Schichtliste liegen alle Farben exakt übereinander.
     */
    bands?: LayerBand[]
    /** `G92 E0` am Schichtanfang — Grundlage für das Einsetzen einzelner Schichten. */
    resetExtruderEachLayer?: boolean
    /** Fläche für die Prime-Linie (z. B. alle Objekte statt nur einer Farbe). */
    footprint?: { min: { x: number; y: number }; max: { x: number; y: number } }
  } = {},
): SliceResult {
  const warnings: string[] = []

  // START_PRINT MESH= ist ein Klipper-Profilname. Zahlen sind erlaubt, wenn
  // die gespeicherten Meshes nach der Betttemperatur benannt sind.

  // Vasenmodus: eine Wand, keine Füllung und keine Deck-/Bodenschichten.
  // Die Außenwand steigt anschließend spiralförmig an (siehe printWalls), die
  // Düse hebt also nicht mehr pro Schicht an.
  if (settings.special?.vase) {
    settings = mergeSettings(settings, {
      walls: 1,
      infillDensity: 0,
      topLayers: 0,
      bottomLayers: 0,
      support: { kind: 'none' },
    })
    warnings.push('Vasenmodus: eine Außenwand ohne Füllung und Deckschichten, Z steigt spiralförmig über die Wand an.')
  }

  // Schrumpf, Bettlage und Negativkörper an einer Stelle. Der Mehrfarbdruck
  // braucht dieselbe Rechnung, um seine Schichtplanung vorab zu bestimmen.
  const placement = placeForSlice(mesh, settings, profile, opts)
  warnings.push(...placement.warnings)
  const placed = placement.placed
  const cuts = placement.cuts

  // Extrusionsbreite: eigene Linienbreite, sonst Düsendurchmesser
  const lineW = settings.lineWidth > 0 ? settings.lineWidth : settings.nozzle
  // Die Prime-Linie wird vor dem Schreiben anhand des tatsächlichen
  // Modell-Fußabdrucks in eine freie Randspur gelegt. So kollidiert sie nicht
  // mit einem breiten Modell oder einem Brim.
  const primeLine = settings.primeLine?.enabled ? planPrimeLine(opts.footprint ?? placed.bbox, profile, settings) : null
  if (settings.primeLine?.enabled && !primeLine) {
    warnings.push(
      'Prime-Linie: neben dem Modell ist kein freier Randstreifen für die Düsenreinigung — sie wird ausgelassen. Modell verkleinern oder Prime-Linie ausschalten.',
    )
  }
  // Rechteckiges Bett: schon vor dem Slicen auf Überstand prüfen.
  if (profile.kinematics !== 'delta') {
    const b = placed.bbox
    const over: string[] = []
    if (b.min.x < -0.01 || b.max.x > profile.bed.x + 0.01) {
      over.push(`X ${(b.max.x - b.min.x).toFixed(1)} > ${profile.bed.x}`)
    }
    if (b.min.y < -0.01 || b.max.y > profile.bed.y + 0.01) {
      over.push(`Y ${(b.max.y - b.min.y).toFixed(1)} > ${profile.bed.y}`)
    }
    if (b.max.z > profile.bed.z + 0.01) over.push(`Z ${b.max.z.toFixed(1)} > ${profile.bed.z}`)
    if (over.length) {
      warnings.push(
        `Modell passt nicht auf das Bett von ${profile.name}: ${over.join(', ')} mm — verkleinern, drehen oder teilen.`,
      )
    }
  }

  // Delta: rundes Bett — warnen, wenn das Modell über den Kreis hinausragt
  if (profile.kinematics === 'delta') {
    const radius = Math.min(profile.bed.x, profile.bed.y) / 2
    const cx = profile.bed.x / 2
    const cy = profile.bed.y / 2
    const box = placed.bbox
    let maxR = 0
    for (const [x, y] of [
      [box.min.x, box.min.y],
      [box.max.x, box.min.y],
      [box.max.x, box.max.y],
      [box.min.x, box.max.y],
    ]) {
      maxR = Math.max(maxR, Math.hypot(x - cx, y - cy))
    }
    if (maxR > radius) {
      warnings.push(
        `Modell ragt über das runde Bett hinaus (${maxR.toFixed(1)} mm statt ${radius.toFixed(1)} mm Radius) — verkleinern oder weiter zur Mitte schieben.`,
      )
    }
  }

  // Die Schichtplanung kennt feste und adaptive Höhen. Sie arbeitet auf dem
  // platzierten Netz, damit Neigungen und Modelloberkante exakt zu den
  // Schnittebenen passen. Die erste Schicht bleibt immer unverändert.
  const planned = opts.bands?.length
    ? { bands: opts.bands, warnings: [] as string[] }
    : planLayers(placed, settings, MAX_LAYERS)
  const zs = planned.bands
  warnings.push(...planned.warnings)

  // Diagnose: Diese Zähler machen stille Geometrieverluste sichtbar. Sie werden
  // am Ende als Warnung ausgegeben, statt Bahnen kommentarlos wegzulassen.
  const geomReport = { openChains: 0 }
  const infillReport: InfillReport = { truncated: false, orderFallback: false }
  const wallReport = { omittedThinAreas: 0 }

  // 1) Konturen und Innenbereiche je Schicht
  const layers: LayerData[] = []
  for (let i = 0; i < zs.length; i++) {
    // Höhenbereiche gelten ab der zweiten Schicht. Die erste Schicht behält
    // bewusst die Haftungs- und First-Layer-Werte des Profils.
    const layerTop = zs[i].z + zs[i].height / 2
    const layerSettings = i === 0
      ? settings
      : applyPrinterLimits(profile, heightRangeSettings(settings, layerTop))
    const layerLineW = layerSettings.lineWidth > 0 ? layerSettings.lineWidth : layerSettings.nozzle
    let loops = sliceAtZ(placed.positions, placed.triangles, zs[i].z, geomReport)
    // Eingelassener Text: seine Querschnitte werden aus jeder Schicht
    // ausgeschnitten, damit im G-Code eine echte Vertiefung entsteht.
    for (const cut of cuts) {
      const holes = sliceAtZ(cut.positions, cut.triangles, zs[i].z, geomReport)
      if (holes.length) loops = booleanPolys(loops, holes, 'diff')
    }
    // Elefantenfuß: nur die erste Schicht. Der Versatz liegt vor der
    // Innenbereich-Berechnung, damit Wände, Boden und Füllung dieselbe
    // Kontur verwenden und keine Überlappung zwischen den Wandringen
    // entsteht.
    const foot = layerSettings.elephantFoot
    if (i === 0 && foot?.enabled) {
      const amount = Number.isFinite(foot.amount) ? Math.max(-1, Math.min(1, foot.amount)) : 0
      if (Math.abs(amount) > 1e-9) {
        const before = loops
        loops = compensateFirstLayer(loops, amount, foot.scope)
        if (before.length && !loops.length) {
          warnings.push(
            'Elefantenfuß-Kompensation entfernt die erste Schicht vollständig — Betrag reduzieren oder nur die Außenkontur kompensieren.',
          )
        }
        const firstWidth = layerSettings.firstLayerLineWidth > 0 ? layerSettings.firstLayerLineWidth : layerLineW
        if (Math.abs(amount) >= Math.max(0.1, firstWidth * 0.5)) {
          warnings.push(
            `Elefantenfuß-Kompensation: ${amount.toFixed(2)} mm pro Seite ist mindestens eine halbe erste Linienbreite (${firstWidth.toFixed(2)} mm) — Wandüberlappung und Haftfläche prüfen.`,
          )
        }
      }
    }
    const inner = layerSettings.walls > 0 ? offsetPolys(loops, -layerLineW * layerSettings.walls) : loops
    // Gedruckt wird auf der Oberkante der Schicht (zs[i].z ist die Mittelebene)
    layers.push({
      z: layerTop,
      height: zs[i].height,
      loops,
      inner,
      skin: [],
      sparse: [],
      settings: layerSettings,
    })
  }

  // 2) Deck-/Bodenschichten ermitteln
  const openShell = settings.special?.openShell === true
  const guard = settings.surfaceGuard
  const guardOn = guard?.enabled === true && !openShell
  const extraTopLayers = guardOn ? Math.max(0, Math.min(6, Math.round(guard.extraTopLayers))) : 0
  const guardBaseLayers = guardOn ? Math.max(0, Math.min(6, Math.round(guard.baseSolidLayers))) : 0
  const topLayers = settings.special?.vase || openShell ? 0 : Math.max(1, Math.round(settings.topLayers) + extraTopLayers)
  const bottomLayers = settings.special?.vase || openShell ? 0 : Math.max(1, Math.round(settings.bottomLayers))
  const surfaceAbove: Poly[][] = []
  for (let i = 0; i < layers.length; i++) {
    const above = layers[i + 1]?.inner ?? []
    surfaceAbove.push(above.length ? booleanPolys(layers[i].inner, above, 'diff') : layers[i].inner)
  }

  for (let i = 0; i < layers.length; i++) {
    const ls = layers[i].settings
    const localGuard = ls.surfaceGuard
    const localGuardBase = !openShell && localGuard?.enabled === true
      ? Math.max(0, Math.min(6, Math.round(localGuard.baseSolidLayers)))
      : 0
    const localExtraTop = !openShell && localGuard?.enabled === true
      ? Math.max(0, Math.min(6, Math.round(localGuard.extraTopLayers)))
      : 0
    const localTop =
      settings.special?.vase || openShell ? 0 : Math.max(1, Math.round(ls.topLayers) + localExtraTop)
    const localBottom = settings.special?.vase || openShell ? 0 : Math.max(1, Math.round(ls.bottomLayers))
    const localLineW = ls.lineWidth > 0 ? ls.lineWidth : ls.nozzle
    let skin: Poly[] = []
    if (i < localBottom) {
      skin = layers[i].inner
    } else if (
      localGuardBase > 0 &&
      i >= Math.max(localBottom, layers.length - localTop - localGuardBase) &&
      i < layers.length - localTop
    ) {
      // Oberflächenschutz: Die sichtbare Deckschicht bekommt eine volle
      // Auflage. Ohne sie hängt sie über der 20-%-Füllung durch und wird
      // danach von der nächsten Düsenbahn gestreift.
      skin = layers[i].inner
    } else {
      const acc: Poly[] = []
      for (let k = i; k < Math.min(layers.length, i + localTop); k++) {
        if (surfaceAbove[k]?.length) acc.push(...surfaceAbove[k])
      }
      if (acc.length) skin = booleanPolys(layers[i].inner, acc, 'and')
    }
    layers[i].skin = skin
    // Infill-Wall-Overlap wie in Orca: Die Füllung darf ein Stück unter die
    // Innenwand reichen. Das verbessert die Verbindung, ohne die Außenwand zu
    // verändern. Linienbreite und Überlappung folgen dem Höhenbereich.
    const sparseBase =
      ls.infillOverlap > 0
        ? offsetPolys(layers[i].inner, (localLineW * ls.infillOverlap) / 100)
        : layers[i].inner
    layers[i].sparse = skin.length ? booleanPolys(sparseBase, skin, 'diff') : sparseBase
  }

  // 3) Stützstrukturen aus Footprint-Differenz UND echten Überhangnormalen
  const supportSeeds =
    settings.support && settings.support.kind !== 'none'
      ? meshOverhangSeeds(
          placed,
          zs.map((entry) => ({ z: entry.z + entry.height / 2, height: entry.height })),
          settings.support.threshold,
        )
      : null
  const support =
    settings.support && settings.support.kind !== 'none'
      ? planSupport(layers, settings.support, supportSeeds, opts.paint ?? null)
      : null
  opts.onSupportPlan?.(support)
  if (support && support.overhangLayers === 0) {
    warnings.push(
      `Stützstrukturen sind eingeschaltet, aber kein Überhang über ${settings.support.threshold}° gefunden — es wird nichts gestützt.`,
    )
  }

  // 4) G-Code schreiben
  const writer = new GcodeWriter({
    settings,
    profile,
    bedMesh,
    overrides,
    resetExtruderEachLayer: opts.resetExtruderEachLayer === true,
    // Die erste Schicht bleibt von Höhenbereichen ausgenommen; ab Schicht 2
    // liefert die gemeinsame Helper-Funktion die passenden Werte.
    layerSettings: (z) =>
      z <= settings.firstLayerHeight + 1e-6
        ? settings
        : applyPrinterLimits(profile, heightRangeSettings(settings, z)),
    customGcode: opts.customGcode,
    primeLine,
  })
  const withStart = opts.start !== false
  const withEnd = opts.end !== false
  if (withStart) writer.start(layers.length)

  const speeds = settings.speeds
  const accel = settings.accelerations
  // Flächen ohne Auflage: für Füllung/Decklagen (inner) und für Wände (loops).
  const overhangPolys: Poly[][] = layers.map((L, i) =>
    i === 0 ? [] : booleanPolys(L.inner, layers[i - 1].inner, 'diff'),
  )
  const overhangWallPolys: Poly[][] = layers.map((L, i) =>
    i === 0 ? [] : booleanPolys(L.loops, layers[i - 1].loops, 'diff'),
  )
  const overhangSpeed = Math.min(speeds.overhang, speeds.solid, speeds.infill)
  // Schmale Stützflächen können zwischen den regulären Musterlinien liegen.
  // Dann wird quer zur längeren Bounding-Box-Achse eine engere Linie erzeugt,
  // statt die Stütze unsichtbar zu lassen.
  const supportSegments = (polys: Poly[], pattern: SupportPattern, density: number, layerIndex: number): Segment[] => {
    if (!polys.length) return []
    const normal = patternSegments(polys, pattern, density, lineW, layerIndex, false, settings.infillAngle, infillReport)
    if (normal.length) return normal
    const bounds = polysBounds(polys)
    const acrossLongAxis = bounds.maxX - bounds.minX >= bounds.maxY - bounds.minY ? 90 : 0
    return clipLines(polys, acrossLongAxis, Math.max(0.05, lineW * 0.25), infillReport)
  }
  // Even-Odd über alle Ringe. Ein Punkt in einem Loch darf nicht als "innerhalb"
  // gelten, nur weil er innerhalb der Außenkontur liegt.
  const pointInPolys = (polys: Poly[], x: number, y: number) => {
    let inside = false
    for (const poly of polys) if (pointInPoly(poly, x, y)) inside = !inside
    return inside
  }
  const inPolys = (polys: Poly[], seg: Segment) =>
    pointInPolys(polys, (seg.a.x + seg.b.x) / 2, (seg.a.y + seg.b.y) / 2)
  const inOverhangArea = (li: number, seg: Segment) => inPolys(overhangPolys[li], seg)
  // Liegt die Mitte einer Füll-/Deckschicht-Bahn außerhalb der vorherigen
  // Kontur, wird sie ohne Auflage gedruckt: das ist eine Brücke.
  // Eine echte Brücke wird an beiden Enden von der vorherigen Schicht
  // getragen. Nur die Mitte ohne Auflage reicht nicht: sonst würde jeder
  // einseitig gehaltene Überhang als Brücke gedruckt.
  const inBridge = (li: number, seg: Segment) => {
    if (li <= 0 || inPolys(layers[li - 1].loops, seg)) return false
    const support = layers[li - 1].loops
    const start = {
      x: seg.a.x + (seg.b.x - seg.a.x) * 0.08,
      y: seg.a.y + (seg.b.y - seg.a.y) * 0.08,
    }
    const end = {
      x: seg.a.x + (seg.b.x - seg.a.x) * 0.92,
      y: seg.a.y + (seg.b.y - seg.a.y) * 0.92,
    }
    return pointInPolys(support, start.x, start.y) && pointInPolys(support, end.x, end.y)
  }
  const ringOverhang = (li: number, poly: Poly) => {
    if (!overhangWallPolys[li].length) return false
    // Nicht nur die Eckpunkte prüfen: Eine Wand kann eine Überhangfläche
    // zwischen zwei außerhalb liegenden Punkten queren.
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]
      const b = poly[(i + 1) % poly.length]
      for (const t of [0.25, 0.5, 0.75]) {
        if (pointInPolys(overhangWallPolys[li], a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return true
      }
    }
    return false
  }
  const inOverhang = (li: number, seg: Segment) =>
    overhangSpeed < Math.min(speeds.solid, speeds.infill) && inOverhangArea(li, seg)
  const spiralVase = settings.special?.vase === true
  let previousObjects: LayerObject[] = []
  for (let li = 0; li < layers.length; li++) {
    const L = layers[li]
    writer.beginLayer(L.z, li, L.height, spiralVase && li > 0)
    // Ab hier gelten die Overrides dieser Schicht. Besonders wichtig für
    // VFA-/Max-Flow-Türme: Deren neue Geschwindigkeit muss auch im G-code
    // ankommen, nicht nur als Kommentar im Kopf der Schicht stehen.
    const speeds = writer.currentSettings.speeds
    const accel = writer.currentSettings.accelerations

    // Saum und Umrandung. Der Saum kann über mehrere Schichten laufen;
    // die Umrandung bleibt wie in Orca auf der ersten Schicht.
    const skirt = settings.skirt
    if (li < Math.max(1, Math.round(skirt.layers)) && settings.adhesion === 'skirt' && L.loops.length) {
      const base = contourSubset(L.loops, skirt.type)
      for (let r = 0; r < Math.max(1, Math.round(skirt.loops)); r++) {
        const rings = offsetPolys(base, skirt.distance + lineW * 0.5 + r * lineW)
        for (const poly of orderPaths(
          rings.filter((p) => pathLength(p, true) >= skirt.minLength),
          writer.pos,
          settings.printOrder.paths,
        )) {
          writer.path(
            { pts: poly, closed: true, kind: 'adhesion', startAngle: skirt.startAngle },
            skirt.speed,
            1,
            accel.print,
          )
        }
      }
    }

    const brim = settings.brim
    if (li === 0 && settings.adhesion === 'brim' && L.loops.length) {
      const base = contourSubset(L.loops, brim.type)
      const rings = Math.max(1, Math.ceil(brim.width / Math.max(0.1, lineW)))
      const start = brim.gap + lineW * 0.5
      for (let r = 0; r < rings; r++) {
        const ring = offsetPolys(base, start + r * lineW)
        for (const poly of orderPaths(ring, writer.pos, settings.printOrder.paths)) {
          writer.path(
            { pts: poly, closed: true, kind: 'adhesion', startAngle: -135 },
            speeds.firstLayer,
            Math.max(0.1, Math.min(3, brim.flow || 1)),
            accel.print,
          )
        }
      }
    }

    // Luftzug-Schutz: eine zusätzliche, durchgehende Wand um das Bauteil.
    if (skirt.draftShield && settings.adhesion !== 'none' && L.loops.length) {
      const shield = offsetPolys(L.loops.filter((p) => signedArea(p) >= 0), skirt.distance + 5)
      for (const poly of orderPaths(shield, writer.pos, settings.printOrder.paths)) {
        writer.path({ pts: poly, closed: true, kind: 'adhesion' }, Math.max(skirt.speed, 10), 1, accel.print)
      }
    }

    // Wände: Reihenfolge ist eine echte Slicer-Option. Standard ist innen
    // zuerst, außen zuletzt (bessere Maßhaltigkeit); umgekehrt ist ebenfalls
    // ein vollständiger, gültiger Werkzeugweg.
    const printWalls = (object: LayerObject) => {
      const ls = L.settings
      const localLineW = ls.lineWidth > 0 ? ls.lineWidth : ls.nozzle
      if (ls.walls <= 0 || !object.loops.length) return
      // Arachne-artiger Wandgenerator: normale Ringe plus Mittellinien für
      // Stellen, die schmaler als eine Wandbreite sind. Dort wird die
      // Extrusionsbreite an die gemessene Dicke angepasst, statt eine Lücke
      // zu lassen. Min/Max und Fluss der Lückenfüllung sind einstellbar.
      const gap = ls.gapFill ?? { enabled: true, minWidth: 0.2, maxWidth: localLineW * 1.02, flow: 1 }
      const plan = planWalls(object.loops, localLineW, ls.walls, wallReport, {
        enabled: gap.enabled !== false,
        minWidth: gap.minWidth,
        maxWidth: gap.maxWidth,
      })
      // Spirale nur bei der klassischen Vase: genau ein Ring, eine Kontur.
      const spiralOuter = spiralVase && ls.walls === 1 && plan.rings.length === 1
      const ringOrder = plan.rings.map((_, i) => i)
      if (ls.printOrder.walls !== 'outer-first') ringOrder.reverse()
      for (const idx of ringOrder) {
        const isOuter = idx === 0
        const ordered = orderPaths(plan.rings[idx], writer.pos, ls.printOrder.paths)
        for (const poly of ordered) {
          const kind: PathKind = ringOverhang(li, poly)
            ? 'overhang'
            : isOuter
              ? 'outer-wall'
              : 'inner-wall'
          const path: PrintPath = {
            pts: poly,
            closed: true,
            kind,
            // Erste Schicht bleibt flach auf dem Bett, die Spirale beginnt darüber.
            spiral: spiralOuter && isOuter && ordered.length === 1 && li > 0,
          }
          writer.path(
            path,
            isOuter ? speeds.outerWall : speeds.innerWall,
            1,
            isOuter ? accel.outerWall : accel.innerWall,
          )
        }
      }
      // Dünne Stellen liegen innen und kommen deshalb nach den Ringen —
      // unabhängig davon, ob außen oder innen zuerst gedruckt wird.
      for (const thin of orderThin(plan.thin, writer.pos)) {
        writer.path(
          { pts: thin.pts, closed: false, kind: 'inner-wall', width: thin.width },
          speeds.innerWall,
          gap.enabled !== false ? Math.max(0.1, Math.min(2, gap.flow || 1)) : 1,
          accel.innerWall,
        )
      }

      // Orca-Option „Alternate extra wall“: Auf jeder zweiten Schicht kommt
      // eine zusätzliche Innenwand hinzu, die die Füllung vertikal verzahnt.
      if (ls.alternateExtraWall && li % 2 === 1) {
        const ring = offsetPolys(object.loops, -localLineW * (ls.walls + 0.5))
        for (const poly of orderPaths(ring, writer.pos, ls.printOrder.paths)) {
          writer.path(
            { pts: poly, closed: true, kind: 'inner-wall' },
            speeds.innerWall,
            1,
            accel.innerWall,
          )
        }
      }
    }

    // Deckschichten (solid): Die obersten Schichten bekommen eigene
    // Geschwindigkeit, Fluss, Beschleunigung und Linienbreite.
    const printSkin = (object: LayerObject) => {
      if (!object.skin.length) return
      const ls = L.settings
      const localTop = settings.special?.vase || openShell ? 0 : Math.max(1, Math.round(ls.topLayers))
      const localBottom = settings.special?.vase || openShell ? 0 : Math.max(1, Math.round(ls.bottomLayers))
      const topSkin = localTop > 0 && li >= layers.length - localTop
      const bottomSkin = localBottom > 0 && li < localBottom
      const skinSpeed = topSkin ? speeds.topSurface : speeds.solid
      const skinAccel = topSkin ? accel.topSurface : accel.solid
      const skinFlow = topSkin ? ls.topSurfaceFlow : bottomSkin ? ls.bottomSurfaceFlow : 1
      // Der Bahnabstand muss zur Breite passen, mit der die Bahn wirklich
      // gedruckt wird (gleiche Auswahl wie GcodeWriter.widthFor). Vorher stand
      // hier lineW × 1,05: Bei Fluss 0,95 wurde damit jede Massivschicht
      // breiter gespreizt als extrudiert und bekam sichtbare Lücken.
      const localLineW = ls.lineWidth > 0 ? ls.lineWidth : ls.nozzle
      // Echte Brücken bekommen eine eigene Bahnrichtung quer zur kürzesten
      // unterstützten Spanne. Die normale Deckschicht wird dort ausgespart,
      // damit keine doppelte Extrusion entsteht; der Ankerrand ist enthalten.
      const bridges = li > 0 ? planBridges(object.skin, layers[li - 1].loops, localLineW) : []
      const skinRegion = bridges.length
        ? booleanPolys(object.skin, unionPolys(bridgeArea(bridges)), 'diff')
        : object.skin
      const skinWidth =
        li === 0 && ls.firstLayerLineWidth > 0
          ? ls.firstLayerLineWidth
          : ls.topSurfaceLineWidth > 0
            ? ls.topSurfaceLineWidth
            : localLineW
      const segs = patternSegments(
        skinRegion,
        ls.infillPattern,
        100,
        Math.max(0.1, skinWidth * 0.98),
        li,
        true,
        ls.infillAngle,
        infillReport,
      )
      emitSegments(
        writer,
        segs,
        skinSpeed,
        'solid',
        skinAccel,
        (seg) => (inBridge(li, seg) ? speeds.bridge : inOverhang(li, seg) ? overhangSpeed : skinSpeed),
        (seg) => (inBridge(li, seg) ? 'bridge' : inOverhangArea(li, seg) ? 'overhang' : 'solid'),
        (seg) => (inBridge(li, seg) ? ls.bridgeFlow : skinFlow),
        (seg) => (inBridge(li, seg) ? accel.bridge : skinAccel),
        ls.printOrder.paths,
        infillReport,
        ls.printOrder.continuous,
        Math.max(0.6, localLineW * 1.5),
        topSkin,
      )
      for (const bridge of bridges) {
        emitSegments(
          writer,
          bridge.lines,
          speeds.bridge,
          'solid',
          accel.bridge,
          undefined,
          () => 'bridge',
          () => ls.bridgeFlow,
          () => accel.bridge,
          ls.printOrder.paths,
          infillReport,
          false,
          Math.max(0.6, localLineW * 1.5),
        )
      }
    }

    const printSparse = (object: LayerObject) => {
      const ls = L.settings
      const localLineW = ls.lineWidth > 0 ? ls.lineWidth : ls.nozzle
      const localSpacing = infillSpacing(ls.infillDensity, localLineW)
      if (!object.sparse.length || ls.infillDensity <= 0 || localSpacing === Infinity) return
      // Auch eine Brücke in der Füllung bekommt ihre eigene Richtung und
      // Anker. Sonst würde sie nur zufällig quer zur Lücke liegen.
      const bridges = li > 0 ? planBridges(object.sparse, layers[li - 1].loops, localLineW) : []
      const sparseRegion = bridges.length
        ? booleanPolys(object.sparse, unionPolys(bridgeArea(bridges)), 'diff')
        : object.sparse
      const segs = patternSegments(
        sparseRegion,
        ls.infillPattern,
        ls.infillDensity,
        localLineW,
        li,
        false,
        ls.infillAngle,
        infillReport,
      )
      emitSegments(
        writer,
        segs,
        speeds.infill,
        'sparse',
        accel.infill,
        (seg) => (inBridge(li, seg) ? speeds.bridge : inOverhang(li, seg) ? overhangSpeed : speeds.infill),
        (seg) => (inBridge(li, seg) ? 'bridge' : inOverhangArea(li, seg) ? 'overhang' : 'sparse'),
        (seg) => (inBridge(li, seg) ? ls.bridgeFlow : 1),
        (seg) => (inBridge(li, seg) ? accel.bridge : accel.infill),
        ls.printOrder.paths,
        infillReport,
        ls.printOrder.continuous,
        Math.max(0.6, localLineW * 1.5),
      )
      for (const bridge of bridges) {
        emitSegments(
          writer,
          bridge.lines,
          speeds.bridge,
          'solid',
          accel.bridge,
          undefined,
          () => 'bridge',
          () => ls.bridgeFlow,
          () => accel.bridge,
          ls.printOrder.paths,
          infillReport,
          false,
          Math.max(0.6, localLineW * 1.5),
        )
      }
    }

    // Gewünschte Reihenfolge pro Schicht: zuerst alle Umrandungen der
    // Bauteile, danach die Flächen Teil für Teil. So liegen die Wände aller
    // Objekte vor der ersten Füllung; die Füllung unterbricht die Schicht
    // innerhalb der Objekte nicht, sondern arbeitet ein Objekt nach dem
    // anderen ab.
    const objects = splitLayerObjects(L, previousObjects)
    // Auf sichtbaren Deckschichten wird der Fahrweg-Schutz vor der ersten
    // Wand aktiv: Schon die Fahrt vom Schichtwechsel zur Wand kann über den
    // zuvor gedruckten Wulst ziehen.
    const layerTopCount = settings.special?.vase || openShell ? 0 : Math.max(1, Math.round(L.settings.topLayers))
    if (layerTopCount > 0 && li >= layers.length - layerTopCount) writer.markTopSurface()
    const orderedObjects =
      L.settings.printOrder.paths === 'generated' ? objects : orderLayerObjects(objects, writer.pos)
    if (L.settings.printOrder.layer === 'infill-first') {
      for (const object of orderedObjects) {
        printSkin(object)
        printSparse(object)
      }
      for (const object of orderedObjects) printWalls(object)
    } else {
      for (const object of orderedObjects) printWalls(object)
      for (const object of orderedObjects) {
        printSkin(object)
        printSparse(object)
      }
    }
    previousObjects = orderedObjects

    // Stützstrukturen: Kontaktlage zuletzt und langsamer, damit sie sich löst
    if (support) {
      const sup = support.area[li]
      const iface = support.interfaceArea[li]
      if (sup?.length) {
        const pattern = settings.support.pattern
        emitSegments(
          writer,
          supportSegments(sup, pattern, settings.support.density, li),
          speeds.support,
          'support',
          accel.support,
          undefined,
          undefined,
          undefined,
          undefined,
          settings.printOrder.paths,
          infillReport,
          settings.printOrder.continuous,
          Math.max(0.6, lineW * 1.5),
        )
      }
      if (iface?.length) {
        const segs = supportSegments(
          iface,
          settings.support.interfacePattern,
          Math.max(20, settings.support.interfaceDensity),
          li,
        )
        emitSegments(
          writer,
          segs,
          speeds.supportInterface,
          'support',
          accel.supportInterface,
          undefined,
          undefined,
          undefined,
          undefined,
          settings.printOrder.paths,
          infillReport,
          settings.printOrder.continuous,
          Math.max(0.6, lineW * 1.5),
        )
      }
    }

    // Glätten (Ironing): nur oberste Schicht oder alle Deckschichten.
    const isLast = li === layers.length - 1
    const ironingNow =
      settings.ironing.type === 'solid'
        ? isLast || (L.skin.length > 0 && li >= layers.length - topLayers)
        : isLast
    if (settings.ironing.enabled && ironingNow) {
      const top = surfaceAbove[li]
      const guardInset = guardOn ? Math.max(0, guard.ironingInset ?? 0) : 0
      const inset = Math.max(0, settings.ironing.inset ?? 0, guardInset)
      const area = top && top.length && inset > 0 ? offsetPolys(top, -inset) : top
      if (area && area.length) {
        if (settings.ironing.pattern === 'concentric') {
          // Ringe von außen nach innen — gleichmäßiger auf runden und quadratischen Flächen.
          for (let k = 0; k < 2000; k++) {
            const rings = offsetPolys(area, -(settings.ironing.spacing * (k + 0.5)))
            if (!rings.length) break
            for (const ring of rings) {
              if (ring.length < 3) continue
              writer.path(
                { pts: ring, closed: true, kind: 'iron' },
                settings.ironing.speed,
                settings.ironing.flow,
                accel.solid,
              )
            }
          }
        } else {
          const segs =
            settings.ironing.pattern === 'grid'
              ? [
                  ...clipLines(area, settings.ironing.angle, settings.ironing.spacing, infillReport),
                  ...clipLines(area, settings.ironing.angle + 90, settings.ironing.spacing, infillReport),
                ]
              : clipLines(area, settings.ironing.angle, settings.ironing.spacing, infillReport)
          const ordered =
            settings.printOrder.paths === 'shortest'
              ? orderSegments(segs, writer.pos, infillReport)
              : { segs, flipped: segs.map(() => false) }
          for (let i = 0; i < ordered.segs.length; i++) {
            const s = ordered.segs[i]
            const a = ordered.flipped[i] ? s.b : s.a
            const b = ordered.flipped[i] ? s.a : s.b
            writer.path(
              { pts: [a, b], closed: false, kind: 'iron' },
              settings.ironing.speed,
              settings.ironing.flow,
              accel.solid,
            )
          }
        }
      }
    }

    // Eigene Deckflächenabtastung: Die normale Deckschicht bleibt als
    // geschlossene Auflage stehen. Darauf wird ein erhöhtes Höhenfeld gelegt.
    // Auf der letzten Schicht ist der volle Aufbau erlaubt; auf tieferen
    // freiliegenden Stufen wird er auf den Abstand zur nächsten Schicht
    // begrenzt, damit keine spätere Düsenbahn dagegen stößt.
    if (
      topLayers > 0 &&
      li >= layers.length - topLayers &&
      settings.fuzzySkin.mode !== 'off' &&
      settings.fuzzySkin.topSurfaces !== false &&
      settings.fuzzySkin.topPattern !== 'none' &&
      textureZoneAt(settings.fuzzySkin.textureZones, L.z) !== null
    ) {
      const exposed = booleanPolys(surfaceAbove[li], L.skin, 'and')
      // Platz für den Texture-Aufbau plus 0,2 mm Fahrthub und etwas Reserve.
      const zClearance = Math.max(0, profile.bed.z - L.z - 0.3)
      const nextClearance =
        li < layers.length - 1 ? Math.max(0, layers[li + 1].z - L.z - 0.05) : Infinity
      const amplitude = Math.min(
        topSurfaceTextureAmplitude(settings.fuzzySkin.thickness, L.height),
        zClearance,
        nextClearance,
      )
      const skinWidth =
        settings.topSurfaceLineWidth > 0 ? settings.topSurfaceLineWidth : lineW
      if (exposed.length && amplitude >= 0.08) {
        // Randabstand und Bahnabstand sind der eigentliche Kollisionsschutz:
        // keine Düse in der Wand, keine Nachbarbahn im Düsenradius.
        const inset = Math.max(0.35, settings.nozzle * 0.6, skinWidth * 0.8)
        const area = offsetPolys(exposed, -inset)
        const spacing = topSurfaceTextureSpacing(settings.nozzle, skinWidth, amplitude)
        if (area.length) {
          const segs = clipLines(
            area,
            settings.infillAngle + (li % 2) * 90,
            spacing,
            infillReport,
          )
          const ordered =
            settings.printOrder.paths === 'shortest'
              ? orderSegments(segs, writer.pos, infillReport, false, true)
              : { segs, flipped: segs.map(() => false) }
          for (let i = 0; i < ordered.segs.length; i++) {
            const seg = ordered.segs[i]
            const a = ordered.flipped[i] ? seg.b : seg.a
            const b = ordered.flipped[i] ? seg.a : seg.b
            writer.path(
              {
                pts: [a, b],
                closed: false,
                kind: 'solid',
                topSkin: true,
                topTexture: true,
                textureAmplitude: amplitude,
              },
              speeds.topSurface,
              settings.topSurfaceFlow,
              accel.topSurface,
            )
          }
        }
      }
    }
  }

  if (withEnd) writer.end()

  if (geomReport.openChains > 0) {
    warnings.push(
      `Geometrie: ${geomReport.openChains} offene Kontur(en) — das Mesh ist an diesen Stellen vermutlich nicht wasserdicht. G-Code prüfen und Modell reparieren.`,
    )
  }
  if (infillReport.truncated) {
    warnings.push(
      'Füllung: Die Sicherheitsgrenze von 40.000 Segmenten pro Muster wurde erreicht — betroffene Bereiche sind unvollständig. Dichte/Konturgröße prüfen.',
    )
  }
  if (infillReport.orderFallback) {
    warnings.push(
      'Füllung: Bei sehr vielen Segmenten wurde die Reihenfolge notdürftig fortgesetzt — es können lange Leerfahrten entstehen.',
    )
  }
  if (wallReport.omittedThinAreas > 0) {
    warnings.push(
      `Wände: ${wallReport.omittedThinAreas} dünne Fläche(n) konnten nicht geplant werden — dort fehlen Mittellinien.`,
    )
  }
  for (const warning of writer.flowWarnings) warnings.push(warning)
  for (const warning of writer.meshWarnings) warnings.push(warning)

  const seconds = writer.seconds * 1.12 + layers.length * 1.5
  // Verbrauch aus dem extrudierten Volumen: mm³ → cm³ → g (PLA 1,24 g/cm³)
  const filamentArea = Math.PI * (settings.filamentDiameter / 2) ** 2
  const filamentMm = writer.volumeMm3 / filamentArea
  const grams = (writer.volumeMm3 / 1000) * 1.24

  const res = writer.result()
  const maxZ = layers.reduce((max, layer) => Math.max(max, layer.z), 0)
  const gcode =
    opts.metadata === false
      ? res.gcode
      : withGcodeMetadata(res.gcode, {
          profile,
          settings,
          filaments: opts.filament ? [opts.filament] : [],
          seconds,
          filamentMm,
          filamentGrams: grams,
          layerCount: layers.length,
          maxZ,
        })
  if (opts.metadata !== false) {
    // Die Vorschau-Zeilen entstehen im Writer; der Metadatenkopf davor
    // verschiebt sie in der endgültigen Datei.
    shiftPreviewLines(res.layers, gcodeLineOffsetBefore(gcode, res.gcode.slice(0, 200)))
  }
  return {
    gcode,
    layers: res.layers,
    features: featureRows(writer.featureStats),
    stats: {
      estimatedSeconds: Math.round(seconds),
      filamentMm: Math.round(filamentMm),
      filamentGrams: Math.round(grams * 10) / 10,
      layerCount: layers.length,
      volumeCm3: Math.round(estimateVolume(placed) / 100) / 10,
      maxFlowMm3s: Math.round(writer.maxFlowMm3s * 10) / 10,
    },
    warnings,
  }
}

/** Wandelt die rohen Writer-Zähler in Legendenwerte mit Zeitanteil um. */
export function featureRows(
  stats: Map<PreviewFeatureKind, { seconds: number; volumeMm3: number }>,
): SliceFeatureStats[] {
  // Reisen bewegen nur die Düse; sie zählen nicht in die Extrusionsprozente.
  const total = [...stats.entries()]
    .filter(([kind]) => kind !== 'travel')
    .reduce((sum, [, entry]) => sum + entry.seconds, 0)
  return [...stats.entries()]
    .filter(([, entry]) => entry.seconds > 0 || entry.volumeMm3 > 0)
    .map(([kind, entry]) => ({
      kind,
      seconds: Math.round(entry.seconds * 10) / 10,
      grams: Math.round(((entry.volumeMm3 / 1000) * 1.24) * 100) / 100,
      percent: kind === 'travel' || total <= 0 ? 0 : Math.round((entry.seconds / total) * 1000) / 10,
    }))
}

/** Verschiebt eine vorhandene Preview-Zeilenkarte um einen G-Code-Kopf. */
export function shiftPreviewLines(layers: SliceResult['layers'], offset: number): void {
  if (!offset) return
  for (const layer of layers) {
    if (layer.lines) layer.lines = layer.lines.map((line) => line + offset)
  }
}

/** Anzahl der Zeilenumbrüche vor dem ersten Vorkommen eines Textstücks. */
export function gcodeLineOffsetBefore(text: string, chunk: string): number {
  const at = text.indexOf(chunk)
  if (at <= 0) return 0
  let lines = 0
  for (let index = 0; index < at; index++) {
    if (text.charCodeAt(index) === 10) lines++
  }
  return lines
}

/** Zeilenumbrüche in einem G-Code-Text — für Offset-Addition beim Zusammenbau. */
export function gcodeLineBreaks(text: string): number {
  let lines = 0
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 10) lines++
  }
  return lines
}

function contourSubset(loops: Poly[], type: 'outer_only' | 'inner_only' | 'combined'): Poly[] {
  if (type === 'outer_only') return loops.filter((poly) => signedArea(poly) >= 0)
  if (type === 'inner_only') return loops.filter((poly) => signedArea(poly) < 0)
  return loops
}

/**
 * Teilt die Polygone einer Schicht in einzelne Bauteile. Bisher wurden alle
 * Wände, Decklagen und Füllungen objektübergreifend geordnet; dadurch sprang
 * die Düse innerhalb einer Schicht ständig zwischen den Teilen hin und her.
 * Die Gruppierung erfolgt über die Außenkonturen; Löcher und Füllflächen werden
 * dem jeweils kleinsten enthaltenden Außenring zugeordnet.
 */
function splitLayerObjects(layer: LayerData, previous: LayerObject[] = []): LayerObject[] {
  const outers = layer.loops.filter((poly) => signedArea(poly) >= 0)
  if (outers.length <= 1) {
    return [
      { loops: layer.loops, inner: layer.inner, skin: layer.skin, sparse: layer.sparse },
    ]
  }

  const groups: LayerObject[] = outers.map((outer) => ({
    loops: [outer],
    inner: [],
    skin: [],
    sparse: [],
  }))

  const groupFor = (poly: Poly): LayerObject => {
    const sample = poly[0]
    let best = -1
    let bestArea = Infinity
    for (let i = 0; i < outers.length; i++) {
      if (!pointInPoly(outers[i], sample.x, sample.y)) continue
      const area = Math.abs(signedArea(outers[i]))
      if (area < bestArea) {
        bestArea = area
        best = i
      }
    }
    // Clipper kann einen Punkt genau auf eine Kante legen. Dann das räumlich
    // nächste Objekt nehmen, statt das Polygon zu verlieren.
    if (best < 0) {
      let bestDistance = Infinity
      for (let i = 0; i < outers.length; i++) {
        for (const p of outers[i]) {
          const d = (p.x - sample.x) ** 2 + (p.y - sample.y) ** 2
          if (d < bestDistance) {
            bestDistance = d
            best = i
          }
        }
      }
    }
    return groups[best]
  }

  for (const poly of layer.loops) if (signedArea(poly) < 0) groupFor(poly).loops.push(poly)
  for (const poly of layer.inner) groupFor(poly).inner.push(poly)
  for (const poly of layer.skin) groupFor(poly).skin.push(poly)
  for (const poly of layer.sparse) groupFor(poly).sparse.push(poly)

  // Ein Bauteil kann in einer Schicht in mehrere Außenkonturen zerfallen
  // (Durchbrüche, dünne Stege, Topfrand). Diese Inseln gehören weiterhin zum
  // selben Objekt. Über die vorherige Schicht werden sie wieder zusammengeführt,
  // damit die Düse nicht erst Teil A, dann B, dann wieder A druckt.
  if (!previous.length) return groups
  const merged = new Map<number, LayerObject>()
  let nextTrack = previous.length
  for (const group of groups) {
    const sample = group.loops[0][0]
    let track = -1
    let bestDistance = Infinity
    for (let i = 0; i < previous.length; i++) {
      if (!inLoops(previous[i].loops, sample.x, sample.y)) continue
      const d = objectDistance(previous[i], sample)
      if (d < bestDistance) {
        bestDistance = d
        track = i
      }
    }
    if (track < 0) {
      for (let i = 0; i < previous.length; i++) {
        const d = objectDistance(previous[i], sample)
        if (d < bestDistance) {
          bestDistance = d
          track = i
        }
      }
    }
    if (track < 0) track = nextTrack++
    let target = merged.get(track)
    if (!target) {
      target = { loops: [], inner: [], skin: [], sparse: [] }
      merged.set(track, target)
    }
    target.loops.push(...group.loops)
    target.inner.push(...group.inner)
    target.skin.push(...group.skin)
    target.sparse.push(...group.sparse)
  }
  return [...merged.values()]
}

/** Even-Odd-Test über mehrere Ringe (Löcher zählen als außerhalb). */
function inLoops(loops: Poly[], x: number, y: number): boolean {
  let inside = false
  for (const poly of loops) if (pointInPoly(poly, x, y)) inside = !inside
  return inside
}

/** Kürzeste Verbindung vom aktuellen Düsenstand zu einem Bauteil. */
function objectDistance(object: LayerObject, from: { x: number; y: number }): number {
  let best = Infinity
  for (const poly of object.loops) {
    for (const p of poly) {
      const d = (p.x - from.x) ** 2 + (p.y - from.y) ** 2
      if (d < best) best = d
    }
  }
  return best
}

/**
 * Objektreihenfolge innerhalb einer Schicht: immer das nächstgelegene noch
 * nicht gedruckte Bauteil. Innerhalb des Objekts bleibt die eingestellte
 * Reihenfolge (Wände/Decklage/Füllung) vollständig erhalten.
 */
function orderLayerObjects(objects: LayerObject[], from: { x: number; y: number }): LayerObject[] {
  const remaining = objects.slice()
  const out: LayerObject[] = []
  let current = from
  while (remaining.length) {
    let best = 0
    let bestDistance = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const d = objectDistance(remaining[i], current)
      if (d < bestDistance) {
        bestDistance = d
        best = i
      }
    }
    const picked = remaining.splice(best, 1)[0]
    out.push(picked)
    // Für die nächste Auswahl reicht ein Punkt am Ende des Objekts; die
    // Feinoptimierung übernimmt anschließend orderPaths() je Kontur.
    const outer = picked.loops[0]
    current = outer?.[outer.length - 1] ?? current
  }
  return out
}

/**
 * Reihenfolge geschlossener Ringe: nächster Einstieg über alle Ringpunkte,
 * danach eine 2-opt-Verbesserung. Damit werden auch Ringe getauscht, bei denen
 * die reine Greedy-Wahl eine unnötige Querfahrt erzeugt (z. B. Außenring weit
 * hinten, obwohl er am Ende der Schicht liegt).
 */
function orderPaths(polys: Poly[], from: { x: number; y: number }, order: PathOrder = 'shortest'): Poly[] {
  if (order === 'generated') return polys.slice()
  if (polys.length <= 1) return polys.slice()
  const n = polys.length

  // 1) Greedy: günstigster Ring, Einstieg über alle Punkte geprüft.
  const used = new Uint8Array(n)
  const seq: number[] = []
  let cur = from
  for (let step = 0; step < n; step++) {
    let best = -1
    let bestIdx = 0
    let bestD = Infinity
    for (let i = 0; i < n; i++) {
      if (used[i]) continue
      const poly = polys[i]
      for (let k = 0; k < poly.length; k++) {
        const d = (poly[k].x - cur.x) ** 2 + (poly[k].y - cur.y) ** 2
        if (d < bestD) { bestD = d; best = i; bestIdx = k }
      }
    }
    used[best] = 1
    seq.push(best)
    cur = polys[best][bestIdx]
  }

  const greedySeq = seq.slice()

  // 2) 2-opt über Ringanker (Einstiegspunkt des Greedy-Laufs). Nur bei
  // überschaubarer Ringzahl — bei Saum/Brim mit vielen Ringen lohnt es nicht.
  if (n >= 4 && n <= 200) {
    const anchor = seq.map((i) => {
      let idx = 0
      let best = Infinity
      for (let k = 0; k < polys[i].length; k++) {
        const d = (polys[i][k].x - from.x) ** 2 + (polys[i][k].y - from.y) ** 2
        if (d < best) { best = d; idx = k }
      }
      return polys[i][idx]
    })
    const D = (a: number, b: number) => Math.hypot(anchor[a].x - anchor[b].x, anchor[a].y - anchor[b].y)
    let improved = true
    let passes = 0
    while (improved && passes++ < 3) {
      improved = false
      for (let i = 0; i + 1 < seq.length; i++) {
        for (let j = i + 2; j < seq.length; j++) {
          const before = D(seq[i], seq[i + 1]) + (j + 1 < seq.length ? D(seq[j], seq[j + 1]) : 0)
          const after = D(seq[i], seq[j]) + (j + 1 < seq.length ? D(seq[i + 1], seq[j + 1]) : 0)
          if (after + 1e-6 < before) {
            const part = seq.slice(i + 1, j + 1).reverse()
            seq.splice(i + 1, part.length, ...part)
            improved = true
          }
        }
      }
    }
  }

  // 3) Ringe so drehen, dass sie dort beginnen, wo die Düse gerade steht.
  // Die 2-opt-Reihenfolge wird nur genommen, wenn sie real weniger Leerweg
  // erzeugt als die Greedy-Reihenfolge.
  const build = (order: number[]): { out: Poly[]; cost: number } => {
    const out: Poly[] = []
    let pos = from
    let cost = 0
    for (const i of order) {
      const poly = polys[i]
      let idx = 0
      let best = Infinity
      for (let k = 0; k < poly.length; k++) {
        const d = (poly[k].x - pos.x) ** 2 + (poly[k].y - pos.y) ** 2
        if (d < best) { best = d; idx = k }
      }
      const rotated = idx > 0 ? [...poly.slice(idx), ...poly.slice(0, idx)] : poly
      cost += Math.sqrt(best)
      out.push(rotated)
      pos = rotated[rotated.length - 1]
    }
    return { out, cost }
  }
  const candidate = build(seq)
  const base = build(greedySeq)
  return candidate.cost <= base.cost ? candidate.out : base.out
}

function emitSegments(
  writer: GcodeWriter,
  segs: Segment[],
  speed: number,
  kind: Extract<PathKind, 'solid' | 'sparse' | 'iron' | 'support'>,
  accel?: number,
  speedFor?: (seg: Segment) => number,
  kindFor?: (seg: Segment) => PathKind,
  flowFor?: (seg: Segment) => number,
  accelFor?: (seg: Segment) => number | undefined,
  order: PathOrder = 'shortest',
  report?: InfillReport,
  continuous = false,
  joinTolerance = 0.8,
  topSkin = false,
) {
  if (!segs.length) return
  const ordered =
    order === 'shortest'
      ? orderSegments(segs, writer.pos, report, false, topSkin)
      : { segs, flipped: segs.map(() => false) }

  // Continuous-Path-Compiler: Benachbarte Segmente mit nahezu gleichem Ende
  // werden zu einer einzigen Bahn verkettet. Der kurze Verbinder wird
  // mitgedruckt (typisch an Grid-Kreuzungen), statt als Leerfahrt zu zählen.
  type Run = {
    kind: PathKind
    speed: number
    flow: number
    accel: number | undefined
    topSkin: boolean
    pts: { x: number; y: number }[]
  }
  const runs: Run[] = []
  for (let i = 0; i < ordered.segs.length; i++) {
    const s = ordered.segs[i]
    const a = ordered.flipped[i] ? s.b : s.a
    const b = ordered.flipped[i] ? s.a : s.b
    const segKind = kindFor?.(s) ?? kind
    const runSpeed = speedFor?.(s) ?? speed
    const runFlow = flowFor?.(s) ?? 1
    const runAccel = accelFor?.(s) ?? accel
    const last = runs[runs.length - 1]
    const gap = last
      ? Math.hypot(a.x - last.pts[last.pts.length - 1].x, a.y - last.pts[last.pts.length - 1].y)
      : Infinity
    const join =
      continuous &&
      last &&
      last.kind === segKind &&
      last.speed === runSpeed &&
      last.flow === runFlow &&
      last.accel === runAccel &&
      gap <= joinTolerance
    if (join) {
      last.pts.push(b)
    } else {
      runs.push({ kind: segKind, speed: runSpeed, flow: runFlow, accel: runAccel, topSkin, pts: [a, b] })
    }
  }
  for (const run of runs) {
    writer.path({ pts: run.pts, closed: false, kind: run.kind, topSkin: run.topSkin }, run.speed, run.flow, run.accel)
  }
}

/** Punkt-in-Polygon (Even-Odd) für die Überhanggeschwindigkeit. */
function pointInPoly(poly: Poly, x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y
    const xj = poly[j].x, yj = poly[j].y
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function estimateVolume(mesh: Mesh): number {
  let vol = 0
  const p = mesh.positions
  for (let t = 0; t < mesh.triangles; t++) {
    const i = t * 9
    const ax = p[i], ay = p[i + 1], az = p[i + 2]
    const bx = p[i + 3], by = p[i + 4], bz = p[i + 5]
    const cx = p[i + 6], cy = p[i + 7], cz = p[i + 8]
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6
  }
  return Math.abs(vol)
}

