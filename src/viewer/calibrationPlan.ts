import {
  PREVIEW_STRIDE,
  type CalibrationStep,
  type PreviewLayer,
  type PrintSettings,
} from '../../shared/types.ts'
import { PREVIEW_CODE_KIND } from '../../shared/preview.ts'

export type CalibrationPlanStep = {
  index: number
  label: string
  value: string
  atZ: number
  expectedTemperature?: number
  expectedFlow?: number
  expectedSpeed?: number
  /** Höchste Wandgeschwindigkeit dieser Stufe im aktuellen Slice. */
  observedMaxSpeed: number | null
  /** Erste Schicht dieser Stufe im aktuellen Slice; null = nicht enthalten. */
  startLayer: number | null
  /** Letzte Schicht dieser Stufe im aktuellen Slice. */
  endLayer: number | null
  active: boolean
}

export type CalibrationPlan = {
  steps: CalibrationPlanStep[]
  plannedStages: number
  stagesInSlice: number
  activeStartLayer: number | null
  plannedLayers: number | null
  slicedLayers: number
  stagesOk: boolean
  layersOk: boolean
  ok: boolean
}

export type CalibrationSpeedHint = {
  text: string
  /** Stufen, deren Solltempo im Slice erkennbar unterschritten wird. */
  limitedStages: {
    index: number
    label: string
    expected: number
    observed: number
  }[]
  /** Für das Beispiel im Text verwendete Stufe. */
  focusSpeed: number
  exampleFrom: number
  exampleTo: number
  scv: number | null
}

function layerAtZ(layers: PreviewLayer[], atZ: number): number | null {
  if (!layers.length) return null
  const index = layers.findIndex((layer) => layer.z >= atZ - 1e-4)
  return index < 0 ? null : index
}

/** Höchste Geschwindigkeit einer Außen- oder Innenwand in einer Schicht. */
function maxWallSpeed(layer: PreviewLayer): number {
  let speed = 0
  for (let k = 0; k + PREVIEW_STRIDE - 1 < layer.data.length; k += PREVIEW_STRIDE) {
    const kind = PREVIEW_CODE_KIND.get(layer.data[k])
    if (kind !== 'outer-wall' && kind !== 'inner-wall') continue
    const value = layer.data[k + 5]
    if (Number.isFinite(value) && value > speed) speed = value
  }
  return speed
}

function formatSpeed(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace('.', ',')
}

/**
 * Ordnet den Kalibrierplan den tatsächlich geslicten Schichten zu.
 *
 * Maßgeblich ist der Z-Wert der Stufe, nicht die Reihenfolge im Plan. Dadurch
 * zeigen Vorschau, Slice und Klick-Sprung dieselbe Stelle. Für die aktive
 * Markierung bilden mehrere Messpunkte auf derselben Z-Ebene (z. B. PA-Linie)
 * eine Z-Stufe; die Vollständigkeitsprüfung zählt jeden Planpunkt.
 */
export function buildCalibrationPlan(
  tool: { steps: CalibrationStep[]; plannedLayers?: number },
  layers: PreviewLayer[],
  currentLayer: number,
  slicedLayerCount = layers.length,
): CalibrationPlan {
  const startLayers = [...new Set(tool.steps.map((step) => step.atZ))]
    .sort((a, b) => a - b)
    .map((atZ) => ({ atZ, layer: layerAtZ(layers, atZ) }))
  const availableStarts = startLayers.filter(
    (entry): entry is { atZ: number; layer: number } => entry.layer !== null,
  )
  const clampedLayer = layers.length ? Math.max(0, Math.min(layers.length - 1, currentLayer)) : -1
  const activeStartLayer = availableStarts
    .filter((entry) => entry.layer <= clampedLayer)
    .reduce<number | null>((active, entry) => (active === null || entry.layer > active ? entry.layer : active), null)

  // Nur Tempo-Tests brauchen die tatsächliche Wandgeschwindigkeit. So bleibt
  // das Neuberechnen des Plans beim Schichtregler für andere Tests billig.
  const layerSpeeds = tool.steps.some((step) => step.expectedSpeed !== undefined)
    ? layers.map(maxWallSpeed)
    : null
  const steps = tool.steps.map((step, index) => {
    const start = startLayers.find((entry) => entry.atZ === step.atZ)?.layer ?? null
    const startIndex = startLayers.findIndex((entry) => entry.atZ === step.atZ)
    const nextStart = startIndex >= 0 ? startLayers[startIndex + 1]?.layer ?? null : null
    const end = start === null ? null : (nextStart ?? slicedLayerCount) - 1
    const observedMaxSpeed =
      start === null || layerSpeeds === null
        ? null
        : layerSpeeds.slice(start, (end ?? start) + 1).reduce((maximum, speed) => Math.max(maximum, speed), 0)
    return {
      index,
      label: step.label,
      value: step.value,
      atZ: step.atZ,
      expectedTemperature: step.expectedTemperature,
      expectedFlow: step.expectedFlow,
      expectedSpeed: step.expectedSpeed,
      observedMaxSpeed,
      startLayer: start,
      endLayer: end !== null && end >= start! ? end : start,
      active: start !== null && start === activeStartLayer,
    }
  })

  const plannedStages = tool.steps.length
  const stagesInSlice = steps.filter((step) => step.startLayer !== null).length
  const plannedLayers = tool.plannedLayers ?? null
  return {
    steps,
    plannedStages,
    stagesInSlice,
    activeStartLayer,
    plannedLayers,
    slicedLayers: slicedLayerCount,
    stagesOk: plannedStages === stagesInSlice,
    layersOk: plannedLayers !== null && plannedLayers === slicedLayerCount,
    ok: plannedStages === stagesInSlice && plannedLayers !== null && plannedLayers === slicedLayerCount,
  }
}

