import { correctedFlow, elephantFootInset, flowCubeWallWidth } from './calibration.ts'
import { mergeSettings, type DeepPartial, type PrintSettings } from './types.ts'

/**
 * Kalibrier-Kreislauf (V-18).
 *
 * Die Messung nach einem Test wird hier zur Korrektur: Wandstärke → Fluss,
 * gemessene Außenmaße → Schrumpfung, Fußbreite → Elefantenfuß und ein am
 * PA-Turm abgelesener Wert → Pressure Advance. Jede Korrektur nennt Formel,
 * Vorher/Nachher und Begründung; übernommene Werte lassen sich als Version mit
 * Spule, Drucker und Datum ablegen.
 */
export type CalibrationMeasureInput = {
  /** Gemessene Wandstärke des Flowwürfels in mm. */
  wallThickness?: number | null
  /** Soll-Wandstärke; ohne Angabe aus der Düse abgeleitet. */
  targetWallWidth?: number | null
  /** Gemessene breiteste Stelle der ersten Schicht in mm. */
  footWidth?: number | null
  /** Sollbreite des Bauteils an der ersten Schicht in mm. */
  targetFootWidth?: number | null
  /** Gemessenes Außenmaß in X bzw. Y in mm. */
  measuredX?: number | null
  targetX?: number | null
  measuredY?: number | null
  targetY?: number | null
  /** Am Pressure-Advance-Turm abgelesener Wert. */
  pressureAdvance?: number | null
}

export type CalibrationCorrectionId = 'flow' | 'pressure-advance' | 'shrinkage' | 'elephant-foot'

export type CalibrationCorrection = {
  id: CalibrationCorrectionId
  label: string
  before: string
  after: string
  formula: string
  why: string
  patch: DeepPartial<PrintSettings>
}

export type CalibrationValues = {
  flow: number
  pressureAdvance: number
  shrinkageX: number
  shrinkageY: number
  elephantFoot: number
}

export type CalibrationVersion = {
  id: string
  at: number
  printerId: string
  printerName: string
  filament: string
  spool: string
  before: CalibrationValues
  after: CalibrationValues
  /** Gemessenes Passungsspiel für den Montage-Assistenten (V-20). */
  tolerance?: number
  note?: string
}

const isPositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

const num = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const fmt = (value: number, digits = 3) => value.toFixed(digits).replace('.', ',')
const pctFmt = (value: number) => `${value.toFixed(2).replace('.', ',')} %`

const round3 = (value: number) => Math.round(value * 1000) / 1000

/**
 * Schrumpfkorrektur aus einem gemessenen Außenmaß.
 *
 * Der aktuelle Prozentwert steckt bereits im Messstück. Deshalb wird die
 * zusätzlich nötige Skalierung `(Soll / Ist − 1) × 100` auf den bisherigen Wert
 * addiert, statt ihn zu ersetzen. Negative Werte verkleinern das Modell.
 */
export function shrinkageCorrection(
  currentPercent: number,
  target: number,
  measured: number,
): number | null {
  if (!isPositive(target) || !isPositive(measured) || !Number.isFinite(currentPercent)) return null
  const next = currentPercent + (target / measured - 1) * 100
  return round3(Math.max(-10, Math.min(10, next)))
}

/** Liest die vier Profilwerte, die der Kreislauf beeinflusst. */
export function calibrationValues(settings: PrintSettings): CalibrationValues {
  return {
    flow: settings.flow,
    pressureAdvance: settings.pressureAdvance?.value ?? 0,
    shrinkageX: settings.shrinkage.x,
    shrinkageY: settings.shrinkage.y,
    elephantFoot: settings.elephantFoot?.amount ?? 0,
  }
}

/**
 * Rechnet alle eingegebenen Messungen in Korrekturen um. Ungültige oder
 * unveränderte Werte erzeugen bewusst keinen Eintrag — der Kreislauf soll
 * nichts „glätten“, was gar nicht gemessen wurde.
 */
