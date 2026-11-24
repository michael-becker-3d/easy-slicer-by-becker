import type { ModelObjectInfo } from '../../shared/types.ts'
import { PREVIEW_STRIDE } from '../../shared/types.ts'

/** Rechteck eines Objekts in den Bettkoordinaten der Vorschau. */
export type PreviewFilterBounds = {
  id: string
  label: string
  plate: number
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/**
 * Baut aus den Modellobjekten die Filterflächen für die Vorschau. Die
 * Slice-Segmente liegen in Bettkoordinaten; `center` und `size` der Objekte
 * ebenfalls. `shiftX` gleicht den Versatz der aktiven Platte in der
 * Mehrplattenansicht aus, damit Filter und Slice-Segmente dieselbe Lage haben.
 * Ausgeschlossene und negative Objekte werden nicht angeboten.
 *
 * `originX`/`originY` verschieben die Modellkoordinaten in die Bettkoordinaten
 * der Vorschau: `Bettmitte - modelCenter`. Ohne diese Verschiebung läge ein
 * zentrierter Würfel bei -10…10 statt bei 112,5…132,5 und der Filter würde
 * jede Bahn ausblenden.
 */
export function buildPreviewFilterBounds(
  objects: ModelObjectInfo[],
  plate?: number,
  shiftX = 0,
  originX = 0,
  originY = 0,
): PreviewFilterBounds[] {
  return objects
    .filter((object) => {
      if (!object.placement.visible || object.excluded || object.negative) return false
      if (plate !== undefined && (object.plate ?? 0) !== plate) return false
      return object.size.x > 0 && object.size.y > 0
    })
    .map((object) => ({
      id: object.id,
      label: object.name,
      plate: object.plate ?? 0,
      minX: object.center.x + originX - shiftX - object.size.x / 2,
      maxX: object.center.x + originX - shiftX + object.size.x / 2,
      minY: object.center.y + originY - object.size.y / 2,
      maxY: object.center.y + originY + object.size.y / 2,
    }))
}

/**
 * Prüft ein Vorschau-Segment gegen die Objektfläche. Beide Endpunkte müssen
 * innerhalb der Fläche liegen. Nur den Mittelpunkt zu prüfen würde lange
 * Leerfahrten zwischen zwei Objekten behalten, wenn ihr Mittelpunkt zufällig
 * über dem ausgewählten Objekt liegt.
 */
export function segmentInsideFilter(
  data: number[],
  offset: number,
  filter: PreviewFilterBounds | null | undefined,
): boolean {
  if (!filter) return true
  if (offset + PREVIEW_STRIDE - 1 >= data.length) return false
  const margin = 0.6
  const inside = (x: number, y: number) =>
    x >= filter.minX - margin &&
    x <= filter.maxX + margin &&
    y >= filter.minY - margin &&
    y <= filter.maxY + margin
  return inside(data[offset + 1], data[offset + 2]) && inside(data[offset + 3], data[offset + 4])
}
