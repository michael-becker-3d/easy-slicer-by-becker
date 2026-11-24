/*
 * Proprietaerer Bestandteil der Easy-Slicer-Slice-Engine.
 * Copyright (c) 2026 Michael Becker. Alle Rechte vorbehalten.
 * Nutzung nur im Rahmen von LICENSE und LICENSE-SLICE-ENGINE.md.
 */
import { booleanPolys, offsetPolys, type Poly, type Pt } from './clipper.ts'

/**
 * Arachne-artiger Wandgenerator (nachgebaut, nicht kopiert).
 *
 * Der Kern der Idee: Eine Wand besteht nicht aus starren Ringen gleicher
 * Breite. Wo das Bauteil schmaler ist als eine Wandbreite, gibt es keinen
 * sinnvollen Ring — dort wird die Mittellinie gedruckt und die Extrusionsbreite
 * an die tatsächliche Dicke angepasst. Breite Stellen bekommen weiterhin
 * normale Ringe.
 *
 * Umsetzung: Die Region wird morphologisch geöffnet (um halbe Wandbreite
 * einziehen und wieder aufweiten). Was dabei verschwindet, ist per Definition
 * schmaler als eine Wand. Für diese Restflächen wird über eine
 * Distanztransformation die Mittellinie bestimmt; die doppelte Distanz zur
 * Kante ist die örtliche Breite.
 */

export type WallPlan = {
  /** Ringe von außen (Index 0) nach innen. */
  rings: Poly[][]
  /** Mittellinien für Stellen schmaler als eine Wandbreite. */
  thin: { pts: Pt[]; width: number }[]
}

/** Grenzen für die variable Breite der Lückenfüllung. */
export type GapFillPlan = {
  enabled: boolean
  minWidth: number
  maxWidth: number
}

/** Wird gesetzt, wenn eine dünne Fläche aus Ressourcengründen nicht geplant werden konnte. */
export type WallReport = { omittedThinAreas: number }

const MAX_CELLS = 250_000
const MIN_THIN_AREA = 0.3
const MAX_RIDGE_CELLS = 40_000

type Box = { minX: number; minY: number; maxX: number; maxY: number }

function boundsOf(polys: Poly[]): Box | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const poly of polys) {
    for (const p of poly) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null
}

/** Scanline-Rasterung der Region (Even-Odd über alle Ringe). */
function rasterize(polys: Poly[], res: number, box: Box): { w: number; h: number; mask: Uint8Array } {
  const w = Math.max(1, Math.ceil((box.maxX - box.minX) / res))
  const h = Math.max(1, Math.ceil((box.maxY - box.minY) / res))
  const mask = new Uint8Array(w * h)
  const xs: number[] = []
  for (let row = 0; row < h; row++) {
    const y = box.minY + (row + 0.5) * res
    xs.length = 0
    for (const poly of polys) {
      for (let i = 0, n = poly.length; i < n; i++) {
        const a = poly[i], b = poly[(i + 1) % n]
        if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
          xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x))
        }
      }
    }
    xs.sort((p, q) => p - q)
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const from = Math.max(0, Math.ceil((xs[i] - box.minX) / res - 0.5))
      const to = Math.min(w - 1, Math.floor((xs[i + 1] - box.minX) / res - 0.5))
      for (let x = from; x <= to; x++) mask[row * w + x] = 1
    }
  }
  return { w, h, mask }
}

/** Chamfer-Distanztransformation (1 / √2) — Abstand jeder Zelle zur Kante. */
function distanceField(mask: Uint8Array, w: number, h: number): Float32Array {
  const d = new Float32Array(w * h)
  const INF = 1e9
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? INF : 0
  const A = 1
  const B = Math.SQRT2
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!mask[i]) continue
      let v = d[i]
      if (x > 0) v = Math.min(v, d[i - 1] + A)
      if (y > 0) {
        v = Math.min(v, d[i - w] + A)
        if (x > 0) v = Math.min(v, d[i - w - 1] + B)
        if (x + 1 < w) v = Math.min(v, d[i - w + 1] + B)
      }
      d[i] = v
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      if (!mask[i]) continue
      let v = d[i]
      if (x + 1 < w) v = Math.min(v, d[i + 1] + A)
      if (y + 1 < h) {
        v = Math.min(v, d[i + w] + A)
        if (x + 1 < w) v = Math.min(v, d[i + w + 1] + B)
        if (x > 0) v = Math.min(v, d[i + w - 1] + B)
      }
      d[i] = v
    }
  }
  return d
}

