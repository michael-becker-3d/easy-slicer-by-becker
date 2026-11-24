import assert from 'node:assert/strict'
import { boxMinMax } from '../server/meshlib.ts'
import { keepBedHeight, placeMesh } from '../server/objects.ts'
import { makeMesh } from '../server/slicer/stl.ts'
import type { ModelObjectInfo, ModelPlacement } from '../shared/types.ts'
import {
  transformFields,
  transformPatch,
  type ObjectTransformFields,
} from '../shared/objectTransform.ts'

const near = (actual: number, expected: number, message: string) => {
  assert.ok(Math.abs(actual - expected) <= 1e-6, `${message}: erwartet ${expected}, erhalten ${actual}`)
}

const mesh = makeMesh(new Float32Array(boxMinMax(0, 0, 0, 20, 10, 5).flat()), false)
const placement: ModelPlacement = {
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
const initialBox = placeMesh(mesh, placement).bbox
const initial: ModelObjectInfo = {
  id: 'dialog-test',
  name: 'Testbox',
  triangles: mesh.triangles,
  size: initialBox.size,
  center: {
    x: (initialBox.min.x + initialBox.max.x) / 2,
    y: (initialBox.min.y + initialBox.max.y) / 2,
    z: (initialBox.min.z + initialBox.max.z) / 2,
  },
  placement,
}

const initialFields = transformFields(initial)
const initialPatch = transformPatch(initial, initialFields)
assert.ok(initialPatch)
near(initialPatch.scaleX, 1, 'Ausgangsvorschau skaliert X nicht')
near(initialPatch.scaleY, 1, 'Ausgangsvorschau skaliert Y nicht')
near(initialPatch.scaleZ, 1, 'Ausgangsvorschau skaliert Z nicht')

for (const axis of ['x', 'y', 'z'] as const) {
  // Der Benutzer dreht nur den Winkel; die Maße bleiben zunächst die alten.
  const edited: ObjectTransformFields = {
    ...initialFields,
    rot: { ...initialFields.rot, [axis]: 90 },
  }
  const requested = transformPatch(initial, edited)
  assert.ok(requested)

  // Der Server wendet die Drehung an und hält die Unterseite auf dem Bett.
  const requestedPlacement: ModelPlacement = {
    ...placement,
    scaleX: requested.scaleX,
    scaleY: requested.scaleY,
    scaleZ: requested.scaleZ,
    rotationX: requested.rotationX,
    rotationY: requested.rotationY,
    rotationZ: requested.rotationZ,
    offsetX: requested.offsetX,
    offsetY: requested.offsetY,
    offsetZ: requested.offsetZ,
  }
  const serverPlacement: ModelPlacement = {
    ...requestedPlacement,
    ...keepBedHeight(mesh, placement, requestedPlacement),
  }
  const placed = placeMesh(mesh, serverPlacement)
  const server: ModelObjectInfo = {
    ...initial,
    size: placed.bbox.size,
    center: {
      x: (placed.bbox.min.x + placed.bbox.max.x) / 2,
      y: (placed.bbox.min.y + placed.bbox.max.y) / 2,
      z: (placed.bbox.min.z + placed.bbox.max.z) / 2,
    },
    placement: serverPlacement,
  }

  // Nach der Server-Antwort müssen die angezeigten Maße die neue Bounding-Box
  // sein — nicht mehr die Maße von vor der Drehung.
  const displayed = transformFields(server)
  near(displayed.sizes.x, server.size.x, `Angezeigte X-Größe nach ${axis.toUpperCase()}-Drehung`)
  near(displayed.sizes.y, server.size.y, `Angezeigte Y-Größe nach ${axis.toUpperCase()}-Drehung`)
  near(displayed.sizes.z, server.size.z, `Angezeigte Z-Größe nach ${axis.toUpperCase()}-Drehung`)
  near(displayed.pos.z, serverPlacement.offsetZ, `Angezeigte Z-Position nach ${axis.toUpperCase()}-Drehung`)

  // Die nächste Vorschau darf aus diesen Maßen keinen neuen Maßstab ableiten.
  const next = transformPatch(server, displayed)
  assert.ok(next)
  near(next.scaleX, 1, `Nächste Vorschau staucht X nach ${axis.toUpperCase()}-Drehung`)
  near(next.scaleY, 1, `Nächste Vorschau staucht Y nach ${axis.toUpperCase()}-Drehung`)
  near(next.scaleZ, 1, `Nächste Vorschau staucht Z nach ${axis.toUpperCase()}-Drehung`)

  // Gegenprobe für den ursprünglichen Fehler: Mit den alten Maßen wäre die
  // nächste Vorschau deutlich verzerrt. Der Test bleibt so an den echten
  // Dialogwerten und nicht nur an der Server-Geometrie.
  const stale = transformPatch(server, { ...displayed, sizes: initialFields.sizes })
  assert.ok(stale)
  const distorted =
    Math.abs(stale.scaleX - 1) > 0.1 ||
    Math.abs(stale.scaleY - 1) > 0.1 ||
    Math.abs(stale.scaleZ - 1) > 0.1
  assert.ok(distorted, `Der Fehlerfall muss bei ${axis.toUpperCase()}-Drehung verzerren`)
}

console.log('OK: Dialogmaße folgen der gedrehten Bounding-Box; nächste Vorschau skaliert mit 1.')
