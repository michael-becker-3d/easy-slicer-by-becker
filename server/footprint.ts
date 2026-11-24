import type { PrinterProfile } from '../shared/types.ts'
import type { Mesh } from './slicer/stl.ts'

export type Area = { x0: number; y0: number; x1: number; y1: number }

/**
 * Modellbereich auf dem Bett — identisch zur Platzierung im Slicer
 * (mittig auf dem Bett). Der Rand wird addiert und auf das Bett begrenzt.
 */
export function footprintOnBed(mesh: Mesh, profile: PrinterProfile, margin: number): Area {
  const { min, max } = mesh.bbox
  const ox = profile.bed.x / 2 - (min.x + max.x) / 2
  const oy = profile.bed.y / 2 - (min.y + max.y) / 2
  const m = Math.max(0, margin)
  const pad = 2

  return {
    x0: Math.max(pad, min.x + ox - m),
    y0: Math.max(pad, min.y + oy - m),
    x1: Math.min(profile.bed.x - pad, max.x + ox + m),
    y1: Math.min(profile.bed.y - pad, max.y + oy + m),
  }
}

export function areaSize(area: Area): { w: number; h: number } {
  return { w: Math.max(0, area.x1 - area.x0), h: Math.max(0, area.y1 - area.y0) }
}
