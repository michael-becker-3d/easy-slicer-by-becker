import type {
  GcodeFlavor,
  PreviewFeatureKind,
  PreviewLayer,
  SliceFeatureStats,
  SliceStats,
} from './types.ts'
import { PREVIEW_KIND_CODE } from './preview.ts'

/**
 * G-Code-Import ist absichtlich unabhängig von der Slicer-Engine: Der Parser
 * liest auch fremde Dateien, ohne sie erst durch den Slicer zu schicken.
 * Die Konvertierung ist konservativ — sie übersetzt nur Befehle, deren
 * Bedeutung zwischen den Firmwaren eindeutig ist. Alles andere bleibt stehen
 * und wird als Hinweis gemeldet.
 */

export type GcodeDialect = GcodeFlavor | 'unknown'

export type GcodeIssueSeverity = 'error' | 'warning' | 'info'

/** Eine konkrete Auffälligkeit mit optionaler Zeile für den Sprung im Editor. */
export type GcodeIssue = {
  severity: GcodeIssueSeverity
  code: string
  message: string
  /** 1-basierte Zeile; null bei dateiweiten Hinweisen. */
  line: number | null
}

export type GcodeBed = {
  x: number
  y: number
  z: number
  /** Ursprung des Koordinatensystems: Ecke (Marlin) oder Bettmitte (Delta). */
  origin?: 'corner' | 'center'
}

export type GcodeAnalysis = {
  dialect: GcodeDialect
  confidence: 'high' | 'medium' | 'low'
  lineCount: number
  commandCount: number
  layers: PreviewLayer[]
  stats: SliceStats
  features: SliceFeatureStats[]
  bounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }
  temperatures: { nozzle: number | null; bed: number | null }
  maxFeedrate: number
  commandCounts: { command: string; count: number }[]
  issues: GcodeIssue[]
  warnings: string[]
}

export type GcodeChange = {
  /** 1-basierte Zeile im Ausgangstext. */
  line: number
  before: string
  after: string
}

export type GcodeConversion = {
  gcode: string
  from: GcodeDialect
  to: GcodeFlavor
  changed: number
  /** Die ersten geänderten Zeilen für die Prüfvorschau (maximal 200). */
  changes: GcodeChange[]
  warnings: string[]
  unsupported: string[]
}

const FILAMENT_AREA = Math.PI * (1.75 / 2) ** 2
const PREVIEW_MAX_SEGMENTS = 250_000
const ARC_STEP = Math.PI / 18

type Point = { x: number; y: number; z: number }
type Extrusion = { seconds: number; volumeMm3: number }
type Bounds = { min: Point; max: Point }
type Param = { key: string; value: number; raw: string }
type ExtendedParam = { key: string; value: string; raw: string }

type ParsedLine = {
  prefix: string
  command: string | null
  params: Param[]
  extended: ExtendedParam[]
  comment: string
  commentSuffix: string
  hasChecksum: boolean
}

const NUMBER = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?'
const STANDARD_PARAM = new RegExp(`([A-Za-z])\\s*(${NUMBER})`, 'g')
const EXTENDED_PARAM = new RegExp(`([A-Za-z_]+)\\s*=\\s*(${NUMBER})`, 'g')

