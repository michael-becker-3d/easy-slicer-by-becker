/**
 * Prüft den GLB-Import (V-24).
 *
 * Die Prüfdateien werden hier byte-genau gebaut (Kopf, JSON-Teil, Binärteil),
 * damit der Leser gegen das Format geprüft wird und nicht gegen eine Datei,
 * die nur zufällig passt. Der letzte Block geht über `parseModelFile`, also
 * denselben Weg wie ein Upload aus der Oberfläche.
 */
import assert from 'node:assert/strict'
import { parseGLB } from '../server/glb.ts'
import { parseModelFile } from '../server/formats.ts'

const GLB_JSON = 0x4e4f534a
const GLB_BIN = 0x004e4942

function buildGlb(json: unknown, bin: Buffer): Buffer {
  const jsonRaw = Buffer.from(JSON.stringify(json), 'utf8')
  const jsonChunk = Buffer.concat([jsonRaw, Buffer.alloc((4 - (jsonRaw.length % 4)) % 4, 0x20)])
  const binChunk = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4, 0)])
  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length
  const out = Buffer.alloc(total)
  out.writeUInt32LE(0x46546c67, 0)
  out.writeUInt32LE(2, 4)
  out.writeUInt32LE(total, 8)
  out.writeUInt32LE(jsonChunk.length, 12)
  out.writeUInt32LE(GLB_JSON, 16)
  jsonChunk.copy(out, 20)
  const offset = 20 + jsonChunk.length
  out.writeUInt32LE(binChunk.length, offset)
  out.writeUInt32LE(GLB_BIN, offset + 4)
  binChunk.copy(out, offset + 8)
  return out
}

function triangleBin(): Buffer {
  const positions = Buffer.alloc(36)
  const points = [0, 0, 0, 10, 0, 0, 0, 10, 0]
  points.forEach((value, index) => positions.writeFloatLE(value, index * 4))
  const indices = Buffer.alloc(6)
  ;[0, 1, 2].forEach((value, index) => indices.writeUInt16LE(value, index * 2))
  return Buffer.concat([positions, indices])
}

const triangleJson = (extra: Record<string, unknown> = {}) => ({
  asset: { version: '2.0', generator: 'Prüfskript' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
    { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
  ],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: 36 },
    { buffer: 0, byteOffset: 36, byteLength: 6 },
  ],
  buffers: [{ byteLength: 42 }],
  ...extra,
})

// --- Einfaches Dreieck -----------------------------------------------------
const simple = parseGLB(buildGlb(triangleJson(), triangleBin()))
assert.equal(simple.mesh.triangles, 1)
assert.equal(simple.primitives, 1)
assert.equal(simple.nodes, 1)
assert.deepEqual(simple.mesh.bbox.size, { x: 10, y: 10, z: 0 })
assert.equal(simple.warnings.length, 0, 'ohne Texturen und ohne Mini-Maß keine Warnung')

// --- Knoten-Translation wird angewendet -----------------------------------
const moved = parseGLB(
  buildGlb(
    triangleJson({ nodes: [{ mesh: 0, translation: [5, 7, 2] }] }),
    triangleBin(),
  ),
)
assert.deepEqual(moved.mesh.bbox.min, { x: 5, y: 7, z: 2 })
assert.deepEqual(moved.mesh.bbox.size, { x: 10, y: 10, z: 0 })

// --- Skalierung ohne Indexliste (nicht indizierte Dreiecke) ---------------
const scaledBin = Buffer.alloc(36)
;[0, 0, 0, 10, 0, 0, 0, 10, 0].forEach((value, index) => scaledBin.writeFloatLE(value, index * 4))
const scaled = parseGLB(
  buildGlb(
    {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, scale: [2, 1, 1] }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
      buffers: [{ byteLength: 36 }],
    },
    scaledBin,
  ),
)
assert.equal(scaled.mesh.triangles, 1)
assert.deepEqual(scaled.mesh.bbox.size, { x: 20, y: 10, z: 0 }, 'Skalierung des Knotens zählt')

