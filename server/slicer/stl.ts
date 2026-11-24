/*
 * Proprietaerer Bestandteil der Easy-Slicer-Slice-Engine.
 * Copyright (c) 2026 Michael Becker. Alle Rechte vorbehalten.
 * Nutzung nur im Rahmen von LICENSE und LICENSE-SLICE-ENGINE.md.
 */
import type { Vec3 } from '../../shared/types.ts'

export type Mesh = {
  /** 9 Floats pro Dreieck (x1,y1,z1,x2,y2,z2,x3,y3,z3) */
  positions: Float32Array
  triangles: number
  bbox: { min: Vec3; max: Vec3; size: Vec3 }
  ascii: boolean
}

/** Parst binäre und ASCII-STL-Dateien. */
export function parseSTL(buf: Buffer): Mesh {
  if (buf.length > 84) {
    const count = buf.readUInt32LE(80)
    if (count > 0 && 84 + count * 50 <= buf.length) {
      return parseBinary(buf, count)
    }
  }
  return parseAscii(buf.toString('utf8'))
}

function parseBinary(buf: Buffer, count: number): Mesh {
  const positions = new Float32Array(count * 9)
  let o = 84
  for (let i = 0; i < count; i++) {
    o += 12 // Normale überspringen
    for (let v = 0; v < 9; v++) {
      positions[i * 9 + v] = buf.readFloatLE(o)
      o += 4
    }
    o += 2 // Attribute
  }
  return finish(positions, count, false)
}

function parseAscii(text: string): Mesh {
  const re = /vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/g
  const vals: number[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    vals.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]))
  }
  const count = Math.floor(vals.length / 9)
  const positions = new Float32Array(count * 9)
  for (let i = 0; i < count * 9; i++) positions[i] = vals[i]
  return finish(positions, count, true)
}

/** Baut ein Mesh aus rohen Dreieckskoordinaten und berechnet die Bounding-Box. */
export function makeMesh(positions: Float32Array, ascii = false): Mesh {
  const count = Math.floor(positions.length / 9)
  const min: Vec3 = { x: Infinity, y: Infinity, z: Infinity }
  const max: Vec3 = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (let i = 0; i < count * 9; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2]
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
    if (x < min.x) min.x = x
    if (y < min.y) min.y = y
    if (z < min.z) min.z = z
    if (x > max.x) max.x = x
    if (y > max.y) max.y = y
    if (z > max.z) max.z = z
  }
  if (!Number.isFinite(min.x)) {
    min.x = min.y = min.z = 0
    max.x = max.y = max.z = 0
  }
  return {
    positions,
    triangles: count,
    bbox: { min, max, size: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z } },
    ascii,
  }
}

function finish(positions: Float32Array, count: number, ascii: boolean): Mesh {
  void count
  return makeMesh(positions, ascii)
}

export function transformMesh(mesh: Mesh, offset: Vec3): Mesh {
  const positions = new Float32Array(mesh.positions.length)
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = mesh.positions[i] + offset.x
    positions[i + 1] = mesh.positions[i + 1] + offset.y
    positions[i + 2] = mesh.positions[i + 2] + offset.z
  }
  return {
    ...mesh,
    positions,
    bbox: {
      min: { x: mesh.bbox.min.x + offset.x, y: mesh.bbox.min.y + offset.y, z: mesh.bbox.min.z + offset.z },
      max: { x: mesh.bbox.max.x + offset.x, y: mesh.bbox.max.y + offset.y, z: mesh.bbox.max.z + offset.z },
      size: mesh.bbox.size,
    },
  }
}

/** Skaliert das Netz um die Faktoren (Schrumpfkompensation). */
export function scaleMesh(mesh: Mesh, sx: number, sy: number, sz: number): Mesh {
  const positions = new Float32Array(mesh.positions.length)
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = mesh.positions[i] * sx
    positions[i + 1] = mesh.positions[i + 1] * sy
    positions[i + 2] = mesh.positions[i + 2] * sz
  }
  return makeMesh(positions, mesh.ascii)
}

/** Erzeugt ein binäres STL aus einer Dreiecksliste (für Demo-Modelle). */
export function buildBinarySTL(triangles: number[][]): Buffer {
  const count = triangles.length
  const buf = Buffer.alloc(84 + count * 50)
  buf.write('Easy-Slicer Demo', 0)
  buf.writeUInt32LE(count, 80)
  let o = 84
  for (const t of triangles) {
    o += 12
    for (let i = 0; i < 9; i++) {
      buf.writeFloatLE(t[i], o)
      o += 4
    }
    o += 2
  }
  return buf
}
