/*
 * Proprietaerer Bestandteil der Easy-Slicer-Slice-Engine.
 * Copyright (c) 2026 Michael Becker. Alle Rechte vorbehalten.
 * Nutzung nur im Rahmen von LICENSE und LICENSE-SLICE-ENGINE.md.
 */
import { buildEndGcode, buildStartGcode, type PrimeLinePlan } from '../../shared/gcode-templates.ts'
import { inputShaperGcode, isKlipperFlavor, pressureAdvanceGcode } from '../../shared/gcode-flavors.ts'
import { machineOffset, mergeSettings } from '../../shared/types.ts'
import type {
  BedMesh,
  CustomGcode,
  DeepPartial,
  PreviewFeatureKind,
  PreviewLayer,
  PrintSettings,
  PrinterProfile,
} from '../../shared/types.ts'
import { PREVIEW_KIND_CODE } from '../../shared/preview.ts'
import { arcLength as fittedArcLength, arcPointAt, findLongestArc } from '../../shared/arcFitting.ts'
import {
  surfaceTextureDetail,
  surfaceTextureOffset,
  topSurfaceTextureHeight,
  textureZoneAt,
} from '../../shared/surfaceTexture.ts'
import type { Pt } from './clipper.ts'

export type PathKind = PreviewFeatureKind

export type PrintPath = {
  pts: Pt[]
  closed: boolean
  kind: PathKind
  /** Startwinkel für Saum/Umrandung; 0° zeigt nach +X. */
  startAngle?: number
  /**
   * Abweichende Extrusionsbreite in mm (Arachne-Wände): dünne Stellen werden
   * mit einer schmaleren Bahn gefüllt, statt eine Lücke zu lassen.
   */
  width?: number
  /** Sichtbare Deckschicht: kurze Wege bleiben hier vorsichtiger. */
  topSkin?: boolean
  /**
   * Deckflächentextur: Der Writer tastet entlang dieser Bahn ein Höhenfeld
   * ab und hebt die Düse nur nach oben an. Die Bahn bleibt zweidimensional;
   * Z und der zusätzliche Materialfluss entstehen erst aus den Einstellungen.
   */
  topTexture?: boolean
  /** Sicherer Aufbau dieser Deckflächentextur; begrenzt auch die Abtastung. */
  textureAmplitude?: number
  /**
   * Vasen-Spirale: Die Bahn steigt über ihre eigene Länge von der
   * Schichtunterkante bis zur Oberkante, statt dass die Düse pro Schicht
   * anhebt. Nur für eine einzige, geschlossene Außenwand sinnvoll.
   */
  spiral?: boolean
}

/** Interne Z-/Flussrampe einer Scarf-Naht. */
type ScarfPlan = {
  z: number[]
  /** Flussfaktor inklusive der wirksamen Schichthöhe. */
  flowScale: number[]
}

type ScarfConfig = {
  length: number
  startFraction: number
  steps: number
  flow: number
  step: number
}

export type FeatureAccum = { seconds: number; volumeMm3: number }

/** Änderungen ab einer bestimmten Schichthöhe (Kalibrier-Türme). */
export type LayerOverride = {
  atZ: number
  lines?: string[]
  settings?: DeepPartial<PrintSettings>
  /** Zeilen für das Druckende, etwa um eine testweise SCV zurückzusetzen. */
  endLines?: string[]
}


/**
 * Größte Mesh-Abweichung, die noch als Bettschlag gilt. Ein gespeichertes
 * Mesh mit mehreren Millimetern Offset ist ein Messfehler (falsche Nullage
 * oder Einheit) und würde die Düse ins Bett ziehen.
 */
const MESH_REJECT_MM = 2

/** Bilineare Z-Korrektur aus dem gemessenen Bett-Mesh. */
export function sampleMesh(mesh: BedMesh, x: number, y: number): number {
  const { cols, rows, x0, y0, dx, dy, z } = mesh
  const fx = Math.min(cols - 1, Math.max(0, (x - x0) / dx))
  const fy = Math.min(rows - 1, Math.max(0, (y - y0) / dy))
  const ix = Math.floor(fx), iy = Math.floor(fy)
  const tx = fx - ix, ty = fy - iy
  const z00 = z[iy]?.[ix] ?? 0
  const z10 = z[iy]?.[ix + 1] ?? z00
  const z01 = z[iy + 1]?.[ix] ?? z00
  const z11 = z[iy + 1]?.[ix + 1] ?? z01
  const a = z00 + (z10 - z00) * tx
  const b = z01 + (z11 - z01) * tx
  return a + (b - a) * ty
}

/** Filamentangaben für den Mainsail-/Moonraker-Metadatenblock. */
export type GcodeFilamentMetadata = {
  type: string
  color?: string
  name?: string
  density?: number
}

export type GcodeFileMetadata = {
  profile: PrinterProfile
  settings: PrintSettings
  filaments: GcodeFilamentMetadata[]
  seconds: number
  filamentMm: number
  filamentGrams: number
  layerCount: number
  maxZ: number
  toolChanges?: number
}

export type WriterOptions = {
  settings: PrintSettings
  profile: PrinterProfile
  bedMesh: BedMesh | null
  overrides?: LayerOverride[]
  /**
   * Höhenbereichs-Modifier: liefert die vollständigen Einstellungen für eine
   * Schicht. Kalibrier-Overrides werden anschließend zusätzlich angewendet.
   */
  layerSettings?: (z: number) => PrintSettings
  /** Eigener G-Code aus dem Drucker-Menü */
  customGcode?: CustomGcode
  /** Bereits auf freien Platz geprüfte Prime-Linie */
  primeLine?: PrimeLinePlan | null
  /**
   * Mehrfarbdruck je Schicht: `G92 E0` am Schichtanfang, damit jeder
   * Schichtblock für sich absolut rechnet und beliebig eingesetzt werden kann.
   */
  resetExtruderEachLayer?: boolean
}

export class GcodeWriter {
  private out: string[] = []
  private settings: PrintSettings
  private overrides: LayerOverride[]
  private endLines: string[]
  private overrideIdx = 0

  private e = 0
  private x = 0
  private y = 0
  private z = 0
  private retracted = false
  private fanOn = false
  private layerZ = 0
  private layerIdx = 0
  /** Z am Ende der vorherigen Schicht — verhindert ein Zurückfallen der Spirale. */
  private previousLayerEndZ = 0
  /** Tatsächliche Höhe der aktuellen Schicht (kann durch Zusammenlegen größer sein). */
  private layerHeight = 0
  private dx = 0
  private dy = 0
  private lastSeam = { x: 0, y: 0 }
  private layerStartedAt = 0
  private currentAccel = 0
  private lastRampPa: number | null = null
  private lineNo = 1
  private currentPathKind: PathKind = 'travel'
  private roleStarted = new Set<string>()
  private lastRetractAmount = 0
  private lastPathKind: PathKind = 'travel'
  private lastPathTopSkin = false
  /** Letzte Bahn war Deckflächentextur — Fahrten brauchen den vollen Hub. */
  private lastPathTexture = false
  private lastPathTextureRise = 0
  /** Sichtbare Deckschicht dieser Schicht — Fahrten bekommen einen Extra-Hub. */
  private topSurfaceActive = false
  /** Wischen wurde aufgeschoben, bis die nächste Bahn bekannt ist. */
  private pendingWipe = false

  seconds = 0
  /** Länge aller Extrusionsbahnen in mm */
  filamentMm = 0
  /** extrudiertes Volumen in mm³ */
  volumeMm3 = 0
  maxFlowMm3s = 0
  layers: PreviewLayer[] = []
  segmentsTotal = 0
  /** Extrusionszeit und Volumen je Bahntyp für die Vorschau-Legende. */
  featureStats = new Map<PreviewFeatureKind, FeatureAccum>()
  /** Bahnen, bei denen der Volumenstrom die gewählte Geschwindigkeit gekappt hat. */
  private flowCaps = new Map<
    string,
    { requested: number; max: number; width: number; height: number; flow: number; limit: number }
  >()
  /** Vasenmodus: Schichten, in denen negative Mesh-Werte auf die nominelle Höhe begrenzt wurden. */
  private meshClampLayers = new Set<number>()
  private meshClampMaxDeviation = 0
  /** Vasenmodus: Schichten, in denen die Spirale ganz ohne Mesh-Kompensation läuft. */
  private spiralMeshFallbackLayers = new Set<number>()
  private spiralMeshFallbackMaxDeviation = 0
  /** Schichten, in denen ein Mesh-Wert Z unter 0 gezogen hätte (jeder Modus). */
  private meshFloorLayers = new Set<number>()
  private meshFloorMaxDeviation = 0
  /** Gespeichertes Mesh war unplausibel und wurde nicht angewendet. */
  private meshRejectedDeviation = 0

  constructor(private opts: WriterOptions) {
    this.settings = opts.settings
    this.overrides = [...(opts.overrides ?? [])].sort((a, b) => a.atZ - b.atZ)
    this.endLines = this.overrides.flatMap((override) => override.endLines ?? [])
    const off = machineOffset(opts.profile)
    this.dx = off.dx
    this.dy = off.dy
  }

  /** Extrusionsbreite — Linienbreite, sonst Düsendurchmesser. */
  private baseWidth(): number {
    return this.settings.lineWidth > 0 ? this.settings.lineWidth : this.settings.nozzle
  }

  /**
   * Orca-artige Linienbreiten: Die erste Schicht und die sichtbaren
   * Außenwände dürfen getrennt eingestellt werden. 0 oder ein fehlender Wert
   * fällt auf die allgemeine Linienbreite zurück.
   */
  private widthFor(kind?: PathKind): number {
    const fallback = this.baseWidth()
    if (this.layerIdx === 0 && this.settings.firstLayerLineWidth > 0) {
      return this.settings.firstLayerLineWidth
    }
    if (kind === 'outer-wall' && this.settings.outerWallLineWidth > 0) return this.settings.outerWallLineWidth
    if (kind === 'inner-wall' && this.settings.innerWallLineWidth > 0) return this.settings.innerWallLineWidth
    if (kind === 'solid' && this.settings.topSurfaceLineWidth > 0) return this.settings.topSurfaceLineWidth
    return fallback
  }

  get pos(): { x: number; y: number } {
    return { x: this.x, y: this.y }
  }

