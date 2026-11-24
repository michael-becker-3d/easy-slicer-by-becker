import { PREVIEW_STRIDE, type PreviewFeatureKind, type PreviewLayer } from '../../shared/types.ts'
import { PREVIEW_CODE_KIND, PREVIEW_FEATURE_META, PREVIEW_KIND_CODE } from '../../shared/preview.ts'

export type PreviewColorMode =
  | 'kind'
  | 'speed'
  | 'flow'
  | 'flow-margin'
  | 'height'
  | 'temperature'
  | 'acceleration'
  | 'width'
  | 'fan'
  | 'pressure-advance'
  | 'duration'
  | 'duration-log'

/** Standardfarben oder farbenblindtaugliche Okabe-Ito-Palette. */
export type PreviewPalette = 'standard' | 'accessible'

/**
 * Bezug der Durchfluss-Reserve. Nur `profile` ist eine echte Grenze;
 * `measured` ist der höchste gemessene Fluss und muss in der Oberfläche
 * ausdrücklich als gemessene Referenz gekennzeichnet werden.
 */
export type PreviewFlowLimitSource = 'profile' | 'measured' | 'none'

export type PreviewFlowLimitInfo = {
  limit: number
  source: PreviewFlowLimitSource
}

/**
 * Löst den Bezug der Durchfluss-Reserve auf. Ein Profilwert 0 bedeutet
 * „nicht gesetzt“ und darf nicht als Limit erscheinen; dann dient der
 * tatsächlich erreichte Spitzenfluss nur als gemessene Referenz.
 */
export function previewFlowLimitInfo(
  configured: number | undefined,
  actual: number,
): PreviewFlowLimitInfo {
  const configuredLimit = configured ?? 0
  if (Number.isFinite(configuredLimit) && configuredLimit > 0) {
    return { limit: configuredLimit, source: 'profile' }
  }
  if (Number.isFinite(actual) && actual > 0) return { limit: actual, source: 'measured' }
  return { limit: 0, source: 'none' }
}

/** Wirksamer Zahlenwert für Farben und Reserveberechnungen. */
export function effectivePreviewFlowLimit(configured: number | undefined, actual: number): number {
  return previewFlowLimitInfo(configured, actual).limit
}

/** Beschriftung der Reserve im Segment-Steckbrief, passend zur Bezugsquelle. */
export function previewFlowReserveLabel(source: PreviewFlowLimitSource): string {
  if (source === 'profile') return 'Reserve zum Limit'
  if (source === 'measured') return 'Reserve (gemessene Referenz)'
  return 'Reserve'
}

export const PREVIEW_MODES: { id: PreviewColorMode; label: string }[] = [
  { id: 'kind', label: 'Linientyp' },
  { id: 'speed', label: 'Geschwindigkeit' },
  { id: 'flow', label: 'Fluss' },
  { id: 'flow-margin', label: 'Durchfluss-Reserve' },
  { id: 'height', label: 'Schichthöhe' },
  { id: 'temperature', label: 'Temperatur' },
  { id: 'acceleration', label: 'Beschleunigung' },
  { id: 'width', label: 'Linienbreite' },
  { id: 'fan', label: 'Lüftergeschwindigkeit' },
  { id: 'pressure-advance', label: 'Pressure Advance' },
  { id: 'duration', label: 'Schichtdauer' },
  { id: 'duration-log', label: 'Layerzeit (log)' },
]

/** Farbverlauf für Messwerte: langsam/kühl → schnell/warm. */
export const PREVIEW_GRADIENT = ['#2f6fed', '#27c6e8', '#7cde78', '#f0d43a', '#ff7738', '#ef4444']

/** Farbenblindtauglicher Ersatz für den Messwertverlauf (Viridis). */
export const PREVIEW_GRADIENT_ACCESSIBLE = ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725']

/** PA-Linientest: Blau (wenig) → Gelb → Rot (viel). */
/** Durchfluss-Reserve: grün = viel Luft bis zum Limit, rot = am Limit. */
export const RESERVE_GRADIENT = ['#22c55e', '#84cc16', '#facc15', '#fb923c', '#ef4444']

