import assert from 'node:assert/strict'
import { boxMinMax } from '../server/meshlib.ts'
import { keepBedHeight, placeMesh } from '../server/objects.ts'
import { makeMesh } from '../server/slicer/stl.ts'
import type { ModelPlacement } from '../shared/types.ts'

const near = (actual: number, expected: number, message: string) => {
  assert.ok(Math.abs(actual - expected) <= 1e-6, `${message}: erwartet ${expected}, erhalten ${actual}`)
}

const mesh = makeMesh(new Float32Array(boxMinMax(0, 0, 0, 20, 10, 5).flat()), false)
const before: ModelPlacement = {
  offsetX: 12,
  offsetY: 34,
  offsetZ: 0,
  rotationX: 0,
  rotationY: 0,
  rotationZ: 0,
  scaleX: 1,
  scaleY: 1,
  scaleZ: 1,
  visible: true,
}

const rest = placeMesh(mesh, before)
near(rest.bbox.min.z, 0, 'Ausgangslage liegt auf dem Bett')

for (const [label, patch] of [
  ['X', { rotationX: 90 }],
  ['Y', { rotationY: 90 }],
  ['Z', { rotationZ: 90 }],
] as const) {
  const turned: ModelPlacement = { ...before, ...patch }
  const kept = keepBedHeight(mesh, before, turned)
  const placed = placeMesh(mesh, { ...turned, ...kept })
  near(placed.bbox.min.z, 0, `Drehung um ${label} hält die Unterseite auf dem Bett`)
  assert.ok(placed.bbox.size.x > 0 && placed.bbox.size.y > 0 && placed.bbox.size.z > 0, `Drehung um ${label} darf das Objekt nicht flach machen`)
  assert.ok(
    Number.isFinite(placed.bbox.min.x) &&
      Number.isFinite(placed.bbox.min.y) &&
      Number.isFinite(placed.bbox.min.z) &&
      Number.isFinite(placed.bbox.max.x) &&
      Number.isFinite(placed.bbox.max.y) &&
      Number.isFinite(placed.bbox.max.z),
    `Drehung um ${label} liefert endliche Grenzen`,
  )
}

// Zwei Drehungen hintereinander dürfen die Höhe nicht erneut verlieren.
const first: ModelPlacement = { ...before, rotationX: 90 }
const firstPlacement: ModelPlacement = { ...first, ...keepBedHeight(mesh, before, first) }
const second: ModelPlacement = { ...firstPlacement, rotationY: 90 }
const secondPlacement: ModelPlacement = { ...second, ...keepBedHeight(mesh, firstPlacement, second) }
const secondKept = placeMesh(mesh, secondPlacement)
near(secondKept.bbox.min.z, 0, 'Zwei Drehungen hintereinander halten die Unterseite auf dem Bett')

console.log('OK: 90°-Drehungen um X/Y/Z bleiben sichtbar und auf dem Bett.')