  /**
   * Die nach allen Layer-Overrides gültigen Einstellungen. Der Slicer liest
   * daraus die Geschwindigkeiten/Beschleunigungen für die aktuelle Schicht;
   * sonst würden Kalibrier-Türme zwar neue Befehle schreiben, aber weiter mit
   * den Werten der ersten Schicht drucken.
   */
  get currentSettings(): PrintSettings {
    return this.settings
  }

  /** Ab hier gehören Fahrten zur sichtbaren Deckschicht. */
  markTopSurface() {
    if (!this.topSurfaceActive) this.line('; Oberflaechenschutz: Deckschicht-Fahrten mit Extra-Hub')
    this.topSurfaceActive = true
  }

  private printAccel(): number {
    return Math.max(100, this.settings.accelerations?.print ?? 3000)
  }

  private travelAccel(): number {
    return Math.max(100, this.settings.accelerations?.travel ?? 5000)
  }

  /**
   * Fahrzeit einer Bewegung mit Beschleunigen und Abbremsen.
   *
   * Strecke/Geschwindigkeit allein ist zu optimistisch: Jede Bahn muss erst
   * beschleunigen und am Ende wieder bremsen. Reicht die Strecke nicht für die
   * Endgeschwindigkeit, fährt die Achse ein Dreiecksprofil.
   */
  private moveSeconds(dist: number, speed: number, accel: number): number {
    if (!(dist > 0)) return 0
    const v = Math.max(0.1, speed)
    const a = Math.max(50, accel)
    const ramp = (v * v) / a
    return dist >= ramp ? dist / v + v / a : 2 * Math.sqrt(dist / a)
  }

  private fmt(n: number, d = 3): string {
    return n.toFixed(d).replace(/\.?0+$/, '') || '0'
  }

  private line(s: string) {
    if (this.settings.output?.lineNumbers && !s.trimStart().startsWith(';')) {
      this.out.push(`N${this.lineNo++} ${s}`)
    } else {
      this.out.push(s)
    }
  }

  /**
   * Platzhalter in eigenem G-Code ersetzen. Unterstützt die eigenen
   * {firstLayerBed}-Platzhalter und die Orca-/FlashForge-Schreibweise mit
   * eckigen Klammern, damit kopierte Startblöcke nicht wörtlich im G-Code
   * landen. Der Ausdruck `T{single_extruder_multi_material ? 0 :
   * initial_extruder}` wird für den AD5X zu T0.
   */
  private customLines(text: string | undefined, extra: Record<string, string> = {}): string[] {
    if (!text?.trim()) return []
    const values: Record<string, string> = {
      nozzle: String(this.settings.temps.nozzle),
      firstLayerNozzle: String(this.settings.temps.firstLayerNozzle),
      bed: String(this.settings.temps.bed),
      firstLayerBed: String(this.settings.temps.firstLayerBed),
      layer: String(this.layerIdx + 1),
      z: this.fmt(this.layerZ, 2),
      ...extra,
    }
    const bracketValues: Record<string, string> = {
      nozzle_temperature_initial_layer: values.firstLayerNozzle,
      nozzle_temperature: values.nozzle,
      bed_temperature_initial_layer_single: values.firstLayerBed,
      bed_temperature: values.bed,
      first_layer_temperature: values.firstLayerNozzle,
      first_layer_bed_temperature: values.firstLayerBed,
      initial_layer_print_height: this.fmt(this.settings.firstLayerHeight, 3),
      layer_height: this.fmt(this.settings.layerHeight, 3),
      nozzle_diameter: this.fmt(this.settings.nozzle, 3),
      filament_diameter: this.fmt(this.settings.filamentDiameter, 3),
      printer_model: this.opts.profile.name,
      printer_settings_id: this.opts.profile.name,
      initial_extruder: '0',
    }
    if (extra.totalLayerCount) bracketValues.total_layer_count = extra.totalLayerCount
    return text
      .split('\n')
      .map((line) => {
        return line
          // T{single_extruder_multi_material ? 0 : initial_extruder}
          .replace(/\{\s*single_extruder_multi_material\s*\?\s*0\s*:\s*initial_extruder\s*\}/g, '0')
          // START_PRINT ... {single_extruder_multi_material ? "; T0" : "T" + initial_extruder}
          .replace(
            /\{\s*single_extruder_multi_material\s*\?\s*";\s*T0"\s*:\s*"T"\s*\+\s*initial_extruder\s*\}/g,
            '; T0',
          )
          // Manche Profile setzen denselben Ausdruck in eckige Klammern.
          .replace(/\[single_extruder_multi_material\s*\?\s*0\s*:\s*initial_extruder\]/g, '0')
          .replace(/\{(\w+)\}/g, (m, key: string) => values[key] ?? m)
          .replace(/\[([a-zA-Z0-9_]+)\]/g, (m, key: string) => bracketValues[key] ?? m)
          .trimEnd()
      })
      .filter((line) => line.trim().length > 0)
  }

  /** PA-Befehl passend zur Firmware — auch für den Linientest. */
  private pressureAdvanceLine(value: number): string {
    const v = this.fmt(Math.max(0, Math.min(2, Number(value) || 0)), 4)
    return pressureAdvanceGcode(this.opts.profile.flavor, v)
  }

  /**
   * Das gespeicherte Mesh nur anwenden, wenn es wie ein Bettschlag aussieht.
   * Ein Mesh mit mehreren Millimetern Offset stammt aus einer falschen Messung
   * (Nullage, Einheit, abgebrochener Lauf) und würde jede Schicht um genau
   * diesen Betrag verschieben — im schlimmsten Fall unter das Bett.
   */
  private usableMesh(): BedMesh | null {
    const mesh = this.opts.bedMesh
    if (!mesh) return null
    if (this.meshRejectedDeviation > 0) return null
    let max = 0
    for (const row of mesh.z) {
      for (const value of row) {
        const magnitude = Math.abs(value)
        if (Number.isFinite(magnitude) && magnitude > max) max = magnitude
      }
    }
    if (max > MESH_REJECT_MM) {
      this.meshRejectedDeviation = max
      return null
    }
    return mesh
  }

  private zAt(x: number, y: number): number {
    if (this.settings.meshCompensation === 'off') return this.layerZ
    const mesh = this.usableMesh()
    if (!mesh) return this.layerZ
    const compensated = this.layerZ + sampleMesh(mesh, x, y)
    // Ein Mesh-Wert unterhalb der Schichthöhe zieht Z unter 0 — die Düse fährt
    // dann ins Bett. Ein gespeichertes Mesh mit mehreren Millimetern Offset ist
    // ein Messfehler, kein Bettschlag. In beiden Fällen bleibt die Düse auf der
    // nominellen Höhe, statt eine negative Z-Koordinate zu schreiben.
    if (compensated < 0) {
      this.meshFloorLayers.add(this.layerIdx + 1)
      this.meshFloorMaxDeviation = Math.max(this.meshFloorMaxDeviation, this.layerZ - compensated)
      if (this.settings.special?.vase) {
        this.meshClampLayers.add(this.layerIdx + 1)
        this.meshClampMaxDeviation = Math.max(this.meshClampMaxDeviation, this.layerZ - compensated)
      }
      return this.layerZ
    }
    return compensated
  }

  private layerHeightNow(): number {
    // beginLayer kennt die tatsächliche Höhe; nur davor (z. B. Prime-Linie)
    // gelten die nominellen Werte aus den Einstellungen.
    if (this.layerHeight > 0) return this.layerHeight
    return this.layerIdx === 0 ? this.settings.firstLayerHeight : this.settings.layerHeight
  }

  private ePerMm(flowScale = 1, width = this.baseWidth()): number {
    const filamentArea = Math.PI * (this.settings.filamentDiameter / 2) ** 2
    return (width * this.layerHeightNow() * this.settings.flow * flowScale) / filamentArea
  }