/** Reserve-Skala mit höherem Kontrast für Rot-Grün-Schwäche (Cividis-Richtung). */
export const RESERVE_GRADIENT_ACCESSIBLE = ['#fde725', '#a0da39', '#4ac16d', '#1fa187', '#365c8d']

const ACCESSIBLE_FEATURE_COLORS: Record<PreviewFeatureKind, string> = {
  'outer-wall': '#E69F00',
  'inner-wall': '#56B4E9',
  overhang: '#D55E00',
  bridge: '#009E73',
  solid: '#CC79A7',
  sparse: '#F0E442',
  support: '#0072B2',
  iron: '#B07AA1',
  adhesion: '#76B7B2',
  travel: '#999999',
  other: '#DDDDDD',
}

const PA_COLORS = [
  '#2f6fed', '#2e9bff', '#27c6e8', '#42d6b5', '#7cde78',
  '#b8df4a', '#f0d43a', '#ffad35', '#ff7738', '#ef4444',
]

export type PreviewRange = {
  speed: [number, number]
  flow: [number, number]
  height: [number, number]
  temperature: [number, number]
  acceleration: [number, number]
  width: [number, number]
  fan: [number, number]
  pressureAdvance: [number, number]
  duration: [number, number]
}

const EMPTY_RANGE: PreviewRange = {
  speed: [0, 1],
  flow: [0, 1],
  height: [0, 1],
  temperature: [0, 1],
  acceleration: [0, 1],
  width: [0, 1],
  fan: [0, 1],
  pressureAdvance: [0, 1],
  duration: [0, 1],
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

function hexRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function mixHex(a: string, b: string, t: number): string {
  const ca = hexRgb(a)
  const cb = hexRgb(b)
  const c = ca.map((v, i) => Math.round(v + (cb[i] - v) * t))
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/** Interpoliert den gemeinsamen Farbverlauf an Position 0–1. */
export function gradientHex(t: number, palette: PreviewPalette = 'standard'): string {
  const colors = palette === 'accessible' ? PREVIEW_GRADIENT_ACCESSIBLE : PREVIEW_GRADIENT
  const p = clamp01(t) * (colors.length - 1)
  const i = Math.min(colors.length - 2, Math.floor(p))
  return mixHex(colors[i], colors[i + 1], p - i)
}

/** Tatsächliche Schichthöhe einer Vorschau-Schicht. */
export function previewLayerHeight(layers: PreviewLayer[], index: number): number {
  const current = layers[index]
  if (!current) return 0
  const previous = layers[index - 1]
  const next = layers[index + 1]
  const height = previous
    ? current.z - previous.z
    : next
      ? next.z - current.z
      : 0
  return Number.isFinite(height) && height > 0 ? height : 0
}

/** Reine Bahnzeit einer Schicht aus den Vorschau-Segmenten (ohne Beschleunigungsprofil). */
export function previewLayerSeconds(layer: PreviewLayer): number {
  let seconds = 0
  for (let k = 0; k + PREVIEW_STRIDE - 1 < layer.data.length; k += PREVIEW_STRIDE) {
    const speed = layer.data[k + 5]
    if (!Number.isFinite(speed) || speed <= 0) continue
    const distance = Math.hypot(layer.data[k + 3] - layer.data[k + 1], layer.data[k + 4] - layer.data[k + 2])
    seconds += distance / speed
  }
  return seconds
}

function updateRange(range: { min: number; max: number }, value: number, allowZero = false) {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value <= 0)) return
  range.min = Math.min(range.min, value)
  range.max = Math.max(range.max, value)
}

function finalRange(min: number, max: number): [number, number] {
  return Number.isFinite(min) && Number.isFinite(max) ? [min, max] : [0, 1]
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0
  const position = (sorted.length - 1) * q
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)
}

