/**
 * GLB-Import (V-24).
 *
 * Die MeshScan-App liefert am Ende `mesh.glb`. GLB ist ein Behälter: ein
 * JSON-Teil beschreibt Knoten, Netze und Zugriffsbereiche, ein Binärteil hält
 * die Zahlen. Der Slicer braucht nur Dreiecke in Weltkoordinaten, deshalb wird
 * hier genau das herausgezogen: Knoten-Hierarchie anwenden, Primitives vom Typ
 * „Dreiecke“ in Dreieckslisten umwandeln, alles andere melden.
 *
 * Bewusst nicht enthalten: Materialien, Texturen, Animationen, Morph-Targets,
 * Skinning, externe .bin-Dateien. Für den Druck zählt die Geometrie.
 */
import { makeMesh, type Mesh } from './slicer/stl.ts'

const GLB_MAGIC = 0x46546c67
const CHUNK_JSON = 0x4e4f534a
const CHUNK_BIN = 0x004e4942

const COMPONENT_SIZE: Record<number, number> = {
  5120: 1, // byte
  5121: 1, // unsigned byte
  5122: 2, // short
  5123: 2, // unsigned short
  5125: 4, // unsigned int
  5126: 4, // float
}

const TYPE_COMPONENTS: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT2: 4,
  MAT3: 9,
  MAT4: 16,
}

type GltfAccessor = {
  bufferView?: number
  byteOffset?: number
  componentType: number
  count: number
  type: string
  normalized?: boolean
}

type GltfBufferView = {
  buffer: number
  byteOffset?: number
  byteLength: number
  byteStride?: number
}

type GltfPrimitive = {
  attributes?: Record<string, number>
  indices?: number
  mode?: number
  material?: number
}

type GltfNode = {
  mesh?: number
  children?: number[]
  matrix?: number[]
  translation?: number[]
  rotation?: number[]
  scale?: number[]
}

type Gltf = {
  scenes?: { nodes?: number[] }[]
  scene?: number
  nodes?: GltfNode[]
  meshes?: { primitives?: GltfPrimitive[] }[]
  accessors?: GltfAccessor[]
  bufferViews?: GltfBufferView[]
  buffers?: { byteLength: number; uri?: string }[]
  images?: unknown[]
  textures?: unknown[]
  materials?: unknown[]
}

export type GlbParseResult = {
  mesh: Mesh
  warnings: string[]
  /** Gezeichnete Primitives (Dreieckslisten). */
  primitives: number
  /** Knoten mit Netz, die tatsächlich beigetragen haben. */
  nodes: number
}

/** Liest den GLB-Behälter und gibt JSON plus Binärteil zurück. */
function readContainer(buf: Buffer): { gltf: Gltf; bin: Buffer | null } {
  if (buf.length < 12 || buf.readUInt32LE(0) !== GLB_MAGIC) {
    throw new Error('Das ist keine GLB-Datei — der Kopf „glTF“ fehlt.')
  }
  const version = buf.readUInt32LE(4)
  if (version === 1) {
    throw new Error('GLB-Version 1 wird nicht unterstützt — bitte als glTF 2.0 exportieren.')
  }
  if (version !== 2) throw new Error(`Unbekannte GLB-Version ${version}.`)

  let json: Gltf | null = null
  let bin: Buffer | null = null
  let offset = 12
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32LE(offset)
    const type = buf.readUInt32LE(offset + 4)
    const start = offset + 8
    if (start + length > buf.length) break
    const data = buf.subarray(start, start + length)
    if (type === CHUNK_JSON) {
      try {
        json = JSON.parse(data.toString('utf8')) as Gltf
      } catch {
        throw new Error('Der JSON-Teil der GLB ist beschädigt.')
      }
    } else if (type === CHUNK_BIN) {
      bin = Buffer.from(data)
    }
    offset = start + length + ((4 - (length % 4)) % 4)
  }
  if (!json) throw new Error('Die GLB enthält keinen lesbaren JSON-Teil.')
  return { gltf: json, bin }
}

