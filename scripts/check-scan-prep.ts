import assert from 'node:assert/strict'
import { countComponents, countOpenEdges, hollowSolid } from '../server/csg.ts'
import { makeMesh } from '../server/slicer/stl.ts'
import {
  assessScan,
  drainOffsets,
  planHollow,
  planScale,
  scanSummary,
} from '../shared/scanPrep.ts'

// ---------- Bewertung ----------
const clean = assessScan({
  triangles: 48_000,
  size: { x: 100, y: 50, z: 80 },
  openEdges: 0,
  components: 1,
})
assert.equal(clean.length, 1)
assert.equal(clean[0].severity, 'ok')
assert.match(scanSummary(clean), /druckbereit/)

const broken = assessScan(
  {
    triangles: 640_000,
    size: { x: 5, y: 4, z: 3 },
    openEdges: 220,
    components: 3,
  },
  { x: 220, y: 220, z: 250 },
)
assert.equal(broken[0].id, 'open-edges')
assert.equal(broken[0].severity, 'critical')
assert.ok(broken.some((f) => f.id === 'components' && f.severity === 'warn'))
assert.ok(broken.some((f) => f.id === 'triangles' && f.severity === 'hint'))
assert.ok(broken.some((f) => f.id === 'scale' && f.severity === 'hint'))
assert.match(scanSummary(broken), /kritisch/)
for (const finding of broken) {
  assert.ok(finding.title && finding.detail && finding.why, `Befund ${finding.id} muss erklärt sein`)
}

const offBed = assessScan(
  { triangles: 1000, size: { x: 300, y: 50, z: 20 }, openEdges: 0, components: 1 },
  { x: 220, y: 220, z: 250 },
)
assert.ok(offBed.some((f) => f.id === 'bed' && f.severity === 'critical'))
assert.ok(assessScan({ triangles: 100, size: { x: 5, y: 5, z: 5 }, openEdges: 3, components: 1 })[0].severity === 'warn')

// ---------- Maßstab ----------
const longest = planScale({ x: 50, y: 100, z: 80 }, 200)
assert.ok(longest)
assert.equal(longest.factor, 2)
assert.deepEqual(longest.newSize, { x: 100, y: 200, z: 160 })
assert.equal(longest.feasible, true)

const zAxis = planScale({ x: 50, y: 100, z: 80 }, 40, 'z')
assert.ok(zAxis)
assert.equal(zAxis.factor, 0.5)
assert.equal(zAxis.newSize.z, 40)

assert.equal(planScale({ x: 10, y: 10, z: 10 }, 0), null)
assert.equal(planScale({ x: 10, y: 10, z: 10 }, Number.NaN), null)
assert.equal(planScale({ x: 0, y: 0, z: 0 }, 50), null)

const tooLarge = planScale({ x: 10, y: 10, z: 10 }, 500)
assert.ok(tooLarge)
assert.equal(tooLarge.feasible, false)
assert.ok(tooLarge.warnings.some((w) => w.includes('außerhalb')))

const overBed = planScale({ x: 100, y: 100, z: 100 }, 300, 'longest', { x: 220, y: 220, z: 250 })
assert.ok(overBed?.warnings.some((w) => w.includes('Bett')))

// ---------- Aushöhl-Plan ----------
const normal = planHollow({ x: 100, y: 60, z: 80 }, { wall: 2, drainHoles: 2, drainDiameter: 3 }, 40_000)
assert.equal(normal.wall, 2)
assert.equal(normal.drainHoles, 2)
assert.equal(normal.drainDiameter, 3)
assert.equal(normal.detail, 0.2)
assert.equal(normal.feasible, true)
assert.equal(normal.drains.length, 2)
assert.equal(normal.drains[0].y, 0)

const clamped = planHollow({ x: 100, y: 100, z: 100 }, { wall: 0.2, drainHoles: 99, drainDiameter: 0.2 })
assert.equal(clamped.wall, 0.8)
assert.equal(clamped.drainHoles, 6)
assert.equal(clamped.drainDiameter, 1.5)

const tiny = planHollow({ x: 3, y: 3, z: 3 }, { wall: 2, drainHoles: 1, drainDiameter: 3 })
assert.equal(tiny.feasible, false)
assert.ok(tiny.warnings.some((w) => w.includes('kein Hohlraum')))