  start(estimatedLayerCount: number) {
    const customStart = this.opts.customGcode?.start
    const fullStart = this.opts.customGcode?.fullMachineGcode === true && Boolean(customStart?.trim())
    if (fullStart) {
      for (const l of this.customLines(customStart, { totalLayerCount: String(estimatedLayerCount) })) this.line(l)
      // Ein vollständiger Startblock ist oft ein Makro wie START_PRINT. Solche
      // Makros können M83 (relative Extrusion) oder G91 hinterlassen. Der
      // folgende Slicer-Code rechnet aber mit absoluten Achsen und E-Werten.
      // Ohne diese drei Zeilen würde jede absolute E-Zahl als zusätzliche
      // Relativmenge extrudiert — der Drucker überextrudiert dann massiv.
      this.line('G90 ; absolute Positionierung für den Slicer')
      this.line('M82 ; absolute Extrusion für den Slicer')
      this.line('G92 E0 ; E-Nullpunkt nach dem Startblock')
    } else {
      for (const l of buildStartGcode(this.opts.profile, this.settings)) this.line(l)
    }
    const a = this.settings.accelerations
    if (a) {
      this.line(`M204 S${Math.round(a.print)} T${Math.round(a.travel)}`)
      this.currentAccel = a.print
    }

    // Pressure Advance / Linear Advance und Input Shaper werden bewusst aus
    // den Slicer-Einstellungen geschrieben — unabhängig davon, ob das
    // Druckerprofil die Funktion als vorhanden meldet. Ohne Firmware-Support
    // ignoriert der Drucker die Zeilen; der G-Code bleibt gültig.
    const pa = this.settings.pressureAdvance
    if (pa?.enabled) {
      const value = Math.max(0, Math.min(2, Number(pa.value) || 0))
      this.line(`; Pressure Advance ${this.fmt(value, 4)}`)
      this.line(pressureAdvanceGcode(this.opts.profile.flavor, this.fmt(value, 4)))
    }

    const cj = this.settings.classicJerk
    if (cj?.enabled) {
      this.line(
        `; Classic Jerk X ${this.fmt(cj.x, 2)} / Y ${this.fmt(cj.y, 2)} / Z ${this.fmt(cj.z, 2)} / E ${this.fmt(cj.e, 2)}`,
      )
      if (isKlipperFlavor(this.opts.profile.flavor)) {
        // Klipper kennt kein Classic Jerk; der X-Wert ist der nächste Ersatz.
        this.line(`SET_VELOCITY_LIMIT SQUARE_CORNER_VELOCITY=${this.fmt(cj.x, 2)}`)
      } else if (this.opts.profile.flavor === 'reprapfirmware') {
        this.line(
          `M566 X${this.fmt(cj.x * 60, 0)} Y${this.fmt(cj.y * 60, 0)} Z${this.fmt(cj.z * 60, 0)} E${this.fmt(cj.e * 60, 0)} ; Jerk (mm/min)`,
        )
      } else {
        this.line(`M205 X${this.fmt(cj.x, 2)} Y${this.fmt(cj.y, 2)} Z${this.fmt(cj.z, 2)} E${this.fmt(cj.e, 2)}`)
      }
    }
    const jd = this.settings.junctionDeviation
    if (jd?.enabled) {
      if (isKlipperFlavor(this.opts.profile.flavor)) {
        this.line('; Junction Deviation: Klipper nutzt stattdessen Square Corner Velocity')
      } else {
        this.line(`M205 J${this.fmt(jd.value, 4)} ; Junction Deviation`)
      }
    }
    const scv = this.settings.squareCornerVelocity
    if (scv?.enabled) {
      if (isKlipperFlavor(this.opts.profile.flavor)) {
        this.line(`SET_VELOCITY_LIMIT SQUARE_CORNER_VELOCITY=${this.fmt(scv.value, 2)}`)
      } else {
        this.line('; Square Corner Velocity: diese Firmware nutzt Classic Jerk / Junction Deviation')
      }
    }

    const ramp = this.settings.pressureAdvanceRamp
    if (ramp?.enabled) {
      this.lastRampPa = null
      this.line(`; PA-Linientest ${this.fmt(ramp.from, 4)} bis ${this.fmt(ramp.to, 4)}`)
      this.line(this.pressureAdvanceLine(ramp.from))
    }

    const is = this.settings.inputShaper
    if (is?.enabled) {
      const x = Math.max(1, Math.min(300, Number(is.freqX) || 0))
      const y = Math.max(1, Math.min(300, Number(is.freqY) || 0))
      const damping = Math.max(0.01, Math.min(1, Number(is.damping) || 0.1))
      const method = is.method ?? 'auto'
      this.line(
        `; Input Shaper X ${this.fmt(x, 1)} Hz / Y ${this.fmt(y, 1)} Hz / Dämpfung ${this.fmt(damping, 3)} / Methode ${method}`,
      )
      for (const shaper of inputShaperGcode(
        this.opts.profile.flavor,
        (v) => this.fmt(v, v % 1 === 0 ? 1 : 3),
        x,
        y,
        damping,
        method,
      )) {
        this.line(shaper)
      }
    }

    this.line(`; Schichten: ${estimatedLayerCount}`)

    // Ältere eigene Startblöcke bleiben Zusatzblöcke am Ende. Der neue,
    // editierbare Standardblock ersetzt dagegen den automatischen Start.
    if (!fullStart) for (const l of this.customLines(customStart)) this.line(l)

    // Die Prime-Linie kommt nach dem eigenen Startblock: Der Nutzer kann dort
    // Temperaturen oder Offsets setzen, ohne die Düsenreinigung zu verschieben.
    if (this.opts.primeLine) this.prime(this.opts.primeLine)
  }

  /** Kurze Extrusionslinie zum Reinigen der Düse vor der ersten Schicht. */
  private prime(plan: PrimeLinePlan) {
    const h = Math.max(0.01, this.settings.firstLayerHeight)
    const width = this.widthFor()
    const filamentArea = Math.PI * (this.settings.filamentDiameter / 2) ** 2
    const len = Math.hypot(plan.x2 - plan.x1, plan.y2 - plan.y1)
    if (!Number.isFinite(len) || len < 1 || filamentArea <= 0) return
    const e = (len * width * h * this.settings.flow) / filamentArea
    const speed = Math.max(1, plan.speed)
    const travel = Math.max(30, Math.min(200, this.settings.speeds.travel || 150))

    this.line(`; ---- Prime-Linie ${this.fmt(len, 1)} mm zur Düsenreinigung ----`)
    this.line('G92 E0')
    this.line('G1 Z5 F600')
    this.line(`G1 X${this.fmt(plan.x1 + this.dx, 2)} Y${this.fmt(plan.y1 + this.dy, 2)} F${Math.round(travel * 60)}`)
    this.line(`G1 Z${this.fmt(h, 3)} F300`)
    this.line(
      `G1 X${this.fmt(plan.x2 + this.dx, 2)} Y${this.fmt(plan.y2 + this.dy, 2)} E${this.fmt(e, 4)} F${Math.round(speed * 60)}`,
    )
    this.line('G92 E0')
    this.line('G1 Z5 F600')

    this.e = 0
    this.x = plan.x2
    this.y = plan.y2
    this.z = 5
    this.seconds +=
      this.moveSeconds(len, speed, this.printAccel()) +
      this.moveSeconds(Math.hypot(plan.x1, plan.y1), travel, this.travelAccel())
    this.filamentMm += len
    this.volumeMm3 += len * width * h * this.settings.flow
  }

  /** Beschleunigung wechseln — nur schreiben, wenn sie sich ändert. */
  private setAccel(accel?: number) {
    if (!accel || !Number.isFinite(accel) || accel <= 0) return
    const v = Math.round(accel)
    if (v === this.currentAccel) return
    this.currentAccel = v
    this.line(`M204 S${v}`)
  }

  /** Zentrale Rückzugsstelle; verhindert doppelte Retracts. */
  private retractNow(distance = this.settings.retraction.distance) {
    const d = Math.max(0, Number(distance) || 0)
    if (this.retracted || d <= 0) return
    this.e -= d
    this.lastRetractAmount = d
    this.line(`G1 E${this.fmt(this.e)} F${Math.round(this.settings.retraction.speed * 60)}`)
    this.retracted = true
  }

  beginLayer(z: number, idx: number, height: number, keepZ = false) {
    // Ein aufgeschobenes Wischen darf nicht über den Schichtwechsel wandern.
    // Bei der Vasen-Spirale gibt es keinen Schichtwechsel im klassischen Sinn:
    // Die Düse läuft auf der Wand weiter. Ein Rückzug an dieser Stelle würde
    // genau die sichtbare Z-Naht erzeugen, die der Vasenmodus vermeiden soll.
    if (this.pendingWipe) {
      this.pendingWipe = false
      if (!keepZ) this.retractNow()
    }
    this.lastPathKind = 'travel'
    this.lastPathTopSkin = false
    this.lastPathTexture = false
    this.lastPathTextureRise = 0
    this.topSurfaceActive = false
    // Mindestschichtzeit: kurze Schichten abwarten, damit die Schicht abkühlt
    const minLayerTime = this.settings.cooling?.minLayerTime ?? 0
    // Auch eine Mindestschichtzeit ist bei der Spirale ein Halt an der Naht;
    // die Wand würde dort eine Beule bekommen. Bei keepZ läuft die Düse durch.
    if (!keepZ && idx > 0 && minLayerTime > 0) {
      const wait = minLayerTime - (this.seconds - this.layerStartedAt)
      if (wait > 0.05) {
        this.line(`G4 P${Math.round(wait * 1000)}`)
        this.seconds += wait
      }
    }
    this.layerStartedAt = this.seconds
    this.previousLayerEndZ = this.z
    this.layerZ = z
    this.layerIdx = idx
    this.layerHeight = height
    this.roleStarted.clear()
    // Moonraker liest die Objekthöhe aus diesem PrusaSlicer-Marker. Der Wert
    // ist die Oberkante der Schicht, nicht die Z-Mitte.
    this.line(';BEFORE_LAYER_CHANGE')
    this.line(`;${this.fmt(z, 3)}`)
    // Leerzeile: Moonrakers PrusaSlicer-Parser darf die Zahl nicht mit der
    // nächsten Kommentarzeile verwechseln.
    this.line('')
    this.line(`;LAYER:${idx + 1}`)
    this.line(`; Z:${this.fmt(z, 2)}  Schicht ${idx + 1}`)
    // Mehrfarbdruck: Jede Farbe wird als eigener Durchlauf geschnitten und
    // später schichtweise eingesetzt. Mit E0 am Schichtanfang rechnet jeder
    // Block absolut für sich — ohne diese Zeile würde der E-Stand der vorigen
    // Farbe als Sprung gelesen und massiv überextrudiert.
    if (this.opts.resetExtruderEachLayer) {
      this.e = 0
      this.retracted = false
      this.line('G92 E0 ; Extruder-Nullpunkt je Schicht')
    }

    // Höhenbereiche und Kalibrier-Overrides werden für jede Schicht neu auf
    // die Basis angewendet. Sonst würde ein Bereich nach seinem Ende mit den
    // Werten des letzten Layers weiterlaufen. Die Zeilen der Overrides werden
    // weiterhin nur einmal an ihrer Schwelle ausgegeben.
    this.settings = this.opts.layerSettings ? this.opts.layerSettings(z) : this.opts.settings
    for (const ov of this.overrides) {
      if (ov.atZ <= z + 1e-6 && ov.settings) this.settings = mergeSettings(this.settings, ov.settings)
    }
    while (this.overrideIdx < this.overrides.length && this.overrides[this.overrideIdx].atZ <= z + 1e-6) {
      const ov = this.overrides[this.overrideIdx++]
      for (const l of ov.lines ?? []) this.line(l)
    }

    // Beim Schichtwechsel zurückziehen, damit die Düse nicht über die Wand zieht
    for (const l of this.customLines(this.opts.customGcode?.layerChange, { layer: String(idx + 1), z: this.fmt(z, 2) })) {
      this.line(l)
    }

    const r = this.settings.retraction
    // Bei keepZ (Vasen-Spirale) läuft die Extrusion über den Schichtwechsel
    // weiter. Ein Layer-Retract würde an jeder Runde eine Z-Kante hinterlassen.
    const layerRetract = !keepZ && r.onLayerChange !== false && r.distance > 0 && !this.retracted
    if (layerRetract) this.retractNow(r.distance)

    // Düse exakt auf die neue Schichthöhe heben. Bei der Vasen-Spirale steht
    // die Düse schon auf dieser Höhe (Ende der vorigen Runde) — dann bleibt
    // das Anheben weg, sonst gäbe es an jeder Nahtstelle ein Z-Nicken.
    if (!keepZ && Math.abs(this.z - z) > 0.005) {
      this.z = z
      this.line(`G1 Z${this.fmt(z, 3)} F600`)
    }

    // Nicht hier wieder entziehen: Der erste Pfad der Schicht fährt mit
    // weiterhin zurückgezogener Düse zum Startpunkt und entzieht erst dort.
    // Sonst folgt sofort ein zweiter Retract für genau diese Leerfahrt.

    if (idx === 1) {
      this.line(`M104 S${this.settings.temps.nozzle}`)
      this.line(`M140 S${this.settings.temps.bed}`)
    }

    // Lüfter erst nach den eingestellten Schichten anwerfen
    if (idx === 0) {
      this.line('M107')
      this.fanOn = false
    }
    const fanFrom = Math.max(0, Math.round(this.settings.cooling?.fanOffLayers ?? 0))
    if (this.settings.fanSpeed > 0 && idx >= fanFrom && !this.fanOn) {
      this.line(`M106 S${Math.round(this.settings.fanSpeed * 2.55)}`)
      this.fanOn = true
    }
    this.layers.push({ z, data: [], lines: [] })
  }

