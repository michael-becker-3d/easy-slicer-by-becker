/*
 * Proprietaerer Bestandteil der Easy-Slicer-Slice-Engine.
 * Copyright (c) 2026 Michael Becker. Alle Rechte vorbehalten.
 * Nutzung nur im Rahmen von LICENSE und LICENSE-SLICE-ENGINE.md.
 */
import type { SupportSettings } from '../../shared/types.ts'
import { booleanPolys, offsetPolys, signedArea, unionPolys, type Poly } from './clipper.ts'
import type { Mesh } from './stl.ts'

/** Gemalte Stützen-Markierung in Weltkoordinaten (Anteil → mm im Slicer). */
export type PaintCircle = { x: number; y: number; z?: number; r: number }
export type PaintSupport = { force: PaintCircle[]; block: PaintCircle[] }

function circlePoly(x: number, y: number, r: number, segments = 24): Poly {
  const out: Poly = []
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2
    out.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r })
  }
  return out
}

export type SupportPlan = {
  /** Stützfläche je Schicht (ohne Kontaktlagen) */
  area: Poly[][]
  /** Verdichtete Kontaktlage je Schicht */
  interfaceArea: Poly[][]
  /** Schichten mit Überhang über dem Grenzwinkel */
  overhangLayers: number
}

/**
 * Projiziert tatsächlich nach unten weisende Dreiecke je Schicht. Der Winkel
 * wird wie in den gängigen Slicern von der Senkrechten gemessen: 0° stützt
 * jede nach unten weisende Fläche, 90° keine. Die Projektion ergänzt die
 * Schichtdifferenz, damit auch Überhänge an Außenwänden und steile Flächen
 * erkannt werden, die in der reinen Footprint-Differenz untergehen.
 */
