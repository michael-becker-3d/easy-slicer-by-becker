import { useEffect, useMemo, useRef, useState } from 'react'
import {
  PREVIEW_STRIDE,
  formatDuration,
  type PreviewFeatureKind,
  type PreviewLayer,
  type PrintSettings,
  type SliceFeatureStats,
  type SliceStats,
} from '../../shared/types.ts'
import { PREVIEW_CODE_KIND, PREVIEW_FEATURES, PREVIEW_FEATURE_META, PREVIEW_KIND_CODE } from '../../shared/preview.ts'
import {
  PREVIEW_GRADIENT,
  PREVIEW_GRADIENT_ACCESSIBLE,
  RESERVE_GRADIENT,
  RESERVE_GRADIENT_ACCESSIBLE,
  computePreviewRange,
  effectivePreviewFlowLimit,
  previewFlowLimitInfo,
  formatFeatureValue,
  previewFeatureColor,
  previewLayerHeight,
  previewLayerSeconds,
  type PreviewColorMode,
  type PreviewPalette,
} from '../viewer/previewColors.ts'
import { FloatingPanelHandle } from './FloatingPanel.tsx'

type LegendResult = {
  layers: PreviewLayer[]
  stats: SliceStats
  features: SliceFeatureStats[]
}

type Range = { min: number; max: number }

type LayerFeature = {
  kind: PreviewFeatureKind
  label: string
  color: string
  segments: number
  seconds: number
  speed: Range
  flow: Range
  temperature: Range
  acceleration: Range
  width: Range
  fan: Range
  pressureAdvance: Range
}

type LayerInfo = {
  height: number
  seconds: number
  speed: Range
  flow: Range
  temperature: Range
  acceleration: Range
  width: Range
  fan: Range
  pressureAdvance: Range
  features: LayerFeature[]
}

type FeatureAggregate = {
  meta: (typeof PREVIEW_FEATURES)[number]
  stat: SliceFeatureStats
  speed: Range
  flow: Range
  temperature: Range
  acceleration: Range
  width: Range
  fan: Range
  pressureAdvance: Range
  height: Range
  duration: Range
}

type LegendMode =
  | 'summary'
  | 'kind'
  | 'filament'
  | 'speed'
  | 'current-speed'
  | 'acceleration'
  | 'retraction'
  | 'layer-height'
  | 'line-width'
  | 'flow'
  | 'flow-margin'
  | 'current-flow'
  | 'layer-duration'
  | 'layer-time-log'
  | 'fan'
  | 'temperature'
  | 'pressure-advance'

const LEGEND_MODES: { id: LegendMode; label: string }[] = [
  { id: 'summary', label: 'Zusammenfassung' },
  { id: 'kind', label: 'Linientyp' },
  { id: 'filament', label: 'Filament' },
  { id: 'speed', label: 'Geschwindigkeit' },
  { id: 'current-speed', label: 'Aktuelle Geschwindigkeit' },
  { id: 'acceleration', label: 'Beschleunigung' },
  { id: 'retraction', label: 'Rückzug' },
  { id: 'layer-height', label: 'Schichthöhe' },
  { id: 'line-width', label: 'Linienbreite' },
  { id: 'flow', label: 'Fluss' },
  { id: 'flow-margin', label: 'Durchfluss-Reserve' },
  { id: 'current-flow', label: 'Aktueller Fluss' },
  { id: 'layer-duration', label: 'Schichtdauer' },
  { id: 'layer-time-log', label: 'Layerzeit (log)' },
  { id: 'fan', label: 'Lüftergeschwindigkeit' },
  { id: 'temperature', label: 'Temperatur' },
  { id: 'pressure-advance', label: 'Pressure Advance' },
]

const COLOR_FOR_MODE: Record<LegendMode, PreviewColorMode> = {
  summary: 'kind',
  kind: 'kind',
  filament: 'kind',
  speed: 'speed',
  'current-speed': 'speed',
  acceleration: 'acceleration',
  retraction: 'kind',
  'layer-height': 'height',
  'line-width': 'width',
  flow: 'flow',
  'flow-margin': 'flow-margin',
  'current-flow': 'flow',
  'layer-duration': 'duration',
  'layer-time-log': 'duration-log',
  fan: 'fan',
  temperature: 'temperature',
  'pressure-advance': 'pressure-advance',
}

const METRIC_META: Partial<
  Record<LegendMode, { label: string; unit: string; digits: number }>
> = {
  speed: { label: 'Geschwindigkeit', unit: 'mm/s', digits: 0 },
  'current-speed': { label: 'Aktuelle Geschwindigkeit', unit: 'mm/s', digits: 0 },
  acceleration: { label: 'Beschleunigung', unit: 'mm/s²', digits: 0 },
  'layer-height': { label: 'Schichthöhe', unit: 'mm', digits: 2 },
  'line-width': { label: 'Linienbreite', unit: 'mm', digits: 2 },
  flow: { label: 'Fluss', unit: 'mm³/s', digits: 1 },
  'flow-margin': { label: 'Durchfluss-Reserve', unit: '%', digits: 0 },
  'current-flow': { label: 'Aktueller Fluss', unit: 'mm³/s', digits: 1 },
  'layer-duration': { label: 'Schichtdauer', unit: 's', digits: 1 },
  'layer-time-log': { label: 'Layerzeit (log)', unit: 's', digits: 1 },
  fan: { label: 'Lüfter', unit: '%', digits: 0 },
  temperature: { label: 'Temperatur', unit: '°C', digits: 0 },
  'pressure-advance': { label: 'Pressure Advance', unit: '', digits: 3 },
}