  private travelTo(
    tx: number,
    ty: number,
    speed: number,
    previousKind: PathKind = 'travel',
    nextKind: PathKind = 'travel',
    nextTopSkin = false,
    nextTexture = false,
    nextTextureRise = 0,
  ) {
    const dist = Math.hypot(tx - this.x, ty - this.y)
    const { retraction, zHop } = this.settings
    const retractDistance =
      retraction.distance *
      (this.settings.output?.reduceInfillRetraction && this.currentPathKind === 'sparse' ? 0.5 : 1)
    // Der Compiler verbindet nur unsichtbare Innenbahnen. Eine aufgeschobene
    // Wisch-Rückzug bleibt bei einer folgenden Innenwand ebenfalls aus.
    const continuous = this.settings.printOrder?.continuous !== false
    const joinSparse = continuous && previousKind === 'sparse' && nextKind === 'sparse'
    // Deckschichten: benachbarte Bahnen ohne Rückzug verbinden. Auf der
    // sichtbaren Oberseite bleibt der Abstand bewusst klein, auf verdeckten
    // Massivschichten darf er größer sein. Der kurze Weg wird nicht als
    // Extrusion gedruckt, sondern nur als Leerfahrt gefahren.
    const topSolid = this.lastPathTopSkin || nextTopSkin
    const solidJoinDistance = topSolid ? Math.max(2.5, this.baseWidth() * 5) : 6
    const joinSolid = continuous && previousKind === 'solid' && nextKind === 'solid'
    const wipeJoinDistance = Math.max(0.8, this.baseWidth() * 2)
    // Außenwände dürfen nur an eine direkt benachbarte Innenwand anschließen;
    // die sichtbare Außenseite wird nicht über eine lange Leerfahrt verbunden.
    // Saum und Umrandung liegen auf der Platte und werden abgelöst — dort darf
    // der nächste Ring ohne Rückzug angeschlossen werden.
    const joinWipe =
      this.pendingWipe &&
      continuous &&
      dist <= wipeJoinDistance &&
      (nextKind === 'inner-wall' || (previousKind === 'adhesion' && nextKind === 'adhesion'))
    if (this.pendingWipe) {
      this.pendingWipe = false
      if (!joinWipe && dist >= 0.001) this.retractNow(retraction.distance)
    }
    let retractThreshold = Math.max(
      retraction.minTravel,
      joinSparse ? Math.max(12, this.baseWidth() * 28) : 0,
      joinSolid ? solidJoinDistance : 0,
      joinWipe ? wipeJoinDistance : 0,
    )
    // Auf der sichtbaren Deckschicht früher zurückziehen: Der kurze Weg wird
    // sonst ohne Retract gefahren und die Düse schleift über den Wulst.
    const guard = this.settings.surfaceGuard
    const guardActive = guard?.enabled === true && this.topSurfaceActive
    if (guardActive) {
      retractThreshold = Math.min(retractThreshold, Math.max(0.5, guard.retractAbove))
    }
    if (dist < 0.001) {
      // Kein Weg zum Entziehen: Falls die Schicht mit einem Retract begann und
      // der Pfad exakt an der aktuellen Position startet, hier wieder freigeben.
      if (this.retracted) {
        this.e += this.lastRetractAmount || retraction.distance
        this.line(`G1 E${this.fmt(this.e)} F${Math.round(retraction.speed * 60)}`)
        this.retracted = false
      }
      return
    }

    const preview = this.layers[this.layers.length - 1]
    const previewLineIndex = preview?.lines?.length ?? -1
    if (preview && this.segmentsTotal < 600000) {
      preview.data.push(
        PREVIEW_KIND_CODE.travel,
        round2(this.x),
        round2(this.y),
        round2(tx),
        round2(ty),
        round2(speed),
        0,
        0,
        round2(this.travelAccel()),
        0,
        0,
        0,
      )
      preview.lines?.push(0)
      this.segmentsTotal++
    }
    const travel = this.featureStats.get('travel') ?? { seconds: 0, volumeMm3: 0 }
    travel.seconds += this.moveSeconds(dist, speed, this.travelAccel())
    this.featureStats.set('travel', travel)

    if (!this.retracted && dist > retractThreshold && retractDistance > 0) {
      this.e -= retractDistance
      this.lastRetractAmount = retractDistance
      this.line(`G1 E${this.fmt(this.e)} F${Math.round(retraction.speed * 60)}`)
      this.retracted = true
    }
    // Sichtbare Deckschicht und Ironing: Auch ohne Rückzug anheben. Gerade
    // dort wird oft nicht zurückgezogen (kurze Wege zwischen den Bahnen),
    // sodass die Düse sonst mit der bereits gedruckten Fläche kollidiert.
    const textureTravel = nextTexture || this.lastPathTexture
    const textureRise = Math.max(nextTexture ? nextTextureRise : 0, this.lastPathTextureRise)
    const visibleSurfaceTravel =
      textureTravel ||
      nextTopSkin ||
      this.lastPathTopSkin ||
      previousKind === 'iron' ||
      nextKind === 'iron'
    const guardHop = guardActive ? Math.max(zHop, guard.travelHop) : 0
    const hopDistance = textureTravel
      ? 0.01
      : guardActive
        ? Math.max(0.6, this.baseWidth() * 1.5)
        : visibleSurfaceTravel
          ? 0.2
          : Math.max(0.8, this.baseWidth() * 2)
    const hopHeight = guardActive ? guardHop : visibleSurfaceTravel ? Math.max(zHop, 0.2) : zHop
    // Über einer texturierten Fläche wird nicht relativ zum bereits erhöhten Z
    // nochmals der volle Aufbau addiert. Die Düse fährt absolut auf die sichere
    // Höhe über dem höchsten beteiligten Aufbau und kehrt danach zurück.
    const liftZ = textureTravel
      ? Math.max(this.z, this.layerZ + textureRise + 0.2)
      : this.z + hopHeight
    const liftDelta = liftZ - this.z
    const useZHop =
      textureTravel
        ? liftDelta > 0.005 && dist > hopDistance
        : hopHeight > 0 && (guardActive || this.retracted || visibleSurfaceTravel) && dist > hopDistance
    if (useZHop) {
      this.line(`G1 Z${this.fmt(liftZ)} F600`)
    }
    this.seconds +=
      this.moveSeconds(dist, speed, previousKind === 'travel' ? this.travelAccel() : this.printAccel()) +
      (this.retracted ? 0.15 : 0)
    const travelLine = this.out.length + 1
    this.line(`G0 X${this.fmt(tx + this.dx, 2)} Y${this.fmt(ty + this.dy, 2)} F${Math.round(speed * 60)}`)
    if (preview && preview.lines && previewLineIndex >= 0) {
      preview.lines[previewLineIndex] = travelLine
    }
    this.x = tx
    this.y = ty
    if (useZHop) {
      this.line(`G1 Z${this.fmt(this.z)} F600`)
    }
    if (this.retracted) {
      this.e += this.lastRetractAmount || retraction.distance
      this.line(`G1 E${this.fmt(this.e)} F${Math.round(retraction.speed * 60)}`)
      this.retracted = false
    }
  }

  /** Wählt den Startpunkt einer geschlossenen Runde nach Winkel um den Schwerpunkt. */
  private angleOrder(poly: Pt[], angle: number): Pt[] {
    if (poly.length < 3) return poly
    const cx = poly.reduce((sum, p) => sum + p.x, 0) / poly.length
    const cy = poly.reduce((sum, p) => sum + p.y, 0) / poly.length
    let start = 0
    let best = Infinity
    for (let i = 0; i < poly.length; i++) {
      const a = (Math.atan2(poly[i].y - cy, poly[i].x - cx) * 180) / Math.PI
      const diff = Math.abs(((a - angle + 540) % 360) - 180)
      if (diff < best) {
        best = diff
        start = i
      }
    }
    return [...poly.slice(start), ...poly.slice(0, start)]
  }

