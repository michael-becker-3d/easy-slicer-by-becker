import assert from 'node:assert/strict'
import { buildCalibration } from '../server/calibration.ts'
import { CALIBRATION_MODELS, loadCalibrationModel, modelBandLevels } from '../server/calibrationModels.ts'
import { parseSTL } from '../server/slicer/stl.ts'
import { DEFAULT_SETTINGS } from '../shared/types.ts'
import { filamentById, printerById } from '../shared/catalog.ts'

const printer = printerById('flashforge-ad5x')
const filament = filamentById('pla')

/** Erwartete Stufen je Modell: Höhe aus dem STL, Werte aus der Voreinstellung. */
const SWEEPS: {
  id: string
  bands: number
  bandHeight: number
  startZ: number
  values: number[]
  field: 'expectedTemperature' | 'expectedFlow'
  /** Temperaturtests setzen die erste Stufe über den Patch, nicht über einen Override. */
  firstOverrideAtZero: boolean
}[] = [
  {
    id: 'temp-tower',
    bands: 6,
    bandHeight: 8,
    startZ: 0,
    values: [210, 205, 200, 195, 190, 185],
    field: 'expectedTemperature',
    firstOverrideAtZero: false,
  },
  {
    id: 'max-flow',
    bands: 7,
    bandHeight: 5,
    startZ: 0,
    values: [4, 6, 8, 10, 12, 14, 16],
    field: 'expectedFlow',
    firstOverrideAtZero: true,
  },
]

// 1) Jedes Modell lädt aus dem Projekt und hat die erwarteten Maße.
for (const [id, model] of Object.entries(CALIBRATION_MODELS)) {
  const stl = loadCalibrationModel(id)
  assert.ok(stl.length > 84, `${id}: STL ist leer`)
  const mesh = parseSTL(stl)
  assert.ok(mesh.triangles > 0, `${id}: STL enthält keine Dreiecke`)
  const { size } = mesh.bbox
  for (const axis of ['x', 'y', 'z'] as const) {
    assert.ok(
      Math.abs(size[axis] - model.size[axis]) < 0.2,
      `${id}: ${axis}-Maß ${size[axis].toFixed(2)} mm weicht von ${model.size[axis]} mm ab`,
    )
  }
  assert.ok(mesh.bbox.min.z > -0.01 && mesh.bbox.min.z < 0.01, `${id}: Modell steht nicht auf Z=0`)
}

// 2) Die Bänder liegen auf vollen Millimetern und decken die Modellhöhe ab.
for (const [id, model] of Object.entries(CALIBRATION_MODELS)) {
  const levels = modelBandLevels(model)
  const bands = model.bands ?? 0
  assert.equal(levels.length, bands, `${id}: Bandzahl stimmt nicht`)
  if (!bands) continue
  for (let index = 0; index < levels.length; index++) {
    assert.equal(levels[index], (model.bandStartZ ?? 0) + index * model.bandHeight!, `${id}: Band ${index + 1} liegt falsch`)
  }
  const top = levels[levels.length - 1] + (model.bandHeight ?? 0)
  assert.ok(top <= model.size.z + 0.01, `${id}: Bänder reichen über das Modell hinaus (${top} mm)`)
}

// 3) Alle sieben Tests entstehen aus dem STL, mit passender Schichtzahl.
for (const id of Object.keys(CALIBRATION_MODELS)) {
  const bundle = buildCalibration(id, printer, filament, DEFAULT_SETTINGS)
  assert.ok(bundle, `${id}: buildCalibration liefert kein Bundle`)
  const mesh = parseSTL(bundle.stl)
  const expectedLayers = Math.max(1, Math.round(mesh.bbox.size.z / 0.2))
  assert.equal(bundle.tool.plannedLayers, expectedLayers, `${id}: geplante Schichtzahl passt nicht zur Modellhöhe`)
  assert.ok(bundle.tool.description.includes(CALIBRATION_MODELS[id].modelName), `${id}: Beschreibung nennt das Modell nicht`)
  // Kein Test-Patch darf die Profilgeschwindigkeit überschreiben.
  assert.equal(
    (bundle.tool.settingsPatch as { speeds?: unknown }).speeds,
    undefined,
    `${id}: Test-Patch überschreibt die Profilgeschwindigkeit`,
  )
}

