import assert from 'node:assert/strict'
import { DEMOS, demoSTL } from '../server/demo.ts'
import { parseSTL } from '../server/slicer/stl.ts'
import { SHAPE_CATEGORIES, SHAPE_LIBRARY, type ShapeEntry } from '../shared/shapes.ts'

const entries: ShapeEntry[] = [...SHAPE_LIBRARY.standard, ...SHAPE_LIBRARY.extra]
const ids = entries.map((entry) => entry.id)
const extra = SHAPE_LIBRARY.extra

assert.equal(new Set(ids).size, ids.length, 'Formen-IDs müssen eindeutig sein')
assert.equal(
  new Set(entries.map((entry) => entry.label)).size,
  entries.length,
  'Formen-Labels müssen eindeutig sein',
)
assert.ok(extra.length >= 10, `Extra-Auswahl ist mit ${extra.length} Formen zu klein`)
assert.deepEqual(
  [...SHAPE_CATEGORIES].sort(),
  [...new Set(extra.map((entry) => entry.category))].sort(),
  'Jede Kategorie braucht mindestens eine Form',
)
for (const category of SHAPE_CATEGORIES) {
  assert.ok(
    extra.filter((entry) => entry.category === category).length >= 3,
    `Kategorie ${category} braucht mindestens drei Formen`,
  )
}
for (const entry of entries) {
  assert.ok(entry.detail.trim(), `${entry.id}: Größenangabe fehlt`)
  assert.ok(DEMOS[entry.id], `${entry.id}: Serverform fehlt`)
}
for (const id of Object.keys(DEMOS)) {
  assert.ok(ids.includes(id), `${id}: Serverform hat keinen UI-Eintrag`)
}
for (const entry of extra) {
  assert.ok(entry.preview, `${entry.id}: Vorschautyp fehlt`)
  assert.ok(SHAPE_CATEGORIES.includes(entry.category), `${entry.id}: unbekannte Kategorie`)
}

const dimensions: string[] = []
for (const entry of entries) {
  const stl = demoSTL(entry.id)
  assert.ok(stl && stl.length > 0, `${entry.id}: STL fehlt`)
  const mesh = parseSTL(stl)
  assert.ok(mesh.triangles > 0, `${entry.id}: STL enthält keine Dreiecke`)
  const { x, y, z } = mesh.bbox.size
  assert.ok([x, y, z].every((value) => Number.isFinite(value) && value > 0), `${entry.id}: ungültige Größe`)
  assert.ok(x <= 220 && y <= 220 && z <= 220, `${entry.id}: Form passt nicht auf das Standardbett`)
  dimensions.push(`${entry.id}: ${x.toFixed(1)} × ${y.toFixed(1)} × ${z.toFixed(1)} mm`)
}

console.log(`OK: ${entries.length} Formen (${SHAPE_LIBRARY.standard.length} Standard, ${extra.length} Extra)`)
for (const category of SHAPE_CATEGORIES) {
  console.log(`  ${category}: ${extra.filter((entry) => entry.category === category).map((entry) => entry.label).join(', ')}`)
}
console.log(dimensions.map((line) => `  ${line}`).join('\n'))