assert.equal(planHollow({ x: 50, y: 50, z: 50 }, { detail: 0.14 }).detail, 0.1)
assert.equal(planHollow({ x: 50, y: 50, z: 50 }, { detail: 0.34 }).detail, 0.4)
assert.equal(planHollow({ x: 50, y: 50, z: 50 }, { detail: 0.4 }, 5000).duration, 'kurz')
assert.equal(planHollow({ x: 50, y: 50, z: 50 }, { detail: 0.1 }, 400_000).duration, 'lang')

assert.deepEqual(drainOffsets({ x: 100, y: 50, z: 50 }, 0, 3), [])
const three = drainOffsets({ x: 100, y: 50, z: 50 }, 3, 3)
assert.equal(three.length, 3)
assert.ok(three.every((point) => Math.abs(point.x) <= 50 && point.y === 0))
assert.ok(three[0].x < three[1].x && three[1].x < three[2].x)
assert.deepEqual(drainOffsets({ x: 3, y: 50, z: 50 }, 2, 3), [{ x: 0, y: 0 }])

// ---------- Echtes Aushöhlen ----------
function cube(size: number) {
  const h = size / 2
  const v = [
    [-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h],
    [-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h],
  ]
  const faces = [
    [0, 2, 1], [0, 3, 2],
    [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4],
    [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6],
    [3, 0, 4], [3, 4, 7],
  ]
  const positions: number[] = []
  for (const face of faces) for (const index of face) positions.push(...v[index])
  return makeMesh(new Float32Array(positions), false)
}

const solid = cube(40)
assert.equal(countComponents(solid), 1)
assert.equal(countOpenEdges(solid), 0)
const two: number[] = []
two.push(...solid.positions)
for (let i = 0; i < solid.positions.length; i += 3) {
  two.push(solid.positions[i] + 60, solid.positions[i + 1], solid.positions[i + 2])
}
assert.equal(countComponents(makeMesh(new Float32Array(two), false)), 2)

const hollow = await hollowSolid(solid, { wall: 2, drainHoles: 2, drainDiameter: 3, detail: 0.2 })
assert.equal(hollow.wall, 2)
assert.equal(hollow.cavity, true)
assert.equal(hollow.drainHoles, 2)
assert.equal(hollow.openedHoles, 2)
assert.equal(hollow.opened, true)
assert.equal(countOpenEdges(hollow.mesh), 0)
assert.equal(countComponents(hollow.mesh), 1)
assert.ok(hollow.trianglesAfter > 0)
assert.ok(hollow.simplifiedTriangles > 0)
assert.ok(hollow.savingPercent > 60 && hollow.savingPercent < 80, `Ersparnis ${hollow.savingPercent}`)
const volume = (40 ** 3 - 36 ** 3) // 17344
assert.ok(hollow.savingPercent > 0)
assert.ok(volume / 40 ** 3 > 0.27 && volume / 40 ** 3 < 0.28)

const closed = await hollowSolid(solid, { wall: 2, drainHoles: 0, drainDiameter: 3, detail: 0.2 })
assert.equal(closed.openedHoles, 0)
assert.equal(closed.opened, false)
assert.ok(closed.savingPercent > hollow.savingPercent - 0.2)

let failed = false
try {
  await hollowSolid(cube(10), { wall: 5, drainHoles: 0, drainDiameter: 3, detail: 0.2 })
} catch (error) {
  failed = true
  assert.match(String(error), /Hohlraum|Wand/)
}
assert.ok(failed, 'Zu dicke Wand muss verständlich abgelehnt werden')

console.log(
  `OK: Scan-Pipeline — Bewertung (offene Kanten/Inseln/Maßstab/Bett), Maßstab 50→200 mm (Faktor 2), ` +
    `Aushöhlen 40-mm-Würfel: ${hollow.trianglesBefore} → ${hollow.simplifiedTriangles} (vereinfacht) → ${hollow.trianglesAfter} Dreiecke, ` +
    `${hollow.openedHoles}/${hollow.drainHoles} Löcher offen, ${hollow.savingPercent.toFixed(1)} % Material gespart, ` +
    `geschlossen ohne offene Kanten; zu dicke Wand wird abgelehnt.`,
)
