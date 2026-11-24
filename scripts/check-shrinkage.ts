import assert from 'node:assert/strict'
import { demoSTL } from '../server/demo.ts'
import { parseSTL } from '../server/slicer/stl.ts'
import { sliceMesh } from '../server/slicer/index.ts'
import { printerById } from '../shared/catalog.ts'
import { DEFAULT_SETTINGS, mergeSettings, PREVIEW_STRIDE } from '../shared/types.ts'
import { PREVIEW_KIND_CODE } from '../shared/preview.ts'
import {
  easyShrinkToOrca,
  orcaShrinkToEasy,
  scaledLength,
  shrinkageFromMeasurement,
} from '../shared/shrinkage.ts'

const close = (actual: number, expected: number, tolerance = 1e-5) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`)

// Easy/Orca-Konventionen: Easy 0 % = aus, 1 % = ×1,01; Orca 100 % = aus,
// 99 % = ×0,99. Die Umrechnung muss proportional sein, nicht additiv.
assert.equal(orcaShrinkToEasy(100), 0)
close(orcaShrinkToEasy(99) ?? NaN, 1.010101)
assert.equal(orcaShrinkToEasy(0), null)
assert.equal(orcaShrinkToEasy(null), null)
assert.equal(easyShrinkToOrca(0), 100)
close(easyShrinkToOrca(1), 99.009901)
for (const easy of [0, 0.4, 1, 2.3, -1]) {
  const orca = easyShrinkToOrca(easy)
  close(orcaShrinkToEasy(orca) ?? NaN, easy)
}

// Messwert-Rechner: 100 mm Soll, 99,2 mm Ist → 0,8065 %.
assert.equal(shrinkageFromMeasurement(100, 99.2), 0.8065)
assert.equal(shrinkageFromMeasurement(100, 100), 0)
assert.equal(shrinkageFromMeasurement(0, 99.2), null)
assert.equal(shrinkageFromMeasurement(100, 0), null)
close(scaledLength(100, 0.8), 100.8)

// Der Slicer muss das Mesh tatsächlich skalieren. Ein 20-mm-Würfel wird bei
// X/Y = 1 % um rund 0,2 mm breiter; der Vergleich läuft über zwei echte
// Slice-Ergebnisse, nicht nur über die Formel.
const cube = parseSTL(demoSTL('wuerfel')!)
const profile = printerById('anycubic-vyper')
const base = mergeSettings(DEFAULT_SETTINGS, {
  layerHeight: 0.2,
  firstLayerHeight: 0.2,
  walls: 1,
  topLayers: 0,
  bottomLayers: 0,
  infillDensity: 0,
  adhesion: 'none',
  primeLine: { enabled: false },
  output: { objectLabels: false },
})

function widthAt(result: ReturnType<typeof sliceMesh>): number {
  const layer = result.layers[Math.min(4, result.layers.length - 1)]
  assert.ok(layer, 'Slice hat keine Schicht geliefert')
  let minX = Infinity
  let maxX = -Infinity
  for (let i = 0; i + PREVIEW_STRIDE <= layer.data.length; i += PREVIEW_STRIDE) {
    if (layer.data[i] === PREVIEW_KIND_CODE.travel) continue
    minX = Math.min(minX, layer.data[i + 1], layer.data[i + 3])
    maxX = Math.max(maxX, layer.data[i + 1], layer.data[i + 3])
  }
  assert.ok(Number.isFinite(minX) && Number.isFinite(maxX), 'Keine Extrusionsbahn in der Schicht')
  return maxX - minX
}

const normal = sliceMesh(
  cube,
  mergeSettings(base, { shrinkage: { x: 0, y: 0, z: 0 } }),
  profile,
  null,
  [],
  { start: true, metadata: false },
)
const enlarged = sliceMesh(
  cube,
  mergeSettings(base, { shrinkage: { x: 1, y: 1, z: 0 } }),
  profile,
  null,
  [],
  { start: true, metadata: false },
)
const normalWidth = widthAt(normal)
const enlargedWidth = widthAt(enlarged)
close(enlargedWidth - normalWidth, 0.196, 0.03)

console.log(
  `OK: Schrumpfung 100 % → 0 %, 99 % → ${orcaShrinkToEasy(99)?.toFixed(4)} %, ` +
    `1 % → ${easyShrinkToOrca(1).toFixed(4)} %; 100/99,2 mm → ${shrinkageFromMeasurement(100, 99.2)} %; ` +
    `20-mm-Würfel bei 1 %: ${normalWidth.toFixed(3)} → ${enlargedWidth.toFixed(3)} mm.`,
)