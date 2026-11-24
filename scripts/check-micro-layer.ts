import assert from 'node:assert/strict'
import { buildBinarySTL, parseSTL } from '../server/slicer/stl.ts'
import { sliceMesh } from '../server/slicer/index.ts'
import { printerById } from '../shared/catalog.ts'
import { applyPrinterLimits } from '../shared/limits.ts'
import { DEFAULT_SETTINGS, mergeSettings } from '../shared/types.ts'

function cylinder(r: number, h: number, seg = 72): number[][] {
  const tris: number[][] = []
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2
    const a1 = ((i + 1) / seg) * Math.PI * 2
    const x0 = Math.cos(a0) * r
    const y0 = Math.sin(a0) * r
    const x1 = Math.cos(a1) * r
    const y1 = Math.sin(a1) * r
    tris.push([0, 0, 0, x0, y0, 0, x1, y1, 0])
    tris.push([0, 0, h, x1, y1, h, x0, y0, h])
    tris.push([x0, y0, 0, x1, y1, 0, x1, y1, h])
    tris.push([x0, y0, 0, x1, y1, h, x0, y0, h])
  }
  return tris
}

const printer = printerById('flashforge-ad5x')
const settings = applyPrinterLimits(
  printer,
  mergeSettings(DEFAULT_SETTINGS, {
    layerHeight: 0.2,
    firstLayerHeight: 0.2,
    walls: 2,
    topLayers: 2,
    bottomLayers: 1,
    adhesion: 'none',
    primeLine: { ...DEFAULT_SETTINGS.primeLine, enabled: false },
    ironing: { ...DEFAULT_SETTINGS.ironing, enabled: false },
  }),
)
const result = sliceMesh(parseSTL(buildBinarySTL(cylinder(20, 3.002))), settings, printer, null, [], {})
const marks = [...result.gcode.matchAll(/^;LAYER:(\d+)$/gm)].map((m) => Number(m[1]))

assert.equal(result.layers.length, 15, `15 Schichten erwartet, erhalten: ${result.layers.length}`)
assert.deepEqual(marks, Array.from({ length: 15 }, (_, i) => i + 1), 'LAYER-Marker müssen lückenlos bis 15 gehen')
assert.match(result.gcode, /^;3\.002$/m, 'Oberkante 3.002 mm fehlt im G-Code')
assert.ok(
  result.warnings.some((w) => w.includes('Resthöhe 0.002 mm') && w.includes('0.202 mm')),
  `Warnung zur Resthöhe fehlt: ${result.warnings.join(' | ')}`,
)
const oversized = sliceMesh(
  parseSTL(buildBinarySTL(cylinder(150, 1, 24))),
  settings,
  printer,
  null,
  [],
  {},
)
assert.ok(
  oversized.warnings.some((w) => w.includes('passt nicht auf das Bett')),
  `Überstand-Warnung fehlt: ${oversized.warnings.join(' | ')}`,
)
console.log(
  `OK: ${result.layers.length} Schichten, letzte 0.202 mm, ` +
    `Oberkante 3.002 mm, ${result.stats.layerCount} Statistik-Schichten, Überstand wird gemeldet`,
)