function parseLine(raw: string): ParsedLine {
  const checksumAt = raw.indexOf('*')
  const hasChecksum = checksumAt >= 0
  const withoutChecksum = hasChecksum ? raw.slice(0, checksumAt) : raw
  const semicolonAt = withoutChecksum.indexOf(';')
  const body = semicolonAt >= 0 ? withoutChecksum.slice(0, semicolonAt) : withoutChecksum
  const commentSuffix = semicolonAt >= 0 ? withoutChecksum.slice(semicolonAt) : ''
  const comment = commentSuffix.replace(/^;\s*/, '').trim()
  const prefixMatch = body.match(/^(\s*(?:N\d+\s*)?)/i)
  const prefix = prefixMatch?.[1] ?? ''
  const rest = body.slice(prefix.length)
  const commandMatch = rest.match(/^([A-Za-z_]+[0-9.]*)\b([\s\S]*)$/)
  if (!commandMatch) {
    // Reine Kommentarzeile: Befehl fehlt, Kommentar bleibt für ;TYPE/;LAYER wichtig.
    return { prefix, command: null, params: [], extended: [], comment, commentSuffix, hasChecksum }
  }
  const command = commandMatch[1].toUpperCase()
  const tail = commandMatch[2] ?? ''
  const params: Param[] = []
  const extended: ExtendedParam[] = []
  for (const match of tail.matchAll(STANDARD_PARAM)) {
    params.push({ key: match[1].toUpperCase(), value: Number(match[2]), raw: match[0].trim() })
  }
  for (const match of tail.matchAll(EXTENDED_PARAM)) {
    extended.push({ key: match[1].toUpperCase(), value: match[2], raw: match[0].trim() })
  }
  return { prefix, command, params, extended, comment, commentSuffix, hasChecksum }
}

function param(parsed: ParsedLine, key: string): number | undefined {
  return parsed.params.find((entry) => entry.key === key)?.value
}

function hasParam(parsed: ParsedLine, key: string): boolean {
  return parsed.params.some((entry) => entry.key === key)
}

function num(value: number): string {
  return String(Math.round(value * 10000) / 10000)
}

function rebuild(parsed: ParsedLine, command: string, params: Param[], extended: ExtendedParam[] = []): string {
  const parts = [...params.map((entry) => entry.raw), ...extended.map((entry) => entry.raw)]
  const suffix = parsed.commentSuffix
    ? parsed.commentSuffix.startsWith(' ')
      ? parsed.commentSuffix
      : ` ${parsed.commentSuffix}`
    : ''
  return `${parsed.prefix}${command}${parts.length ? ` ${parts.join(' ')}` : ''}${suffix}`
}

function featureFromComment(comment: string): PreviewFeatureKind | null {
  const text = comment.toLowerCase()
  if (!text) return null
  if (text.includes('overhang wall')) return 'overhang'
  if (text.includes('outer wall') || text.includes('external perimeter') || text.includes('external wall')) {
    return 'outer-wall'
  }
  if (text.includes('inner wall') || text.includes('perimeter') || text.includes('internal wall')) {
    return 'inner-wall'
  }
  if (text.includes('support interface')) return 'support'
  if (text.includes('support')) return 'support'
  if (text.includes('bridge')) return 'bridge'
  if (text.includes('ironing')) return 'iron'
  if (
    text.includes('solid infill') ||
    text.includes('top surface') ||
    text.includes('bottom surface') ||
    text.includes('top skin') ||
    text.includes('bottom skin') ||
    text === 'skin' ||
    text.includes('skin ')
  ) {
    return 'solid'
  }
  if (text.includes('sparse infill') || text.includes('infill') || text.includes('fill')) return 'sparse'
  if (text.includes('skirt') || text.includes('brim') || text.includes('adhesion') || text.includes('raft')) {
    return 'adhesion'
  }
  return null
}

function detectDialect(text: string): { dialect: GcodeDialect; confidence: 'high' | 'medium' | 'low' } {
  const sample = text.slice(0, 400_000).toLowerCase()
  const scores: Record<GcodeFlavor, number> = {
    marlin: 0,
    marlin2: 0,
    klipper: 0,
    reprapfirmware: 0,
    repetier: 0,
  }
  const boosts: [RegExp, GcodeFlavor, number][] = [
    [/prusaslicer|cura|superSlicer/i, 'marlin', 4],
    [/;\s*klipper|klipper/i, 'klipper', 6],
    [/set_pressure_advance|bed_mesh_calibrate|exclude_object|set_velocity_limit|save_variables/i, 'klipper', 4],
    [/;\s*reprapfirmware|reprapfirmware|rrf/i, 'reprapfirmware', 6],
    [/\bm566\b|\bm572\b|\bm563\b|\bm950\b|\bm291\b|\bm98\b/i, 'reprapfirmware', 3],
    [/;\s*repetier|repetier/i, 'repetier', 6],
    [/\bm302\b|\bm206\b|\bm220\b/i, 'repetier', 2],
    [/;\s*marlin\s*2|marlin2/i, 'marlin2', 6],
    [/\bm486\b|\bm73\b|\bm413\b|\bm593\b|\bm900\b/i, 'marlin2', 2],
    [/;\s*marlin|marlin/i, 'marlin', 4],
    [/\bm420\b|\bm204\s+s\b|\bm900\b|\bm593\b/i, 'marlin', 1],
  ]
  for (const [pattern, flavor, score] of boosts) if (pattern.test(sample)) scores[flavor] += score
  const ranked = (Object.entries(scores) as [GcodeFlavor, number][]).sort((a, b) => b[1] - a[1])
  const [best, bestScore] = ranked[0]
  const second = ranked[1]?.[1] ?? 0
  if (bestScore <= 0) return { dialect: 'unknown', confidence: 'low' }
  if (bestScore >= 6 && bestScore > second) return { dialect: best, confidence: 'high' }
  if (bestScore >= 2) return { dialect: best, confidence: 'medium' }
  return { dialect: best, confidence: 'low' }
}