export function calibrationCorrections(
  input: CalibrationMeasureInput,
  current: PrintSettings,
): CalibrationCorrection[] {
  const out: CalibrationCorrection[] = []

  // Fluss aus der Wandstärke des Flowwürfels.
  const wall = num(input.wallThickness)
  const targetWall = num(input.targetWallWidth) ?? (isPositive(current.nozzle) ? flowCubeWallWidth(current.nozzle) : null)
  if (wall !== null && targetWall !== null) {
    const next = correctedFlow(current.flow, targetWall, wall)
    if (next !== null && Math.abs(next - current.flow) >= 0.002) {
      out.push({
        id: 'flow',
        label: 'Fluss aus Wandstärke',
        before: fmt(current.flow),
        after: fmt(next),
        formula: `${fmt(current.flow)} × ${fmt(targetWall, 2)} mm / ${fmt(wall, 2)} mm = ${fmt(next)}`,
        why: 'Die gemessene Wand zeigt, wie viel Material tatsächlich gefördert wurde. Der Fluss korrigiert genau diesen Faktor, ohne die Geometrie zu verändern.',
        patch: { flow: next },
      })
    }
  }

  // Schrumpfung aus gemessenen Außenmaßen.
  const measuredX = num(input.measuredX)
  const targetX = num(input.targetX)
  const measuredY = num(input.measuredY)
  const targetY = num(input.targetY)
  const nextX =
    measuredX !== null && targetX !== null
      ? shrinkageCorrection(current.shrinkage.x, targetX, measuredX)
      : null
  const nextY =
    measuredY !== null && targetY !== null
      ? shrinkageCorrection(current.shrinkage.y, targetY, measuredY)
      : null
  if (nextX !== null || nextY !== null) {
    const x = nextX ?? current.shrinkage.x
    const y = nextY ?? current.shrinkage.y
    if (Math.abs(x - current.shrinkage.x) >= 0.01 || Math.abs(y - current.shrinkage.y) >= 0.01) {
      out.push({
        id: 'shrinkage',
        label: 'Schrumpfung aus Außenmaß',
        before: `X ${pctFmt(current.shrinkage.x)} · Y ${pctFmt(current.shrinkage.y)}`,
        after: `X ${pctFmt(x)} · Y ${pctFmt(y)}`,
        formula: 'neu = alt + (Soll / Ist − 1) × 100',
        why: 'Der Ist-Wert enthält die bisherige Kompensation. Nur die Differenz zum Soll kommt hinzu — so wird ein bereits kalibriertes Profil nicht doppelt skaliert.',
        patch: { shrinkage: { ...current.shrinkage, x, y } },
      })
    }
  }

  // Elefantenfuß aus der Fußbreite.
  const foot = num(input.footWidth)
  const targetFoot = num(input.targetFootWidth)
  if (foot !== null && targetFoot !== null) {
    const inset = elephantFootInset(targetFoot, foot)
    if (inset !== null && Math.abs(inset) >= 0.01) {
      out.push({
        id: 'elephant-foot',
        label: 'Elefantenfuß aus Fußbreite',
        before: current.elephantFoot?.enabled ? `${fmt(current.elephantFoot.amount, 2)} mm Einzug` : 'aus',
        after: inset > 0 ? `${fmt(Math.abs(inset), 2)} mm Einzug` : 'Einzug aus',
        formula: `(${fmt(foot, 2)} − ${fmt(targetFoot, 2)}) / 2 = ${fmt(inset, 2)} mm`,
        why: 'Die erste Schicht wird durch den Anpressdruck breiter. Der Einzug wirkt pro Seite, deshalb wird die Differenz halbiert.',
        patch: {
          elephantFoot: {
            ...current.elephantFoot,
            enabled: inset >= 0.02,
            amount: Math.abs(inset),
          },
        },
      })
    }
  }

  // Pressure Advance aus dem abgelesenen Turmwert.
  const pa = num(input.pressureAdvance)
  if (pa !== null && Math.abs(pa - (current.pressureAdvance?.value ?? 0)) >= 0.001) {
    out.push({
      id: 'pressure-advance',
      label: 'Pressure Advance vom Turm',
      before: fmt(current.pressureAdvance?.value ?? 0),
      after: fmt(pa),
      formula: 'abgelesener Wert direkt übernehmen',
      why: 'PA gleicht den Druckaufbau im Hotend aus. Der Turm zeigt ihn am saubersten an Ecken und Kanten; ein Rechenwert würde nur raten.',
      patch: {
        pressureAdvance: { ...(current.pressureAdvance ?? { enabled: false, value: 0 }), enabled: true, value: pa },
        // Der Linientest würde den übernommenen Wert beim Slicen überschreiben.
        pressureAdvanceRamp: { enabled: false },
      },
    })
  }

  return out
}

/** Wendet alle Korrekturen in einem Schritt an. */
export function applyCalibrationCorrections(
  settings: PrintSettings,
  corrections: readonly CalibrationCorrection[],
): PrintSettings {
  return corrections.reduce((next, correction) => mergeSettings(next, correction.patch), settings)
}

export type CalibrationComparison = {
  key: keyof CalibrationValues
  label: string
  before: number
  after: number
  delta: number
  unit: string
  digits: number
}

const LABELS: Record<keyof CalibrationValues, { label: string; unit: string; digits: number }> = {
  flow: { label: 'Fluss', unit: '×', digits: 3 },
  pressureAdvance: { label: 'Pressure Advance', unit: '', digits: 3 },
  shrinkageX: { label: 'Schrumpfung X', unit: '%', digits: 2 },
  shrinkageY: { label: 'Schrumpfung Y', unit: '%', digits: 2 },
  elephantFoot: { label: 'Elefantenfuß', unit: 'mm', digits: 2 },
}

/** Vorher/Nachher-Tabelle einer abgelegten Version. */
export function compareCalibrationValues(
  before: CalibrationValues,
  after: CalibrationValues,
): CalibrationComparison[] {
  return (Object.keys(LABELS) as (keyof CalibrationValues)[]).map((key) => ({
    key,
    label: LABELS[key].label,
    unit: LABELS[key].unit,
    digits: LABELS[key].digits,
    before: before[key],
    after: after[key],
    delta: round3(after[key] - before[key]),
  }))
}
