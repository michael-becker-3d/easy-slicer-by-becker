import assert from 'node:assert/strict'
import {
  meshJobWarning,
  meshTrend,
  MESH_MEAN_DRIFT_WARN,
  MESH_SPREAD_WARN,
  MESH_STALE_DAYS,
  MESH_STEP_WARN,
} from '../shared/meshTrend.ts'
import type { BedMeshRecord } from '../shared/types.ts'

const DAY = 86_400_000
const now = Date.UTC(2026, 10, 21, 12)

function record(mean: number, spread: number, at: number, rows = 3, cols = 3): BedMeshRecord {
  const z = Array.from({ length: rows }, () => Array.from({ length: cols }, () => mean))
  z[0][0] = mean + spread / 2
  z[rows - 1][cols - 1] = mean - spread / 2
  const flat = z.flat()
  return {
    at,
    rows,
    cols,
    min: Math.min(...flat),
    max: Math.max(...flat),
    mean,
    spread,
    source: 'simulation',
    z,
  }
}

// Ohne Messung: ein Hinweis, kein Job-Warnhinweis.
const empty = meshTrend([], now)
assert.equal(empty.count, 0)
assert.equal(empty.latest, null)
assert.equal(empty.warnings[0]?.id, 'no-mesh')
assert.equal(meshJobWarning([], now), null)

// Eine junge, saubere Messung: nur der Baseline-Hinweis.
const single = meshTrend([record(0.02, 0.2, now - DAY)], now)
assert.equal(single.count, 1)
assert.equal(single.ageDays, 1)
assert.ok(single.warnings.some((warning) => warning.id === 'baseline'))
assert.equal(single.warnings.some((warning) => warning.severity !== 'info'), false)
assert.equal(meshJobWarning([record(0.02, 0.2, now - DAY)], now), null)

// Starke Wölbung: ab 1,2 mm kritisch, und der Job-Hinweis muss kommen.
const warped = meshTrend([record(0, 0.2, now - 10 * DAY), record(0, MESH_SPREAD_WARN * 1.5, now - DAY)], now)
const spread = warped.warnings.find((warning) => warning.id === 'spread')
assert.ok(spread, 'Starke Wölbung muss gemeldet werden')
assert.equal(spread.severity, 'critical')
assert.ok(spread.detail.includes('1,20'), `Streuung muss im Text stehen: ${spread.detail}`)
assert.match(meshJobWarning([record(0, 1.3, now - DAY)], now) ?? '', /streut 1,30 mm/)

// Wachsende Wölbung: die Streuung nimmt um 0,3 mm zu.
const growing = meshTrend([record(0, 0.2, now - 4 * DAY), record(0, 0.5, now - DAY)], now)
assert.ok(growing.warnings.some((warning) => warning.id === 'spread-growth'), 'Wachsende Streuung fehlt')
assert.ok(
  growing.warnings.some((warning) => warning.id === 'spread-growth' && warning.detail.includes('gewachsen')),
)

// Sprung und Mittelwertdrift zwischen zwei Messungen.
const step = meshTrend(
  [record(0, 0.2, now - 3 * DAY), record(MESH_STEP_WARN + 0.05, 0.2, now - DAY)],
  now,
)
assert.ok(step.warnings.some((warning) => warning.id === 'step'), 'Sprung zwischen Messungen fehlt')
assert.ok(step.warnings.some((warning) => warning.id === 'mean-drift'), 'Mittelwertdrift fehlt')
assert.ok(step.maxStep >= MESH_STEP_WARN)
assert.ok(step.meanDrift >= MESH_MEAN_DRIFT_WARN)
assert.match(meshJobWarning([record(0, 0.2, now - 3 * DAY), record(0.3, 0.2, now - DAY)], now) ?? '', /Sprung/)

// Alte Messung: Hinweis und Job-Warnung.
const stale = meshTrend([record(0, 0.2, now - (MESH_STALE_DAYS + 5) * DAY)], now)
assert.equal(stale.ageDays, MESH_STALE_DAYS + 5)
assert.ok(stale.warnings.some((warning) => warning.id === 'stale'), 'Alte Messung fehlt')
assert.match(meshJobWarning([record(0, 0.2, now - (MESH_STALE_DAYS + 5) * DAY)], now) ?? '', /Tage alt/)

// Unsortierte Eingabe wird nach Zeit sortiert; beschädigte Einträge fallen raus.
const unordered = meshTrend(
  [record(0.5, 0.2, now - DAY), record(0, 0.2, now - 9 * DAY), { ...record(0, 1, now), z: [] }],
  now,
)
assert.equal(unordered.count, 2)
assert.equal(unordered.latest?.mean, 0.5)
assert.equal(unordered.oldest?.mean, 0)
assert.equal(unordered.meanDrift, 0.5)

// Rückgang der Streuung wird als eigener Hinweis formuliert.
const improved = meshTrend([record(0, 0.7, now - 5 * DAY), record(0, 0.3, now - DAY)], now)
assert.ok(
  improved.warnings.some((warning) => warning.id === 'spread-growth' && warning.detail.includes('gesunken')),
  'Abnehmende Streuung muss als Verbesserung erklärt werden',
)
assert.equal(
  meshJobWarning([record(0, 0.7, now - 5 * DAY), record(0, 0.3, now - DAY)], now),
  null,
  'Eine verbesserte Streuung darf den Auftrag nicht blockieren',
)

console.log(
  `OK: Mesh-Verlauf prüft leer/einzeln/wölbt/wächst/Sprung/alt/unordentlich; ` +
    `Job-Warnung bei ${MESH_SPREAD_WARN} mm Streuung und ${MESH_STALE_DAYS} Tagen Alter; ` +
    `Drift ${unordered.meanDrift.toFixed(3)} mm, Sprung ${step.maxStep.toFixed(3)} mm.`,
)
