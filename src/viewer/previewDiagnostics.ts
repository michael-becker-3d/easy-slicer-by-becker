import {
  PREVIEW_STRIDE,
  type CalibrationTool,
  type PreviewFeatureKind,
  type PreviewLayer,
  type SliceStats,
} from '../../shared/types.ts'
import { PREVIEW_CODE_KIND, PREVIEW_FEATURE_META } from '../../shared/preview.ts'
import { buildCalibrationPlan, type CalibrationPlanStep } from './calibrationPlan.ts'

/**
 * Leichtgewichtige Diagnose der Vorschau. Sie arbeitet nur mit Daten, die im
 * Slice-Ergebnis bereits stecken — dadurch bleibt sie schnell und funktioniert
 * auch für importierte G-Code-Vorschauen ohne zusätzliche Slicer-Auswertung.
 */
export type DiagnosticSettings = {
  maxVolumetricFlow?: number
  temps?: { nozzle?: number }
  cooling?: { fanOffLayers?: number }
}

export type PreviewRiskSeverity = 'hoch' | 'mittel' | 'niedrig'

export type PreviewRisk = {
  id: string
  layerIndex: number
  z: number
  severity: PreviewRiskSeverity
  score: number
  title: string
  detail: string
  recommendation: string
  /** Letzte betroffene Schicht, wenn ein Hinweis pro Kalibrierstufe gruppiert wurde. */
  layerEndIndex?: number
  /** Zahl der zusammengefassten Schichten einer Gruppe. */
  occurrences?: number
  /** Bezeichnung der Kalibrierstufe, falls der Hinweis aus dem Testplan stammt. */
  stageLabel?: string
}

export type PreviewRiskReport = {
  layers: PreviewLayer[]
  risks: PreviewRisk[]
  highCount: number
  mediumCount: number
  medianSeconds: number
  maxFlow: number
}

export type PreviewSegment = {
  layerIndex: number
  z: number
  offset: number
  kind: PreviewFeatureKind
  label: string
  color: string
  start: { x: number; y: number }
  end: { x: number; y: number }
  length: number
  seconds: number
  speed: number
  flow: number
  temperature: number
  acceleration: number
  width: number
  fan: number
  pressureAdvance: number
  flowReserve: number | null
  /** 1-basierte Zeile im zugehörigen G-Code; null ohne Zuordnung. */
  gcodeLine: number | null
}

type PreviewSegmentCore = Omit<
  PreviewSegment,
  'layerIndex' | 'z' | 'offset' | 'flowReserve' | 'gcodeLine'
>

type LayerMetrics = {
  index: number
  z: number
  seconds: number
  extrusionSeconds: number
  travelSeconds: number
  length: number
  segments: number
  extrusions: number
  maxFlow: number
  maxSpeed: number
  maxWallSpeed: number
  maxTemperature: number
  maxFan: number
  kinds: Set<PreviewFeatureKind>
}

const SEVERITY_SCORE: Record<PreviewRiskSeverity, number> = { hoch: 3, mittel: 2, niedrig: 1 }