  /**
   * Prozedurale Oberflächentextur: teilt lange Wandsegmente in Stützpunkte
   * auf und verschiebt sie entlang der Wandnormalen. Ohne die Aufteilung
   * hätte eine gerade 30-mm-Wand nur ihre vier Ecken und damit keine sichtbare
   * Maserung oder Steinstructur.
   */
  private fuzzy(pts: Pt[], kind: PathKind, closed: boolean): Pt[] {
    const cfg = this.settings.fuzzySkin
    if (!cfg || cfg.mode === 'off') return pts
    if (cfg.mode === 'external' && kind !== 'outer-wall') return pts
    if (cfg.mode === 'all' && kind !== 'outer-wall' && kind !== 'inner-wall') return pts
    if (kind === 'adhesion' || kind === 'iron' || kind === 'travel') return pts
    if (pts.length < 2) return pts
    const zone = textureZoneAt(cfg.textureZones, this.layerZ)
    if (zone === null) return pts
    const thickness = Math.max(0, Math.min(1.5, cfg.thickness || 0))
    if (thickness <= 0) return pts
    const feature = Math.max(0.5, cfg.scale || 3)
    const spacing = Math.max(0.1, cfg.pointDistance || 0.8)
    const pattern =
      zone?.pattern && zone.pattern !== 'inherit'
        ? zone.pattern
        : cfg.pattern || 'noise'
    const angle = Number.isFinite(cfg.angle) ? cfg.angle : 0
    // Genug Stützpunkte pro Merkmal, aber nie mehr als nötig. Bei sehr großen
    // Bauteilen wird der Abstand begrenzt, damit der G-Code nicht ausufert.
    // Mauerwerk und Bruchstein benötigen zusätzlich mindestens vier Punkte
    // pro Fuge; sonst fallen die schmalen senkrechten Fugen zwischen zwei
    // Abtastpunkten hindurch.
    let perimeter = 0
    for (let i = 0; i < pts.length - 1; i++) perimeter += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y)
    if (closed) perimeter += Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y)
    const step = Math.max(0.1, Math.min(spacing, surfaceTextureDetail(pattern, feature)), perimeter / 40000)
    const sampled = this.resampleForTexture(pts, step, closed)
    const amount = thickness * 0.5
    // Mauerwerk wird entlang der Wand vermessen, nicht in globalen X/Y-
    // Koordinaten. Sonst bleibt auf einer X-Fläche das globale x konstant und
    // die Fuge zieht sich als eine lange Diagonale über die ganze Seite.
    let wallDistance: number[] | null = null
    if (pattern === 'stone-blocks' || pattern === 'rubble') {
      wallDistance = [0]
      for (let i = 1; i < sampled.length; i++) {
        wallDistance.push(
          wallDistance[i - 1] +
            Math.hypot(sampled[i].x - sampled[i - 1].x, sampled[i].y - sampled[i - 1].y),
        )
      }
    }
    // Jahresringe sollen um das Bauteil liegen, nicht um den Bett-Nullpunkt:
    // Bei einer 30-mm-Wand mitten auf dem Bett wären die Ringe sonst nur
    // fast gerade Bänder am Rand eines sehr großen Kreises.
    const ringCx = pattern === 'wood-rings' ? pts.reduce((sum, p) => sum + p.x, 0) / pts.length : 0
    const ringCy = pattern === 'wood-rings' ? pts.reduce((sum, p) => sum + p.y, 0) / pts.length : 0
    // V-21: Flächenzuweisung. Die Seite ergibt sich aus der Lage des Punktes
    // zum Mittelpunkt der Wandkontur und der nach außen gedrehten Normalen.
    // Das ist bewusst eine Näherung über die Bounding-Box: Für Rechtecke,
    // Zylinder und die meisten Gehäuse stimmt sie; bei stark verwinkelten
    // Konturen gilt die jeweils nächstliegende Hauptseite.
    const faces = cfg.faces
    const faceFilter = faces?.enabled === true
    let boxCx = 0
    let boxCy = 0
    if (faceFilter) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      for (const point of pts) {
        if (point.x < minX) minX = point.x
        if (point.x > maxX) maxX = point.x
        if (point.y < minY) minY = point.y
        if (point.y > maxY) maxY = point.y
      }
      boxCx = (minX + maxX) / 2
      boxCy = (minY + maxY) / 2
    }
    const out: Pt[] = []
    for (let i = 0; i < sampled.length; i++) {
      const prev = sampled[i === 0 ? (closed ? sampled.length - 1 : 0) : i - 1]
      const next = sampled[i === sampled.length - 1 ? (closed ? 0 : sampled.length - 1) : i + 1]
      const tx = next.x - prev.x
      const ty = next.y - prev.y
      const len = Math.hypot(tx, ty) || 1
      let nx = -ty / len
      let ny = tx / len
      let faceActive = true
      if (faceFilter && faces) {
        const vx = sampled[i].x - boxCx
        const vy = sampled[i].y - boxCy
        // Normale nach außen drehen, damit Innen- und Außenkontur dieselbe
        // Seite meinen.
        if (vx * nx + vy * ny < 0) {
          nx = -nx
          ny = -ny
        }
        faceActive =
          Math.abs(nx) >= Math.abs(ny)
            ? nx >= 0
              ? faces.right !== false
              : faces.left !== false
            : ny >= 0
              ? faces.back !== false
              : faces.front !== false
      }
      const offset = faceActive
        ? surfaceTextureOffset(
            sampled[i].x - ringCx,
            sampled[i].y - ringCy,
            this.layerZ,
            pattern,
            feature,
            angle,
            wallDistance ? { u: wallDistance[i], v: 0 } : undefined,
          ) * amount
        : 0
      out.push({ x: sampled[i].x + nx * offset, y: sampled[i].y + ny * offset })
    }
    return this.simplifyTexturePath(out, Math.min(0.01, thickness * 0.02))
  }

  /**
   * Entfernt Zwischenpunkte, die weniger als `tolerance` von der geraden
   * Verbindung abweichen. Die feine Mauerwerk-Abtastung braucht ihre Punkte
   * an Fugen und Kanten; auf den glatten Blockflächen reichen wenige Stütz-
   * punkte. Das hält den G-Code klein, ohne die sichtbare Struktur zu ändern.
   */
  private simplifyTexturePath(pts: Pt[], tolerance: number): Pt[] {
    if (pts.length <= 2 || !(tolerance > 0)) return pts
    const keep = new Uint8Array(pts.length)
    keep[0] = 1
    keep[pts.length - 1] = 1
    const stack: [number, number][] = [[0, pts.length - 1]]
    const tol2 = tolerance * tolerance
    while (stack.length) {
      const [from, to] = stack.pop()!
      if (to - from < 2) continue
      const a = pts[from]
      const b = pts[to]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len2 = dx * dx + dy * dy
      let farthest = -1
      let farthestDist = tol2
      for (let i = from + 1; i < to; i++) {
        const p = pts[i]
        const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0
        const qx = a.x + dx * t
        const qy = a.y + dy * t
        const d2 = (p.x - qx) ** 2 + (p.y - qy) ** 2
        if (d2 > farthestDist) {
          farthestDist = d2
          farthest = i
        }
      }
      if (farthest >= 0) {
        keep[farthest] = 1
        stack.push([from, farthest], [farthest, to])
      }
    }
    return pts.filter((_, index) => keep[index] === 1)
  }

  /**
   * Höhenfeld der sichtbaren Deckfläche. Die Bahn wird wie eine Wand in
   * gleichmäßige Punkte geteilt; anders als dort wird der Punkt aber nicht
   * seitlich verschoben, sondern ausschließlich in Z angehoben. Die
   * Steigungsbegrenzung verhindert harte Z-Kanten, an denen die Düse über
   * eine gerade gedruckte Nachbarbahn schrammen könnte.
   */
  private topTexturePoints(pts: Pt[], safeAmplitude?: number): { pts: Pt[]; heights: number[] } {
    const cfg = this.settings.fuzzySkin
    if (!cfg || pts.length < 2) return { pts, heights: pts.map(() => 0) }
    // „Glatt“ schaltet nur den Aufbau auf der Deckfläche ab; die Wandtextur
    // bleibt unverändert. Der Aufrufer überspringt den Pass bereits, diese
    // Prüfung hält die Funktion auch bei direkter Verwendung kollisionsfrei.
    if (cfg.topPattern === 'none') return { pts, heights: pts.map(() => 0) }
    const zone = textureZoneAt(cfg.textureZones, this.layerZ)
    if (zone === null) return { pts, heights: pts.map(() => 0) }
    const amplitude =
      safeAmplitude !== undefined && Number.isFinite(safeAmplitude) && safeAmplitude > 0
        ? safeAmplitude
        : cfg.thickness
    const feature = Math.max(0.5, cfg.scale || 3)
    const spacing = Math.max(0.1, cfg.pointDistance || 0.8)
    const pattern =
      cfg.topPattern && cfg.topPattern !== 'inherit'
        ? cfg.topPattern
        : zone?.pattern && zone.pattern !== 'inherit'
          ? zone.pattern
          : cfg.pattern || 'noise'
    const angle = Number.isFinite(cfg.angle) ? cfg.angle : 0
    let perimeter = 0
    for (let i = 0; i < pts.length - 1; i++) {
      perimeter += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y)
    }
    const step = Math.max(0.1, Math.min(spacing, surfaceTextureDetail(pattern, feature)), perimeter / 40000)
    const sampled = this.resampleForTexture(pts, step, false)
    if (sampled.length < 2) return { pts, heights: pts.map(() => 0) }
    const heights = sampled.map((p) =>
              topSurfaceTextureHeight(
          surfaceTextureOffset(p.x, p.y, this.layerZ, pattern, feature, angle),
          amplitude,
          this.layerHeightNow(),
        ),

    )
    // Nach vorne und hinten begrenzen: Ein einzelner hoher Punkt darf keine
    // senkrechte Rampe erzeugen. 0,35 mm Höhe je mm Bahn entspricht ca. 19°.
    const maxDelta = Math.max(0.01, step * 0.35)
    for (let i = 1; i < heights.length; i++) {
      heights[i] = Math.min(heights[i], heights[i - 1] + maxDelta)
    }
    for (let i = heights.length - 2; i >= 0; i--) {
      heights[i] = Math.min(heights[i], heights[i + 1] + maxDelta)
    }
    return { pts: sampled, heights }
  }

  /** Teilt eine Wand in gleichmäßige Stützpunkte, ohne Ecken zu verlieren. */
  private resampleForTexture(pts: Pt[], step: number, closed: boolean): Pt[] {
    const out: Pt[] = [{ ...pts[0] }]
    const segments = closed ? pts.length : pts.length - 1
    for (let i = 0; i < segments; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const length = Math.hypot(dx, dy)
      if (length < 1e-9) continue
      const count = Math.max(1, Math.ceil(length / step))
      for (let j = 1; j <= count; j++) {
        // Der geschlossene Ring bekommt den ersten Punkt bereits am Anfang.
        if (closed && i === segments - 1 && j === count) break
        out.push({ x: a.x + (dx * j) / count, y: a.y + (dy * j) / count })
      }
    }
    return out
  }

  private roleKey(kind: PathKind): string | null {
    if (kind === 'outer-wall') return 'outerWall'
    if (kind === 'inner-wall') return 'innerWall'
    if (kind === 'solid') return 'solid'
    if (kind === 'sparse') return 'sparse'
    if (kind === 'support') return 'support'
    if (kind === 'bridge' || kind === 'overhang') return 'bridge'
    if (kind === 'iron') return 'iron'
    if (kind === 'adhesion') return 'adhesion'
    return null
  }

  /**
   * Dreht eine geschlossene Runde so, dass die Naht an der gewünschten Stelle
   * liegt. Die Nahtlücke wird erst nach dem Schließen der Runde abgezogen;
   * sonst würde die letzte Wandseite komplett fehlen.
   */
  private seamOrder(poly: Pt[]): Pt[] {
    if (poly.length < 3) return poly
    const { position } = this.settings.seam
    let start = 0
    if (position === 'rear') {
      for (let i = 1; i < poly.length; i++) if (poly[i].y > poly[start].y) start = i
    } else if (position === 'aligned') {
      let best = Infinity
      for (let i = 0; i < poly.length; i++) {
        const d = (poly[i].x - this.lastSeam.x) ** 2 + (poly[i].y - this.lastSeam.y) ** 2
        if (d < best) {
          best = d
          start = i
        }
      }
    } else if (position === 'nearest') {
      // Naht dorthin, wo die Düse gerade steht: kürzester Anfahrtsweg.
      let best = Infinity
      for (let i = 0; i < poly.length; i++) {
        const d = (poly[i].x - this.x) ** 2 + (poly[i].y - this.y) ** 2
        if (d < best) {
          best = d
          start = i
        }
      }
    } else if (position === 'random') {
      const r = Math.sin((this.layerIdx + 1) * 12.9898 + poly.length * 78.233) * 43758.5453
      start = Math.abs(Math.round(r)) % poly.length
    }
    const rotated = [...poly.slice(start), ...poly.slice(0, start)]
    this.lastSeam = rotated[0]
    return rotated
  }

  /** Schneidet eine bereits geschlossene Runde am Ende um `gap` zurück. */
  private trimSeamGap(pts: Pt[], gap: number): Pt[] {
    if (pts.length < 3 || gap <= 0) return pts
    const out = pts.slice()
    let left = gap
    while (out.length > 3 && left > 0) {
      const a = out[out.length - 2]
      const b = out[out.length - 1]
      const d = Math.hypot(b.x - a.x, b.y - a.y)
      if (d <= left) {
        out.pop()
        left -= d
      } else {
        const t = (d - left) / d
        out[out.length - 1] = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
        left = 0
      }
    }
    return out
  }

  /** Länge einer offenen oder geschlossenen Punktfolge in mm. */
  private ringLength(pts: Pt[], closed: boolean): number {
    let total = 0
    for (let i = 1; i < pts.length; i++) {
      total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    }
    if (closed && pts.length > 1) {
      const first = pts[0]
      const last = pts[pts.length - 1]
      if (Math.hypot(first.x - last.x, first.y - last.y) > 1e-9) {
        total += Math.hypot(first.x - last.x, first.y - last.y)
      }
    }
    return total
  }

  /**
   * Scarf-Naht nur auf geschlossenen Wänden ab Schicht 2. Erste Schicht,
   * Vasen-Spirale, Saum/Umrandung und Deckflächentextur bleiben unangetastet.
   */
  private scarfConfig(path: PrintPath): ScarfConfig | null {
    const cfg = this.settings.seam?.scarf
    if (!cfg?.enabled || !path.closed || path.startAngle !== undefined || path.spiral === true) return null
    if (path.topTexture === true || this.layerIdx === 0) return null
    if (path.kind !== 'outer-wall' && !(cfg.innerWalls && path.kind === 'inner-wall')) return null
    const length = Number.isFinite(cfg.length) ? Math.max(0, cfg.length) : 0
    if (length < 1) return null
    const steps = Number.isFinite(cfg.steps) ? Math.max(2, Math.min(50, Math.round(cfg.steps))) : 10
    const startPercent = Number.isFinite(cfg.startHeight) ? cfg.startHeight : 15
    const startFraction = Math.max(0, Math.min(0.9, startPercent / 100))
    const flow = Number.isFinite(cfg.flow) ? Math.max(0.2, Math.min(1.5, cfg.flow)) : 1
    return { length, startFraction, steps, flow, step: length / steps }
  }

  /**
   * Z- und Flussrampe für eine bereits geschlossene Punktfolge. Die Rampe
   * läuft an beiden Seiten der Naht von der Starthöhe bis zur vollen Schicht
   * und zurück. Der Fluss wird mit der wirksamen Höhe skaliert, damit die
   * Düse am Anfang nicht die volle Menge in den schmalen Keil drückt.
   */
  private scarfPlan(pts: Pt[], cfg: ScarfConfig, layerHeight: number): ScarfPlan | null {
    if (pts.length < 3 || !(layerHeight > 0)) return null
    const total = this.ringLength(pts, true)
    const length = Math.min(cfg.length, total * 0.45)
    if (length < 0.5) return null
    const z: number[] = []
    const flowScale: number[] = []
    let distance = 0
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) distance += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
      const toEnd = Math.max(0, total - distance)
      const ramp = Math.min(1, Math.min(distance, toEnd) / length)
      const top = this.zAt(pts[i].x, pts[i].y)
      const bottom = top - layerHeight
      const zz = bottom + layerHeight * (cfg.startFraction + (1 - cfg.startFraction) * ramp)
      const effective = Math.max(0.01, zz - bottom)
      z.push(zz)
      flowScale.push(Math.max(0.05, Math.min(1.5, cfg.flow * (effective / layerHeight))))
    }
    return { z, flowScale }
  }

  /** Klartext-Hinweise für den Slice-Bericht, sobald der Volumenstrom bremst. */
  get flowWarnings(): string[] {
    return [...this.flowCaps.values()].map(
      (e) =>
        `Volumenstrom zu niedrig für ${this.fmt(e.requested, 1)} mm/s: Bei ${this.fmt(e.width, 2)} mm Linienbreite, ${this.fmt(e.height, 2)} mm Schichthöhe und Fluss ${this.fmt(e.flow, 2)} sind mit ${this.fmt(e.limit, 1)} mm³/s höchstens ${this.fmt(e.max, 1)} mm/s möglich. Der G-Code druckt diese Bahnen mit ${this.fmt(e.max, 1)} mm/s.`,
    )
  }

  /** Klartext-Hinweise für den Slice-Bericht, wenn das Bett-Mesh weichen muss. */
  get meshWarnings(): string[] {
    const warnings: string[] = []
    const layers = (count: number) => (count === 1 ? 'einer Schicht' : `${count} Schichten`)
    const mm = (value: number) => this.fmt(value, 2).replace('.', ',')
    if (this.meshRejectedDeviation > 0) {
      warnings.push(
        `Bett-Mesh verworfen: Das gespeicherte Mesh weicht um ${mm(this.meshRejectedDeviation)} mm vom Bett ab (Grenze ${MESH_REJECT_MM} mm). So ein Wert ist ein Messfehler, kein Bettschlag; der G-Code rechnet deshalb ohne Ausgleich. Bett-Mesh neu messen und erst danach wieder einschalten.`,
      )
    }
    if (!this.opts.settings.special?.vase && this.meshFloorLayers.size > 0) {
      warnings.push(
        `Bett-Mesh unplausibel: In ${layers(this.meshFloorLayers.size)} hätte der Ausgleich Z unter 0 gezogen (größte Abweichung ${mm(this.meshFloorMaxDeviation)} mm). Dort bleibt die Düse auf der nominellen Schichthöhe, der Ausgleich wirkt nicht. Bett-Mesh neu messen — mehrere Millimeter Offset sind ein Messfehler, kein Bettschlag.`,
      )
    }
    if (this.meshClampLayers.size > 0) {
      warnings.push(
        `Bett-Mesh im Vasenmodus begrenzt: In ${layers(this.meshClampLayers.size)} hätte ein negativer Mesh-Wert Z unter 0 gezogen. Dort bleibt die Düse auf der nominellen Schichthöhe (größte Mesh-Abweichung ${mm(this.meshClampMaxDeviation)} mm); der Ausgleich wirkt an diesen Stellen nicht. Der Abstand zum Bett kann örtlich abweichen — erste Schicht und Wandhaftung prüfen.`,
      )
    }
    if (this.spiralMeshFallbackLayers.size > 0) {
      warnings.push(
        `Bett-Mesh im Vasenmodus für die Spirale deaktiviert: In ${layers(this.spiralMeshFallbackLayers.size)} würde der Spiralstart unter Z 0 oder unter das Ende der vorherigen Schicht fallen. Die Spirale läuft deshalb ohne Mesh-Kompensation auf der nominellen Höhe (größte Mesh-Abweichung ${mm(this.spiralMeshFallbackMaxDeviation)} mm). Der Abstand zum Bett weicht über die betroffenen Schichten ab — erste Schicht und Wandhaftung prüfen.`,
      )
    }
    return warnings
  }

  path(path: PrintPath, speed: number, flowScale = 1, accel?: number) {
    if (!path.pts.length) return
    const previousKind = this.lastPathKind
    const roleKey = this.roleKey(path.kind)
    if (roleKey && !this.roleStarted.has(roleKey)) {
      this.roleStarted.add(roleKey)
      const code = (this.settings.roleGcode as Record<string, string | undefined>)?.[roleKey]
      for (const line of this.customLines(code)) this.line(line)
    }
    this.currentPathKind = path.kind
    this.setAccel(accel)
    if (this.settings.output?.verbosePaths) this.line(`; TYPE: ${path.kind}`)
    const base = path.closed
      ? path.startAngle !== undefined
        ? this.angleOrder(path.pts, path.startAngle)
        : this.seamOrder(path.pts)
      : path.pts
    const texture = path.topTexture === true
    const textureSamples = texture
      ? this.topTexturePoints(base, path.textureAmplitude)
      : null
    let shaped = textureSamples ? textureSamples.pts : this.fuzzy(base, path.kind, path.closed)
    const textureHeights = textureSamples?.heights ?? []
    const h = this.layerHeightNow()
    let scarf = this.scarfConfig(path)
    if (scarf) {
      const total = this.ringLength(shaped, true)
      const capped = Math.min(scarf.length, total * 0.45)
      if (capped >= 1) {
        scarf = { ...scarf, length: capped, step: Math.max(0.1, capped / scarf.steps) }
        shaped = this.resampleForTexture(shaped, scarf.step, true)
      } else {
        scarf = null
      }
    }
    // Erst die Runde schließen, dann die Nahtlücke am Ende abziehen. Sonst
    // fehlt bei seam.gap > 0 die letzte Wandseite komplett.
    const seamGap = path.closed && path.startAngle === undefined ? this.settings.seam.gap : 0
    const closedPts = path.closed ? [...shaped, shaped[0]] : shaped
    const pts = path.closed && seamGap > 0 ? this.trimSeamGap(closedPts, seamGap) : closedPts
    const s = this.settings
    const scarfPlan = scarf ? this.scarfPlan(pts, scarf, h) : null
    const width = path.width && path.width > 0 ? path.width : this.widthFor(path.kind)
    const textureMaxRise = textureHeights.length ? Math.max(...textureHeights) : 0
    // Die Textur liegt als zusätzlicher Aufbau über der bereits gedruckten
    // Deckschicht. Für die Volumenstromgrenze zählt deshalb die volle Höhe.
    const flowHeight = h + (texture ? textureMaxRise : 0)

    // Volumenstrom begrenzen: schneller als das Hotend schmelzen kann bringt nichts.
    // Die gewählte Geschwindigkeit bleibt der Wunschwert; nur wenn die Formel
    // eine niedrigere Grenze liefert, wird gekappt und das später gemeldet.
    const flowFactor = Math.max(0.01, s.flow * flowScale)
    const cap =
      s.maxVolumetricFlow > 0
        ? s.maxVolumetricFlow / Math.max(0.02, width * flowHeight * flowFactor)
        : Infinity
    let speedUsed = Math.min(speed, cap)
    if (Number.isFinite(cap) && cap + 0.01 < speed) {
      const key = `${width.toFixed(2)}|${flowHeight.toFixed(3)}|${flowFactor.toFixed(3)}`
      const entry = this.flowCaps.get(key)
      const max = Math.round(cap * 10) / 10
      if (entry) {
        entry.requested = Math.max(entry.requested, speed)
        entry.max = Math.min(entry.max, max)
      } else {
        this.flowCaps.set(key, {
          requested: Math.round(speed * 10) / 10,
          max,
          width,
          height: flowHeight,
          flow: flowFactor,
          limit: s.maxVolumetricFlow,
        })
      }
    }
    if (this.layerIdx === 0) speedUsed = Math.min(speedUsed, s.speeds.firstLayer)
    const flowUsed = speedUsed * width * flowHeight * flowScale * s.flow
    if (flowUsed > this.maxFlowMm3s) this.maxFlowMm3s = flowUsed

    this.travelTo(
      pts[0].x,
      pts[0].y,
      s.speeds.travel,
      previousKind,
      path.kind,
      path.topSkin === true,
      texture,
      textureMaxRise,
    )
    // Vasen-Spirale: an der Schichtunterkante anfangen und die Höhe über die
    // Bahnlänge verteilen. So gibt es keine Naht und kein Anheben.
    const spiral = path.spiral === true
    const nominalTop = this.layerZ
    const compensatedTop = spiral ? this.zAt(pts[0].x, pts[0].y) : 0
    const compensatedStart = compensatedTop - h
    // Kompensation nur nutzen, wenn der Start nicht negativ wird und nicht
    // unter das Ende der vorherigen Schicht fällt. Sonst würde die Düse beim
    // Vasen-Spiralstart rückwärts fahren; dann gilt die nominelle Höhe.
    const spiralMeshSafe =
      spiral && compensatedStart >= 0 && compensatedStart >= this.previousLayerEndZ - 1e-6
    if (spiral && !spiralMeshSafe) {
      this.spiralMeshFallbackLayers.add(this.layerIdx + 1)
      this.spiralMeshFallbackMaxDeviation = Math.max(
        this.spiralMeshFallbackMaxDeviation,
        Math.abs(nominalTop - compensatedTop),
      )
    }
    const spiralStart = spiral
      ? spiralMeshSafe
        ? compensatedStart
        : Math.max(0, this.previousLayerEndZ, nominalTop - h)
      : 0
    const spiralTop = spiral
      ? spiralMeshSafe
        ? compensatedTop
        : Math.max(nominalTop, spiralStart + h)
      : 0
    if (spiral) {
      if (Math.abs(this.z - spiralStart) > 0.005) {
        this.z = spiralStart
        this.line(`G1 Z${this.fmt(spiralStart, 3)} F600`)
      }
    } else if (scarfPlan) {
      const startZ = scarfPlan.z[0] ?? this.zAt(pts[0].x, pts[0].y)
      if (Math.abs(startZ - this.z) > 0.005) {
        this.z = startZ
        this.line(`G1 Z${this.fmt(startZ, 3)} F600`)
      }
    } else if (texture) {
      const startZ = this.zAt(pts[0].x, pts[0].y) + (textureHeights[0] ?? 0)
      if (Math.abs(startZ - this.z) > 0.005) {
        this.z = startZ
        this.line(`G1 Z${this.fmt(startZ, 3)} F600`)
      }
    } else {
      this.ensureZ(pts[0].x, pts[0].y)
    }

    const eFactor = this.ePerMm(flowScale, width)
    const preview = this.layers[this.layers.length - 1]
    const code = PREVIEW_KIND_CODE[path.kind]
    // Der PA-Linientest bekommt in der Vorschau eine Farbskala: 20 = 0 %,
    // 29 = 100 % der eingestellten PA-Rampe. Normale Bahnen behalten ihre Farbe.
    const ramp = s.pressureAdvanceRamp
    const rampPreviewCode = (x: number) => {
      const span = (ramp?.endX ?? 0) - (ramp?.startX ?? 0)
      const t = !span ? 0 : Math.max(0, Math.min(1, (x - (ramp?.startX ?? 0)) / span))
      return 20 + Math.min(9, Math.floor(t * 10))
    }
    let pathSeconds = 0
    let pathDistance = 0
    let pathTimeAtSpeed = 0
    let pathVolume = 0
    let spiralLength = 0
    let spiralDone = 0
    if (spiral) {
      for (let i = 1; i < pts.length; i++) {
        spiralLength += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
      }
    }

    const pushPreview = (
      ax: number,
      ay: number,
      bx: number,
      by: number,
      lineNo: number,
      speedValue: number,
      flowValue: number,
      previewCode: number,
    ) => {
      if (!preview || this.segmentsTotal >= 600000) return
      preview.data.push(
        previewCode,
        round2(ax),
        round2(ay),
        round2(bx),
        round2(by),
        round2(speedValue),
        round2(flowValue),
        round2(this.settings.temps.nozzle),
        round2(accel && accel > 0 ? accel : this.currentAccel || this.printAccel()),
        round2(width),
        round2(this.fanOn ? s.fanSpeed : 0),
        Math.round((this.lastRampPa ?? (s.pressureAdvance.enabled ? s.pressureAdvance.value : 0)) * 10000) / 10000,
      )
      preview.lines?.push(lineNo)
      this.segmentsTotal++
    }
    // Bögen nur auf geschlossenen, konstanten Bahnen ohne Z- oder Texturrampe.
    // Die Nahtlücke und der Vasen-Spiralzuwachs würden sonst stillschweigend
    // verändert; dort bleibt die bewährte G1-Ausgabe erhalten.
    const arcCfg = s.arcFitting
    const canFitArcs =
      arcCfg?.enabled === true &&
      path.closed &&
      seamGap === 0 &&
      !spiral &&
      !scarfPlan &&
      !texture &&
      !s.pressureAdvanceRamp?.enabled

    for (let i = 1; i < pts.length; ) {
      const fitted = canFitArcs ? findLongestArc(pts, i - 1, arcCfg.tolerance, arcCfg.minSegments) : null
      if (fitted) {
        const a = pts[fitted.startIndex]
        const b = pts[fitted.endIndex]
        const length = fittedArcLength(fitted)
        const gcodeLine = this.out.length + 1
        const segmentFlow = speedUsed * width * h * s.flow * flowScale
        this.e += length * eFactor
        this.filamentMm += length
        this.volumeMm3 += length * width * h * s.flow * flowScale
        if (segmentFlow > this.maxFlowMm3s) this.maxFlowMm3s = segmentFlow
        const iOffset = fitted.center.x - (a.x + this.dx)
        const jOffset = fitted.center.y - (a.y + this.dy)
        this.line(
          `G${fitted.ccw ? 3 : 2} X${this.fmt(b.x + this.dx, 2)} Y${this.fmt(b.y + this.dy, 2)} ` +
            `I${this.fmt(iOffset, 3)} J${this.fmt(jOffset, 3)} E${this.fmt(this.e)} F${Math.round(speedUsed * 60)}`,
        )
        this.x = b.x
        this.y = b.y
        pathDistance += length
        pathTimeAtSpeed += length / Math.max(0.1, speedUsed)
        pathVolume += length * width * h * s.flow * flowScale
        // Die Vorschau bleibt eine Polylinie. Mehrere Vorschausegmente zeigen
        // auf dieselbe G2/G3-Zeile; so bleibt die Zeilenzuordnung gültig.
        const steps = Math.max(2, Math.min(32, Math.ceil(Math.abs(fitted.sweep) / (Math.PI / 18))))
        for (let step = 1; step <= steps; step++) {
          const p0 = arcPointAt(fitted, (step - 1) / steps)
          const p1 = arcPointAt(fitted, step / steps)
          pushPreview(p0.x, p0.y, p1.x, p1.y, gcodeLine, speedUsed, segmentFlow, code)
        }
        i = fitted.endIndex + 1
        continue
      }
      const a = pts[i - 1], b = pts[i]
      const dist = Math.hypot(b.x - a.x, b.y - a.y)
      if (dist < 1e-4) {
        i++
        continue
      }
      const ramp = s.pressureAdvanceRamp
      if (ramp?.enabled) {
        const span = ramp.endX - ramp.startX
        const t = Math.abs(span) < 1e-6 ? 0 : Math.max(0, Math.min(1, (b.x - ramp.startX) / span))
        const value = Math.max(0, Math.min(2, ramp.from + (ramp.to - ramp.from) * t))
        if (this.lastRampPa === null || Math.abs(value - this.lastRampPa) >= 0.0005) {
          this.lastRampPa = value
          this.line(this.pressureAdvanceLine(value))
        }
      }
      // Zeilennummer der folgenden Extrusionszeile in der endgültigen Datei
      // (der Metadaten-/Objektkopf wird später in `sliceMesh` bzw. beim
      // Zusammensetzen der Objekte aufaddiert).
      const gcodeLine = this.out.length + 1
      const riseA = texture ? textureHeights[i - 1] ?? 0 : 0
      const riseB = texture ? textureHeights[i] ?? 0 : 0
      const rise = texture ? (riseA + riseB) / 2 : 0
      // Auf der Deckschicht ist nur der zusätzliche Aufbau zu fördern; die
      // normale Schicht darunter wurde bereits geschlossen gedruckt.
      const extraFlow = texture ? Math.max(0.1, rise / h) : 1
      const scarfFlow = scarfPlan?.flowScale[i] ?? 1
      const segmentFlow = speedUsed * width * h * s.flow * flowScale * extraFlow * scarfFlow
      this.e += dist * eFactor * extraFlow * scarfFlow
      this.filamentMm += dist
      this.volumeMm3 += dist * width * h * s.flow * flowScale * extraFlow * scarfFlow
      if (segmentFlow > this.maxFlowMm3s) this.maxFlowMm3s = segmentFlow
      if (spiral) {
        spiralDone += dist
        const zz = spiralLength > 1e-6 ? spiralStart + ((spiralTop - spiralStart) * spiralDone) / spiralLength : spiralTop
        this.z = zz
        this.line(
          `G1 X${this.fmt(b.x + this.dx, 2)} Y${this.fmt(b.y + this.dy, 2)} Z${this.fmt(zz, 3)} E${this.fmt(this.e)} F${Math.round(speedUsed * 60)}`,
        )
      } else if (scarfPlan) {
        const zz = scarfPlan.z[i] ?? this.zAt(b.x, b.y)
        this.z = zz
        this.line(
          `G1 X${this.fmt(b.x + this.dx, 2)} Y${this.fmt(b.y + this.dy, 2)} Z${this.fmt(zz, 3)} E${this.fmt(this.e)} F${Math.round(speedUsed * 60)}`,
        )
      } else if (texture) {
        const zz = this.zAt(b.x, b.y) + riseB
        this.z = zz
        this.line(
          `G1 X${this.fmt(b.x + this.dx, 2)} Y${this.fmt(b.y + this.dy, 2)} Z${this.fmt(zz, 3)} E${this.fmt(this.e)} F${Math.round(speedUsed * 60)}`,
        )
      } else {
        this.line(`G1 X${this.fmt(b.x + this.dx, 2)} Y${this.fmt(b.y + this.dy, 2)} E${this.fmt(this.e)} F${Math.round(speedUsed * 60)}`)
      }
      this.x = b.x
      this.y = b.y
      pathDistance += dist
      pathTimeAtSpeed += dist / Math.max(0.1, speedUsed)
      pathVolume += dist * width * h * s.flow * flowScale * extraFlow * scarfFlow
      const previewCode = ramp?.enabled ? rampPreviewCode((a.x + b.x) / 2) : code
      pushPreview(a.x, a.y, b.x, b.y, gcodeLine, speedUsed, segmentFlow, previewCode)
      i++
    }

    // Die letzte Scarf-Bahn endet an der Starthöhe. Vor dem nächsten Travel
    // wieder auf die volle Schichthöhe heben, damit die Düse nicht durch den
    // bereits gedruckten Nachbarbereich schleift.
    if (scarfPlan) {
      const endTop = this.zAt(this.x, this.y)
      if (Math.abs(this.z - endTop) > 0.005) {
        this.z = endTop
        this.line(`G1 Z${this.fmt(endTop, 3)} F600`)
      }
    }

    // Die Zeit wird einmal für die ganze Bahn gerechnet, nicht je Punkt. Bei
    // dichten Texturpunkten würde sonst jedes 0,16-mm-Segment erneut auf null
    // abbremsen und die Schätzung um ein Vielfaches aufblasen. Die Bahn selbst
    // hat nur am Anfang und Ende einen echten Halt; Kurven und Junction
    // Deviation sind im Beschleunigungszuschlag enthalten.
    if (pathDistance > 0) {
      const cruiseSpeed = pathDistance / Math.max(1e-9, pathTimeAtSpeed)
      pathSeconds = this.moveSeconds(
        pathDistance,
        cruiseSpeed,
        this.currentAccel || this.printAccel(),
      )
      this.seconds += pathSeconds
    }
    if (pathSeconds > 0) {
      const feature = this.featureStats.get(path.kind) ?? { seconds: 0, volumeMm3: 0 }
      feature.seconds += pathSeconds
      feature.volumeMm3 += pathVolume
      this.featureStats.set(path.kind, feature)
    }

    // Innenwände und Außenwände: Wischen erst beim nächsten Travel. Liegt
    // die nächste Innenwand direkt daneben, entfällt der Rückzug ganz. Bei
    // einer Außenwand wird nur ein sehr kurzer Weg zur Innenwand zugelassen;
    // sonst bleibt die sichtbare Naht unangetastet. Saum/Skirt zieht sofort
    // zurück.
    if (path.closed && s.seam.wipe && !this.retracted && s.retraction.distance > 0) {
      if (
        s.printOrder?.continuous !== false &&
        (path.kind === 'inner-wall' || path.kind === 'outer-wall' || path.kind === 'adhesion')
      ) {
        this.pendingWipe = true
      } else {
        this.retractNow(s.retraction.distance)
      }
    }
    this.lastPathKind = path.kind
    this.lastPathTopSkin = path.topSkin === true
    this.lastPathTexture = texture
    this.lastPathTextureRise = textureMaxRise
  }

  private ensureZ(x: number, y: number) {
    const target = this.zAt(x, y)
    if (Math.abs(target - this.z) > 0.005) {
      this.z = target
      this.line(`G1 Z${this.fmt(target, 3)} F600`)
    }
  }

  end() {
    if (this.pendingWipe) {
      this.pendingWipe = false
      this.retractNow()
    }
    const customEnd = this.opts.customGcode?.end
    const fullEnd = this.opts.customGcode?.fullMachineGcode === true && Boolean(customEnd?.trim())
    if (!fullEnd) for (const l of buildEndGcode(this.opts.profile, this.settings)) this.line(l)
    // Test-Overrides dürfen den Drucker nicht mit einem Sonderwert zurücklassen.
    // Der eigene End-G-code des Nutzers kommt danach und hat das letzte Wort.
    for (const l of this.endLines) this.line(l)
    for (const l of this.customLines(customEnd)) this.line(l)
    // `filamentMm` ist die zurückgelegte Extrusionsstrecke, nicht die Länge
    // des verbrauchten Filaments. Für den Footer aus dem Volumen rechnen.
    const filamentArea = Math.PI * (this.settings.filamentDiameter / 2) ** 2
    const filamentMm = filamentArea > 0 ? this.volumeMm3 / filamentArea : 0
    // Die Beschleunigungsanteile stecken jetzt in `seconds`; nur noch ein
    // kleiner Zuschlag für Schichtwechsel und Firmware-Verzögerungen.
    const estimatedSeconds = this.seconds * 1.02 + this.layers.length * 1.5
    this.line(`; Filament: ${filamentMm.toFixed(1)} mm`)
    this.line(`; Dauer (Schaetzung): ${(estimatedSeconds / 60).toFixed(1)} min`)
  }

  result() {
    return { gcode: this.out.join('\n') + '\n', layers: this.layers }
  }
}