// 4) Werte-Sweeps: Stufen, Z-Höhen und G-code-Befehle.
for (const sweep of SWEEPS) {
  const bundle = buildCalibration(sweep.id, printer, filament, DEFAULT_SETTINGS)!
  assert.equal(bundle.tool.steps.length, sweep.bands, `${sweep.id}: falsche Stufenzahl`)
  sweep.values.forEach((value, index) => {
    const step = bundle.tool.steps[index]
    const z = sweep.startZ + index * sweep.bandHeight
    assert.equal(step.atZ, z, `${sweep.id}: Stufe ${index + 1} beginnt bei ${step.atZ} statt ${z} mm`)
    assert.equal(step[sweep.field], value, `${sweep.id}: Stufe ${index + 1} hat nicht ${value}`)
  })
  const switches = bundle.overrides.filter((override) => override.atZ > 0)
  assert.equal(switches.length, sweep.bands - 1, `${sweep.id}: Stufenwechsel fehlen`)
  switches.forEach((override, index) => {
    const z = sweep.startZ + (index + 1) * sweep.bandHeight
    assert.ok(
      Math.abs(override.atZ - (z + 0.0001)) < 1e-6,
      `${sweep.id}: Wechsel ${index + 1} liegt bei ${override.atZ} statt ${z + 0.0001} mm`,
    )
  })
  if (sweep.firstOverrideAtZero) {
    assert.equal(bundle.overrides[0]?.atZ, 0, `${sweep.id}: erster Override muss auf Z=0 liegen`)
  }
}

// 5) PA-Blade und Needle-Grid: Werte und Firmware-Befehle.
const pa = buildCalibration('pressure-advance', printer, filament, DEFAULT_SETTINGS)!
assert.equal(pa.tool.steps.length, 10, 'PA-Blade braucht zehn Stufen')
assert.deepEqual(
  pa.tool.steps.map((step) => step.value),
  ['PA 0.020', 'PA 0.030', 'PA 0.040', 'PA 0.050', 'PA 0.060', 'PA 0.070', 'PA 0.080', 'PA 0.090', 'PA 0.100', 'PA 0.110'],
  'PA-Blade: Voreinstellung ist nicht 0,02–0,11 in 0,01er-Schritten',
)
assert.ok(pa.overrides.some((override) => override.lines?.some((line) => /^(M900 K|SET_PRESSURE_ADVANCE)/.test(line))), 'PA-Blade: Firmware-Befehl fehlt')

const retract = buildCalibration('retract-tower', printer, filament, DEFAULT_SETTINGS)!
assert.equal(retract.tool.steps.length, 5, 'Needle-Grid braucht fünf Stufen')
assert.deepEqual(
  retract.tool.steps.map((step) => step.atZ),
  [2, 9, 16, 23, 30],
  'Needle-Grid: Stufen liegen nicht auf 2/9/16/23/30 mm',
)
assert.equal(
  retract.overrides.filter((override) => override.lines?.some((line) => line.startsWith('; Retract'))).length,
  5,
  'Needle-Grid: Retract-Werte fehlen',
)

const shaper = buildCalibration('input-shaper', printer, filament, DEFAULT_SETTINGS)!
assert.equal(shaper.tool.steps.length, 5, 'Resonance-Fin braucht fünf Stufen')
assert.deepEqual(
  shaper.tool.steps.map((step) => step.atZ),
  [0, 9, 18, 27, 36],
  'Resonance-Fin: Stufen liegen nicht auf 0/9/18/27/36 mm',
)

// 6) Feste Modelle ohne Werte-Sweep erzeugen trotzdem ein Modell.
for (const id of ['overhang', 'fit-coupon']) {
  const bundle = buildCalibration(id, printer, filament, DEFAULT_SETTINGS)!
  assert.equal(bundle.tool.steps.length, 0, `${id}: festes Modell darf keine Werte-Stufen haben`)
  assert.equal(bundle.overrides.length, 0, `${id}: festes Modell darf keine Overrides haben`)
}

// 7) Falsche Stufenzahl wird verständlich abgelehnt statt still gekürzt.
assert.throws(
  () => buildCalibration('temp-tower', printer, filament, DEFAULT_SETTINGS, { tempFrom: 210, tempTo: 190, tempStep: 5 }),
  /Thermal-Cell hat 6 feste Stufen/,
  'Thermal-Cell: falsche Stufenzahl wird nicht abgelehnt',
)
assert.throws(
  () => buildCalibration('max-flow', printer, filament, DEFAULT_SETTINGS, { flowFrom: 4, flowTo: 14, flowStep: 2 }),
  /Max-Flow-Core hat 7 feste Stufen/,
  'Max-Flow-Core: falsche Stufenzahl wird nicht abgelehnt',
)
assert.throws(
  () => buildCalibration('pressure-advance', printer, filament, DEFAULT_SETTINGS, { paFrom: 0, paTo: 0.05, paStep: 0.01 }),
  /PA-Blade hat 10 feste Stufen/,
  'PA-Blade: falsche Stufenzahl wird nicht abgelehnt',
)

console.log('OK: Kalibrier-Modelle geprüft')
console.log(`  ${Object.keys(CALIBRATION_MODELS).length} STL-Modelle laden, Maße und Z=0 stimmen`)
console.log('  Bänder: Thermal-Cell 6 × 8 mm, Max-Flow-Core 7 × 5 mm, PA-Blade 10 × 4 mm')
console.log('  Bänder: Needle-Grid 5 × 7 mm ab z 2, Resonance-Fin 5 × 9 mm')
console.log('  Overhang-Array und Mech-Clutch sind feste Formtests ohne Werte-Sweep')
console.log('  Falsche Von/Bis/Schritt-Zahl wird mit klarer Meldung abgelehnt')
