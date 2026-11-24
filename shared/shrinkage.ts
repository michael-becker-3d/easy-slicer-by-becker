/**
 * Schrumpfkompensation: Easy Slicer rechnet mit einer prozentualen
 * Vergrößerung (0 % = aus, 1 % = Maß × 1,01). Orca/Bambu schreiben dagegen
 * das verbleibende Maß in Prozent (100 % = aus, 99 % = Maß × 0,99).
 *
 * Die Umrechnung ist deshalb proportional und nicht additiv:
 *   Easy = (100 / Orca - 1) × 100
 *   Orca = 100 / (1 + Easy / 100)
 */

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

/** Prozentualer Skalierungsfaktor für Easy-Slicer-Werte. */
export function shrinkageScale(percent: number): number {
  return 1 + (Number.isFinite(percent) ? percent : 0) / 100
}

/** Beispielmaß für die Oberfläche: 100 mm bei 0,8 % → 100,8 mm. */
export function scaledLength(lengthMm: number, percent: number): number {
  return lengthMm * shrinkageScale(percent)
}

/**
 * Orca/Bambu-Prozentwert in die Easy-Slicer-Skala umrechnen.
 * 100 % → 0, 99 % → 1,010101 %, 0/ungültig → null (keine Übernahme).
 */
export function orcaShrinkToEasy(value: number | null | undefined): number | null {
  if (!positive(value)) return null
  return round((100 / value - 1) * 100, 6)
}

/** Easy-Slicer-Prozentwert als Orca/Bambu-Prozentwert schreiben. */
export function easyShrinkToOrca(value: number): number {
  const factor = shrinkageScale(value)
  if (!(factor > 0)) return 100
  return round(100 / factor, 6)
}

/**
 * Aus Soll- und Ist-Maß die nötige Easy-Slicer-Kompensation berechnen.
 * Beispiel: 100 mm Soll, 99,2 mm Ist → 0,8065 %.
 */
export function shrinkageFromMeasurement(targetMm: number, measuredMm: number): number | null {
  if (!positive(targetMm) || !positive(measuredMm)) return null
  return round((targetMm / measuredMm - 1) * 100, 4)
}