function finite(value: number): boolean {
  return Number.isFinite(value)
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function segmentAt(layer: PreviewLayer, offset: number): PreviewSegmentCore | null {
  const data = layer.data
  if (offset < 0 || offset + PREVIEW_STRIDE - 1 >= data.length) return null
  const kind = PREVIEW_CODE_KIND.get(data[offset])
  if (!kind) return null
  const meta = PREVIEW_FEATURE_META.get(kind)
  const start = { x: data[offset + 1], y: data[offset + 2] }
  const end = { x: data[offset + 3], y: data[offset + 4] }
  const length = Math.hypot(end.x - start.x, end.y - start.y)
  const speed = data[offset + 5]
  return {
    kind,
    label: meta?.label ?? 'Sonstige',
    color: meta?.color ?? '#cbd5e1',
    start,
    end,
    length,
    seconds: speed > 0 ? length / speed : 0,
    speed,
    flow: data[offset + 6],
    temperature: data[offset + 7],
    acceleration: data[offset + 8],
    width: data[offset + 9],
    fan: data[offset + 10],
    pressureAdvance: data[offset + 11],
  }
}

/** Ein einzelnes Segment aus der Vorschau — inklusive Reserve zum Volumenstrom-Limit. */
export function describePreviewSegment(
  layers: PreviewLayer[],
  layerIndex: number,
  offset: number,
  maxVolumetricFlow = 0,
): PreviewSegment | null {
  const layer = layers[layerIndex]
  if (!layer) return null
  const segment = segmentAt(layer, offset)
  if (!segment) return null
  return {
    ...segment,
    layerIndex,
    z: layer.z,
    offset,
    flowReserve: maxVolumetricFlow > 0 ? segment.flow / maxVolumetricFlow : null,
    gcodeLine: layer.lines?.[Math.floor(offset / PREVIEW_STRIDE)] ?? null,
  }
}

function collectLayerMetrics(layers: PreviewLayer[]): LayerMetrics[] {
  return layers.map((layer, index) => {
    let seconds = 0
    let extrusionSeconds = 0
    let travelSeconds = 0
    let length = 0
    let segments = 0
    let extrusions = 0
    let maxFlow = 0
    let maxSpeed = 0
    let maxWallSpeed = 0
    let maxTemperature = 0
    let maxFan = 0
    const kinds = new Set<PreviewFeatureKind>()

    for (let k = 0; k + PREVIEW_STRIDE - 1 < layer.data.length; k += PREVIEW_STRIDE) {
      const kind = PREVIEW_CODE_KIND.get(layer.data[k])
      if (!kind) continue
      const distance = Math.hypot(layer.data[k + 3] - layer.data[k + 1], layer.data[k + 4] - layer.data[k + 2])
      const speed = layer.data[k + 5]
      const segmentSeconds = speed > 0 ? distance / speed : 0
      if (!finite(segmentSeconds)) continue
      segments += 1
      kinds.add(kind)
      length += finite(distance) ? distance : 0
      seconds += segmentSeconds
      if (kind === 'travel') {
        travelSeconds += segmentSeconds
        continue
      }
      extrusions += 1
      extrusionSeconds += segmentSeconds
      const flow = layer.data[k + 6]
      const temperature = layer.data[k + 7]
      const fan = layer.data[k + 10]
      if (finite(flow)) maxFlow = Math.max(maxFlow, flow)
      if (finite(speed)) maxSpeed = Math.max(maxSpeed, speed)
      if ((kind === 'outer-wall' || kind === 'inner-wall') && finite(speed)) {
        maxWallSpeed = Math.max(maxWallSpeed, speed)
      }
      if (finite(temperature)) maxTemperature = Math.max(maxTemperature, temperature)
      if (finite(fan)) maxFan = Math.max(maxFan, fan)
    }

    return {
      index,
      z: layer.z,
      seconds,
      extrusionSeconds,
      travelSeconds,
      length,
      segments,
      extrusions,
      maxFlow,
      maxSpeed,
      maxWallSpeed,
      maxTemperature,
      maxFan,
      kinds,
    }
  })
}

function makeRisk(
  metrics: LayerMetrics,
  severity: PreviewRiskSeverity,
  kind: string,
  title: string,
  detail: string,
  recommendation: string,
  extra: Partial<Pick<PreviewRisk, 'layerEndIndex' | 'occurrences' | 'stageLabel'>> = {},
): PreviewRisk {
  return {
    id: `layer-${metrics.index}-${kind}`,
    layerIndex: metrics.index,
    z: metrics.z,
    severity,
    score: SEVERITY_SCORE[severity],
    title,
    detail,
    recommendation,
    ...extra,
  }
}

type CalibrationDeviationKind = 'temperature' | 'flow' | 'speed'

type CalibrationDeviation = {
  stage: CalibrationPlanStep
  kind: CalibrationDeviationKind
  firstLayer: number
  lastLayer: number
  occurrences: number
  actualMin: number
  actualMax: number
  expected: number
  severity: PreviewRiskSeverity
}

const CALIBRATION_TEMPERATURE_TOLERANCE = 3
const CALIBRATION_FLOW_TOLERANCE = 0.08
const CALIBRATION_SPEED_TOLERANCE = 0.08

function numberRange(min: number, max: number, digits: number): string {
  const low = min.toFixed(digits)
  const high = max.toFixed(digits)
  return low === high ? low : `${low}–${high}`
}

function calibrationDeviationTitle(kind: CalibrationDeviationKind): string {
  if (kind === 'temperature') return 'Temperaturstufe weicht vom Testplan ab'
  if (kind === 'speed') return 'Geschwindigkeitsstufe weicht vom Testplan ab'
  return 'Volumenstromstufe weicht vom Testplan ab'
}

function calibrationDeviationDetail(deviation: CalibrationDeviation): string {
  const stage = deviation.stage.label
  if (deviation.kind === 'temperature') {
    return `„${stage}“: ${deviation.occurrences} Schichten mit ${numberRange(deviation.actualMin, deviation.actualMax, 0)} °C statt ${deviation.expected.toFixed(0)} °C im Testplan.`
  }
  if (deviation.kind === 'speed') {
    return `„${stage}“: ${deviation.occurrences} Schichten mit ${numberRange(deviation.actualMin, deviation.actualMax, 0)} mm/s statt ${deviation.expected.toFixed(0)} mm/s im Testplan.`
  }
  return `„${stage}“: ${deviation.occurrences} Schichten mit ${numberRange(deviation.actualMin, deviation.actualMax, 1)} mm³/s statt ${deviation.expected.toFixed(1)} mm³/s im Testplan.`
}

function calibrationDeviationRecommendation(kind: CalibrationDeviationKind): string {
  if (kind === 'temperature') return 'Temperatur-Override und Testplan prüfen; die gedruckte Stufe entspricht nicht der geplanten Temperatur.'
  if (kind === 'speed') return 'Geschwindigkeits-Override und Volumenstromgrenze prüfen; die Stufe erreicht ihr geplantes Tempo nicht.'
  return 'Volumenstrom-Override und Materialgrenze prüfen; die Stufe erreicht ihren geplanten Volumenstrom nicht.'
}

/**
 * Prüft jede Schicht auf typische Druckrisiken. Die Schwellen sind bewusst
 * konservativ: kurze Schichten, hohe Reiseanteile, fehlende Kühlung und
 * Volumenstrom-Spitzen werden nur gemeldet, wenn sie aus den Bahndaten
 * wirklich ablesbar sind.
 */
export function analyzePreviewRisks(
  layers: PreviewLayer[],
  settings?: DiagnosticSettings,
  calibration?: Pick<CalibrationTool, 'steps'> | null,
): PreviewRiskReport {
  const metrics = collectLayerMetrics(layers)
  const positiveTimes = metrics.map((entry) => entry.seconds).filter((value) => value > 0)
  const medianSeconds = median(positiveTimes)
  const medianSegments = median(metrics.map((entry) => entry.segments).filter((value) => value > 0))
  const flowLimit = settings?.maxVolumetricFlow ?? 0
  const nozzleTemp = settings?.temps?.nozzle ?? 0
  const fanOffLayers = settings?.cooling?.fanOffLayers ?? 0
  const risks: PreviewRisk[] = []
  const calibrationPlan = calibration?.steps.length
    ? buildCalibrationPlan(calibration, layers, 0, layers.length)
    : null
  const calibrationSteps = calibrationPlan?.steps.filter((step) => step.startLayer !== null) ?? []
  const calibrationDeviations = new Map<string, CalibrationDeviation>()
  const stageAt = (layerIndex: number) =>
    calibrationSteps.find(
      (step) => step.startLayer !== null && step.endLayer !== null && layerIndex >= step.startLayer && layerIndex <= step.endLayer,
    )
  const recordDeviation = (
    stage: CalibrationPlanStep,
    kind: CalibrationDeviationKind,
    entry: LayerMetrics,
    actual: number,
    expected: number,
    severity: PreviewRiskSeverity,
  ) => {
    const key = `${stage.index}:${kind}`
    const existing = calibrationDeviations.get(key)
    if (!existing) {
      calibrationDeviations.set(key, {
        stage,
        kind,
        firstLayer: entry.index,
        lastLayer: entry.index,
        occurrences: 1,
        actualMin: actual,
        actualMax: actual,
        expected,
        severity,
      })
      return
    }
    existing.lastLayer = entry.index
    existing.occurrences += 1
    existing.actualMin = Math.min(existing.actualMin, actual)
    existing.actualMax = Math.max(existing.actualMax, actual)
    if (SEVERITY_SCORE[severity] > SEVERITY_SCORE[existing.severity]) existing.severity = severity
  }
  const stageForValue = (
    stage: CalibrationPlanStep,
    entry: LayerMetrics,
    kind: CalibrationDeviationKind,
    actual: number,
    tolerance: number,
  ): { stage: CalibrationPlanStep; expected: number } | null => {
    const expected =
      kind === 'temperature'
        ? stage.expectedTemperature
        : kind === 'flow'
          ? stage.expectedFlow
          : stage.expectedSpeed
    if (expected === undefined) return null
    // An einer Stufengrenze kann die Schicht noch zur vorherigen Stufe
    // gehören (Override beginnt erst hinter der Grenze). Dort entscheidet
    // der tatsächliche Wert, welche Stufe gilt; passt er zu keiner der beiden,
    // bleibt die Schicht bei der vorherigen Stufe.
    if (entry.index !== stage.startLayer || stage.index === 0) return { stage, expected }
    const previous = calibrationSteps.find((step) => step.index === stage.index - 1)
    if (!previous) return { stage, expected }
    const previousExpected =
      kind === 'temperature'
        ? previous.expectedTemperature
        : kind === 'flow'
          ? previous.expectedFlow
          : previous.expectedSpeed
    if (previousExpected !== undefined && Math.abs(actual - previousExpected) <= tolerance) {
      return { stage: previous, expected: previousExpected }
    }
    if (Math.abs(actual - expected) <= tolerance) return { stage, expected }
    return { stage: previous, expected: previousExpected ?? expected }
  }
  let maxFlow = 0

  for (const entry of metrics) {
    maxFlow = Math.max(maxFlow, entry.maxFlow)
    if (!entry.segments || entry.seconds <= 0) {
      if (layers.length > 1) {
        risks.push(
          makeRisk(
            entry,
            'niedrig',
            'leer',
            'Leere Schicht',
            'Für diese Schicht liegen keine Bahndaten vor.',
            'Schicht im Slicer prüfen — eventuell eine Stütz- oder Füllschicht ohne Extrusion.',
          ),
        )
      }
      continue
    }

    const stage = stageAt(entry.index)
    const plannedFlow = stage?.expectedFlow
    const plannedSpeed = stage?.expectedSpeed
    if (plannedFlow !== undefined && entry.maxFlow > 0) {
      // Max-Flow-Stufen überschreiten absichtlich das Profil-Limit. Nur eine
      // Abweichung vom Stufen-Sollwert ist ein echter Befund.
      const tolerance = Math.max(0.25, plannedFlow * CALIBRATION_FLOW_TOLERANCE)
      const effective = stageForValue(stage!, entry, 'flow', entry.maxFlow, tolerance)
      const deviation = effective ? Math.abs(entry.maxFlow - effective.expected) : 0
      if (effective && deviation > tolerance) {
        recordDeviation(
          effective.stage,
          'flow',
          entry,
          entry.maxFlow,
          effective.expected,
          deviation / effective.expected > 0.2 ? 'hoch' : 'mittel',
        )
      }
    } else if (plannedSpeed !== undefined && entry.maxWallSpeed > 0) {
      // VFA-Stufen ändern absichtlich das Tempo. Ein Limit, das die Stufe
      // nicht erreicht, bleibt dagegen eine echte Planabweichung.
      const tolerance = Math.max(2, plannedSpeed * CALIBRATION_SPEED_TOLERANCE)
      const effective = stageForValue(stage!, entry, 'speed', entry.maxWallSpeed, tolerance)
      const deviation = effective ? Math.abs(entry.maxWallSpeed - effective.expected) : 0
      if (effective && deviation > tolerance) {
        recordDeviation(
          effective.stage,
          'speed',
          entry,
          entry.maxWallSpeed,
          effective.expected,
          deviation / effective.expected > 0.2 ? 'hoch' : 'mittel',
        )
      }
    } else if (flowLimit > 0 && entry.maxFlow > 0) {
      const ratio = entry.maxFlow / flowLimit
      if (ratio >= 0.95) {
        risks.push(
          makeRisk(
            entry,
            'hoch',
            'flow',
            'Volumenstrom am Limit',
            `Spitze ${entry.maxFlow.toFixed(1)} mm³/s bei ${Math.round(ratio * 100)} % des Profilwerts.`,
            'Tempo oder Linienbreite senken; bei dauerhafter Spitze max. Volumenstrom im Filamentprofil prüfen.',
          ),
        )
      } else if (ratio >= 0.8) {
        risks.push(
          makeRisk(
            entry,
            'mittel',
            'flow',
            'Wenig Durchfluss-Reserve',
            `Spitze ${entry.maxFlow.toFixed(1)} mm³/s bei ${Math.round(ratio * 100)} % des Profilwerts.`,
            'Für diese Schicht bleibt weniger als ein Fünftel Reserve — bei Aussetzern Tempo reduzieren.',
          ),
        )
      }
    }

    if (entry.index > 0 && entry.extrusionSeconds > 0) {
      const shortAgainstMedian = medianSeconds > 0 && entry.seconds < medianSeconds * 0.35
      if (entry.seconds < 8 && shortAgainstMedian) {
        risks.push(
          makeRisk(
            entry,
            'hoch',
            'short-layer',
            'Sehr kurze Schicht',
            `Nur ${entry.seconds.toFixed(1)} s Bahnzeit — deutlich unter dem Median von ${medianSeconds.toFixed(1)} s.`,
            'Kühlung und Mindestschichtzeit prüfen; kleine Querschnitte können sonst weich bleiben oder hochziehen.',
          ),
        )
      } else if (entry.seconds < 15 && shortAgainstMedian) {
        risks.push(
          makeRisk(
            entry,
            'mittel',
            'short-layer',
            'Kurze Schicht',
            `Bahnzeit ${entry.seconds.toFixed(1)} s bei Median ${medianSeconds.toFixed(1)} s.`,
            'Bei filigranen Bereichen Kühlung beobachten oder die Geschwindigkeit etwas reduzieren.',
          ),
        )
      }
    }

    if (entry.travelSeconds > 6) {
      const ratio = entry.travelSeconds / entry.seconds
      if (ratio >= 0.55) {
        risks.push(
          makeRisk(
            entry,
            ratio >= 0.7 ? 'hoch' : 'mittel',
            'travel',
            'Viel Leerfahrt',
            `${Math.round(ratio * 100)} % der Schichtzeit sind Reisen (${entry.travelSeconds.toFixed(1)} s).`,
            'Reihenfolge, Combing oder Z-Hop prüfen — viele Leerfahrten erhöhen Fäden und Zeit.',
          ),
        )
      }
    }

    if (
      entry.index >= fanOffLayers + 2 &&
      entry.extrusions > 0 &&
      entry.maxFan < 25 &&
      entry.extrusionSeconds > 2
    ) {
      risks.push(
        makeRisk(
          entry,
          entry.maxFan <= 0 ? 'hoch' : 'mittel',
          'cooling',
          entry.maxFan <= 0 ? 'Kühlung fehlt' : 'Kühlung sehr niedrig',
          `Lüfter höchstens ${Math.round(entry.maxFan)} % — nach den ersten ${fanOffLayers + 1} Schichten.`,
          'Lüftergrenze und Kühlzeit prüfen; bei PLA ist fehlende Kühlung ein häufiger Grund für Verzug.',
        ),
      )
    }

    const plannedTemperature = stage?.expectedTemperature
    if (plannedTemperature !== undefined && entry.maxTemperature > 0) {
      // Temperaturtürme und ähnliche Tests durchlaufen absichtlich mehrere
      // Temperaturen. Gewarnt wird nur, wenn die Schicht ihren Stufen-Sollwert
      // verfehlt.
      const effective = stageForValue(
        stage!,
        entry,
        'temperature',
        entry.maxTemperature,
        CALIBRATION_TEMPERATURE_TOLERANCE,
      )
      const deviation = effective ? Math.abs(entry.maxTemperature - effective.expected) : 0
      if (effective && deviation > CALIBRATION_TEMPERATURE_TOLERANCE) {
        recordDeviation(
          effective.stage,
          'temperature',
          entry,
          entry.maxTemperature,
          effective.expected,
          deviation > 20 ? 'hoch' : 'mittel',
        )
      }
    } else if (nozzleTemp > 0 && entry.maxTemperature > 0 && Math.abs(entry.maxTemperature - nozzleTemp) > 15) {
      risks.push(
        makeRisk(
          entry,
          'mittel',
          'temperature',
          'Temperatur weicht ab',
          `Bahn-Temperatur ${Math.round(entry.maxTemperature)} °C statt ${Math.round(nozzleTemp)} °C im Profil.`,
          'Temperaturwechsel oder eine fehlerhafte Materialzuordnung in dieser Schicht prüfen.',
        ),
      )
    }

    if (medianSegments >= 20 && entry.segments < Math.max(5, medianSegments * 0.12) && entry.index > 0) {
      risks.push(
        makeRisk(
          entry,
          'niedrig',
          'sparse',
          'Wenige Bahnen',
          `Nur ${entry.segments} Segmente in dieser Schicht.`,
          'Prüfen, ob eine dünne Wand oder ein Übergang absichtlich so wenig Material vorsieht.',
        ),
      )
    }
  }

  // Wiederholte Abweichungen derselben Kalibrierstufe werden zu einem Befund
  // mit Schichtbereich und Anzahl zusammengefasst.
  for (const deviation of calibrationDeviations.values()) {
    const entry = metrics[deviation.firstLayer]
    if (!entry) continue
    risks.push(
      makeRisk(
        entry,
        deviation.severity,
        `calibration-${deviation.kind}-${deviation.stage.index}`,
        calibrationDeviationTitle(deviation.kind),
        calibrationDeviationDetail(deviation),
        calibrationDeviationRecommendation(deviation.kind),
        {
          layerEndIndex: deviation.lastLayer,
          occurrences: deviation.occurrences,
          stageLabel: deviation.stage.label,
        },
      ),
    )
  }

  const severityRank: Record<PreviewRiskSeverity, number> = { hoch: 0, mittel: 1, niedrig: 2 }
  risks.sort((a, b) => {
    const severity = severityRank[a.severity] - severityRank[b.severity]
    return severity || a.layerIndex - b.layerIndex
  })

  return {
    layers,
    risks,
    highCount: risks.filter((risk) => risk.severity === 'hoch').length,
    mediumCount: risks.filter((risk) => risk.severity === 'mittel').length,
    medianSeconds,
    maxFlow,
  }
}

export type SliceComparisonSide = {
  layers: PreviewLayer[]
  stats: Pick<
    SliceStats,
    'estimatedSeconds' | 'filamentMm' | 'filamentGrams' | 'maxFlowMm3s' | 'layerCount'
  >
}

export type SliceLayerDifference = {
  layerIndex: number
  currentSeconds: number
  previousSeconds: number
  secondsDelta: number
  currentFlow: number
  previousFlow: number
  flowDelta: number
}

export type SliceComparison = {
  current: SliceComparisonSide
  previous: SliceComparisonSide
  secondsDelta: number
  filamentDelta: number
  gramsDelta: number
  flowDelta: number
  layerCountDelta: number
  layerDifferences: SliceLayerDifference[]
}

function layerSeconds(layer: PreviewLayer | undefined): number {
  if (!layer) return 0
  let seconds = 0
  for (let k = 0; k + PREVIEW_STRIDE - 1 < layer.data.length; k += PREVIEW_STRIDE) {
    const speed = layer.data[k + 5]
    if (!(speed > 0)) continue
    seconds += Math.hypot(layer.data[k + 3] - layer.data[k + 1], layer.data[k + 4] - layer.data[k + 2]) / speed
  }
  return seconds
}

function layerMaxFlow(layer: PreviewLayer | undefined): number {
  if (!layer) return 0
  let flow = 0
  for (let k = 0; k + PREVIEW_STRIDE - 1 < layer.data.length; k += PREVIEW_STRIDE) {
    if (layer.data[k] === 10) continue
    if (Number.isFinite(layer.data[k + 6])) flow = Math.max(flow, layer.data[k + 6])
  }
  return flow
}

/**
 * Vergleicht zwei Slice-Ergebnisse. Die Schichten werden über den Index
 * synchronisiert; bei unterschiedlicher Höhe wird nur der gemeinsame Teil
 * verglichen, damit die Differenz nicht durch fehlende Schichten verfälscht wird.
 */
export function compareSliceResults(
  current: SliceComparisonSide,
  previous: SliceComparisonSide,
): SliceComparison {
  const shared = Math.min(current.layers.length, previous.layers.length)
  const layerDifferences: SliceLayerDifference[] = []
  for (let index = 0; index < shared; index++) {
    const currentSeconds = layerSeconds(current.layers[index])
    const previousSeconds = layerSeconds(previous.layers[index])
    const currentFlow = layerMaxFlow(current.layers[index])
    const previousFlow = layerMaxFlow(previous.layers[index])
    const secondsDelta = currentSeconds - previousSeconds
    const flowDelta = currentFlow - previousFlow
    if (Math.abs(secondsDelta) < 0.5 && Math.abs(flowDelta) < 0.2) continue
    layerDifferences.push({
      layerIndex: index,
      currentSeconds,
      previousSeconds,
      secondsDelta,
      currentFlow,
      previousFlow,
      flowDelta,
    })
  }
  layerDifferences.sort(
    (a, b) =>
      Math.abs(b.secondsDelta) +
      Math.abs(b.flowDelta) * 2 -
      (Math.abs(a.secondsDelta) + Math.abs(a.flowDelta) * 2),
  )
  return {
    current,
    previous,
    secondsDelta: current.stats.estimatedSeconds - previous.stats.estimatedSeconds,
    filamentDelta: current.stats.filamentMm - previous.stats.filamentMm,
    gramsDelta: current.stats.filamentGrams - previous.stats.filamentGrams,
    flowDelta: current.stats.maxFlowMm3s - previous.stats.maxFlowMm3s,
    layerCountDelta: current.layers.length - previous.layers.length,
    layerDifferences: layerDifferences.slice(0, 8),
  }
}
