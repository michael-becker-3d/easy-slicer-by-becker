import type { BedMeshRecord } from './types.ts'

/**
 * Bett-Mesh-Verlauf (V-19).
 *
 * Der Slicer speichert bereits jede Messung. Hier wird daraus eine Bewertung:
 * Wie stark driftet das Bett, wächst die Wölbung, ist die letzte Messung zu alt
 * und taugt sie noch für den nächsten Auftrag? Die Schwellen sind bewusst
 * konservativ und als Konstanten exportiert, damit Tests sie nicht raten müssen.
 */
export const MESH_SPREAD_WARN = 0.8
/** Ab hier ist die Wölbung nicht mehr nur unangenehm, sondern kritisch. */
export const MESH_SPREAD_CRITICAL = 1.2
export const MESH_SPREAD_GROWTH_WARN = 0.2
export const MESH_STEP_WARN = 0.15
export const MESH_MEAN_DRIFT_WARN = 0.15
export const MESH_STALE_DAYS = 30

export type MeshTrendSeverity = 'critical' | 'warn' | 'info'

export type MeshTrendWarning = {
  id: string
  severity: MeshTrendSeverity
  title: string
  detail: string
}

export type MeshTrend = {
  count: number
  latest: BedMeshRecord | null
  oldest: BedMeshRecord | null
  meanDrift: number
  spreadNow: number
  spreadGrowth: number
  maxStep: number
  ageDays: number | null
  warnings: MeshTrendWarning[]
}

const round = (value: number) => Math.round(value * 1000) / 1000

/** Sortiert nach Messzeit; beschädigte Einträge ohne Raster werden verworfen. */
function usable(records: readonly BedMeshRecord[]): BedMeshRecord[] {
  return records
    .filter((record) => Array.isArray(record.z) && record.z.length > 0 && Number.isFinite(record.at))
    .slice()
    .sort((a, b) => a.at - b.at)
}

