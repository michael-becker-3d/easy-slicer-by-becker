import type { ModelObjectInfo, Vec3 } from './types.ts'

/** Die drei Feldgruppen, die der Transformationsdialog bearbeitet. */
export type ObjectTransformFields = {
  sizes: Vec3
  rot: Vec3
  pos: Vec3
}

/** Werte, die die Live-Vorschau an `/api/models/:id/objects` schickt. */
export type ObjectTransformPatch = {
  id: string
  scaleX: number
  scaleY: number
  scaleZ: number
  rotationX: number
  rotationY: number
  rotationZ: number
  offsetX: number
  offsetY: number
  offsetZ: number
}

export const sameVec3 = (a: Vec3, b: Vec3): boolean =>
  a.x === b.x && a.y === b.y && a.z === b.z

export const sameTransformFields = (
  a: ObjectTransformFields,
  b: ObjectTransformFields,
): boolean => sameVec3(a.sizes, b.sizes) && sameVec3(a.rot, b.rot) && sameVec3(a.pos, b.pos)

/**
 * Ausgangsmaße für die Prozentfelder. `object.size` ist bereits die gedrehte
 * Bounding-Box; der Maßstab wird deshalb herausgerechnet, damit die Prozent-
 * anzeige bei einer reinen Drehung nicht plötzlich einen anderen Wert zeigt.
 */
export function transformBase(object: ModelObjectInfo | null): Vec3 {
  if (!object) return { x: 1, y: 1, z: 1 }
  const placement = object.placement
  return {
    x: Math.max(0.01, object.size.x / (placement.scaleX || 1)),
    y: Math.max(0.01, object.size.y / (placement.scaleY || 1)),
    z: Math.max(0.01, object.size.z / (placement.scaleZ || 1)),
  }
}

/**
 * Übernimmt den aktuellen Serverzustand in die Dialogfelder.
 *
 * Wichtig: Nach einer Drehung ändern sich die Maße und die tiefste Stelle.
 * Würden nur die Winkel übernommen, würde die nächste Vorschau alte Maße
 * gegen die neue Bounding-Box rechnen und das Objekt stauchen.
 */
export function transformFields(object: ModelObjectInfo | null): ObjectTransformFields {
  if (!object) {
    return {
      sizes: { x: 0, y: 0, z: 0 },
      rot: { x: 0, y: 0, z: 0 },
      pos: { x: 0, y: 0, z: 0 },
    }
  }
  return {
    sizes: { x: object.size.x, y: object.size.y, z: object.size.z },
    rot: {
      x: object.placement.rotationX,
      y: object.placement.rotationY,
      z: object.placement.rotationZ,
    },
    pos: {
      x: object.placement.offsetX,
      y: object.placement.offsetY,
      z: object.placement.offsetZ,
    },
  }
}

/** Baut aus den Dialogfeldern die Objektänderung für die nächste Vorschau. */
export function transformPatch(
  object: ModelObjectInfo | null,
  fields: ObjectTransformFields,
  base = transformBase(object),
): ObjectTransformPatch | null {
  if (!object) return null
  return {
    id: object.id,
    scaleX: Math.max(0.05, Math.min(10, fields.sizes.x / base.x)),
    scaleY: Math.max(0.05, Math.min(10, fields.sizes.y / base.y)),
    scaleZ: Math.max(0.05, Math.min(10, fields.sizes.z / base.z)),
    rotationX: fields.rot.x,
    rotationY: fields.rot.y,
    rotationZ: fields.rot.z,
    offsetX: fields.pos.x,
    offsetY: fields.pos.y,
    offsetZ: fields.pos.z,
  }
}