function sampledRange(
  values: number[],
  min: number,
  max: number,
  allowZero: boolean,
  robust: boolean,
): [number, number] {
  if (!robust || values.length < 20) return finalRange(min, max)
  const sorted = values
    .filter((value) => Number.isFinite(value) && value >= 0 && (allowZero || value > 0))
    .sort((a, b) => a - b)
  if (sorted.length < 20) return finalRange(min, max)
  // 2–98 % halten einzelne Rekordwerte aus der Farbskala heraus. Die
  // Messwerte selbst bleiben unverändert; nur der Farbbereich wird gestaucht.
  return [quantile(sorted, 0.02), quantile(sorted, 0.98)]
}

/**
 * Alle Messwerte einmal scannen; der Scene-Cache wird nur bei neuen Layern
 * erneuert. Standardmäßig werden robuste 2–98-%-Grenzen verwendet, damit ein
 * einzelner Rekordwert nicht die ganze Farbverteilung dominiert.
 */
export function computePreviewRange(layers: PreviewLayer[], robust = true): PreviewRange {
  if (!layers.length) return EMPTY_RANGE
  const speed = { min: Infinity, max: -Infinity }
  const flow = { min: Infinity, max: -Infinity }
  const height = { min: Infinity, max: -Infinity }
  const temperature = { min: Infinity, max: -Infinity }
  const acceleration = { min: Infinity, max: -Infinity }
  const width = { min: Infinity, max: -Infinity }
  const fan = { min: Infinity, max: -Infinity }
  const pressureAdvance = { min: Infinity, max: -Infinity }
  const duration = { min: Infinity, max: -Infinity }
  const speedSamples: number[] = []
  const flowSamples: number[] = []
  const heightSamples: number[] = []
  const temperatureSamples: number[] = []
  const accelerationSamples: number[] = []
  const widthSamples: number[] = []
  const fanSamples: number[] = []
  const pressureAdvanceSamples: number[] = []
  const durationSamples: number[] = []
  const totalSegments = layers.reduce(
    (sum, layer) => sum + Math.floor(layer.data.length / PREVIEW_STRIDE),
    0,
  )
  const sampleStep = Math.max(1, Math.ceil(totalSegments / 20_000))
  let segmentIndex = 0

  for (let index = 0; index < layers.length; index++) {
    const layer = layers[index]
    const thickness = previewLayerHeight(layers, index)
    if (thickness > 0) {
      updateRange(height, thickness)
      heightSamples.push(thickness)
    }
    const layerSeconds = previewLayerSeconds(layer)
    if (layerSeconds > 0) {
      updateRange(duration, layerSeconds)
      durationSamples.push(layerSeconds)
    }

    for (let k = 0; k + PREVIEW_STRIDE - 1 < layer.data.length; k += PREVIEW_STRIDE) {
      // Reisen sind keine Extrusion und würden die Messbereiche verfälschen.
      if (layer.data[k] === PREVIEW_KIND_CODE.travel) continue
      const sample = segmentIndex++ % sampleStep === 0
      updateRange(speed, layer.data[k + 5], true)
      updateRange(flow, layer.data[k + 6], true)
      updateRange(temperature, layer.data[k + 7])
      updateRange(acceleration, layer.data[k + 8])
      updateRange(width, layer.data[k + 9])
      updateRange(fan, layer.data[k + 10], true)
      updateRange(pressureAdvance, layer.data[k + 11], true)
      if (sample) {
        speedSamples.push(layer.data[k + 5])
        flowSamples.push(layer.data[k + 6])
        temperatureSamples.push(layer.data[k + 7])
        accelerationSamples.push(layer.data[k + 8])
        widthSamples.push(layer.data[k + 9])
        fanSamples.push(layer.data[k + 10])
        pressureAdvanceSamples.push(layer.data[k + 11])
      }
    }
  }

  return {
    speed: sampledRange(speedSamples, speed.min, speed.max, true, robust),
    flow: sampledRange(flowSamples, flow.min, flow.max, true, robust),
    height: sampledRange(heightSamples, height.min, height.max, false, robust),
    temperature: sampledRange(temperatureSamples, temperature.min, temperature.max, false, robust),
    acceleration: sampledRange(accelerationSamples, acceleration.min, acceleration.max, false, robust),
    width: sampledRange(widthSamples, width.min, width.max, false, robust),
    fan: sampledRange(fanSamples, fan.min, fan.max, true, robust),
    pressureAdvance: sampledRange(pressureAdvanceSamples, pressureAdvance.min, pressureAdvance.max, true, robust),
    duration: sampledRange(durationSamples, duration.min, duration.max, false, robust),
  }
}