const NEIGHBOURS: [number, number][] = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
]

/**
 * Zhang-Suen-Skelettierung: reduziert einen zwei Zellen breiten Grat auf eine
 * einzige Zellenkette, ohne Endpunkte oder Verbindungen zu verlieren.
 */
function thinMask(mask: Uint8Array, w: number, h: number): Uint8Array {
  const img = Uint8Array.from(mask)
  if (w < 3 || h < 3) return img
  for (let pass = 0; pass < 12; pass++) {
    let changed = false
    for (const step of [0, 1]) {
      const remove: number[] = []
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x
          if (!img[i]) continue
          const p2 = img[i - w], p3 = img[i - w + 1], p4 = img[i + 1], p5 = img[i + w + 1]
          const p6 = img[i + w], p7 = img[i + w - 1], p8 = img[i - 1], p9 = img[i - w - 1]
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
          if (b < 2 || b > 6) continue
          const ring = [p2, p3, p4, p5, p6, p7, p8, p9, p2]
          let transitions = 0
          for (let k = 0; k < 8; k++) if (ring[k] === 0 && ring[k + 1] === 1) transitions++
          if (transitions !== 1) continue
          if (step === 0) {
            if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue
          } else if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue
          remove.push(i)
        }
      }
      if (remove.length) {
        changed = true
        for (const i of remove) img[i] = 0
      }
    }
    if (!changed) break
  }
  return img
}

/** Ramer-Douglas-Peucker: entfernt Zwischenpunkte ohne Formverlust. */
function simplify(pts: Pt[], eps: number): Pt[] {
  if (pts.length <= 2) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = 1
  keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop() as [number, number]
    let far = -1
    let farD = eps
    const ax = pts[first].x, ay = pts[first].y
    const bx = pts[last].x, by = pts[last].y
    const dx = bx - ax, dy = by - ay
    const len = Math.hypot(dx, dy) || 1
    for (let i = first + 1; i < last; i++) {
      const dist = Math.abs((pts[i].x - ax) * dy - (pts[i].y - ay) * dx) / len
      if (dist > farD) {
        farD = dist
        far = i
      }
    }
    if (far > 0) {
      keep[far] = 1
      stack.push([first, far], [far, last])
    }
  }
  return pts.filter((_, i) => keep[i] === 1)
}

/** Mittellinien der schmalen Restflächen inklusive örtlicher Breite. */
function centerlines(
  area: Poly[],
  lineWidth: number,
  gapFill: GapFillPlan,
  report?: WallReport,
): { pts: Pt[]; width: number }[] {
  const box = boundsOf(area)
  if (!box) return []
  const boxArea = (box.maxX - box.minX) * (box.maxY - box.minY)
  if (!(boxArea > 0)) return []
  // Auflösung so wählen, dass die Zellzahl begrenzt bleibt (dünne Stellen sind
  // meist klein; bei großen Flächen wird gröber gerechnet).
  const res = Math.max(0.08, Math.min(0.25, lineWidth / 5), Math.sqrt(boxArea / MAX_CELLS))
  const { w, h, mask } = rasterize(area, res, box)
  if (w * h > MAX_CELLS * 1.2) {
    if (report) report.omittedThinAreas++
    return []
  }
  const d = distanceField(mask, w, h)

  const minWidth = Math.max(0.05, Math.min(lineWidth, gapFill.minWidth))
  const maxWidth = Math.max(minWidth, Math.min(lineWidth * 1.5, gapFill.maxWidth))
  const minDist = minWidth / 2 / res

  const isRidge = (x: number, y: number): boolean => {
    const i = y * w + x
    const v = d[i]
    if (!mask[i] || v < minDist || v >= 1e8) return false
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      if (d[ny * w + nx] > v + 1e-6) return false
    }
    return true
  }

  // Der Grat einer schmalen Fläche ist oft zwei Zellen breit. Ohne Skelettierung
  // würde die Mittellinie hin und zurück laufen und die Stelle doppelt füllen.
  const ridgeMask = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (isRidge(x, y)) ridgeMask[y * w + x] = 1
  const skeleton = thinMask(ridgeMask, w, h)
  const ridge = new Set<number>()
  for (let i = 0; i < skeleton.length; i++) if (skeleton[i]) ridge.add(i)
  if (!ridge.size || ridge.size > MAX_RIDGE_CELLS) {
    if (ridge.size > MAX_RIDGE_CELLS && report) report.omittedThinAreas++
    return []
  }

  const degree = (i: number): number => {
    const x = i % w, y = (i / w) | 0
    let n = 0
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      if (ridge.has(ny * w + nx)) n++
    }
    return n
  }

  const toPt = (i: number): Pt => ({
    x: box.minX + ((i % w) + 0.5) * res,
    y: box.minY + (((i / w) | 0) + 0.5) * res,
  })

  const used = new Set<number>()
  const chains: number[][] = []
  const walk = (start: number) => {
    const chain: number[] = []
    let cur = start
    while (cur >= 0 && !used.has(cur)) {
      used.add(cur)
      chain.push(cur)
      const x = cur % w, y = (cur / w) | 0
      let next = -1
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const ni = ny * w + nx
        if (ridge.has(ni) && !used.has(ni)) {
          next = ni
          break
        }
      }
      cur = next
    }
    if (chain.length >= 3) chains.push(chain)
  }

  // Zuerst an Endpunkten beginnen, dann bleiben nur geschlossene Ringe übrig.
  for (const cell of ridge) if (degree(cell) <= 1) walk(cell)
  for (const cell of ridge) if (!used.has(cell)) walk(cell)

  const out: { pts: Pt[]; width: number }[] = []
  for (const chain of chains) {
    const widths = chain.map((i) => d[i] * 2 * res).sort((a, b) => a - b)
    const width = Math.max(minWidth, Math.min(maxWidth, widths[Math.floor(widths.length / 2)]))
    const pts = simplify(chain.map(toPt), res * 1.5)
    let length = 0
    for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    if (length < Math.max(0.5, lineWidth)) continue
    out.push({ pts, width })
  }
  return out
}