export function analyzeGcode(text: string, bed?: GcodeBed): GcodeAnalysis {
  const issues: GcodeIssue[] = []
  const issueKeys = new Set<string>()
  const addIssue = (
    severity: GcodeIssueSeverity,
    code: string,
    message: string,
    line: number | null = null,
  ) => {
    if (issueKeys.has(code)) return
    issueKeys.add(code)
    issues.push({ severity, code, message, line })
  }
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  const counts = new Map<string, number>()
  const features = new Map<PreviewFeatureKind, Extrusion>()
  const layerMap = new Map<string, PreviewLayer>()
  const bounds: Bounds = {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  }
  let x = 0
  let y = 0
  let z = 0
  let e = 0
  let feed = 3000
  let absPosition = true
  let absExtrusion = true
  let unitScale = 1
  let plane: 'XY' | 'XZ' | 'YZ' = 'XY'
  let knownPosition = false
  let currentKind: PreviewFeatureKind = 'other'
  let nozzleTemp: number | null = null
  let bedTemp: number | null = null
  let maxFeedrate = 0
  let totalSeconds = 0
  let filamentMm = 0
  let totalVolume = 0
  let maxFlow = 0
  let previewSegments = 0
  let truncated = false
  let showedArcWarning = false
  let showedUnitsWarning = false
  let sawVolumetricE = false
  let sawHome = false
  let m200Line: number | null = null
  let firstOutsideLine: number | null = null
  const tools = new Set<string>()

  const addBounds = (p: Point, line: number) => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return
    bounds.min.x = Math.min(bounds.min.x, p.x)
    bounds.min.y = Math.min(bounds.min.y, p.y)
    bounds.min.z = Math.min(bounds.min.z, p.z)
    bounds.max.x = Math.max(bounds.max.x, p.x)
    bounds.max.y = Math.max(bounds.max.y, p.y)
    bounds.max.z = Math.max(bounds.max.z, p.z)
    if (!bed || firstOutsideLine !== null) return
    const minX = bed.origin === 'center' ? -bed.x / 2 : 0
    const maxX = bed.origin === 'center' ? bed.x / 2 : bed.x
    const minY = bed.origin === 'center' ? -bed.y / 2 : 0
    const maxY = bed.origin === 'center' ? bed.y / 2 : bed.y
    const epsilon = 0.5
    if (
      p.x < minX - epsilon ||
      p.x > maxX + epsilon ||
      p.y < minY - epsilon ||
      p.y > maxY + epsilon ||
      p.z < -epsilon ||
      p.z > bed.z + epsilon
    ) {
      firstOutsideLine = line
    }
  }

  const layerAt = (layerZ: number): PreviewLayer => {
    const key = layerZ.toFixed(3)
    let layer = layerMap.get(key)
    if (!layer) {
      layer = { z: layerZ, data: [], lines: [] }
      layerMap.set(key, layer)
    }
    return layer
  }

  const nearestLayer = (layerZ: number): PreviewLayer => {
    let best: PreviewLayer | null = null
    let bestDistance = Infinity
    for (const layer of layerMap.values()) {
      const distance = Math.abs(layer.z - layerZ)
      if (distance < bestDistance) {
        bestDistance = distance
        best = layer
      }
    }
    if (best && bestDistance <= 2) return best
    return layerAt(layerZ)
  }

  const addPreview = (
    layer: PreviewLayer,
    kind: PreviewFeatureKind,
    a: Point,
    b: Point,
    speed: number,
    flow: number,
    line: number,
  ) => {
    if (previewSegments >= PREVIEW_MAX_SEGMENTS) {
      truncated = true
      return
    }
    const round = (value: number) => Math.round(value * 100) / 100
    layer.data.push(
      PREVIEW_KIND_CODE[kind],
      round(a.x),
      round(a.y),
      round(b.x),
      round(b.y),
      round(speed),
      round(flow),
      kind === 'travel' ? 0 : nozzleTemp ?? 0,
      0,
      0,
      0,
      0,
    )
    layer.lines?.push(line)
    previewSegments++
  }

  const addExtrusion = (
    kind: PreviewFeatureKind,
    a: Point,
    b: Point,
    speed: number,
    seconds: number,
    volume: number,
    line: number,
  ) => {
    if (!sawHome) {
      addIssue(
        'warning',
        'missing-homing',
        'Extrusion vor dem ersten Homing (G28/G161) — Datei nur auf einer bereits gehomten Maschine starten.',
        line,
      )
    }
    if (nozzleTemp === null) {
      addIssue(
        'warning',
        'missing-heater',
        'Keine Düsentemperatur im G-Code gefunden — die Heizung muss vor dem Start extern erfolgen.',
        line,
      )
    } else if (nozzleTemp <= 0) {
      addIssue(
        'error',
        'cold-extrusion',
        'Extrusion bei ausgeschalteter Düse (M104/M109 S0) — Datei nicht ungeprüft starten.',
        line,
      )
    }
    const layer = layerAt(b.z)
    const dt = Math.max(0, seconds)
    const flow = dt > 0 ? volume / dt : 0
    if (flow > maxFlow) maxFlow = flow
    addPreview(layer, kind, a, b, speed, flow, line)
    const stat = features.get(kind) ?? { seconds: 0, volumeMm3: 0 }
    stat.seconds += dt
    stat.volumeMm3 += volume
    features.set(kind, stat)
    totalSeconds += dt
    filamentMm += volume / FILAMENT_AREA
    totalVolume += volume
  }

  const addTravel = (a: Point, b: Point, speed: number, seconds: number, line: number) => {
    const layer = nearestLayer(b.z)
    addPreview(layer, 'travel', a, b, speed, 0, line)
    const stat = features.get('travel') ?? { seconds: 0, volumeMm3: 0 }
    stat.seconds += seconds
    features.set('travel', stat)
    totalSeconds += seconds
  }

  const resolveTarget = (parsed: ParsedLine): { target: Point; targetE: number; feedValue: number } => {
    const ax = hasParam(parsed, 'X')
      ? absPosition
        ? (param(parsed, 'X') ?? 0) * unitScale
        : x + (param(parsed, 'X') ?? 0) * unitScale
      : x
    const ay = hasParam(parsed, 'Y')
      ? absPosition
        ? (param(parsed, 'Y') ?? 0) * unitScale
        : y + (param(parsed, 'Y') ?? 0) * unitScale
      : y
    const az = hasParam(parsed, 'Z')
      ? absPosition
        ? (param(parsed, 'Z') ?? 0) * unitScale
        : z + (param(parsed, 'Z') ?? 0) * unitScale
      : z
    const targetE = hasParam(parsed, 'E')
      ? absExtrusion
        ? (param(parsed, 'E') ?? 0) * unitScale
        : e + (param(parsed, 'E') ?? 0) * unitScale
      : e
    const feedValue = param(parsed, 'F') ?? feed
    return { target: { x: ax, y: ay, z: az }, targetE, feedValue }
  }

  const moveLinear = (parsed: ParsedLine, line: number) => {
    const { target, targetE, feedValue } = resolveTarget(parsed)
    feed = feedValue > 0 ? feedValue : feed
    maxFeedrate = Math.max(maxFeedrate, feed)
    const start: Point = { x, y, z }
    const end = target
    const xyDistance = Math.hypot(end.x - start.x, end.y - start.y)
    const distance3 = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z)
    const speed = Math.max(1, feed / 60)
    const seconds = distance3 / speed
    const deltaE = targetE - e
    if (hasParam(parsed, 'F') && (param(parsed, 'F') ?? 0) <= 0 && distance3 > 1e-6) {
      addIssue(
        'warning',
        'zero-feed',
        'Bewegung mit Vorschub F0 gefunden — die Analyse nutzt den letzten gültigen Vorschub.',
        line,
      )
    }

    if (!knownPosition) {
      knownPosition = true
      x = end.x
      y = end.y
      z = end.z
      e = targetE
      addBounds(end, line)
      return
    }

    if (deltaE > 1e-6 && distance3 > 1e-6) {
      const volume = deltaE * FILAMENT_AREA
      addExtrusion(currentKind, start, end, speed, seconds, volume, line)
    } else if (xyDistance > 1e-6 || Math.abs(end.z - start.z) > 1e-6) {
      addTravel(start, end, speed, seconds, line)
    }
    x = end.x
    y = end.y
    z = end.z
    e = targetE
    addBounds(end, line)
  }

  const moveArc = (parsed: ParsedLine, clockwise: boolean, line: number) => {
    if (plane !== 'XY' || (!hasParam(parsed, 'I') && !hasParam(parsed, 'J'))) {
      if (!showedArcWarning) {
        addIssue(
          'warning',
          'arc-linearized',
          'Bögen G2/G3 werden ohne I/J bzw. außerhalb der XY-Ebene als gerade Linie dargestellt.',
          line,
        )
        showedArcWarning = true
      }
      moveLinear(parsed, line)
      return
    }
    const start: Point = { x, y, z }
    const { target, targetE, feedValue } = resolveTarget(parsed)
    feed = feedValue > 0 ? feedValue : feed
    maxFeedrate = Math.max(maxFeedrate, feed)
    const cx = x + (param(parsed, 'I') ?? 0) * unitScale
    const cy = y + (param(parsed, 'J') ?? 0) * unitScale
    const radius = Math.hypot(x - cx, y - cy)
    if (!Number.isFinite(radius) || radius < 1e-6) {
      moveLinear(parsed, line)
      return
    }
    const a0 = Math.atan2(y - cy, x - cx)
    const a1 = Math.atan2(target.y - cy, target.x - cx)
    let sweep = a1 - a0
    if (clockwise) {
      while (sweep >= -1e-9) sweep -= Math.PI * 2
    } else {
      while (sweep <= 1e-9) sweep += Math.PI * 2
    }
    const totalLength = Math.abs(sweep) * radius
    if (totalLength < 1e-6) {
      moveLinear(parsed, line)
      return
    }
    const speed = Math.max(1, feed / 60)
    const steps = Math.max(2, Math.ceil(Math.abs(sweep) / ARC_STEP))
    const deltaE = targetE - e
    const volume = deltaE > 0 ? deltaE * FILAMENT_AREA : 0
    if (hasParam(parsed, 'F') && (param(parsed, 'F') ?? 0) <= 0) {
      addIssue(
        'warning',
        'zero-feed',
        'Bewegung mit Vorschub F0 gefunden — die Analyse nutzt den letzten gültigen Vorschub.',
        line,
      )
    }
    const stepSeconds = totalLength / steps / speed
    let previous = start
    for (let i = 1; i <= steps; i++) {
      const angle = a0 + (sweep * i) / steps
      const point: Point = {
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
        z: start.z + ((target.z - start.z) * i) / steps,
      }
      if (deltaE > 1e-6) {
        addExtrusion(currentKind, previous, point, speed, stepSeconds, volume / steps, line)
      } else {
        addTravel(previous, point, speed, stepSeconds, line)
      }
      addBounds(point, line)
      previous = point
    }
    x = target.x
    y = target.y
    z = target.z
    e = targetE
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const raw = lines[lineIndex]
    const line = lineIndex + 1
    if (!raw.trim()) continue
    const parsed = parseLine(raw)
    if (parsed.comment) {
      const kind = featureFromComment(parsed.comment)
      if (kind) currentKind = kind
      const layerZ = parsed.comment.match(/^[Zz]\s*[:=]\s*([-+]?\d+(?:[.,]\d+)?)/)
      if (layerZ) {
        const value = Number(layerZ[1].replace(',', '.'))
        if (Number.isFinite(value)) z = value
      }
    }
    if (!parsed.command) continue
    const command = parsed.command
    counts.set(command, (counts.get(command) ?? 0) + 1)

    if (command === 'G90') {
      absPosition = true
      continue
    }
    if (command === 'G91') {
      absPosition = false
      continue
    }
    if (command === 'M82') {
      absExtrusion = true
      continue
    }
    if (command === 'M83') {
      absExtrusion = false
      continue
    }
    if (command === 'G20') {
      unitScale = 25.4
      if (!showedUnitsWarning) {
        addIssue(
          'warning',
          'units-inch',
          'G20 (Zoll) erkannt — Analyse rechnet in Millimeter um; die Konvertierung lässt G20 unverändert.',
          line,
        )
        showedUnitsWarning = true
      }
      continue
    }
    if (command === 'G21') {
      unitScale = 1
      continue
    }
    if (command === 'G17') plane = 'XY'
    else if (command === 'G18') plane = 'XZ'
    else if (command === 'G19') plane = 'YZ'
    else if (command === 'G92') {
      if (hasParam(parsed, 'X')) x = (param(parsed, 'X') ?? 0) * unitScale
      if (hasParam(parsed, 'Y')) y = (param(parsed, 'Y') ?? 0) * unitScale
      if (hasParam(parsed, 'Z')) z = (param(parsed, 'Z') ?? 0) * unitScale
      if (hasParam(parsed, 'E')) e = (param(parsed, 'E') ?? 0) * unitScale
      knownPosition = true
    } else if (command === 'G28' || command === 'G161') {
      sawHome = true
      knownPosition = false
    } else if (command === 'G0' || command === 'G1') {
      moveLinear(parsed, line)
    } else if (command === 'G2' || command === 'G3') {
      moveArc(parsed, command === 'G2', line)
    } else if (command === 'G4') {
      const p = param(parsed, 'P')
      const s = param(parsed, 'S')
      if (p !== undefined) totalSeconds += p / 1000
      else if (s !== undefined) totalSeconds += s
    } else if (command === 'M104' || command === 'M109') {
      const value = param(parsed, 'S') ?? param(parsed, 'R')
      if (value !== undefined) nozzleTemp = value
    } else if (command === 'M140' || command === 'M190') {
      const value = param(parsed, 'S') ?? param(parsed, 'R')
      if (value !== undefined) bedTemp = value
    } else if (command === 'M200') {
      if ((param(parsed, 'D') ?? 0) > 0) {
        sawVolumetricE = true
        if (m200Line === null) m200Line = line
      }
    } else if (/^T\d+$/.test(command)) {
      tools.add(command)
    }
  }

  if (!knownPosition && !layerMap.size) {
    addIssue('warning', 'no-moves', 'Keine druckbaren Bewegungen gefunden — ist das wirklich eine G-Code-Datei?')
  }
  if (sawVolumetricE) {
    addIssue(
      'warning',
      'volumetric-e',
      'M200 D (volumetrische Extrusion) erkannt — Mengen werden als lineare E-Werte geschätzt.',
      m200Line,
    )
  }
  if (truncated) {
    addIssue(
      'warning',
      'preview-truncated',
      `Vorschau auf ${PREVIEW_MAX_SEGMENTS.toLocaleString('de-DE')} Segmente begrenzt; Analyse und Zeit bleiben vollständig.`,
    )
  }
  if (tools.size > 1) {
    addIssue(
      'warning',
      'multi-tool',
      `Mehrere Werkzeuge (${[...tools].join(', ')}) — die Vorschau zeigt alle Werkzeuge gemeinsam.`,
    )
  }
  if (!lines.some((line) => /;.*(?:layer|type|feature)/i.test(line))) {
    addIssue(
      'warning',
      'no-layer-comments',
      'Keine Layer-/Typ-Kommentare gefunden — Bahntypen sind als „Sonstige“ eingeordnet, die Layer folgen der Z-Höhe.',
    )
  }
  if (firstOutsideLine !== null && bed) {
    addIssue(
      'warning',
      'outside-bounds',
      `Mindestens eine Bewegung liegt außerhalb des Bauraums (${bed.x} × ${bed.y} × ${bed.z} mm).`,
      firstOutsideLine,
    )
  }

  const layers = [...layerMap.values()].sort((a, b) => a.z - b.z)
  const extrusionSeconds = [...features.entries()]
    .filter(([kind]) => kind !== 'travel')
    .reduce((sum, [, value]) => sum + value.seconds, 0)
  const featureRows = [...features.entries()]
    .filter(([, value]) => value.seconds > 0 || value.volumeMm3 > 0)
    .map(([kind, value]): SliceFeatureStats => ({
      kind,
      seconds: Math.round(value.seconds * 10) / 10,
      grams: Math.round((value.volumeMm3 / 1000) * 1.24 * 100) / 100,
      percent:
        kind === 'travel' || extrusionSeconds <= 0
          ? 0
          : Math.round((value.seconds / extrusionSeconds) * 1000) / 10,
    }))

  const safeBounds = Number.isFinite(bounds.min.x)
    ? bounds
    : { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }
  const stats: SliceStats = {
    estimatedSeconds: Math.round(totalSeconds),
    filamentMm: Math.round(filamentMm),
    filamentGrams: Math.round((totalVolume / 1000) * 1.24 * 10) / 10,
    layerCount: layers.length,
    volumeCm3: Math.round(totalVolume / 100) / 10,
    maxFlowMm3s: Math.round(maxFlow * 10) / 10,
  }

  const detected = detectDialect(text)
  const warnings = issues
    .filter((issue) => issue.severity !== 'info')
    .map((issue) => issue.message)

  return {
    dialect: detected.dialect,
    confidence: detected.confidence,
    lineCount: lines.length,
    commandCount: [...counts.values()].reduce((sum, value) => sum + value, 0),
    layers,
    stats,
    features: featureRows,
    bounds: safeBounds,
    temperatures: { nozzle: nozzleTemp, bed: bedTemp },
    maxFeedrate: Math.round(maxFeedrate),
    commandCounts: [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([command, count]) => ({ command, count })),
    issues,
    warnings,
  }
}