export function meshTrend(records: readonly BedMeshRecord[], now = Date.now()): MeshTrend {
  const list = usable(records)
  const empty: MeshTrend = {
    count: list.length,
    latest: list[list.length - 1] ?? null,
    oldest: list[0] ?? null,
    meanDrift: 0,
    spreadNow: 0,
    spreadGrowth: 0,
    maxStep: 0,
    ageDays: null,
    warnings: [],
  }
  if (!list.length) {
    return {
      ...empty,
      warnings: [
        {
          id: 'no-mesh',
          severity: 'info',
          title: 'Noch keine Bettmessung',
          detail: 'Ohne Messung kann der Slicer keine Unebenheiten ausgleichen. Einmal vermessen, dann ist der Verlauf die Grundlage für die Driftkontrolle.',
        },
      ],
    }
  }

  const latest = list[list.length - 1]
  const oldest = list[0]
  const meanDrift = round(latest.mean - oldest.mean)
  const spreadNow = round(latest.spread)
  const spreadGrowth = round(latest.spread - oldest.spread)
  let maxStep = 0
  for (let i = 1; i < list.length; i++) {
    maxStep = Math.max(maxStep, Math.abs(list[i].mean - list[i - 1].mean))
  }
  maxStep = round(maxStep)
  const ageDays =
    latest.at > 0 ? Math.max(0, Math.floor((now - latest.at) / 86_400_000)) : null

  const warnings: MeshTrendWarning[] = []

  if (spreadNow >= MESH_SPREAD_WARN) {
    warnings.push({
      id: 'spread',
      severity: spreadNow >= MESH_SPREAD_CRITICAL ? 'critical' : 'warn',
      title: 'Bett wölbt sich stark',
      detail: `Die aktuelle Messung streut ${spreadNow.toFixed(2).replace('.', ',')} mm. Über ${MESH_SPREAD_WARN.toFixed(2).replace('.', ',')} mm gleicht die Software zwar aus, aber die erste Schicht wird oben zu dünn und unten zu dick. Platte prüfen, reinigen und neu vermessen.`,
    })
  }

  if (list.length >= 2 && Math.abs(spreadGrowth) >= MESH_SPREAD_GROWTH_WARN) {
    warnings.push({
      id: 'spread-growth',
      severity: 'warn',
      title: spreadGrowth > 0 ? 'Wölbung nimmt zu' : 'Wölbung hat abgenommen',
      detail: `Die Streuung ist seit der ersten Messung um ${Math.abs(spreadGrowth).toFixed(2).replace('.', ',')} mm ${spreadGrowth > 0 ? 'gewachsen' : 'gesunken'}. ${spreadGrowth > 0 ? 'Das deutet auf eine verzogene Platte, lose Auflage oder Temperaturdrift hin.' : 'Die Platte liegt jetzt gleichmäßiger — der alte Messwert war vermutlich die Ausnahme.'}`,
    })
  }

  if (maxStep >= MESH_STEP_WARN) {
    warnings.push({
      id: 'step',
      severity: 'warn',
      title: 'Sprung zwischen zwei Messungen',
      detail: `Zwischen zwei aufeinanderfolgenden Messungen liegt ein Sprung von ${maxStep.toFixed(2).replace('.', ',')} mm. Ein einzelner Sprung ist meist eine verrutschte Platte oder eine Messung mit heißem Bett; erst der nächste Lauf zeigt, ob es Drift ist.`,
    })
  }

  if (Math.abs(meanDrift) >= MESH_MEAN_DRIFT_WARN) {
    warnings.push({
      id: 'mean-drift',
      severity: 'warn',
      title: 'Mittelwert wandert',
      detail: `Der Mittelwert hat sich um ${meanDrift >= 0 ? '+' : ''}${meanDrift.toFixed(2).replace('.', ',')} mm verschoben. Das verschiebt die ganze erste Schicht; Z-Offset und Mesh gehören zusammen neu eingestellt.`,
    })
  }

  if (ageDays !== null && ageDays > MESH_STALE_DAYS) {
    warnings.push({
      id: 'stale',
      severity: 'info',
      title: 'Messung ist alt',
      detail: `Die letzte Messung ist ${ageDays} Tage alt. Nach einem Plattenwechsel, Umbau oder längerer Standzeit ist sie keine verlässliche Grundlage mehr.`,
    })
  }

  if (list.length === 1) {
    warnings.push({
      id: 'baseline',
      severity: 'info',
      title: 'Erst eine Messung',
      detail: 'Eine einzelne Messung zeigt den Zustand, aber keine Drift. Ab der zweiten Messung erkennt der Verlauf Veränderungen.',
    })
  }

  return { count: list.length, latest, oldest, meanDrift, spreadNow, spreadGrowth, maxStep, ageDays, warnings }
}

/**
 * Kurzer Satz für die Slice-Warnungen: reicht das gespeicherte Mesh noch für
 * diesen Auftrag? Wird beim Slicen zugeschaltet, damit eine alte oder stark
 * gewölbte Messung nicht unbemerkt in den G-Code wandert.
 */
export function meshJobWarning(records: readonly BedMeshRecord[], now = Date.now()): string | null {
  const trend = meshTrend(records, now)
  if (!trend.latest) return null
  if (trend.spreadNow >= MESH_SPREAD_WARN) {
    return `Bett-Mesh streut ${trend.spreadNow.toFixed(2).replace('.', ',')} mm — Platte prüfen und vor dem Auftrag neu vermessen.`
  }
  if (trend.ageDays !== null && trend.ageDays > MESH_STALE_DAYS) {
    return `Bett-Mesh ist ${trend.ageDays} Tage alt — nach Plattenwechsel oder Umbau neu messen, sonst gleicht der G-Code einen alten Zustand aus.`
  }
  if (trend.maxStep >= MESH_STEP_WARN) {
    return `Bett-Mesh hat zwischen zwei Messungen ${trend.maxStep.toFixed(2).replace('.', ',')} mm Sprung — aktuelle Messung vor dem Auftrag prüfen.`
  }
  return null
}
