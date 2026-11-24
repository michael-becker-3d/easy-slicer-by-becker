import assert from 'node:assert/strict'
import { planLayers } from '../server/slicer/layerPlan.ts'
import { makeMesh } from '../server/slicer/stl.ts'
import { sliceAtZ } from '../server/slicer/geom.ts'
import { DEFAULT_SETTINGS, mergeSettings } from '../shared/types.ts'

const quality = 0.1
const firstLayer = 0.2
// Bei 45° ist eine Höhe von quality / cos(45°) genau 0,1414 mm. Die
// Modellhöhe ist so gewählt, dass nach der festen ersten Schicht genau 30
// volle Lagen entstehen; so entsteht keine Restlage, die das Ergebnis
// verfälscht.
const slopeHeight = firstLayer + 30 * (quality / Math.cos(Math.PI / 4))
const slopeRun = slopeHeight
const slopeWidth = 10
assert.ok(Math.abs(slopeHeight / slopeRun - 1) < 1e-12, 'Testbedingung: Die Schräge muss 45° haben')

/** Dreieckiger Prismenquerschnitt in X/Z, entlang Y extrudiert. */
const vertices = [
  [0, 0, 0],
  [slopeRun, 0, 0],
  [0, 0, slopeHeight],
  [0, slopeWidth, 0],
  [slopeRun, slopeWidth, 0],
  [0, slopeWidth, slopeHeight],
]
const triangles = [
  [0, 1, 2],
  [3, 5, 4],
  [0, 3, 4], [0, 4, 1],
  [0, 2, 5], [0, 5, 3],
  [1, 2, 5], [1, 5, 4],
]
const mesh = makeMesh(new Float32Array(triangles.flatMap((tri) => tri.flatMap((index) => vertices[index]))))

const settings = mergeSettings(DEFAULT_SETTINGS, {
  layerHeight: 0.2,
  firstLayerHeight: firstLayer,
  adaptiveLayerHeight: {
    enabled: true,
    minHeight: 0.08,
    maxHeight: 0.28,
    quality,
  },
  walls: 1,
  topLayers: 1,
  bottomLayers: 1,
  infillDensity: 0,
  adhesion: 'none',
  support: { kind: 'none' },
  primeLine: { enabled: false },
  ironing: { enabled: false },
  fuzzySkin: { mode: 'off' },
})

const plan = planLayers(mesh, settings)
assert.equal(plan.bands.length, 31, `Es müssen 31 Lagen ohne Restlage entstehen, nicht ${plan.bands.length}`)
assert.deepEqual(plan.warnings, [], 'Der bekannte 45°-Test darf keine Restlagen-Warnung erzeugen')

// Die tatsächliche Treppenabweichung wird nicht aus der geplanten Höhe
// übernommen, sondern aus den geschnittenen Konturen an den Schichtoberkanten
// gemessen: Die horizontale Stufe dx erzeugt auf einer um α geneigten Fläche
// die senkrechte Abweichung dx · sin(α).
const slopeAngle = Math.atan2(slopeHeight, slopeRun)
const sinSlope = Math.sin(slopeAngle)
function maxXAt(z: number): number {
  const polys = sliceAtZ(mesh.positions, mesh.triangles, z)
  assert.ok(polys.length > 0, `Querschnitt bei Z=${z} fehlt`)
  let maxX = -Infinity
  for (const poly of polys) for (const point of poly) maxX = Math.max(maxX, point.x)
  assert.ok(Number.isFinite(maxX), `Querschnitt bei Z=${z} hat keine endliche Kontur`)
  return maxX
}
// Die erste Stufe beginnt an der Modellunterseite, nicht an der Oberkante
// einer vorherigen Schicht. So wird auch die feste erste Lage geometrisch
// gemessen, statt sie nur als Sonderfall zu deklarieren.
let previousMaxX = maxXAt(1e-4)
const errors: number[] = []
const slices: number[] = []
for (let index = 0; index < plan.bands.length; index++) {
  const band = plan.bands[index]
  const top = band.z + band.height / 2
  const maxX = maxXAt(top - 1e-4)
  slices.push(maxX)
  errors.push(Math.abs(previousMaxX - maxX) * sinSlope)
  previousMaxX = maxX
}

assert.equal(errors.length, plan.bands.length, 'Jede Schicht braucht eine gemessene Stufe')
assert.ok(errors.length >= 2, 'Der Geometrietest braucht mindestens zwei Stufen')

// Die erste Schicht ist absichtlich fest und darf die Zielabweichung
// überschreiten; ab Schicht 2 muss die tatsächliche Stufe am Ziel liegen.
const fixedFirstError = errors[0]
assert.ok(fixedFirstError > quality * 1.2, `Die feste erste Schicht muss von der Zielabweichung abweichen: ${fixedFirstError}`)
const measured = errors.slice(1)
const maxError = Math.max(...measured)
const minError = Math.min(...measured)
assert.ok(maxError <= quality * 1.02, `Tatsächliche Treppenabweichung zu groß: ${maxError} > ${quality}`)
assert.ok(minError >= quality * 0.98, `Tatsächliche Treppenabweichung zu klein: ${minError} < ${quality}`)
assert.ok(measured.every((error) => Math.abs(error - quality) < 0.002), 'Jede Lage muss die eingestellte Zielabweichung treffen')

assert.ok(!/\bNaN\b|Infinity/.test(JSON.stringify({ errors, slices })), 'Geometriemessung enthält ungültige Werte')

console.log(
  `OK: 45°-Geometrie; ${plan.bands.length} Lagen, feste erste Schicht ${fixedFirstError.toFixed(4)} mm, ` +
    `tatsächliche Treppenabweichung ${minError.toFixed(4)}–${maxError.toFixed(4)} mm bei Ziel ${quality.toFixed(4)} mm.`,
)