function bufferFor(gltf: Gltf, index: number, bin: Buffer | null): Buffer {
  const buffer = gltf.buffers?.[index]
  if (!buffer) throw new Error(`GLB verweist auf einen fehlenden Puffer (${index}).`)
  if (!buffer.uri) {
    if (!bin) throw new Error('Der Binärteil der GLB fehlt — die Datei ist unvollständig.')
    return bin
  }
  if (buffer.uri.startsWith('data:')) {
    const base64 = buffer.uri.slice(buffer.uri.indexOf(',') + 1)
    return Buffer.from(base64, 'base64')
  }
  throw new Error(
    `Die GLB verweist auf eine externe Datei (${buffer.uri}). Bitte als eine GLB mit eingebetteten Daten exportieren.`,
  )
}

function readAccessor(
  gltf: Gltf,
  index: number,
  bin: Buffer | null,
): { values: Float32Array; count: number; components: number } {
  const accessor = gltf.accessors?.[index]
  if (!accessor) throw new Error(`GLB-Zugriffsbereich ${index} fehlt.`)
  const components = TYPE_COMPONENTS[accessor.type]
  if (!components || components > 4) {
    throw new Error(`GLB-Zugriffsbereich ${index} hat den nicht unterstützten Typ „${accessor.type}“.`)
  }
  const size = COMPONENT_SIZE[accessor.componentType]
  if (!size) throw new Error(`GLB-Zugriffsbereich ${index} hat einen unbekannten Komponententyp.`)
  const view = typeof accessor.bufferView === 'number' ? gltf.bufferViews?.[accessor.bufferView] : undefined
  if (!view) throw new Error(`GLB-Zugriffsbereich ${index} hat keine Daten.`)
  const data = bufferFor(gltf, view.buffer, bin)
  const elementSize = size * components
  const stride = view.byteStride && view.byteStride > elementSize ? view.byteStride : elementSize
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  if (start + stride * (accessor.count - 1) + elementSize > view.byteLength + (view.byteOffset ?? 0)) {
    throw new Error(`GLB-Zugriffsbereich ${index} zeigt über seine Daten hinaus — die Datei ist beschädigt.`)
  }

  const values = new Float32Array(accessor.count * components)
  const read = (at: number): number => {
    switch (accessor.componentType) {
      case 5120:
        return data.readInt8(at)
      case 5121:
        return data.readUInt8(at)
      case 5122:
        return data.readInt16LE(at)
      case 5123:
        return data.readUInt16LE(at)
      case 5125:
        return data.readUInt32LE(at)
      default:
        return data.readFloatLE(at)
    }
  }
  // Normalisierte Ganzzahlen (z. B. Quantisierung) auf 0…1 bzw. −1…1 bringen.
  const scale =
    accessor.normalized && accessor.componentType !== 5126
      ? accessor.componentType === 5120
        ? 1 / 127
        : accessor.componentType === 5121
          ? 1 / 255
          : accessor.componentType === 5122
            ? 1 / 32767
            : 1 / 65535
      : 1

  for (let i = 0; i < accessor.count; i++) {
    const at = start + i * stride
    if (at + elementSize > data.length) break
    for (let c = 0; c < components; c++) {
      values[i * components + c] = read(at + c * size) * scale
    }
  }
  return { values, count: accessor.count, components }
}

function multiply(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0)
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[column * 4 + k]
      out[column * 4 + row] = sum
    }
  }
  return out
}

