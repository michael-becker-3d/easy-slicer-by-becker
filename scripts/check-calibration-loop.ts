import assert from 'node:assert/strict'
import {
  applyCalibrationCorrections,
  calibrationCorrections,
  calibrationValues,
  compareCalibrationValues,
  shrinkageCorrection,
} from '../shared/calibrationLoop.ts'
import { DEFAULT_SETTINGS, mergeSettings } from '../shared/types.ts'

const settings = mergeSettings(DEFAULT_SETTINGS, {
  flow: 1,
  pressureAdvance: { enabled: false, value: 0.04 },
  shrinkage: { x: 2, y: 2, z: 0 },
  elephantFoot: { enabled: false, amount: 0.2, scope: 'outer-wall' },
})

// Fluss: 0,42 mm Soll bei 0,44 mm Messung → 1 × 0,42 / 0,44 = 0,955.
const flow = calibrationCorrections({ wallThickness: 0.44, targetWallWidth: 0.42 }, settings)
const flowCorrection = flow.find((correction) => correction.id === 'flow')
assert.ok(flowCorrection, 'Wandstärke muss eine Flusskorrektur ergeben')
assert.equal(flowCorrection.patch.flow, 0.955)
assert.match(flowCorrection.formula, /0,42 mm \/ 0,44 mm/)
assert.ok(flowCorrection.why.includes('gefördert'))

// Ohne Sollwert gilt die Standard-Wandbreite der Düse (0,42 mm).
const defaultTarget = calibrationCorrections({ wallThickness: 0.44 }, settings).find(
  (correction) => correction.id === 'flow',
)
assert.equal(defaultTarget?.patch.flow, 0.955)

// Unverändert oder ungültig: keine Korrektur.
assert.equal(
  calibrationCorrections({ wallThickness: 0.42, targetWallWidth: 0.42 }, settings).some(
    (correction) => correction.id === 'flow',
  ),
  false,
  'Passende Wand darf keine Korrektur erzeugen',
)
assert.equal(
  calibrationCorrections({ wallThickness: -1 }, settings).some((correction) => correction.id === 'flow'),
  false,
  'Negative Wandstärke darf keine Korrektur erzeugen',
)

// Schrumpfung: aktuell 2 %, Soll 20 mm, Ist 19,8 mm → +1,01 % auf 3,01 %.
assert.equal(shrinkageCorrection(2, 20, 19.8), 3.01)
assert.equal(shrinkageCorrection(2, 20, 20), 2)
assert.equal(shrinkageCorrection(2, 20, 0), null)
assert.equal(shrinkageCorrection(2, 0, 20), null)
const shrink = calibrationCorrections({ measuredX: 19.8, targetX: 20, measuredY: 20.2, targetY: 20 }, settings).find(
  (correction) => correction.id === 'shrinkage',
)
assert.ok(shrink, 'Außenmaße müssen eine Schrumpfkorrektur ergeben')
assert.deepEqual(shrink.patch.shrinkage, { x: 3.01, y: 1.01, z: 0 })
assert.match(shrink.why, /doppelt skaliert/)

// Elefantenfuß: 20,4 mm Fuß bei 20 mm Soll → 0,2 mm Einzug pro Seite.
const foot = calibrationCorrections({ footWidth: 20.4, targetFootWidth: 20 }, settings).find(
  (correction) => correction.id === 'elephant-foot',
)
assert.ok(foot, 'Fußbreite muss eine Elefantenfuß-Korrektur ergeben')
assert.equal(foot.patch.elephantFoot?.enabled, true)
assert.equal(foot.patch.elephantFoot?.amount, 0.2)

// Ein schmalerer Fuß schaltet den Einzug ab, statt ihn negativ zu speichern.
const narrowFoot = calibrationCorrections({ footWidth: 19.8, targetFootWidth: 20 }, settings).find(
  (correction) => correction.id === 'elephant-foot',
)
assert.equal(narrowFoot?.patch.elephantFoot?.enabled, false)
assert.equal(narrowFoot?.patch.elephantFoot?.amount, 0.1)

// Pressure Advance: übernommener Turmwert schaltet die Rampe ab.
const pa = calibrationCorrections({ pressureAdvance: 0.055 }, settings).find(
  (correction) => correction.id === 'pressure-advance',
)
assert.ok(pa, 'Abweichender PA-Wert muss eine Korrektur ergeben')
assert.equal(pa.patch.pressureAdvance?.enabled, true)
assert.equal(pa.patch.pressureAdvance?.value, 0.055)
assert.equal(pa.patch.pressureAdvanceRamp?.enabled, false)
assert.equal(
  calibrationCorrections({ pressureAdvance: 0.04 }, settings).some((correction) => correction.id === 'pressure-advance'),
  false,
  'Unveränderter PA-Wert darf keine Korrektur erzeugen',
)

// Anwenden: alle Korrekturen zusammen, ohne andere Werte zu verlieren.
const all = calibrationCorrections(
  {
    wallThickness: 0.44,
    measuredX: 19.8,
    targetX: 20,
    footWidth: 20.4,
    targetFootWidth: 20,
    pressureAdvance: 0.055,
  },
  settings,
)
assert.ok(all.length >= 4, `Es müssen mindestens vier Korrekturen entstehen (${all.length})`)
const next = applyCalibrationCorrections(settings, all)
assert.equal(next.flow, 0.955)
assert.equal(next.shrinkage.x, 3.01)
assert.equal(next.elephantFoot.amount, 0.2)
assert.equal(next.pressureAdvance.value, 0.055)
assert.equal(next.layerHeight, settings.layerHeight, 'Nicht gemessene Werte dürfen sich nicht ändern')
assert.equal(next.walls, settings.walls)
assert.notEqual(next, settings, 'Anwenden muss ein neues Objekt liefern')

// Versionen: Vorher/Nachher-Tabelle enthält alle fünf Werte inklusive Delta.
const before = calibrationValues(settings)
const after = calibrationValues(next)
assert.equal(before.flow, 1)
assert.equal(after.flow, 0.955)
const comparison = compareCalibrationValues(before, after)
assert.equal(comparison.length, 5, 'Die Vergleichstabelle muss fünf Werte haben')
for (const row of comparison) {
  assert.equal(row.delta, Math.round((row.after - row.before) * 1000) / 1000, `${row.key}: Delta ist falsch`)
  assert.ok(row.label.trim(), `${row.key}: Label fehlt`)
}
assert.equal(comparison.find((row) => row.key === 'flow')?.delta, -0.045)
assert.deepEqual(compareCalibrationValues(before, before).map((row) => row.delta), [0, 0, 0, 0, 0])

console.log(
  `OK: Fluss 1 → ${next.flow}; Schrumpfung X ${before.shrinkageX} → ${next.shrinkage.x} %; ` +
    `Elefantenfuß ${next.elephantFoot.amount} mm; PA ${next.pressureAdvance.value}; ` +
    `${all.length} Korrekturen, ${comparison.length} Vergleichswerte; unveränderte Werte bleiben.`,
)
