import assert from 'node:assert/strict'
import { buildCalibration } from '../server/calibration.ts'
import { parseSTL } from '../server/slicer/stl.ts'
import { sliceMesh } from '../server/slicer/index.ts'
import { applyPrinterLimits } from '../shared/limits.ts'
import { DEFAULT_SETTINGS, mergeSettings } from '../shared/types.ts'
import { filamentById, printerById } from '../shared/catalog.ts'
import { calibrationSliceSettings } from '../src/calibrationSettings.ts'

const printer = printerById('flashforge-ad5x')
const filament = filamentById('pla')
const bundle = buildCalibration('flow-cube', printer, filament, DEFAULT_SETTINGS)
assert.ok(bundle, 'Flowwürfel-Kalibrierbundle fehlt')

const normal = applyPrinterLimits(
  printer,
  mergeSettings(DEFAULT_SETTINGS, {
    primeLine: { ...DEFAULT_SETTINGS.primeLine, enabled: false },
    ironing: { ...DEFAULT_SETTINGS.ironing, enabled: false },
  }),
)

// Der laufende Test hat seine Pflichtwerte; anschließend wird die Wandzahl
// absichtlich auf 0 gesetzt — genau der Zustand, der A-94 ausgelöst hat.
const testBase = mergeSettings(normal, bundle.tool.settingsPatch)
const broken = mergeSettings(testBase, { walls: 0 })
assert.equal(broken.walls, 0, 'Testbedingung: Wandzahl muss auf 0 stehen')

function slice(settings: typeof broken) {
  return sliceMesh(parseSTL(bundle.stl), applyPrinterLimits(printer, settings), printer, null, bundle.overrides, {
    start: false,
    end: false,
    metadata: false,
  })
}

// Ohne erneut angewendeten Pflicht-Patch bleibt ab Schicht 2 nur der Brim
// übrig. Das stellt sicher, dass der Test den ursprünglichen Fehler abdeckt.
const withoutPatch = slice(broken)
const emptyWithoutPatch = withoutPatch.layers.filter((layer) => layer.data.length === 0)
assert.ok(
  emptyWithoutPatch.length > 0,
  'Testbedingung: Ohne Patch müssen leere Schichten entstehen',
)

// doSlice() wendet den Pflicht-Patch vor dem Slicen erneut an. Danach muss
// wieder eine Wand vorhanden sein und keine Schicht leer bleiben.
const patched = calibrationSliceSettings(broken, bundle.tool)
assert.equal(patched.walls, 1, 'Pflicht-Patch hat die Wandzahl nicht wiederhergestellt')
assert.equal(patched.topLayers, 0)
assert.equal(patched.bottomLayers, 0)
assert.equal(patched.infillDensity, 0)
const sliced = slice(patched)
const empty = sliced.layers.filter((layer) => layer.data.length === 0)
assert.ok(sliced.layers.length > 60, `Flowwürfel hat nur ${sliced.layers.length} Schichten`)
assert.equal(empty.length, 0, `Flowwürfel hat ${empty.length} leere Schichten`)
assert.ok(
  sliced.layers.slice(1).every((layer) => layer.data.length > 0),
  'Nach dem Pflicht-Patch fehlen Bahndaten in einzelnen Schichten',
)

console.log(
  `OK: Kalibrier-Patch bei Wand 0 wieder angewendet; ${sliced.layers.length} Schichten, keine leeren Schichten ` +
    `(ohne Patch: ${emptyWithoutPatch.length} leer).`,
)