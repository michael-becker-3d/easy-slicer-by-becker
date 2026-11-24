import type { BedMesh, PrinterProfile } from '../../shared/types.ts'

export type ProbePoint = { x: number; y: number; z: number }

/** Liest "Bed X: 10.00 Y: 20.00 Z: 0.123" Zeilen (G29 / G30). */
export function parseProbeLines(lines: string[]): ProbePoint[] {
  const pts: ProbePoint[] = []
  const re = /Bed X:\s*(-?[\d.]+)\s*Y:\s*(-?[\d.]+)\s*Z:\s*(-?[\d.]+)/i
  for (const l of lines) {
    const m = l.match(re)
    if (m) pts.push({ x: parseFloat(m[1]), y: parseFloat(m[2]), z: parseFloat(m[3]) })
  }
  return pts
}

/** Baut ein Raster aus beliebig geordneten Messpunkten. */
export function meshFromPoints(points: ProbePoint[], profile: PrinterProfile): BedMesh | null {
  if (points.length < 4) return null
  const xs = [...new Set(points.map((p) => Math.round(p.x * 10) / 10))].sort((a, b) => a - b)
  const ys = [...new Set(points.map((p) => Math.round(p.y * 10) / 10))].sort((a, b) => a - b)
  const cols = xs.length
  const rows = ys.length
  if (cols < 2 || rows < 2) return null

  const z: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0))
  const filled: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(false))
  for (const p of points) {
    const c = xs.indexOf(Math.round(p.x * 10) / 10)
    const r = ys.indexOf(Math.round(p.y * 10) / 10)
    if (c >= 0 && r >= 0) {
      z[r][c] = p.z
      filled[r][c] = true
    }
  }
  // Lücken mit Nachbarmittel füllen
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (filled[r][c]) continue
      let sum = 0, n = 0
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const rr = r + dr, cc = c + dc
        if (rr >= 0 && rr < rows && cc >= 0 && cc < cols && filled[rr][cc]) {
          sum += z[rr][cc]
          n++
        }
      }
      z[r][c] = n ? sum / n : 0
    }
  }

  return {
    cols,
    rows,
    x0: xs[0],
    y0: ys[0],
    dx: cols > 1 ? (xs[cols - 1] - xs[0]) / (cols - 1) : 1,
    dy: rows > 1 ? (ys[rows - 1] - ys[0]) / (rows - 1) : 1,
    z,
    source: 'firmware',
    capturedAt: Date.now(),
  }
}

/** Liest die Mesh-Tabelle aus `M420 V`. */
export function parseMeshTable(lines: string[], profile: PrinterProfile): BedMesh | null {
  let cols = 0
  let rows = 0
  const grid: number[][] = []

  for (const raw of lines) {
    const line = raw.replace(/^Recv:\s*/i, '').trim()
    const numXY = line.match(/Num X,Y:\s*(\d+)\s*,\s*(\d+)/i)
    if (numXY) {
      cols = parseInt(numXY[1], 10)
      rows = parseInt(numXY[2], 10)
      continue
    }
    const m = line.match(/^(-?\d+)\s+(.*)$/)
    if (!m) continue
    const rowIdx = parseInt(m[1], 10)
    const nums = m[2].replace(/\+/g, ' ').trim().split(/\s+/).map((v) => parseFloat(v.replace(/^-/, (s) => s)))
    // "+0.12345" -> nach dem Ersetzen bleibt "-0.12345" bzw. "0.12345"
    const values: number[] = []
    for (const token of m[2].split(/\s+/)) {
      const v = parseFloat(token)
      if (Number.isFinite(v)) values.push(v)
    }
    if (values.length >= 2 && !/^\d+$/.test(m[2].trim())) {
      grid[rowIdx] = values
      void nums
    }
  }

  const realRows = grid.filter(Boolean)
  if (!realRows.length) return null
  const realCols = Math.max(...realRows.map((r) => r.length))
  if (realCols < 2 || realRows.length < 2) return null

  const margin = profile.meshGrid.margin
  const spanX = profile.bed.x - margin * 2
  const spanY = profile.bed.y - margin * 2
  const c = cols || realCols
  const r = rows || realRows.length

  return {
    cols: realCols,
    rows: realRows.length,
    x0: margin,
    y0: margin,
    dx: (realCols > 1 ? spanX : 0) / Math.max(1, c - 1) || 1,
    dy: (realRows.length > 1 ? spanY : 0) / Math.max(1, r - 1) || 1,
    z: realRows,
    source: 'firmware',
    capturedAt: Date.now(),
  }
}

export function meshStats(mesh: BedMesh): { min: number; max: number; spread: number; mean: number } {
  const flat = mesh.z.flat()
  const min = Math.min(...flat)
  const max = Math.max(...flat)
  const mean = flat.reduce((a, b) => a + b, 0) / Math.max(1, flat.length)
  return { min, max, spread: max - min, mean }
}