export function previewFeatureMeta(kind: number) {
  const key = PREVIEW_CODE_KIND.get(kind)
  return key ? PREVIEW_FEATURE_META.get(key) : undefined
}

export function previewFeatureColor(kind: number, palette: PreviewPalette = 'standard'): string {
  if (kind >= 20) return PA_COLORS[Math.min(9, kind - 20)] ?? '#ffffff'
  const feature = previewFeatureMeta(kind)
  if (!feature) return '#ffffff'
  return palette === 'accessible' ? ACCESSIBLE_FEATURE_COLORS[feature.kind] : feature.color
}

function gradientFor(value: number, [min, max]: [number, number], palette: PreviewPalette): string {
  if (!Number.isFinite(value)) return '#64748b'
  if (max === min) return gradientHex(0.5, palette)
  return gradientHex((value - min) / (max - min), palette)
}

export function reserveHex(ratio: number, palette: PreviewPalette = 'standard'): string {
  const colors = palette === 'accessible' ? RESERVE_GRADIENT_ACCESSIBLE : RESERVE_GRADIENT
  const p = clamp01(Number.isFinite(ratio) ? ratio : 1) * (colors.length - 1)
  const i = Math.min(colors.length - 2, Math.floor(p))
  return mixHex(colors[i], colors[i + 1], p - i)
}

function gradientForLog(value: number, [min, max]: [number, number], palette: PreviewPalette): string {
  if (!Number.isFinite(value) || value < 0) return '#64748b'
  const lower = Math.log1p(Math.max(0, min))
  const upper = Math.log1p(Math.max(0, max))
  if (upper === lower) return gradientHex(0.5, palette)
  return gradientHex((Math.log1p(value) - lower) / (upper - lower), palette)
}

/** Liefert die Farbe eines Vorschausesegments für den aktiven Farbmodus. */
export function colorForSegment(
  kind: number,
  speed: number,
  flow: number,
  temperature: number,
  layerHeight: number,
  layerSeconds: number,
  acceleration: number,
  width: number,
  fan: number,
  pressureAdvance: number,
  mode: PreviewColorMode,
  range: PreviewRange,
  flowLimit = 0,
  palette: PreviewPalette = 'standard',
): string {
  if (kind === PREVIEW_KIND_CODE.travel) return previewFeatureColor(kind, palette)
  if (mode === 'kind') return previewFeatureColor(kind, palette)
  if (mode === 'flow-margin') return reserveHex(flowLimit > 0 ? flow / flowLimit : 0, palette)
  if (mode === 'speed') return gradientFor(speed, range.speed, palette)
  if (mode === 'flow') return gradientFor(flow, range.flow, palette)
  if (mode === 'temperature') return gradientFor(temperature, range.temperature, palette)
  if (mode === 'height') return gradientFor(layerHeight, range.height, palette)
  if (mode === 'acceleration') return gradientFor(acceleration, range.acceleration, palette)
  if (mode === 'width') return width <= 0 ? '#64748b' : gradientFor(width, range.width, palette)
  if (mode === 'fan') return gradientFor(fan, range.fan, palette)
  if (mode === 'pressure-advance') return gradientFor(pressureAdvance, range.pressureAdvance, palette)
  if (mode === 'duration-log') return gradientForLog(layerSeconds, range.duration, palette)
  return gradientFor(layerSeconds, range.duration, palette)
}

export function formatFeatureValue(value: number, digits = 1): string {
  return value.toFixed(digits).replace('.', ',')
}