/**
 * Verständlicher Hinweis für Tempo-Kalibrierungen: Die Planwerte sind
 * Sollgeschwindigkeiten. Kurze Testwände, Beschleunigung und SCV können den
 * tatsächlich erreichbaren Momentanwert begrenzen; das ist kein Slicerfehler.
 */
export function calibrationSpeedHint(
  plan: CalibrationPlan,
  toolId: string,
  settings?: Pick<PrintSettings, 'squareCornerVelocity'>,
  scvActive = false,
): CalibrationSpeedHint | null {
  if (toolId !== 'vfa') return null
  const speedSteps = plan.steps.filter(
    (step): step is CalibrationPlanStep & { expectedSpeed: number } =>
      Number.isFinite(step.expectedSpeed) && (step.expectedSpeed ?? 0) > 0,
  )
  if (!speedSteps.length) return null

  const limitedStages = speedSteps
    .filter(
      (step) =>
        step.observedMaxSpeed !== null &&
        step.observedMaxSpeed > 0 &&
        step.observedMaxSpeed < step.expectedSpeed * 0.985,
    )
    .map((step) => ({
      index: step.index,
      label: step.label,
      expected: step.expectedSpeed,
      observed: step.observedMaxSpeed ?? 0,
    }))

  const fastestStep = speedSteps.reduce((fastest, step) =>
    step.expectedSpeed > fastest.expectedSpeed ? step : fastest,
  )
  const limitedFastest = limitedStages.reduce<(typeof limitedStages)[number] | null>(
    (fastest, stage) => (!fastest || stage.expected > fastest.expected ? stage : fastest),
    null,
  )
  const focusSpeed = limitedFastest?.expected ?? fastestStep.expectedSpeed
  const exampleFrom = Math.max(1, Math.round(focusSpeed * 0.9))
  const exampleTo = Math.max(exampleFrom + 1, Math.round(focusSpeed * 0.93))

  const configuredScv = settings?.squareCornerVelocity
  const scv =
    scvActive && configuredScv?.enabled && Number.isFinite(configuredScv.value) && configuredScv.value > 0
      ? configuredScv.value
      : null
  const cause =
    scv !== null
      ? `der Beschleunigung und der eingestellten Square-Corner-Velocity (SCV ${formatSpeed(scv)} mm/s)`
      : 'der Beschleunigung und der kurzen Wege der Testgeometrie'

  return {
    text:
      `Tempo-Stufen sind Sollwerte. Auf der 20 × 14 mm-Testwand erreicht die Düse wegen ${cause} ` +
      'nicht zwischen jeder Ecke das Stufentempo. ' +
      `Zeigt der Drucker statt ${formatSpeed(focusSpeed)} mm/s nur etwa ${exampleFrom}–${exampleTo} mm/s an, ` +
      'ist das kein Slicerfehler — bewerte die Oberfläche, nicht den Momentanwert.',
    limitedStages,
    focusSpeed,
    exampleFrom,
    exampleTo,
    scv,
  }
}

/** Kurze Layer-Angabe für die Planzeile, z. B. „L16–65“. */
export function calibrationLayerRange(step: CalibrationPlanStep): string {
  if (step.startLayer === null) return 'nicht im Slice'
  if (step.endLayer === null || step.endLayer === step.startLayer) return `L${step.startLayer + 1}`
  return `L${step.startLayer + 1}–${step.endLayer + 1}`
}