function metadataText(value: unknown): string {
  return String(value ?? '')
    .replace(/[\r\n;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function metadataNumber(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '0'
  return value.toFixed(digits).replace(/\.?0+$/, '') || '0'
}

function metadataColor(value?: string): string {
  const raw = String(value ?? '').trim()
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toUpperCase()
  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    const h = raw.slice(1)
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toUpperCase()
  }
  return '#FFFFFF'
}

function metadataDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const parts: string[] = []
  if (h > 0) parts.push(`${h}h`)
  if (m > 0) parts.push(`${m}m`)
  if (s > 0 || parts.length === 0) parts.push(`${s}s`)
  return parts.join(' ')
}

function metadataTimestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} at ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/**
 * Ergänzt den G-Code um die Metadaten, die Mainsail/Fluidd über Moonraker
 * anzeigen. Der `generated by`-Kopf lässt Moonraker den PrusaSlicer-Parser
 * verwenden; die auswertbaren Werte stehen wie bei Prusa/Orca im Footer.
 */
export function withGcodeMetadata(gcode: string, meta: GcodeFileMetadata): string {
  const filaments = meta.filaments.length ? meta.filaments : [{ type: 'PLA' }]
  const types = filaments.map((f) => metadataText(f.type || 'PLA')).join(';') || 'PLA'
  const names = filaments.map((f) => metadataText(f.name || f.type || 'Filament')).join(';')
  const colors = filaments.map((f) => metadataColor(f.color)).join(';')
  const nozzleTemps = filaments.map(() => String(Math.round(meta.settings.temps.nozzle))).join(';')
  const firstTemps = filaments.map(() => String(Math.round(meta.settings.temps.firstLayerNozzle))).join(';')
  const density = metadataNumber(filaments[0]?.density ?? 1.24, 2)
  const blockStart = '; ---- Easy-Slicer Metadaten'

  let body = gcode.replace(/^; generated by Easy-Slicer[^\n]*\n?/, '')
  const previousBlock = body.indexOf(blockStart)
  if (previousBlock >= 0) body = body.slice(0, previousBlock)
  body = body.replace(/\s*$/, '\n')

  const footer = [
    '',
    `${blockStart} (Mainsail/Moonraker) ----`,
    `; filament_type = ${types}`,
    `; filament_settings_id = ${names}`,
    `; filament_colour = ${colors}`,
    `; filament_diameter = ${metadataNumber(meta.settings.filamentDiameter, 2)}`,
    `; filament_density = ${density}`,
    `; nozzle_diameter = ${metadataNumber(meta.settings.nozzle, 2)}`,
    `; layer_height = ${metadataNumber(meta.settings.layerHeight, 3)}`,
    `; first_layer_height = ${metadataNumber(meta.settings.firstLayerHeight, 3)}`,
    `; total layers count = ${Math.max(0, Math.round(meta.layerCount))}`,
    `; nozzle_temperature = ${nozzleTemps}`,
    `; bed_temperature = ${Math.round(meta.settings.temps.bed)}`,
    `; first_layer_temperature = ${firstTemps}`,
    `; first_layer_bed_temperature = ${Math.round(meta.settings.temps.firstLayerBed)}`,
    `; printer_model = ${metadataText(meta.profile.name)}`,
    `; printer_vendor = ${metadataText(meta.profile.brand)}`,
    `; estimated printing time (normal mode) = ${metadataDuration(meta.seconds)}`,
    `; filament used [mm] = ${metadataNumber(meta.filamentMm, 1)}`,
    `; filament used [g] = ${metadataNumber(meta.filamentGrams, 1)}`,
    `; total filament used [g] = ${metadataNumber(meta.filamentGrams, 1)}`,
    `; total toolchanges = ${Math.max(0, Math.round(meta.toolChanges ?? 0))}`,
    `; object_height = ${metadataNumber(meta.maxZ, 2)}`,
    `; max_layer_z = ${metadataNumber(meta.maxZ, 2)}`,
    '',
  ].join('\n')

  return `; generated by Easy-Slicer 0.2.0 on ${metadataTimestamp()}\n${body}${footer}`
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