/** Knotenmatrix aus Translation, Quaternion und Skalierung (glTF ist spaltenweise). */
function localMatrix(node: GltfNode): number[] {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) return node.matrix.slice()
  const [tx, ty, tz] = node.translation ?? [0, 0, 0]
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1]
  const [sx, sy, sz] = node.scale ?? [1, 1, 1]
  const x2 = qx + qx
  const y2 = qy + qy
  const z2 = qz + qz
  const xx = qx * x2
  const xy = qx * y2
  const xz = qx * z2
  const yy = qy * y2
  const yz = qy * z2
  const zz = qz * z2
  const wx = qw * x2
  const wy = qw * y2
  const wz = qw * z2
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ]
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** Sammelt alle Dreiecke der Szene in Weltkoordinaten. */
export function parseGLB(buf: Buffer): GlbParseResult {
  const { gltf, bin } = readContainer(buf)
  const warnings: string[] = []
  const triangles: number[] = []
  let primitives = 0
  let usedNodes = 0
  let skippedPrimitives = 0

  const sceneIndex = typeof gltf.scene === 'number' ? gltf.scene : 0
  const sceneNodes = gltf.scenes?.[sceneIndex]?.nodes
  const roots =
    sceneNodes && sceneNodes.length
      ? sceneNodes
      : (gltf.nodes ?? [])
          .map((_, index) => index)
          .filter(
            (index) =>
              !(gltf.nodes ?? []).some((node) => (node.children ?? []).includes(index)),
          )

  const visit = (nodeIndex: number, parent: number[], depth: number) => {
    if (depth > 64) return
    const node = gltf.nodes?.[nodeIndex]
    if (!node) return
    const world = multiply(parent, localMatrix(node))
    if (typeof node.mesh === 'number') {
      const primitivesOfMesh = gltf.meshes?.[node.mesh]?.primitives ?? []
      let contributed = false
      for (const primitive of primitivesOfMesh) {
        const mode = typeof primitive.mode === 'number' ? primitive.mode : 4
        if (mode !== 4) {
          skippedPrimitives += 1
          continue
        }
        const positionIndex = primitive.attributes?.POSITION
        if (typeof positionIndex !== 'number') {
          skippedPrimitives += 1
          continue
        }
        const positions = readAccessor(gltf, positionIndex, bin)
        if (positions.components < 3) {
          skippedPrimitives += 1
          continue
        }
        const indices =
          typeof primitive.indices === 'number'
            ? readAccessor(gltf, primitive.indices, bin)
            : null
        const vertexCount = positions.count
        const indexAt = (i: number) => (indices ? indices.values[i] : i)
        const total = indices ? indices.count : vertexCount
        for (let i = 0; i + 2 < total; i += 3) {
          const ia = indexAt(i)
          const ib = indexAt(i + 1)
          const ic = indexAt(i + 2)
          if (
            !Number.isInteger(ia) || !Number.isInteger(ib) || !Number.isInteger(ic) ||
            ia < 0 || ib < 0 || ic < 0 ||
            ia >= vertexCount || ib >= vertexCount || ic >= vertexCount ||
            ia === ib || ib === ic || ia === ic
          ) {
            continue
          }
          for (const vertex of [ia, ib, ic]) {
            const x = positions.values[vertex * 3]
            const y = positions.values[vertex * 3 + 1]
            const z = positions.values[vertex * 3 + 2]
            triangles.push(
              world[0] * x + world[4] * y + world[8] * z + world[12],
              world[1] * x + world[5] * y + world[9] * z + world[13],
              world[2] * x + world[6] * y + world[10] * z + world[14],
            )
          }
        }
        primitives += 1
        contributed = true
      }
      if (contributed) usedNodes += 1
    }
    for (const child of node.children ?? []) visit(child, world, depth + 1)
  }

  for (const root of roots) visit(root, IDENTITY, 0)

  if (skippedPrimitives) {
    warnings.push(
      `GLB: ${skippedPrimitives} Primitiv${skippedPrimitives === 1 ? '' : 'e'} ohne Dreiecke übersprungen (Punkte oder Linien).`,
    )
  }
  if (gltf.images?.length || gltf.textures?.length || gltf.materials?.length) {
    warnings.push('GLB: Texturen und Materialien werden nicht übernommen — gedruckt wird nur die Geometrie.')
  }
  if (!triangles.length) throw new Error('Die GLB enthält keine Dreiecke, die sich drucken lassen.')

  const mesh = makeMesh(new Float32Array(triangles))
  const longest = Math.max(mesh.bbox.size.x, mesh.bbox.size.y, mesh.bbox.size.z)
  if (longest > 0 && longest < 1) {
    warnings.push(
      `GLB: Die größte Kante ist nur ${longest.toFixed(3).replace('.', ',')} mm. glTF rechnet offiziell in Metern — der Slicer bietet nach dem Laden „100 mm größte Kante“ zum Anklicken an, oder über ein Ist-Maß im Scan-Assistenten.`,
    )
  }
  return { mesh, warnings, primitives, nodes: usedNodes }
}
