/**
 * Rechenlogik rund um die Kalibriertests. Sie liegt bewusst in `shared`, damit
 * Slicer, Oberfläche und Regressionstests dieselbe Soll-Wandbreite verwenden.
 */

/** Kleinste Soll-Linienbreite des Flowwürfels; darunter wäre eine einzelne Wand nicht messbar. */
export const MIN_FLOW_CUBE_WALL = 0.42

/**
 * Geometrie des Max-Flow-Tests. Die langen Geraden sind der entscheidende
 * Unterschied zum alten 96-Eck-Zylinder: Auf ihnen kann die Düse zwischen zwei
 * Ecken tatsächlich auf die oberen Stufen beschleunigen.
 */
export const MAX_FLOW_TEST_WIDTH = 100
export const MAX_FLOW_TEST_DEPTH = 100
export const MAX_FLOW_TEST_CORNER_RADIUS = 10
export const MAX_FLOW_TEST_CORNER_SEGMENTS = 10
/** Länge der geraden Wände zwischen den vier abgerundeten Ecken. */
export const MAX_FLOW_TEST_STRAIGHT = MAX_FLOW_TEST_WIDTH - 2 * MAX_FLOW_TEST_CORNER_RADIUS
/** Nur für den Test erhöhte SCV; der bisherige Wert wird im End-G-code wiederhergestellt. */
export const MAX_FLOW_TEST_SCV = 15

/**
 * Soll-Linienbreite der einen Außenwand des Flowwürfels in mm.
 *
 * Der Testwürfel wird mit mindestens 0,42 mm Linienbreite gedruckt und wächst
 * bei größeren Düsen mit deren Durchmesser. Das ist der Bezugswert für die
 * Flussmessung — nicht die Düsenbreite, die bei 0,4 mm nur 0,40 mm wäre.
 */
export function flowCubeWallWidth(nozzle: number): number {
  return Math.max(MIN_FLOW_CUBE_WALL, Number.isFinite(nozzle) && nozzle > 0 ? nozzle : 0)
}

/**
 * Korrigiert den Fluss anhand einer gemessenen Wandstärke.
 *
 * `newFlow = oldFlow × Sollwand / Messwert`, auf drei Nachkommastellen
 * gerundet. Bei ungültigen Werten gibt es kein Ergebnis, statt still einen
 * falschen Fluss zu übernehmen.
 */
export function correctedFlow(
  currentFlow: number,
  targetWallWidth: number,
  measuredWallWidth: number,
): number | null {
  if (
    !Number.isFinite(currentFlow) ||
    !Number.isFinite(targetWallWidth) ||
    !Number.isFinite(measuredWallWidth) ||
    currentFlow <= 0 ||
    targetWallWidth <= 0 ||
    measuredWallWidth <= 0
  ) {
    return null
  }
  return Math.round(((currentFlow * targetWallWidth) / measuredWallWidth) * 1000) / 1000
}

/**
 * Zusammenfassung mehrerer Wandmessungen desselben Flowwürfels.
 *
 * Der empfohlene Fluss nutzt den Mittelwert, damit eine einzelne
 * Fehlmessung nicht allein den ganzen Fluss verschiebt. Der Flussbereich
 * zeigt zusätzlich die Grenzen aus der dicksten (kleinster Fluss) und
 * dünnsten (größter Fluss) Wandmessung.
 */
export type FlowMeasurementSummary = {
  count: number
  mean: number | null
  standardDeviation: number | null
  minimum: number | null
  maximum: number | null
  flow: number | null
  flowMinimum: number | null
  flowMaximum: number | null
}

export function summarizeFlowMeasurements(
  measurements: readonly number[],
  currentFlow: number,
  targetWallWidth: number,
): FlowMeasurementSummary {
  const values = measurements.filter((value) => Number.isFinite(value) && value > 0)
  if (!values.length) {
    return {
      count: 0,
      mean: null,
      standardDeviation: null,
      minimum: null,
      maximum: null,
      flow: null,
      flowMinimum: null,
      flowMaximum: null,
    }
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)

  return {
    count: values.length,
    mean,
    standardDeviation: Math.sqrt(variance),
    minimum,
    maximum,
    flow: correctedFlow(currentFlow, targetWallWidth, mean),
    // Die dickste Wand ergibt den kleinsten, die dünnste den größten Fluss.
    flowMinimum: correctedFlow(currentFlow, targetWallWidth, maximum),
    flowMaximum: correctedFlow(currentFlow, targetWallWidth, minimum),
  }
}

/**
 * Elefantenfuß aus zwei Breitenmessungen ableiten.
 *
 * Gemessen wird die breiteste Stelle der ersten Schicht und die Sollbreite
 * des Bauteils. Der Einzug wirkt pro Seite, deshalb halbiert sich die
 * Differenz. Positive Werte ziehen nach innen, negative weiten die erste
 * Schicht leicht auf.
 */
export function elephantFootInset(targetWidth: number, measuredFootWidth: number): number | null {
  if (
    !Number.isFinite(targetWidth) ||
    !Number.isFinite(measuredFootWidth) ||
    targetWidth <= 0 ||
    measuredFootWidth <= 0
  ) {
    return null
  }
  return Math.round(((measuredFootWidth - targetWidth) / 2) * 1000) / 1000
}