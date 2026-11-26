import assert from 'node:assert/strict'
import { buildBinarySTL, parseSTL } from '../server/slicer/stl.ts'
import { sliceMesh } from '../server/slicer/index.ts'
import { printerById } from '../shared/catalog.ts'
import { applyPrinterLimits } from '../shared/limits.ts'
import { DEFAULT_SETTINGS, mergeSettings, type BedMesh } from '../shared/types.ts'

type Tri = number[]

function cylinder(r: number, h: number, seg = 72): Tri[] {
  const tris: Tri[] = []
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

const mesh = parseSTL(buildBinarySTL(cylinder(15, 10)))
const vyper = printerById('anycubic-vyper')
const vase = applyPrinterLimits(
  vyper,
  mergeSettings(DEFAULT_SETTINGS, {
    layerHeight: 0.2,
    firstLayerHeight: 0.24,
    lineWidth: 0.4,
    walls: 1,
    topLayers: 0,
    bottomLayers: 0,
    infillDensity: 0,
    adhesion: 'none',
    primeLine: { ...DEFAULT_SETTINGS.primeLine, enabled: false },
    special: { vase: true },
    // Dieser Test prüft die Kompensation im Vasenmodus — sie muss ausdrücklich
    // eingeschaltet sein, seit der Standard „aus" ist.
    meshCompensation: 'software',
  }),
)

/** Konstantes Mesh über dem ganzen Bett; offset ist der Messwert in mm. */
function bedMesh(offset: number): BedMesh {
  return {
    cols: 2,
    rows: 2,
    x0: 0,
    y0: 0,
    dx: vyper.bed.x,
    dy: vyper.bed.y,
    z: [
      [offset, offset],
      [offset, offset],
    ],
    source: 'simulation',
    capturedAt: Date.now(),
  }
}

function zValues(gcode: string): number[] {
  const values: number[] = []
  for (const line of gcode.split(/\r?\n/)) {
    if (!line.startsWith('G1 ')) continue
    const match = /(?:^| )Z(-?\d+(?:\.\d+)?)/.exec(line)
    if (match) values.push(Number(match[1]))
  }
  return values
}

function sliceWithMesh(offset: number) {
  return sliceMesh(mesh, vase, vyper, bedMesh(offset), [], {
    start: true,
    end: false,
    metadata: false,
  })
}

function meshWarnings(result: { warnings: string[] }): string[] {
  return result.warnings.filter((warning) => warning.startsWith('Bett-Mesh im Vasenmodus'))
}

// Ein moderat negativer Offset darf weiter kompensiert werden, solange Z
// positiv bleibt: erste Schicht 0,24 mm − 0,10 mm = 0,14 mm.
const safe = sliceWithMesh(-0.1)
const safeZ = zValues(safe.gcode)
assert.ok(safeZ.length > 20, 'Zu wenige Z-Bewegungen im sicheren Mesh-Fall')
assert.ok(Math.min(...safeZ) > 0.1, `Sicheres Mesh wurde nicht kompensiert: min Z ${Math.min(...safeZ)}`)
assert.equal(
  meshWarnings(safe).length,
  0,
  'Ein sicher kompensiertes Mesh darf keinen Begrenzungshinweis erzeugen',
)

// Ein Offset von −0,5 mm würde ohne Schutz bereits in Schicht 1 und am
// Spiralstart negative Z-Werte erzeugen. Dann muss der Vasenpfad auf die
// nominelle Höhe zurückfallen; negative Z-Bewegungen sind nie erlaubt.
const unsafe = sliceWithMesh(-0.5)
const unsafeZ = zValues(unsafe.gcode)
assert.ok(unsafeZ.length > 20, 'Zu wenige Z-Bewegungen im negativen Mesh-Fall')
assert.ok(
  Math.min(...unsafeZ) >= -1e-9,
  `Vasen-Spiralstart erzeugt negatives Z: min Z ${Math.min(...unsafeZ)}`,
)
assert.ok(
  unsafe.gcode.split(/\r?\n/).some((line) => /^G1 X.* Y.* Z.* E/.test(line)),
  'Keine spiralförmige Z-Bahn im Vasenmodus',
)
const unsafeWarnings = meshWarnings(unsafe)
assert.ok(
  unsafeWarnings.some((warning) => warning.includes('begrenzt')),
  'Der Slice-Bericht muss die begrenzte Mesh-Kompensation nennen',
)
assert.ok(
  unsafeWarnings.some((warning) => warning.includes('0,5 mm')),
  'Der Hinweis muss die größte Mesh-Abweichung nennen',
)
assert.ok(
  unsafeWarnings.some((warning) => warning.includes('deaktiviert')),
  'Auch die deaktivierte Spirale muss im Slice-Bericht stehen',
)

// Bei −0,35 mm bleibt die obere Z-Koordinate positiv, der Spiralstart würde
// aber negativ. Dann wird die Spirale ganz ohne Mesh gefahren; der Bericht
// muss zusätzlich zur Begrenzung der ersten Schicht ausdrücklich auf die
// deaktivierte Mesh-Kompensation hinweisen.
const mixed = sliceWithMesh(-0.35)
const mixedZ = zValues(mixed.gcode)
assert.ok(Math.min(...mixedZ) >= -1e-9, `Negatives Z im gemischten Mesh-Fall: ${Math.min(...mixedZ)}`)
const mixedWarnings = meshWarnings(mixed)
assert.ok(
  mixedWarnings.some((warning) => warning.includes('begrenzt')),
  'Der gemischte Fall muss die erste Schicht als begrenzt melden',
)
assert.ok(
  mixedWarnings.some((warning) => warning.includes('deaktiviert')),
  'Der gemischte Fall muss die Spirale als deaktiviert melden',
)
assert.ok(
  mixedWarnings.some((warning) => warning.includes('0,35 mm')),
  'Der Hinweis muss die größte Abweichung der deaktivierten Spirale nennen',
)

console.log(
  `OK: Vasen-Mesh-Z begrenzt; sicheres Mesh min Z ${Math.min(...safeZ).toFixed(3)} mm, ` +
    `negatives Mesh min Z ${Math.min(...unsafeZ).toFixed(3)} mm, keine negativen Z-Bewegungen; ` +
    `Bericht: ${unsafeWarnings.length} Meldungen beim konstanten, ${mixedWarnings.length} beim gemischten Mesh.`,
)
