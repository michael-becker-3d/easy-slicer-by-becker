import type { BedMeshRecord } from './types.ts'

export type MeshDiff = {
  rows: number
  cols: number
  /** delta[r][c] = A − B in mm, positiv = A liegt höher */
  d: number[][]
  maxRise: number
  maxDrop: number
  maxAbs: number
  meanAbs: number
  rms: number
  /** Raster war unterschiedlich und wurde auf A umgerechnet */
  resampled: boolean
}

/** Bilineare Abtastung eines Rasters in normierten Koordinaten (0…1). */
function sampleNormalized(z: number[][], u: number, v: number): number {
  const rows = z.length
  const cols = z[0]?.length ?? 0
  if (!rows || !cols) return 0
  if (rows === 1 && cols === 1) return z[0][0] ?? 0

  const fy = v * (rows - 1)
  const fx = u * (cols - 1)
  const iy = Math.min(rows - 2, Math.max(0, Math.floor(fy)))
  const ix = Math.min(cols - 2, Math.max(0, Math.floor(fx)))
  const ty = Math.min(1, Math.max(0, fy - iy))
  const tx = Math.min(1, Math.max(0, fx - ix))

  const z00 = z[iy]?.[ix] ?? 0
  const z10 = z[iy]?.[ix + 1] ?? z00
  const z01 = z[iy + 1]?.[ix] ?? z00
  const z11 = z[iy + 1]?.[ix + 1] ?? z01
  const top = z00 + (z10 - z00) * tx
  const bottom = z01 + (z11 - z01) * tx
  return top + (bottom - top) * ty
}

/**
 * Vergleicht zwei Bettmessungen. Beide Messungen decken dieselbe Druckfläche ab,
 * deshalb wird über normierte Koordinaten verglichen — auch bei unterschiedlich
 * feinen Rastern. Das Ergebnis liegt auf dem Raster von `a`.
 */
export function diffBedMeshes(a: BedMeshRecord, b: BedMeshRecord): MeshDiff {
  const rows = a.z.length
  const cols = a.z[0]?.length ?? 0
  const d: number[][] = []

  let maxRise = 0
  let maxDrop = 0
  let maxAbs = 0
  let sumAbs = 0
  let sumSq = 0
  let n = 0

  for (let r = 0; r < rows; r++) {
    const row: number[] = []
    for (let c = 0; c < cols; c++) {
      const u = cols > 1 ? c / (cols - 1) : 0.5
      const v = rows > 1 ? r / (rows - 1) : 0.5
      const delta = (a.z[r]?.[c] ?? 0) - sampleNormalized(b.z, u, v)
      row.push(delta)
      if (delta > maxRise) maxRise = delta
      if (delta < maxDrop) maxDrop = delta
      const abs = Math.abs(delta)
      if (abs > maxAbs) maxAbs = abs
      sumAbs += abs
      sumSq += delta * delta
      n++
    }
    d.push(row)
  }

  return {
    rows,
    cols,
    d,
    maxRise,
    maxDrop,
    maxAbs,
    meanAbs: n ? sumAbs / n : 0,
    rms: n ? Math.sqrt(sumSq / n) : 0,
    resampled: a.rows !== b.rows || a.cols !== b.cols,
  }
}