function timeText(seconds: number): string {
  if (seconds <= 0) return '<1s'
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`
  return formatDuration(seconds)
}

function gramText(grams: number): string {
  return grams < 0.005 ? '0,00 g' : `${formatFeatureValue(grams, 2)} g`
}

function lengthText(mm: number): string {
  if (!Number.isFinite(mm) || mm <= 0) return '0,00 m'
  return `${formatFeatureValue(mm / 1000, 2)} m`
}

function emptyRange(): Range {
  return { min: Infinity, max: -Infinity }
}

function addValue(range: Range, value: number, allowZero = false) {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value <= 0)) return
  range.min = Math.min(range.min, value)
  range.max = Math.max(range.max, value)
}

function rangeText(range: Range, digits: number, unit: string): string {
  if (!Number.isFinite(range.min) || !Number.isFinite(range.max)) return '—'
  const suffix = unit ? ` ${unit}` : ''
  if (Math.abs(range.max - range.min) < 1e-9) {
    return `${formatFeatureValue(range.min, digits)}${suffix}`
  }
  return `${formatFeatureValue(range.min, digits)}–${formatFeatureValue(range.max, digits)}${suffix}`
}

function tempText(range: Range): string {
  return rangeText(range, 0, '°C')
}

function buildLayerInfo(layers: PreviewLayer[], layerIndex: number): LayerInfo {
  const current = layers[layerIndex]
  const height = previewLayerHeight(layers, layerIndex)
  const byKind = new Map<PreviewFeatureKind, LayerFeature>()
  const layer: LayerInfo = {
    height,
    seconds: 0,
    speed: emptyRange(),
    flow: emptyRange(),
    temperature: emptyRange(),
    acceleration: emptyRange(),
    width: emptyRange(),
    fan: emptyRange(),
    pressureAdvance: emptyRange(),
    features: [],
  }
  if (!current) return layer

  for (let k = 0; k + PREVIEW_STRIDE - 1 < current.data.length; k += PREVIEW_STRIDE) {
    const kind = PREVIEW_CODE_KIND.get(current.data[k])
    if (!kind) continue
    const meta = PREVIEW_FEATURE_META.get(kind)
    if (!meta) continue
    const speed = current.data[k + 5]
    const flow = current.data[k + 6]
    const temperature = current.data[k + 7]
    const acceleration = current.data[k + 8]
    const width = current.data[k + 9]
    const fan = current.data[k + 10]
    const pressureAdvance = current.data[k + 11]
    const distance = Math.hypot(
      current.data[k + 3] - current.data[k + 1],
      current.data[k + 4] - current.data[k + 2],
    )
    const seconds = speed > 0 ? distance / speed : 0
    let feature = byKind.get(kind)
    if (!feature) {
      feature = {
        kind,
        label: meta.label,
        color: meta.color,
        segments: 0,
        seconds: 0,
        speed: emptyRange(),
        flow: emptyRange(),
        temperature: emptyRange(),
        acceleration: emptyRange(),
        width: emptyRange(),
        fan: emptyRange(),
        pressureAdvance: emptyRange(),
      }
      byKind.set(kind, feature)
    }
    feature.segments += 1
    feature.seconds += seconds
    layer.seconds += seconds
    if (kind === 'travel') continue
    addValue(layer.speed, speed)
    addValue(layer.flow, flow)
    addValue(layer.temperature, temperature)
    addValue(layer.acceleration, acceleration)
    addValue(layer.width, width)
    addValue(layer.fan, fan, true)
    addValue(layer.pressureAdvance, pressureAdvance, true)
    addValue(feature.speed, speed)
    addValue(feature.flow, flow)
    addValue(feature.temperature, temperature)
    addValue(feature.acceleration, acceleration)
    addValue(feature.width, width)
    addValue(feature.fan, fan, true)
    addValue(feature.pressureAdvance, pressureAdvance, true)
  }

  const order = new Map(PREVIEW_FEATURES.map((feature, index) => [feature.kind, index]))
  layer.features = [...byKind.values()]
    .filter((feature) => feature.segments > 0)
    .sort((a, b) => (order.get(a.kind) ?? 99) - (order.get(b.kind) ?? 99))
  return layer
}

function buildFeatureAggregates(layers: PreviewLayer[], stats: SliceFeatureStats[]): FeatureAggregate[] {
  const byKind = new Map<PreviewFeatureKind, FeatureAggregate>()
  for (const stat of stats) {
    const meta = PREVIEW_FEATURE_META.get(stat.kind)
    if (!meta) continue
    byKind.set(stat.kind, {
      meta,
      stat,
      speed: emptyRange(),
      flow: emptyRange(),
      temperature: emptyRange(),
      acceleration: emptyRange(),
      width: emptyRange(),
      fan: emptyRange(),
      pressureAdvance: emptyRange(),
      height: emptyRange(),
      duration: emptyRange(),
    })
  }

  for (let index = 0; index < layers.length; index++) {
    const layer = layers[index]
    const height = previewLayerHeight(layers, index)
    const duration = previewLayerSeconds(layer)
    for (let k = 0; k + PREVIEW_STRIDE - 1 < layer.data.length; k += PREVIEW_STRIDE) {
      const kind = PREVIEW_CODE_KIND.get(layer.data[k])
      if (!kind || kind === 'travel') continue
      const entry = byKind.get(kind)
      if (!entry) continue
      addValue(entry.speed, layer.data[k + 5])
      addValue(entry.flow, layer.data[k + 6])
      addValue(entry.temperature, layer.data[k + 7])
      addValue(entry.acceleration, layer.data[k + 8])
      addValue(entry.width, layer.data[k + 9])
      addValue(entry.fan, layer.data[k + 10], true)
      addValue(entry.pressureAdvance, layer.data[k + 11], true)
      addValue(entry.height, height)
      addValue(entry.duration, duration)
    }
  }

  const order = new Map(PREVIEW_FEATURES.map((feature, index) => [feature.kind, index]))
  return [...byKind.values()].sort((a, b) => (order.get(a.meta.kind) ?? 99) - (order.get(b.meta.kind) ?? 99))
}

function usageText(agg: FeatureAggregate, result: LegendResult): string {
  if (agg.meta.kind === 'travel') return '—'
  const length =
    result.stats.filamentGrams > 0
      ? (agg.stat.grams / result.stats.filamentGrams) * result.stats.filamentMm
      : 0
  return `${lengthText(length)} · ${gramText(agg.stat.grams)}`
}

function metricText(agg: FeatureAggregate, mode: LegendMode): string {
  switch (mode) {
    case 'speed':
    case 'current-speed':
      return rangeText(agg.speed, 0, 'mm/s')
    case 'flow':
    case 'flow-margin':
    case 'current-flow':
      return rangeText(agg.flow, 1, 'mm³/s')
    case 'acceleration':
      return rangeText(agg.acceleration, 0, 'mm/s²')
    case 'layer-height':
      return rangeText(agg.height, 2, 'mm')
    case 'line-width':
      return rangeText(agg.width, 2, 'mm')
    case 'fan':
      return rangeText(agg.fan, 0, '%')
    case 'temperature':
      return tempText(agg.temperature)
    case 'pressure-advance':
      return rangeText(agg.pressureAdvance, 3, '')
    case 'layer-duration':
    case 'layer-time-log':
      return rangeText(agg.duration, 1, 's')
    case 'retraction':
      return '—'
    default:
      return ''
  }
}

function layerMetricText(agg: FeatureAggregate, mode: LegendMode, layer: LayerInfo): string {
  const feature = layer.features.find((entry) => entry.kind === agg.meta.kind)
  if (!feature) return '—'
  if (mode === 'current-speed') return rangeText(feature.speed, 0, 'mm/s')
  return rangeText(feature.flow, 1, 'mm³/s')
}

function tableValue(
  agg: FeatureAggregate,
  mode: LegendMode,
  result: LegendResult,
  layer: LayerInfo,
  settings?: PrintSettings,
): string {
  if (mode === 'kind' || mode === 'filament' || mode === 'retraction') return usageText(agg, result)
  // „Aktuelle …“ zeigt den Wert dieser Schicht je Linientyp. Der Farbbereich
  // und die Modellfärbung bleiben weiterhin auf den gesamten Druck bezogen.
  if (mode === 'current-speed' || mode === 'current-flow') return layerMetricText(agg, mode, layer)
  if (mode === 'flow-margin') {
    const limit = effectivePreviewFlowLimit(settings?.maxVolumetricFlow, result.stats.maxFlowMm3s)
    if (limit > 0 && Number.isFinite(agg.flow.max))
      return `${Math.max(0, Math.round((1 - agg.flow.max / limit) * 100))} %`
    return '—'
  }
  return metricText(agg, mode)
}

function currentValue(
  mode: LegendMode,
  layer: LayerInfo,
  settings?: PrintSettings,
  result?: LegendResult,
): string {
  switch (mode) {
    case 'speed':
    case 'current-speed':
      return rangeText(layer.speed, 0, 'mm/s')
    case 'flow':
    case 'current-flow':
      return rangeText(layer.flow, 1, 'mm³/s')
    case 'flow-margin': {
      const limit = effectivePreviewFlowLimit(settings?.maxVolumetricFlow, result?.stats.maxFlowMm3s ?? 0)
      return limit > 0 && Number.isFinite(layer.flow.max)
        ? `${Math.max(0, Math.round((1 - layer.flow.max / limit) * 100))} % Reserve`
        : '—'
    }
    case 'acceleration':
      return rangeText(layer.acceleration, 0, 'mm/s²')
    case 'layer-height':
      return layer.height > 0 ? `${formatFeatureValue(layer.height, 2)} mm` : '—'
    case 'line-width':
      return rangeText(layer.width, 2, 'mm')
    case 'fan':
      return rangeText(layer.fan, 0, '%')
    case 'temperature':
      return tempText(layer.temperature)
    case 'pressure-advance':
      return rangeText(layer.pressureAdvance, 3, '')
    case 'layer-duration':
    case 'layer-time-log':
      return timeText(layer.seconds)
    case 'filament':
      return '—'
    case 'retraction':
      return settings
        ? `${formatFeatureValue(settings.retraction.distance, 2)} mm · ${formatFeatureValue(settings.retraction.speed, 0)} mm/s`
        : '—'
    default:
      return '—'
  }
}

function modalForMode(mode: LegendMode, range: ReturnType<typeof computePreviewRange>): [number, number] | null {
  switch (mode) {
    case 'speed':
    case 'current-speed':
      return range.speed
    case 'flow':
    case 'current-flow':
      return range.flow
    case 'flow-margin':
      return [0, 100]
    case 'acceleration':
      return range.acceleration
    case 'layer-height':
      return range.height
    case 'line-width':
      return range.width
    case 'fan':
      return range.fan
    case 'temperature':
      return range.temperature
    case 'pressure-advance':
      return range.pressureAdvance
    case 'layer-duration':
    case 'layer-time-log':
      return range.duration
    default:
      return null
  }
}

function EyeIcon({ off = false }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5">
      <path
        d="M2.2 10s2.8-4.7 7.8-4.7 7.8 4.7 7.8 4.7-2.8 4.7-7.8 4.7S2.2 10 2.2 10Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="10" cy="10" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.4" />
      {off && (
        <path
          d="M3.2 3.4 16.8 17"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      )}
    </svg>
  )
}

function modeDetailRows(
  mode: LegendMode,
  settings: PrintSettings | undefined,
  layer: LayerInfo,
  result: LegendResult,
): [string, string][] {
  if (!settings) return []
  if (mode === 'retraction') {
    return [
      ['Abstand', `${formatFeatureValue(settings.retraction.distance, 2)} mm`],
      ['Geschwindigkeit', `${formatFeatureValue(settings.retraction.speed, 0)} mm/s`],
      ['Min. Weg', `${formatFeatureValue(settings.retraction.minTravel, 1)} mm`],
      ['Z-Hop', `${formatFeatureValue(settings.zHop, 2)} mm`],
    ]
  }
  if (mode === 'fan') {
    return [
      ['Sollwert', `${formatFeatureValue(settings.fanSpeed, 0)} %`],
      ['Ab Schicht', `${settings.cooling.fanOffLayers + 1}`],
      ['Im Layer', rangeText(layer.fan, 0, '%')],
    ]
  }
  if (mode === 'line-width') {
    return [
      ['Allgemein', `${formatFeatureValue(settings.lineWidth, 2)} mm`],
      ['Außenwand', `${formatFeatureValue(settings.outerWallLineWidth, 2)} mm`],
      ['Innenwand', `${formatFeatureValue(settings.innerWallLineWidth, 2)} mm`],
      ['Deckschicht', `${formatFeatureValue(settings.topSurfaceLineWidth, 2)} mm`],
      ['Erste Schicht', `${formatFeatureValue(settings.firstLayerLineWidth, 2)} mm`],
    ]
  }
  if (mode === 'acceleration') {
    return [
      ['Druck', `${formatFeatureValue(settings.accelerations.print, 0)} mm/s²`],
      ['Außenwand', `${formatFeatureValue(settings.accelerations.outerWall, 0)} mm/s²`],
      ['Innenwand', `${formatFeatureValue(settings.accelerations.innerWall, 0)} mm/s²`],
      ['Füllung', `${formatFeatureValue(settings.accelerations.infill, 0)} mm/s²`],
      ['Deckschicht', `${formatFeatureValue(settings.accelerations.topSurface, 0)} mm/s²`],
      ['Reisen', `${formatFeatureValue(settings.accelerations.travel, 0)} mm/s²`],
    ]
  }
  if (mode === 'pressure-advance') {
    return [
      ['Status', settings.pressureAdvance.enabled ? 'an' : 'aus'],
      ['Wert', formatFeatureValue(settings.pressureAdvance.value, 4)],
      [
        'Rampe',
        settings.pressureAdvanceRamp.enabled
          ? `${formatFeatureValue(settings.pressureAdvanceRamp.from, 3)} → ${formatFeatureValue(settings.pressureAdvanceRamp.to, 3)}`
          : 'aus',
      ],
    ]
  }
  if (mode === 'filament') {
    return [
      ['Gesamt', `${lengthText(result.stats.filamentMm)} · ${formatFeatureValue(result.stats.filamentGrams, 2)} g`],
      ['Schichten', `${result.stats.layerCount}`],
    ]
  }
  return []
}

export function PreviewLegend({
  result,
  layer,
  colorMode,
  onColorMode,
  settings,
  filamentName,
  filamentPricePerKg,
  plateName,
  hiddenFeatures = [],
  onToggleFeature,
  onShowAllFeatures,
  palette = 'standard',
  onPalette,
}: {
  result: LegendResult
  layer: number
  colorMode: PreviewColorMode
  onColorMode: (mode: PreviewColorMode) => void
  settings?: PrintSettings
  filamentName?: string
  filamentPricePerKg?: number
  plateName?: string
  hiddenFeatures?: PreviewFeatureKind[]
  onToggleFeature?: (kind: PreviewFeatureKind) => void
  onShowAllFeatures?: () => void
  /** Standard- oder farbenblindtaugliche Darstellung */
  palette?: PreviewPalette
  onPalette?: (palette: PreviewPalette) => void
}) {
  // Bei geteilter Vorschau bleiben neben der Werkstatt sonst nur wenige
  // Zentimeter Modellfläche. Auf typischen 1440er-Desktops startet die
  // Legende deshalb eingeklappt und lässt sich über den Linientyp-Knopf öffnen.
  const [open, setOpen] = useState(() => window.innerWidth >= 1600)
  const [menuOpen, setMenuOpen] = useState(false)
  const modeMenuRef = useRef<HTMLDivElement>(null)
  const [summaryOpen, setSummaryOpen] = useState(true)
  const [layerOpen, setLayerOpen] = useState(true)
  const [mode, setMode] = useState<LegendMode>(() => {
    if (colorMode === 'speed') return 'speed'
    if (colorMode === 'flow') return 'flow'
    if (colorMode === 'flow-margin') return 'flow-margin'
    if (colorMode === 'height') return 'layer-height'
    if (colorMode === 'temperature') return 'temperature'
    if (colorMode === 'acceleration') return 'acceleration'
    if (colorMode === 'width') return 'line-width'
    if (colorMode === 'fan') return 'fan'
    if (colorMode === 'pressure-advance') return 'pressure-advance'
    if (colorMode === 'duration') return 'layer-duration'
    if (colorMode === 'duration-log') return 'layer-time-log'
    return 'kind'
  })

  useEffect(() => {
    if (!menuOpen) return
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return
      if (event instanceof PointerEvent && modeMenuRef.current?.contains(event.target as Node)) return
      setMenuOpen(false)
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
    }
  }, [menuOpen])

  const range = useMemo(() => computePreviewRange(result.layers), [result.layers])
  const hidden = useMemo(() => new Set(hiddenFeatures), [hiddenFeatures])
  const aggregates = useMemo(
    () => buildFeatureAggregates(result.layers, result.features),
    [result.layers, result.features],
  )
  const clampedLayer = Math.max(0, Math.min(result.layers.length - 1, layer))
  const z = result.layers[clampedLayer]?.z ?? 0
  const layerInfo = useMemo(
    () => buildLayerInfo(result.layers, clampedLayer),
    [result.layers, clampedLayer],
  )
  const flowLimit = previewFlowLimitInfo(settings?.maxVolumetricFlow, result.stats.maxFlowMm3s)
  const layerHeightLabel = settings?.adaptiveLayerHeight?.enabled
    ? `${formatFeatureValue(settings.adaptiveLayerHeight.minHeight, 2)}–${formatFeatureValue(settings.adaptiveLayerHeight.maxHeight, 2)} mm (adaptiv)`
    : settings
      ? `${formatFeatureValue(settings.layerHeight, 2)} mm`
      : '—'
  const flowSettingLabel =
    flowLimit.source === 'profile'
      ? 'Fluss / max. Volumen'
      : flowLimit.source === 'measured'
        ? 'Fluss / Referenz (gemessen)'
        : 'Fluss / max. Volumen'

  const summaryRows: [string, string][] = [
    ['Druckzeit', formatDuration(result.stats.estimatedSeconds)],
    ['Filament gesamt', `${lengthText(result.stats.filamentMm)} · ${formatFeatureValue(result.stats.filamentGrams, 2)} g`],
              ['Schichten', `${result.stats.layerCount}`],
          ['Max. Volumenstrom', `${formatFeatureValue(result.stats.maxFlowMm3s, 1)} mm³/s`],
          ...(filamentPricePerKg && filamentPricePerKg > 0
            ? ([
                ['Kosten', `${formatFeatureValue((result.stats.filamentGrams / 1000) * filamentPricePerKg, 2)} €`],
              ] as [string, string][])
            : []),
    ...(settings
      ? ([
          ['Düse (Soll)', `${formatFeatureValue(settings.temps.nozzle, 0)} °C`],
          ['Bett (Soll)', `${formatFeatureValue(settings.temps.bed, 0)} °C`],
          ['Schichthöhe', layerHeightLabel],
          ['Wände / Deck / Boden', `${settings.walls} / ${settings.topLayers} / ${settings.bottomLayers}`],
          ['Füllung', `${formatFeatureValue(settings.infillDensity, 0)} % · ${settings.infillPattern}`],
          ['Tempo / Außenwand', `${formatFeatureValue(settings.speeds.print, 0)} / ${formatFeatureValue(settings.speeds.outerWall, 0)} mm/s`],
          [flowSettingLabel, `${formatFeatureValue(settings.flow, 3)} / ${flowLimit.limit > 0 ? formatFeatureValue(flowLimit.limit, 1) : '—'} mm³/s`],
          ['Retract', `${formatFeatureValue(settings.retraction.distance, 2)} mm · ${formatFeatureValue(settings.retraction.speed, 0)} mm/s`],
          ['Pressure Advance', settings.pressureAdvance.enabled ? formatFeatureValue(settings.pressureAdvance.value, 3) : 'aus'],
          ['Input Shaper', settings.inputShaper.enabled ? `${formatFeatureValue(settings.inputShaper.freqX, 0)} / ${formatFeatureValue(settings.inputShaper.freqY, 0)} Hz` : 'aus'],
        ] as [string, string][])
      : []),
    ...(filamentName ? ([['Filament', filamentName]] as [string, string][]) : []),
    ...(plateName ? ([['Platte', plateName]] as [string, string][]) : []),
  ]

  const chooseMode = (next: LegendMode) => {
    setMode(next)
    setMenuOpen(false)
    onColorMode(COLOR_FOR_MODE[next])
  }

  const modeLabel = LEGEND_MODES.find((entry) => entry.id === mode)?.label ?? 'Linientyp'

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pointer-events-auto ml-auto flex items-center gap-1.5 rounded-lg border border-line/60 bg-ink-950/80 px-2.5 py-1.5 text-[10px] text-white/65 shadow-lg backdrop-blur-md transition hover:border-amber/40 hover:text-white"
      >
        <span className="flex gap-0.5">
          {PREVIEW_FEATURES.slice(0, 4).map((f) => (
            <span key={f.kind} className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: previewFeatureColor(f.code, palette) }} />
          ))}
        </span>
        {modeLabel}
      </button>
    )
  }

  const metric = METRIC_META[mode]
  const gradientRange = modalForMode(mode, range)
  const detailRows = modeDetailRows(mode, settings, layerInfo, result)
  const showTable = mode !== 'summary'
  const usageColumn = mode === 'kind' || mode === 'filament' || mode === 'retraction'
  const currentMetric = currentValue(mode, layerInfo, settings, result)

  return (
    <div className="pointer-events-auto w-full overflow-hidden rounded-xl border border-line/70 bg-ink-950/95 text-white shadow-2xl backdrop-blur-md">
      <div className="flex items-center gap-1.5 border-b border-line/60 px-2.5 py-1.5">
        <FloatingPanelHandle label="Vorschau-Legende" />
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-mint shadow-[0_0_7px_rgba(111,227,176,0.8)]" />
        <div ref={modeMenuRef} className="relative min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            className="flex w-full min-w-0 items-center gap-1.5 rounded-md border border-line/80 bg-ink-900 px-1.5 py-1 text-[11px] text-white/85 outline-none transition hover:border-mint/50"
            aria-haspopup="listbox"
            aria-expanded={menuOpen}
            aria-label="Kennzahl der Vorschau wählen"
          >
            <span className="text-[10px] text-white/35">&lt;/&gt;</span>
            <span className="truncate">{modeLabel}</span>
            <span className="ml-auto text-[9px] text-white/40">{menuOpen ? '▴' : '▾'}</span>
          </button>
          {menuOpen && (
            <div
              className="absolute left-0 right-0 top-[calc(100%+2px)] z-30 max-h-[260px] overflow-y-auto rounded-md border border-line bg-ink-900/98 py-1 shadow-2xl"
              role="listbox"
              aria-label="Kennzahl der Vorschau"
            >
              {LEGEND_MODES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => chooseMode(entry.id)}
                  role="option"
                  aria-selected={entry.id === mode}
                  className={`flex w-full items-center px-2 py-[5px] text-left text-[10px] transition hover:bg-white/10 ${
                    entry.id === mode ? 'bg-mint/15 text-mint' : 'text-white/70'
                  }`}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {onPalette && (
          <button
            type="button"
            onClick={() => onPalette(palette === 'accessible' ? 'standard' : 'accessible')}
            title={palette === 'accessible' ? 'Zu den Standardfarben wechseln' : 'Farbenblindtaugliche Palette einschalten'}
            className={`rounded border px-1 py-1 text-[8px] transition ${
              palette === 'accessible'
                ? 'border-sky/50 bg-sky/15 text-sky'
                : 'border-line/70 text-white/40 hover:border-sky/40 hover:text-white/75'
            }`}
            aria-label="Farbpalette der Vorschau umschalten"
          >
            ◐
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="grid h-5 w-5 shrink-0 place-items-center rounded text-[13px] leading-none text-white/40 transition hover:bg-white/10 hover:text-white"
          aria-label="Vorschau-Legende schließen"
        >
          ×
        </button>
      </div>

      {gradientRange && (
        <div className="border-b border-line/40 px-2.5 py-2">
          <div className="mb-1 flex items-center justify-between text-[9px]">
            <span className="font-medium text-white/70">{metric?.label ?? modeLabel}</span>
            <span className="flex items-center gap-1 text-white/35">
              {metric?.unit}
              <span className="rounded border border-line/60 px-1 text-[7px] text-white/25" title="Farbgrenzen werden robust aus dem 2.–98. Perzentil gebildet.">
                robust
              </span>
            </span>
          </div>
          <div
            className="h-3 w-full rounded-sm border border-white/10"
            style={{
              background: `linear-gradient(90deg, ${(
                mode === 'flow-margin'
                  ? palette === 'accessible'
                    ? RESERVE_GRADIENT_ACCESSIBLE
                    : RESERVE_GRADIENT
                  : palette === 'accessible'
                    ? PREVIEW_GRADIENT_ACCESSIBLE
                    : PREVIEW_GRADIENT
              ).join(', ')})`,
            }}
          />
          <div className="tabular mt-1 flex justify-between text-[9px] text-white/55">
            <span>{mode === 'flow-margin' ? '100 % Reserve' : formatFeatureValue(gradientRange[0], metric?.digits ?? 1)}</span>
            <span className="text-white/30">→</span>
            <span>{mode === 'flow-margin' ? '0 % Reserve' : formatFeatureValue(gradientRange[1], metric?.digits ?? 1)}</span>
          </div>
          {mode === 'flow-margin' && flowLimit.source !== 'profile' && (
            <div className="mt-1 text-[8px] leading-snug text-sky/65">
              {flowLimit.source === 'measured'
                ? `Kein Profil-Limit — gemessene Referenz: ${formatFeatureValue(flowLimit.limit, 1)} mm³/s (höchster gemessener Fluss).`
                : 'Kein Profil-Limit — Durchfluss-Reserve nicht verfügbar.'}
            </div>
          )}
          <div className="mt-1.5 flex items-center justify-between gap-2 rounded border border-amber/20 bg-amber/[0.06] px-1.5 py-1 text-[9px]">
            <span className="text-white/40">Aktuelle Schicht</span>
            <span className="tabular text-right text-amber/90">{currentMetric}</span>
          </div>
        </div>
      )}

      {!gradientRange && mode !== 'summary' && mode !== 'kind' && mode !== 'filament' && (
        <div className="border-b border-line/40 px-2.5 py-2">
          <div className="flex items-center justify-between gap-2 rounded border border-amber/20 bg-amber/[0.06] px-1.5 py-1 text-[9px]">
            <span className="text-white/40">Aktuelle Schicht</span>
            <span className="tabular text-right text-amber/90">{currentMetric}</span>
          </div>
        </div>
      )}

      {detailRows.length > 0 && (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-x-2 gap-y-0.5 border-b border-line/40 px-2.5 py-2 text-[9px] leading-snug">
          {detailRows.map(([label, value]) => (
            <div key={label} className="contents">
              <span className="truncate text-white/35">{label}</span>
              <span className="tabular text-right text-white/70">{value}</span>
            </div>
          ))}
        </div>
      )}

      {showTable && (
        <>
          <div className="flex items-center justify-between gap-2 border-b border-line/40 px-2.5 py-1 text-[8px] font-medium tracking-wide text-white/35 uppercase">
            <span className="flex min-w-0 items-center gap-1">
              Linientyp
              {onShowAllFeatures && hiddenFeatures.length > 0 && (
                <button
                  type="button"
                  onClick={onShowAllFeatures}
                  className="rounded border border-line/70 px-1 py-0 text-[7px] leading-3 text-mint/80 transition hover:border-mint/50"
                >
                  Alle
                </button>
              )}
            </span>
            <span className="shrink-0 text-right text-white/25">
              Zeit · % ·{' '}
              {usageColumn
                ? 'Nutzung'
                : mode === 'current-speed' || mode === 'current-flow'
                  ? 'Akt. Schicht'
                  : 'Wert'}
            </span>
          </div>
          <div className="max-h-[282px] overflow-y-auto">
            {aggregates.length ? (
              aggregates.map((agg) => {
                const isHidden = hidden.has(agg.meta.kind)
                return (
                  <div
                    key={agg.meta.kind}
                    className={`grid w-full grid-cols-[minmax(0,1fr)_18px] items-center gap-x-1.5 px-2.5 py-1 text-[9px] leading-tight odd:bg-white/[0.025] transition hover:bg-white/[0.05] ${
                      isHidden ? 'opacity-35' : ''
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        className="h-2 w-2 shrink-0 rounded-[1px]"
                        style={{
                          backgroundColor: previewFeatureColor(agg.meta.code, palette),
                          boxShadow: `0 0 5px ${previewFeatureColor(agg.meta.code, palette)}55`,
                        }}
                      />
                      <span className="min-w-0 whitespace-normal break-words text-white/80" title={agg.meta.label}>
                        {agg.meta.label}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => onToggleFeature?.(agg.meta.kind)}
                      aria-pressed={!isHidden}
                      aria-label={isHidden ? `${agg.meta.label} einblenden` : `${agg.meta.label} ausblenden`}
                      title={isHidden ? `${agg.meta.label} einblenden` : `${agg.meta.label} ausblenden`}
                      className={`row-span-2 grid self-center place-items-center rounded p-0.5 transition hover:bg-white/10 ${
                        isHidden ? 'text-white/30' : 'text-mint/80'
                      }`}
                    >
                      <EyeIcon off={isHidden} />
                    </button>
                    <span className="col-start-1 grid grid-cols-[42px_32px_minmax(0,1fr)] gap-1 tabular">
                      <span className="text-right text-white/55">{timeText(agg.stat.seconds)}</span>
                      <span className="text-right text-white/45">
                        {agg.meta.kind === 'travel' ? '—' : `${formatFeatureValue(agg.stat.percent, 1)}%`}
                      </span>
                      <span className="whitespace-nowrap text-right text-white/70">
                        {tableValue(agg, mode, result, layerInfo, settings)}
                      </span>
                    </span>
                  </div>
                )
              })
            ) : (
              <p className="px-2.5 py-2 text-[9px] text-white/35">Noch keine Bahndaten — Modell neu slicen.</p>
            )}
          </div>
          <div className="border-t border-line/60 px-2.5 py-1.5">
            <div className="flex items-center justify-between text-[9px]">
              <span className="font-medium text-white/55">Gesamt</span>
              <span className="tabular text-white/85">{formatDuration(result.stats.estimatedSeconds)}</span>
            </div>
            <div className="mt-0.5 flex items-center justify-between text-[8px] text-white/35">
              <span>Filament</span>
              <span className="tabular text-white/60">
                {lengthText(result.stats.filamentMm)} · {formatFeatureValue(result.stats.filamentGrams, 1)} g
              </span>
            </div>
          </div>
        </>
      )}

      {mode === 'summary' && (
        <div className="border-b border-line/40">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-x-2 gap-y-0.5 px-2.5 py-2 text-[9px] leading-snug">
            {summaryRows.map(([label, value]) => (
              <div key={label} className="contents">
                <span className="truncate text-white/35">{label}</span>
                <span className="tabular text-right text-white/70">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {mode !== 'summary' && (
        <div className="border-t border-line/50">
          <button
            type="button"
            onClick={() => setLayerOpen((value) => !value)}
            className="flex w-full items-center justify-between px-2.5 py-1 text-[8px] font-semibold tracking-wide text-white/40 uppercase transition hover:text-white/70"
            aria-expanded={layerOpen}
          >
            <span>
              Aktuelle Schicht <span className="text-amber/90">{clampedLayer + 1}</span>
            </span>
            <span className="text-[10px] leading-none">{layerOpen ? '−' : '+'}</span>
          </button>
          {layerOpen && (
            <div className="px-2.5 pb-2">
              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[9px] leading-snug">
                <span className="text-white/35">Düse</span>
                <span className="tabular text-right text-white/75">{tempText(layerInfo.temperature)}</span>
                <span className="text-white/35">Tempo</span>
                <span className="tabular text-right text-white/75">{rangeText(layerInfo.speed, 0, 'mm/s')}</span>
                <span className="text-white/35">Volumenstrom</span>
                <span className="tabular text-right text-white/75">{rangeText(layerInfo.flow, 1, 'mm³/s')}</span>
                <span className="text-white/35">Schichthöhe</span>
                <span className="tabular text-right text-white/75">
                  {layerInfo.height > 0 ? `${formatFeatureValue(layerInfo.height, 2)} mm` : '—'}
                </span>
                <span className="text-white/35">Bahnzeit</span>
                <span className="tabular text-right text-white/75">{timeText(layerInfo.seconds)}</span>
              </div>
              <div className="mt-1 max-h-[118px] space-y-0.5 overflow-y-auto">
                {layerInfo.features.length ? (
                  layerInfo.features.map((feature) => {
                    const isHidden = hidden.has(feature.kind)
                    return (
                      <div
                        key={feature.kind}
                        className={`flex w-full items-center gap-1.5 rounded px-1 py-[1px] text-[8px] ${
                          isHidden ? 'opacity-35' : ''
                        }`}
                      >
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-[1px]"
                          style={{ backgroundColor: previewFeatureColor(PREVIEW_KIND_CODE[feature.kind], palette) }}
                        />
                        <span className="min-w-0 flex-1 break-words leading-tight text-white/65">{feature.label}</span>
                        <span className="tabular text-white/35">
                          {feature.segments} · {timeText(feature.seconds)}
                        </span>
                        <button
                          type="button"
                          onClick={() => onToggleFeature?.(feature.kind)}
                          aria-pressed={!isHidden}
                          aria-label={isHidden ? `${feature.label} einblenden` : `${feature.label} ausblenden`}
                          className={`grid place-items-center rounded p-0.5 transition hover:bg-white/10 ${
                            isHidden ? 'text-white/30' : 'text-mint/80'
                          }`}
                        >
                          <EyeIcon off={isHidden} />
                        </button>
                      </div>
                    )
                  })
                ) : (
                  <p className="text-[8px] text-white/30">Keine Bahndaten für diese Schicht.</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {summaryRows.length > 0 && mode !== 'summary' && (
        <div className="border-t border-line/50">
          <button
            type="button"
            onClick={() => setSummaryOpen((value) => !value)}
            className="flex w-full items-center justify-between px-2.5 py-1 text-[8px] font-semibold tracking-wide text-white/40 uppercase transition hover:text-white/70"
            aria-expanded={summaryOpen}
          >
            <span>Zusammenfassung</span>
            <span className="text-[10px] leading-none">{summaryOpen ? '−' : '+'}</span>
          </button>
          {summaryOpen && (
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-x-2 gap-y-0.5 px-2.5 pb-2 text-[8px] leading-snug">
              {summaryRows.map(([label, value]) => (
                <div key={label} className="contents">
                  <span className="truncate text-white/35">{label}</span>
                  <span className="tabular text-right text-white/70">{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-line/50 px-2.5 py-1 text-[8px] text-white/35">
        <span>
          Schicht <span className="tabular text-amber/90">{clampedLayer + 1}</span> / {result.layers.length}
        </span>
        <span className="tabular">z {z.toFixed(2)} mm</span>
      </div>
    </div>
  )
}
