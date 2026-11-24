/**
 * Prüft den Ein-Klick-Maßstab für winzige Importe (V-25).
 *
 * GLB aus der Scan-App und Engine-Ausgaben rechnen in Metern — ein 200-mm-Teil
 * kommt dann als 0,2 mm an. Der Platzierungsmaßstab ist auf 0,05–10 begrenzt;
 * deshalb skaliert der Server die Geometrie selbst. Hier wird die Rechnung
 * geprüft, nicht die Route: Faktor, Netz, unveränderte Quelle.
 */
import assert from 'node:assert/strict'
import { meshFromTris, rescaleFactor, scaleMesh } from '../server/edit.ts'

const triangle = meshFromTris([[0, 0, 0, 10, 0, 0, 0, 10, 0]])
assert.equal(triangle.triangles, 1)
assert.deepEqual(triangle.bbox.size, { x: 10, y: 10, z: 0 })

// --- Faktor: größte Kante auf ein Soll-Maß ---------------------------------
assert.equal(rescaleFactor(0.2, 100), 500, '0,2 mm in Metern → 100 mm braucht Faktor 500')
assert.equal(rescaleFactor(20, 100), 5)
assert.equal(rescaleFactor(100, 100), 1)
assert.equal(rescaleFactor(0.2, 200), 1000)
assert.equal(rescaleFactor(0, 100), null, 'ohne messbare Größe kein Faktor')
assert.equal(rescaleFactor(Number.NaN, 100), null)
assert.equal(rescaleFactor(0.2, 0), null, 'Soll-Maß 0 ist keine Größe')
assert.equal(rescaleFactor(0.2, Number.NaN), null)
assert.equal(rescaleFactor(0.00001, 100), null, 'Faktor über 10.000 wird abgelehnt')
assert.equal(rescaleFactor(1_000_000, 1), null, 'Faktor unter 0,001 wird abgelehnt')

// --- Netz skalieren: gleichmäßig, Quelle bleibt unangetastet --------------
const scaled = scaleMesh(triangle, 500)
assert.equal(scaled.triangles, 1, 'Dreieckszahl bleibt gleich')
assert.equal(scaled.positions.length, triangle.positions.length)
assert.deepEqual(scaled.bbox.size, { x: 5000, y: 5000, z: 0 })
assert.notEqual(scaled, triangle, 'neues Netz — sonst merkt der Server die Änderung nicht')
assert.deepEqual(triangle.bbox.size, { x: 10, y: 10, z: 0 }, 'das Original wird nicht verändert')

// --- Meter-Modell auf 100 mm: Endmaß stimmt --------------------------------
const meterCube = meshFromTris([
  [0, 0, 0, 0.2, 0, 0, 0.2, 0.2],
  [0, 0, 0, 0.2, 0.2, 0, 0, 0.2, 0],
])
// Float32 speichert 0,2 nur genähert — der Faktor weicht minimal ab.
const factor = rescaleFactor(Math.max(...Object.values(meterCube.bbox.size)), 100)!
assert.ok(Math.abs(factor - 500) < 0.01, `Faktor nahe 500, war ${factor}`)
const resized = scaleMesh(meterCube, factor)
assert.equal(Number(resized.bbox.size.x.toFixed(3)), 100)
assert.equal(Number(resized.bbox.size.y.toFixed(3)), 100)

// --- Faktor 1 lässt alles, wie es ist -------------------------------------
const same = scaleMesh(triangle, 1)
assert.deepEqual(same.bbox.size, triangle.bbox.size)
assert.equal(same.triangles, 1)

console.log(
  'Ein-Klick-Maßstab: Faktor 0,2 mm → 100 mm = 500, Netz skaliert ohne Quelländerung, Grenzen 0,001–10.000 und ungültige Soll-Maße abgelehnt.',
)
