import type { DeepPartial, ModelObjectInfo, ModelPlacement, PaintMark, PrintSettings, TextPart } from '../shared/types.ts'
import { makeMesh, type Mesh } from './slicer/stl.ts'

export type ModelObject = {
  id: string
  name: string
  mesh: Mesh
  placement: ModelPlacement
  /** 0-basierte Platte einer 3MF-Datei */
  plate?: number
  /** Eingelassener Text — kein eigenes Druckobjekt, sondern eine Vertiefung */
  negative?: boolean
  /** Vom Druck ausgenommen, bleibt aber in der Objektliste sichtbar. */
  excluded?: boolean
  /** Textwerkzeug-Metadaten (Text, Größe, Versatz, Modus) */
  text?: TextPart
  /** Lage vor dem Teilen — für „Zusammenbauen“ in der ursprünglichen Position. */
  splitBase?: { x: number; y: number; z: number }
  /** Gemalte Stützen-Bereiche (Taste L) */
  paint?: PaintMark[]
  /** Objektbezogene Slicer-Werte aus einer 3MF-Datei; überschreiben nur dieses Objekt. */
  settings?: DeepPartial<PrintSettings>
}

export const defaultPlacement = (): ModelPlacement => ({
  offsetX: 0,
  offsetY: 0,
  offsetZ: 0,
  rotationX: 0,
  rotationY: 0,
  rotationZ: 0,
  scaleX: 1,
  scaleY: 1,
  scaleZ: 1,
  visible: true,
})

/**
 * Wendet Maßstab je Achse, Drehungen um X/Y/Z und die Verschiebung an.
 * Reihenfolge: skalieren → X → Y → Z drehen → verschieben.
 *
 * Gedreht wird um den Mittelpunkt des skalierten Meshes, nicht um den
 * Dateiursprung. Sonst springt ein Objekt mit frei gewähltem STL-Ursprung beim
 * Ziehen am Gizmo aus der Mitte — OrcaSlicer dreht ebenfalls um die Objektmitte.
 */
export function placeMesh(mesh: Mesh, p: ModelPlacement): Mesh {
  const rx = (p.rotationX * Math.PI) / 180
  const ry = (p.rotationY * Math.PI) / 180
  const rz = (p.rotationZ * Math.PI) / 180
  const cosX = Math.cos(rx), sinX = Math.sin(rx)
  const cosY = Math.cos(ry), sinY = Math.sin(ry)
  const cosZ = Math.cos(rz), sinZ = Math.sin(rz)
  const scaled = new Float32Array(mesh.positions.length)
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity

  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i] * p.scaleX
    const y = mesh.positions[i + 1] * p.scaleY
    const z = mesh.positions[i + 2] * p.scaleZ
    scaled[i] = x
    scaled[i + 1] = y
    scaled[i + 2] = z
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }

  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  const centerZ = (minZ + maxZ) / 2
  const out = new Float32Array(mesh.positions.length)

  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x0 = scaled[i] - centerX
    const y0 = scaled[i + 1] - centerY
    const z0 = scaled[i + 2] - centerZ

    // X-Achse
    const y1 = y0 * cosX - z0 * sinX
    const z1 = y0 * sinX + z0 * cosX
    // Y-Achse
    const x2 = x0 * cosY + z1 * sinY
    const z2 = -x0 * sinY + z1 * cosY
    // Z-Achse
    out[i] = x2 * cosZ - y1 * sinZ + centerX + p.offsetX
    out[i + 1] = x2 * sinZ + y1 * cosZ + centerY + p.offsetY
    out[i + 2] = z2 + centerZ + p.offsetZ
  }

  return makeMesh(out, mesh.ascii)
}

/**
 * Hält die tiefste Stelle bei einer Drehung auf ihrer bisherigen Höhe.
 *
 * `placeMesh` dreht um den Objektmittelpunkt. Bei einem hohen, schmalen
 * Objekt wandert die Unterseite dabei unter das Bett, obwohl der Mittelpunkt
 * gleich bleibt. Diese Korrektur wird nur bei einer reinen Drehung angewendet;
 * eine gleichzeitig eingegebene Z-Position bleibt unangetastet.
 */
export function keepBedHeight(
  mesh: Mesh,
  before: ModelPlacement,
  after: ModelPlacement,
): Partial<ModelPlacement> {
  const beforeMinZ = placeMesh(mesh, before).bbox.min.z
  const afterMinZ = placeMesh(mesh, after).bbox.min.z
  return { offsetZ: after.offsetZ + beforeMinZ - afterMinZ }
}

/** Setzt alle sichtbaren Objekte zu einem Mesh zusammen. Eingelassener Text
 *  (negative) gehört nicht dazu — er wird beim Slicen abgezogen. */
export function composeObjects(objects: ModelObject[]): Mesh | null {
  const parts = objects
    .filter((o) => o.placement.visible && !o.negative && !o.excluded)
    .map((o) => placeMesh(o.mesh, o.placement))
  if (!parts.length) return null

  const total = parts.reduce((n, m) => n + m.positions.length, 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part.positions, offset)
    offset += part.positions.length
  }
  return makeMesh(out, false)
}

/** Kurzinfo für die Oberfläche inklusive tatsächlicher Lage nach Platzierung. */
export function describeObjects(objects: ModelObject[]): ModelObjectInfo[] {
  return objects.map((o) => {
    const placed = placeMesh(o.mesh, o.placement)
    const { min, max, size } = placed.bbox
    return {
      id: o.id,
      name: o.name,
      plate: o.plate ?? 0,
      triangles: o.mesh.triangles,
      size: { x: Math.round(size.x * 10) / 10, y: Math.round(size.y * 10) / 10, z: Math.round(size.z * 10) / 10 },
      center: {
        x: Math.round(((min.x + max.x) / 2) * 10) / 10,
        y: Math.round(((min.y + max.y) / 2) * 10) / 10,
        z: Math.round(((min.z + max.z) / 2) * 10) / 10,
      },
      placement: { ...o.placement },
      filamentId: o.placement.filamentId,
      slotId: o.placement.slotId,
      excluded: o.excluded,
      negative: o.negative,
      text: o.text,
      paint: o.paint,
      settings: o.settings,
    }
  })
}