// --- Zwei Knoten auf demselben Netz ---------------------------------------
const twice = parseGLB(
  buildGlb(
    triangleJson({
      scenes: [{ nodes: [0, 1] }],
      nodes: [
        { mesh: 0, translation: [0, 0, 0] },
        { mesh: 0, translation: [40, 0, 0] },
      ],
    }),
    triangleBin(),
  ),
)
assert.equal(twice.mesh.triangles, 2)
assert.equal(twice.nodes, 2)
assert.equal(twice.mesh.bbox.size.x, 50)

// --- Texturen werden gemeldet, nicht übernommen ---------------------------
const textured = parseGLB(
  buildGlb(
    triangleJson({
      images: [{ bufferView: 0 }],
      textures: [{ source: 0 }],
      materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    }),
    triangleBin(),
  ),
)
assert.equal(textured.mesh.triangles, 1)
assert.equal(textured.warnings.some((warning) => /Texturen und Materialien/.test(warning)), true)

// --- Auffällig kleines Modell (glTF rechnet in Metern) --------------------
const metreBin = Buffer.alloc(36)
;[0, 0, 0, 0.01, 0, 0, 0, 0.01, 0].forEach((value, index) => metreBin.writeFloatLE(value, index * 4))
const metre = parseGLB(
  buildGlb(
    {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
      buffers: [{ byteLength: 36 }],
    },
    metreBin,
  ),
)
assert.equal(
  metre.warnings.some((warning) => /glTF rechnet offiziell in Metern/.test(warning)),
  true,
  'Meter-Modelle werden benannt, nicht still umgerechnet',
)

// --- Punkte/Linien werden übersprungen und gemeldet -----------------------
assert.throws(
  () =>
    parseGLB(
      buildGlb(
        triangleJson({
          meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 1 }] }],
        }),
        triangleBin(),
      ),
    ),
  /keine Dreiecke/,
)

const withLines = parseGLB(
  buildGlb(
    triangleJson({
      meshes: [
        {
          primitives: [
            { attributes: { POSITION: 0 }, indices: 1, mode: 4 },
            { attributes: { POSITION: 0 }, mode: 1 },
          ],
        },
      ],
    }),
    triangleBin(),
  ),
)
assert.equal(withLines.mesh.triangles, 1)
assert.equal(withLines.warnings.some((warning) => /ohne Dreiecke übersprungen/.test(warning)), true)

// --- Fehlerfälle mit klaren Meldungen ------------------------------------
assert.throws(() => parseGLB(Buffer.from('ply\nformat ascii 1.0\n')), /keine GLB-Datei/)
assert.throws(
  () => {
    const v1 = buildGlb(triangleJson(), triangleBin())
    v1.writeUInt32LE(1, 4)
    parseGLB(v1)
  },
  /GLB-Version 1/,
)
assert.throws(
  () =>
    parseGLB(
      buildGlb(
        triangleJson({ buffers: [{ byteLength: 42, uri: 'scene.bin' }] }),
        triangleBin(),
      ),
    ),
  /externe Datei/,
)
assert.throws(() => parseGLB(Buffer.from('glTF\x02\x00\x00\x00\x40\x00\x00\x00')), /JSON-Teil/)

// --- Derselbe Weg wie ein Upload: parseModelFile erkennt GLB --------------
const upload = parseModelFile(buildGlb(triangleJson(), triangleBin()), 'mesh.glb')
assert.equal(upload.format, 'glb')
assert.equal(upload.objects.length, 1)
assert.equal(upload.objects[0].name, 'mesh.glb')
assert.equal(upload.mesh.triangles, 1)
assert.equal(upload.plates, 1)
assert.ok(upload.binary && upload.binary.length === 84 + 50, 'GLB wird als STL weitergereicht')

console.log(
  'GLB-Import: Dreiecke, Indizes, Knoten-Transformation, Texturhinweis, Meter-Hinweis, Fehlerfälle und Import über parseModelFile geprüft.',
)