const KNOWN_UNSUPPORTED = new Set([
  'M566',
  'M567',
  'M568',
  'M563',
  'M950',
  'M291',
  'M292',
  'M98',
  'M593',
  'M486',
  'M73',
  'M413',
  'SET_VELOCITY_LIMIT',
  'BED_MESH_PROFILE',
  'EXCLUDE_OBJECT',
  'SET_PRINT_STATS_INFO',
])

function pressureAdvanceValue(parsed: ParsedLine): number | null {
  if (parsed.command === 'M900') {
    const value = param(parsed, 'K')
    return value === undefined ? null : value
  }
  if (parsed.command === 'M572') {
    const value = param(parsed, 'S')
    return value === undefined ? null : value
  }
  if (parsed.command === 'SET_PRESSURE_ADVANCE') {
    const raw = parsed.extended.find((entry) => entry.key === 'ADVANCE')?.value
    if (raw === undefined) return null
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
  }
  return null
}

/**
 * Übersetzt nur eindeutige Befehle. Der Rückgabewert enthält immer den
 * vollständigen Text; nicht übersetzte Zeilen bleiben byte-genau erhalten.
 */
export function convertGcode(text: string, to: GcodeFlavor): GcodeConversion {
  const detected = detectDialect(text).dialect
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  const output: string[] = []
  const warnings = new Set<string>()
  const unsupported = new Set<string>()
  const changes: GcodeChange[] = []
  let changed = 0

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const raw = lines[lineIndex]
    const parsed = parseLine(raw)
    if (!parsed.command || parsed.hasChecksum) {
      if (parsed.command && parsed.hasChecksum) warnings.add('Zeilen mit Prüfsumme (*) bleiben unverändert.')
      output.push(raw)
      continue
    }
    const command = parsed.command
    let next = raw

    if (command === 'M204') {
      const s = param(parsed, 'S')
      const p = param(parsed, 'P')
      const t = param(parsed, 'T')
      if (to === 'reprapfirmware' && p === undefined && s !== undefined) {
        const params: Param[] = [
          { key: 'P', value: s, raw: `P${num(s)}` },
          ...(t !== undefined ? [{ key: 'T', value: t, raw: `T${num(t)}` }] : []),
        ]
        next = rebuild(parsed, 'M204', params)
      } else if (to !== 'reprapfirmware' && s === undefined && p !== undefined) {
        const params: Param[] = [
          { key: 'S', value: p, raw: `S${num(p)}` },
          ...(t !== undefined ? [{ key: 'T', value: t, raw: `T${num(t)}` }] : []),
        ]
        next = rebuild(parsed, 'M204', params)
      }
    } else if (command === 'M900' || command === 'M572' || command === 'SET_PRESSURE_ADVANCE') {
      const value = pressureAdvanceValue(parsed)
      if (value !== null) {
        if (to === 'klipper') {
          next = rebuild(parsed, 'SET_PRESSURE_ADVANCE', [], [
            { key: 'ADVANCE', value: num(value), raw: `ADVANCE=${num(value)}` },
          ])
        } else if (to === 'reprapfirmware') {
          next = rebuild(parsed, 'M572', [
            { key: 'D', value: 0, raw: 'D0' },
            { key: 'S', value, raw: `S${num(value)}` },
          ])
        } else {
          next = rebuild(parsed, 'M900', [{ key: 'K', value, raw: `K${num(value)}` }])
        }
        if (command === 'M572' && (param(parsed, 'D') ?? 0) !== 0) {
          warnings.add('M572 mit Werkzeugindex ungleich 0: Der Index wird nicht übernommen.')
        }
      }
    } else if (command === 'M106') {
      const p = param(parsed, 'P')
      if (p !== undefined && p !== 0 && (to === 'klipper' || to === 'repetier')) {
        unsupported.add('M106 P>0')
      } else if (p === 0 && (to === 'klipper' || to === 'repetier')) {
        const params = parsed.params.filter((entry) => entry.key !== 'P')
        next = rebuild(parsed, 'M106', params)
      }
    } else if (command === 'G29' && to === 'klipper' && parsed.params.length === 0) {
      next = rebuild(parsed, 'BED_MESH_CALIBRATE', [])
    } else if (command === 'BED_MESH_CALIBRATE' && to !== 'klipper' && parsed.params.length === 0) {
      next = rebuild(parsed, 'G29', [])
    } else if (KNOWN_UNSUPPORTED.has(command)) {
      unsupported.add(command)
    }

    if (next !== raw) {
      changed++
      if (changes.length < 200) changes.push({ line: lineIndex + 1, before: raw, after: next })
    }
    output.push(next)
  }

  if (detected === 'unknown') warnings.add('Firmware konnte nicht sicher erkannt werden — Ausgangsformat unbekannt.')
  if (changed === 0) warnings.add('Keine sicher übersetzbaren Befehle gefunden; die Datei bleibt inhaltlich unverändert.')
  if (unsupported.size) {
    warnings.add(
      'Nicht übersetzt: ' +
        [...unsupported].slice(0, 12).join(', ') +
        (unsupported.size > 12 ? ' …' : '') +
        '. Diese Befehle bleiben unverändert und müssen zur Ziel-Firmware passen.',
    )
  }

  return {
    gcode: output.join('\n'),
    from: detected,
    to,
    changed,
    changes,
    warnings: [...warnings],
    unsupported: [...unsupported],
  }
}
