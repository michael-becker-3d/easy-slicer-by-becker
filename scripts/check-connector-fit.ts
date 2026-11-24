import assert from 'node:assert/strict'
import { countOpenEdges, splitSolid } from '../server/csg.ts'
import { buildBinarySTL, parseSTL, type Mesh } from '../server/slicer/stl.ts'

function cube(size = 20): Mesh {
  const s = size
  const p = [
    [0, 0, 0],
    [s, 0, 0],
    [s, s, 0],
    [0, s, 0],
    [0, 0, s],
    [s, 0, s],
    [s, s, s],
    [0, s, s],
  ]
  const faces = [
    [0, 2, 1], [0, 3, 2],
    [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4],
    [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6],
    [3, 0, 4], [3, 4, 7],
  ]
  const tris = faces.map((f) => f.flatMap((i) => p[i]))
  return parseSTL(buildBinarySTL(tris))
}

/** Schnittpunkte einer Ebene, begrenzt auf den Bereich um den Verbinder. */
function section(mesh: Mesh, z: number, cx: number, cy: number, radius: number) {
  const q = mesh.positions
  const points: { x: number; y: number }[] = []
  for (let i = 0; i < q.length; i += 9) {
    const tri = [0, 1, 2].map((k) => ({ x: q[i + k * 3], y: q[i + k * 3 + 1], z: q[i + k * 3 + 2] }))
    for (let e = 0; e < 3; e++) {
      const a = tri[e]
      const b = tri[(e + 1) % 3]
      if ((a.z < z && b.z >= z) || (b.z < z && a.z >= z)) {
        const t = (z - a.z) / (b.z - a.z)
        const x = a.x + (b.x - a.x) * t
        const y = a.y + (b.y - a.y) * t
        if (Math.hypot(x - cx, y - cy) <= radius) points.push({ x, y })
      }
    }
  }
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  return {
    count: points.length,
    width: xs.length ? Math.max(...xs) - Math.min(...xs) : 0,
    depth: ys.length ? Math.max(...ys) - Math.min(...ys) : 0,
  }
}

const parts = await splitSolid(cube(), {
  axis: 'z',
  pieces: 2,
  profile: 'flat',
  position: 10,
  pinCount: 1,
  pinType: 'pin',
  pinWidth: 6,
  pinLength: 8,
  pinHeight: 4,
  pinTaper: 0.08,
  clearance: 0.05,
  connectorClearance: 0.25,
})
assert.equal(parts.length, 2, 'Der Würfel muss in zwei Teile geteilt werden')
for (const part of parts) assert.equal(countOpenEdges(part), 0, 'Beide Teile müssen geschlossen sein')

const pin = section(parts[0], 10.1, 10, 10, 5)
const mouth = section(parts[1], 10.4, 10, 10, 5)
const socketNominal = section(parts[1], 11.1, 10, 10, 5)
assert.ok(pin.width > 5.5, `Zapfen zu schmal: ${pin.width.toFixed(2)} mm`)
assert.ok(
  mouth.width > socketNominal.width + 0.5,
  `Einführfase fehlt: Öffnung ${mouth.width.toFixed(2)} mm, Nennmaß ${socketNominal.width.toFixed(2)} mm`,
)
assert.ok(
  socketNominal.width >= pin.width + 0.4,
  `Passung zu stramm: Nut ${socketNominal.width.toFixed(2)} mm, Zapfen ${pin.width.toFixed(2)} mm`,
)
console.log(
  `OK: Zapfen ${pin.width.toFixed(2)} mm, Nut ${socketNominal.width.toFixed(2)} mm, ` +
    `Öffnung ${mouth.width.toFixed(2)} mm, beide Teile geschlossen`,
)