export function meshOverhangSeeds(
  mesh: Mesh,
  layers: { z: number; height: number }[],
  thresholdDeg: number,
): Poly[][] {
  const n = layers.length
  const out: Poly[][] = Array.from({ length: n }, () => [])
  if (!n || !mesh.triangles) return out
  const threshold = Math.max(0, Math.min(90, thresholdDeg))
  const minNormalZ = -Math.sin((threshold * Math.PI) / 180)
  const topZ = layers.map((layer) => layer.z)
  const p = mesh.positions

  const firstAtOrAbove = (value: number): number => {
    let lo = 0
    let hi = n
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (topZ[mid] < value) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  const lastAtOrBelow = (value: number): number => {
    let lo = -1
    let hi = n - 1
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      if (topZ[mid] <= value) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  for (let t = 0; t < mesh.triangles; t++) {
    const i = t * 9
    const ax = p[i], ay = p[i + 1], az = p[i + 2]
    const bx = p[i + 3], by = p[i + 4], bz = p[i + 5]
    const cx = p[i + 6], cy = p[i + 7], cz = p[i + 8]
    // Geometrische Normale aus der Windung; STL-Normalen sind oft unzuverlässig.
    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz)
    if (len < 1e-9) continue
    if (nz / len >= minNormalZ) continue

    const zMin = Math.min(az, bz, cz)
    const zMax = Math.max(az, bz, cz)
    const first = firstAtOrAbove(zMin - 1e-6)
    const last = lastAtOrBelow(zMax + 1e-6)
    if (first >= n || last < first) continue
    const poly: Poly = [
      { x: ax, y: ay },
      { x: bx, y: by },
      { x: cx, y: cy },
    ]
    if (Math.abs(signedArea(poly)) < 1e-4) continue
    for (let layer = first; layer <= last; layer++) out[layer].push(poly)
  }

  for (let i = 0; i < n; i++) {
    if (out[i].length > 1) out[i] = unionPolys(out[i])
  }
  return out
}

/**
 * Projiziert Überhänge schichtweise nach unten. „Normal“ hält die Säule
 * senkrecht, „Baum“ weitet sie nach unten auf (branchAngle), damit sie
 * breiter steht als die Kontaktfläche. Zwischen Bauteil und Stütze bleiben
 * XY- und Z-Abstand frei, die obersten Lagen werden verdichtet.
 */
/**
 * Baum: Überhangflächen zu runden Astspitzen verrunden. Dadurch wachsen
 * benachbarte Äste beim Aufweiten zu einem gemeinsamen Stamm zusammen,
 * statt als breite Platte unter dem Überhang zu stehen.
 */
function treeTips(polys: Poly[]): Poly[] {
  const out: Poly[] = []
  for (const poly of polys) {
    const area = Math.abs(signedArea(poly))
    const r = Math.min(3, Math.max(0.8, Math.sqrt(area / Math.PI) * 0.45))
    const shrunk = offsetPolys([poly], -r)
    const rounded = shrunk.length ? offsetPolys(shrunk, r) : []
    out.push(...(rounded.length ? rounded : [poly]))
  }
  return out
}

export function planSupport(
  layers: { loops: Poly[]; inner: Poly[]; z: number; height: number }[],
  settings: SupportSettings,
  seeds?: Poly[][] | null,
  /** Gemalte Bereiche: erzwingen Stützen oder sperren sie aus. */
  marks?: PaintSupport | null,
): SupportPlan {
  const n = layers.length
  const area: Poly[][] = Array.from({ length: n }, () => [])
  const interfaceArea: Poly[][] = Array.from({ length: n }, () => [])
  const plan: SupportPlan = { area, interfaceArea, overhangLayers: 0 }
  if (settings.kind === 'none' || n < 2) return plan

  const ifaceLayers = Math.max(0, Math.round(settings.interfaceLayers))
  const threshold = Math.max(0, Math.min(80, settings.threshold))
  const xy = Math.max(0.01, settings.xyDistance)
  const zDistance = Math.max(0, Number.isFinite(settings.zDistance) ? settings.zDistance : 0)
  const branchSlope =
    settings.kind === 'tree'
      ? Math.tan((Math.max(0, Math.min(70, settings.branchAngle)) * Math.PI) / 180)
      : 0

  // Der Z-Abstand ist eine physikalische Höhe, keine Anzahl Schichten. Bei
  // adaptiven Schichthöhen darf deshalb nicht mit einem Mittelwert gerechnet
  // werden: Die Stützspitze liegt auf der Oberkante der höchsten Schicht,
  // deren Abstand zur Unterseite des Überhangs den Wunschwert erreicht.
  const gapCache = new Map<number, number>()
  const gapFor = (src: number): number => {
    const cached = gapCache.get(src)
    if (cached !== undefined) return cached
    const overhangBottom = layers[src].z - layers[src].height
    let gap = 1
    while (gap < src) {
      const supportTop = src - gap
      const actualGap = overhangBottom - layers[supportTop].z
      if (actualGap >= zDistance - 1e-6) break
      gap++
    }
    gap = Math.min(gap, src)
    gapCache.set(src, gap)
    return gap
  }

  // Ein Überhang ist der Bereich einer Schicht, der über die darunterliegende
  // hinausragt — gemessen ab dem Grenzwinkel (Schichthöhe × tan(Winkel)).
  const cache = new Map<number, Poly[]>()
  const overhangAt = (i: number): Poly[] => {
    if (i < 1 || i >= n) return []
    const hit = cache.get(i)
    if (hit) return hit
    const band = Math.max(0.01, layers[i].height * Math.tan((threshold * Math.PI) / 180))
    const supported = layers[i - 1].loops.length ? offsetPolys(layers[i - 1].loops, band) : []
    let out: Poly[] = []
    if (layers[i].loops.length) {
      out = supported.length ? booleanPolys(layers[i].loops, supported, 'diff') : layers[i].loops
    }
    cache.set(i, out)
    return out
  }

  // Jede Überhangschicht hat ihre eigene Stützspitze. Bei gemischten
  // Schichthöhen können mehrere Quellen dieselbe Trägerlage haben; deshalb
  // werden sie vor dem Abstieg nach ihrer tatsächlichen Spitzenlage gruppiert.
  const sourcesByTop = new Map<number, number[]>()
  for (let src = 1; src < n; src++) {
    const top = src - gapFor(src)
    if (top < 0 || top >= n) continue
    const list = sourcesByTop.get(top)
    if (list) list.push(src)
    else sourcesByTop.set(top, [src])
  }

  const interfaceMarks = new Set<number>()
  let carry: Poly[] = []

  for (let i = n - 1; i >= 0; i--) {
    for (const src of sourcesByTop.get(i) ?? []) {
      const detected = overhangAt(src)
      const seeded = seeds?.[src] ?? []
      const ov = seeded.length
        ? unionPolys([...detected, ...seeded])
        : detected
      if (ov.length) {
        plan.overhangLayers++
        const tips = settings.kind === 'tree' ? treeTips(ov) : ov
        const grown = offsetPolys(tips, xy)
        if (grown.length) {
          carry = carry.length ? booleanPolys(carry, grown, 'or') : grown
          for (let k = i - ifaceLayers + 1; k <= i; k++) {
            if (k >= 0 && k < n) interfaceMarks.add(k)
          }
        }
      }
    }

    let zone = carry
    // Gemalte Stützen: senkrechte Säule von der Markierung bis zum Bett.
    // Der Anteil läuft über `carry` nach unten weiter, damit die Säule steht.
    if (marks?.force?.length) {
      const forced = marks.force
        .filter((m) => (m.z ?? 0) >= layers[i].z)
        .map((m) => circlePoly(m.x, m.y, m.r))
      if (forced.length) {
        const add = unionPolys(forced)
        zone = zone.length ? booleanPolys(zone, add, 'or') : add
        carry = carry.length ? booleanPolys(carry, add, 'or') : add
        plan.overhangLayers = Math.max(plan.overhangLayers, 1)
      }
    }
    if (zone.length && layers[i].inner.length) {
      const keepOff = offsetPolys(layers[i].inner, xy)
      if (keepOff.length) zone = booleanPolys(zone, keepOff, 'diff')
    }
    // Gemalte Blocker gewinnen: dort wächst keine Stütze, auch keine erzwungene.
    if (zone.length && marks?.block?.length) {
      const blocked = unionPolys(marks.block.map((m) => circlePoly(m.x, m.y, m.r)))
      if (blocked.length) zone = booleanPolys(zone, blocked, 'diff')
    }

    if (zone.length) {
      const iface = interfaceMarks.has(i) ? zone : []
      interfaceArea[i] = iface
      area[i] = iface.length ? booleanPolys(zone, iface, 'diff') : zone
    }

    // Die Baumaufweitung ist ein Weg pro tatsächlicher Schichthöhe. Ein
    // gemittelter Wert würde bei feinen Kontaktlagen zu breite und bei
    // dicken Schichten zu schmale Stämme erzeugen.
    if (carry.length && branchSlope > 0) {
      carry = offsetPolys(carry, branchSlope * Math.max(0.01, layers[i].height))
    }
  }

  return plan
}
