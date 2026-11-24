import type { ModelAnalysis } from '../shared/types.ts'
import type { Mesh } from './slicer/stl.ts'

export function analyzeMesh(mesh: Mesh, name: string): ModelAnalysis {
  const p = mesh.positions
  const { min, max, size } = mesh.bbox
  let volume = 0
  let area = 0
  let overhang = 0
  let flatTop = 0
  let footprint = 0

  for (let t = 0; t < mesh.triangles; t++) {
    const i = t * 9
    const ax = p[i], ay = p[i + 1], az = p[i + 2]
    const bx = p[i + 3], by = p[i + 4], bz = p[i + 5]
    const cx = p[i + 6], cy = p[i + 7], cz = p[i + 8]

    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6

    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz)
    if (len < 1e-9) continue
    const triArea = len / 2
    area += triArea

    const unitNz = nz / len
    const tileZ = Math.min(az, bz, cz)

    if (unitNz < -0.7 && tileZ > 1) overhang += triArea
    if (unitNz > 0.98) {
      flatTop += triArea
      if (Math.abs(tileZ - max.z) < 0.6) footprint += triArea
    }
  }

  return {
    name,
    triangles: mesh.triangles,
    bbox: { min, max, size },
    volumeMm3: Math.abs(volume),
    surfaceAreaMm2: area,
    overhangRatio: area > 0 ? overhang / area : 0,
    flatTopRatio: area > 0 ? flatTop / area : 0,
    footprintAreaMm2: Math.max(footprint, 0.01),
  }
}