/**
 * Plant die Wände einer Schicht: normale Ringe außen nach innen plus
 * Arachne-Mittellinien für Stellen, die keine volle Wandbreite haben.
 */
export function planWalls(
  region: Poly[],
  lineWidth: number,
  wallCount: number,
  report?: WallReport,
  gapFill: GapFillPlan = { enabled: true, minWidth: 0.2, maxWidth: lineWidth * 1.02 },
): WallPlan {
  const rings: Poly[][] = []
  if (!region.length || wallCount <= 0 || lineWidth <= 0) return { rings, thin: [] }

  // Körper, der eine volle Wandbreite aufnehmen kann.
  const opened = offsetPolys(offsetPolys(region, -lineWidth / 2), lineWidth / 2)
  const body = opened.length ? opened : region

  for (let i = 0; i < wallCount; i++) {
    // Außenwand folgt der echten Kontur, Innenwände dem tragfähigen Körper.
    const ring = i === 0 ? offsetPolys(region, -lineWidth / 2) : offsetPolys(body, -lineWidth * (i + 0.5))
    if (ring.length) rings.push(ring)
  }

  // Wichtig: Auch wenn die Öffnung leer ist (eine Schicht besteht nur aus
  // Bereichen schmaler als eine Linienbreite), muss der Rest die ganze Region
  // sein. Sonst fehlen genau dort sämtliche Mittellinien.
  const rest = opened.length ? booleanPolys(region, opened, 'diff') : region
  const thin = rest.length && gapFill.enabled ? centerlines(rest, lineWidth, gapFill, report) : []
  return { rings, thin }
}

/** Reihenfolge der dünnen Bahnen: immer die nächstgelegene, Richtung frei. */
export function orderThin(
  thin: { pts: Pt[]; width: number }[],
  from: Pt,
): { pts: Pt[]; width: number }[] {
  const remaining = thin.slice()
  const out: { pts: Pt[]; width: number }[] = []
  let cur = from
  while (remaining.length) {
    let best = 0
    let bestD = Infinity
    let flip = false
    for (let i = 0; i < remaining.length; i++) {
      const a = remaining[i].pts[0]
      const b = remaining[i].pts[remaining[i].pts.length - 1]
      const da = (a.x - cur.x) ** 2 + (a.y - cur.y) ** 2
      const db = (b.x - cur.x) ** 2 + (b.y - cur.y) ** 2
      if (da < bestD) { bestD = da; best = i; flip = false }
      if (db < bestD) { bestD = db; best = i; flip = true }
    }
    const pick = remaining.splice(best, 1)[0]
    const pts = flip ? [...pick.pts].reverse() : pick.pts
    out.push({ pts, width: pick.width })
    cur = pts[pts.length - 1]
  }
  return out
}
