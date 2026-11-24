/*
 * Proprietaerer Bestandteil der Easy-Slicer-Slice-Engine.
 * Copyright (c) 2026 Michael Becker. Alle Rechte vorbehalten.
 * Nutzung nur im Rahmen von LICENSE und LICENSE-SLICE-ENGINE.md.
 */
import type { InfillPattern } from '../../shared/types.ts'
import { polysBounds } from './geom.ts'
import { offsetPolys, pointInPoly, type Poly } from './clipper.ts'

export type Segment = { a: { x: number; y: number }; b: { x: number; y: number } }

/** Meldet gekürzte Muster bzw. den Fallback bei zu vielen Segmenten. */
export type InfillReport = { truncated: boolean; orderFallback: boolean }

const MAX_SEGMENTS = 40000

/**
 * Erzeugt parallele Linien im Winkel `angle` und schneidet sie per
 * Even-Odd-Regel mit der Region (Löcher werden automatisch ausgespart).
 */
export function clipLines(
  polys: Poly[],
  angleDeg: number,
  spacing: number,
  report?: InfillReport,
): Segment[] {
  if (!polys.length || spacing <= 0.02) return []
  const angle = (angleDeg * Math.PI) / 180
  const c = Math.cos(angle), s = Math.sin(angle)
  const rot = (p: { x: number; y: number }) => ({ x: p.x * c + p.y * s, y: -p.x * s + p.y * c })

  const rotated = polys.map((poly) => poly.map(rot))
  const bounds = polysBounds(rotated)
  if (!Number.isFinite(bounds.minY)) return []

  const out: Segment[] = []
  const startY = Math.ceil(bounds.minY / spacing) * spacing + spacing * 0.5

  for (let y = startY; y < bounds.maxY; y += spacing) {
    const xs: number[] = []
    for (const poly of rotated) {
      for (let i = 0, n = poly.length; i < n; i++) {
        const a = poly[i], b = poly[(i + 1) % n]
        if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
          xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x))
        }
      }
    }
    xs.sort((p, q) => p - q)
    for (let i = 0; i + 1 < xs.length; i += 2) {
      if (xs[i + 1] - xs[i] > 0.05) {
        out.push({
          a: { x: xs[i] * c - y * s, y: xs[i] * s + y * c },
          b: { x: xs[i + 1] * c - y * s, y: xs[i + 1] * s + y * c },
        })
        if (out.length > MAX_SEGMENTS) {
          if (report) report.truncated = true
          return out
        }
      }
    }
  }
  return out
}

function insideRegion(polys: Poly[], p: { x: number; y: number }): boolean {
  let inside = false
  // Even-Odd über alle Ringe: Ein Punkt in einem Loch ist NICHT innerhalb
  // der Region, auch wenn er innerhalb der Außenkontur liegt.
  for (const poly of polys) if (pointInPoly(p, poly)) inside = !inside
  return inside
}

/**
 * Schneidet eine Strecke exakt an allen Polygongrenzen und behält nur die
 * Abschnitte, deren Mittelpunkt innerhalb der Region liegt. Damit können
 * Waben/Gyroiden nicht mehr über die Wand hinausragen.
 */
function clipSegmentToRegion(region: Poly[], seg: Segment): Segment[] {
  const dx = seg.b.x - seg.a.x
  const dy = seg.b.y - seg.a.y
  const length = Math.hypot(dx, dy)
  if (length < 1e-9) return []

  const ts: number[] = [0, 1]
  const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx
  for (const poly of region) {
    for (let i = 0, n = poly.length; i < n; i++) {
      const a = poly[i]
      const b = poly[(i + 1) % n]
      const rx = b.x - a.x
      const ry = b.y - a.y
      const denom = cross(dx, dy, rx, ry)
      if (Math.abs(denom) < 1e-12) continue
      const qx = a.x - seg.a.x
      const qy = a.y - seg.a.y
      const t = cross(qx, qy, rx, ry) / denom
      const u = cross(qx, qy, dx, dy) / denom
      if (t > 1e-9 && t < 1 - 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) ts.push(t)
    }
  }
  ts.sort((a, b) => a - b)
  const unique: number[] = []
  for (const t of ts) {
    if (!unique.length || Math.abs(t - unique[unique.length - 1]) > 1e-7) unique.push(t)
  }
  const out: Segment[] = []
  for (let i = 0; i + 1 < unique.length; i++) {
    const t0 = unique[i]
    const t1 = unique[i + 1]
    if (t1 - t0 < 1e-9) continue
    const mid = (t0 + t1) / 2
    if (!insideRegion(region, { x: seg.a.x + dx * mid, y: seg.a.y + dy * mid })) continue
    out.push({
      a: { x: seg.a.x + dx * t0, y: seg.a.y + dy * t0 },
      b: { x: seg.a.x + dx * t1, y: seg.a.y + dy * t1 },
    })
  }
  return out
}

function segmentKey(s: Segment): string {
  const k = (p: { x: number; y: number }) => `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`
  const a = k(s.a), b = k(s.b)
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/** Echte Bienenwaben: sechs Kanten je Zelle, doppelte Kanten werden entfernt. */
function honeycombSegments(
  region: Poly[],
  spacing: number,
  lineWidth: number,
  report?: InfillReport,
): Segment[] {
  const bounds = polysBounds(region)
  if (!Number.isFinite(bounds.minX)) return []
  const r = Math.max(lineWidth * 1.2, spacing * 0.85)
  const dx = r * 1.5
  const dy = Math.sqrt(3) * r
  const out: Segment[] = []
  const seen = new Set<string>()
  const add = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    if (Math.hypot(b.x - a.x, b.y - a.y) < 0.08) return
    const seg = { a, b }
    const key = segmentKey(seg)
    if (seen.has(key)) return
    seen.add(key)
    for (const part of clipSegmentToRegion(region, seg)) {
      out.push(part)
      if (out.length > MAX_SEGMENTS) {
        if (report) report.truncated = true
        return
      }
    }
  }

  const startRow = Math.floor((bounds.minY - dy) / dy)
  const endRow = Math.ceil((bounds.maxY + dy) / dy)
  const startCol = Math.floor((bounds.minX - dx) / dx)
  const endCol = Math.ceil((bounds.maxX + dx) / dx)
  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      const cx = col * dx
      const cy = row * dy + (col % 2 === 0 ? 0 : dy / 2)
      const verts = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i
        return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }
      })
      for (let i = 0; i < 6; i++) add(verts[i], verts[(i + 1) % 6])
      if (out.length > MAX_SEGMENTS) {
        if (report) report.truncated = true
        return out
      }
    }
  }
  return out
}

/**
 * Gyroid-Näherung für eine Schicht: sinusförmig verschobene Linien. Das ist
 * keine exakte 3D-Gyroidfläche, aber ein weiches, in alle Richtungen
 * belastbares Muster mit echtem Richtungswechsel zwischen den Schichten.
 */
function gyroidSegments(
  region: Poly[],
  spacing: number,
  lineWidth: number,
  layerIndex: number,
  report?: InfillReport,
): Segment[] {
  const bounds = polysBounds(region)
  if (!Number.isFinite(bounds.minX)) return []
  const step = Math.max(lineWidth * 1.2, spacing / 2.2)
  const period = Math.max(5, spacing * 3.2)
  const k = (Math.PI * 2) / period
  const phase = layerIndex * 0.55
  const out: Segment[] = []

  for (let y = bounds.minY + step * 0.5; y < bounds.maxY; y += step) {
    for (let x = bounds.minX + step * 0.5; x < bounds.maxX; x += step) {
      const f = (px: number, py: number) =>
        Math.sin(k * px + phase) * Math.cos(k * py) +
        Math.sin(k * py + phase) * Math.cos(phase * 0.7) +
        Math.sin(phase * 0.7) * Math.cos(k * px + phase)
      const p00 = f(x, y)
      const p10 = f(x + step, y)
      const p11 = f(x + step, y + step)
      const p01 = f(x, y + step)
      const points: { x: number; y: number }[] = []
      const edge = (a: number, b: number, ax: number, ay: number, bx: number, by: number) => {
        if ((a <= 0 && b > 0) || (a > 0 && b <= 0)) {
          const t = Math.abs(a - b) < 1e-9 ? 0.5 : a / (a - b)
          points.push({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t })
        }
      }
      edge(p00, p10, x, y, x + step, y)
      edge(p10, p11, x + step, y, x + step, y + step)
      edge(p11, p01, x + step, y + step, x, y + step)
      edge(p01, p00, x, y + step, x, y)
      for (let i = 0; i + 1 < points.length; i += 2) {
        const a = points[i], b = points[i + 1]
        if (Math.hypot(b.x - a.x, b.y - a.y) < 0.08) continue
        for (const part of clipSegmentToRegion(region, { a, b })) {
          out.push(part)
          if (out.length > MAX_SEGMENTS) {
            if (report) report.truncated = true
            return out
          }
        }
      }
    }
  }
  return out
}

/**
 * Cubic: ein versetztes Gitter mit einer zusätzlichen Diagonale. Die
 * Diagonalrichtung wechselt pro Schicht, damit die Füllung nicht nur in
 * einer Ebene liegt. Das ist eine 2D-Näherung des 3D-Würfelgitters.
 */
function cubicSegments(
  region: Poly[],
  spacing: number,
  layerIndex: number,
  report?: InfillReport,
): Segment[] {
  const base = layerIndex % 2 === 0 ? 45 : 0
  return [
    ...clipLines(region, base, spacing, report),
    ...clipLines(region, base + 90, spacing, report),
    ...clipLines(region, base + 45, spacing * 1.65, report),
  ]
}

/**
 * Octet: vier gleichmäßig verteilte Richtungen (0/45/90/135°). Das ergibt
 * die typische dichte, allseitig belastbare Achtflächen-Näherung.
 */
function octetSegments(region: Poly[], spacing: number, report?: InfillReport): Segment[] {
  return [0, 45, 90, 135].flatMap((angle) => clipLines(region, angle, spacing, report))
}

/** Muster inkl. Richtungswechsel pro Schicht. */
export function patternSegments(
  region: Poly[],
  pattern: InfillPattern,
  density: number,
  lineWidth: number,
  layerIndex: number,
  solid: boolean,
  angleDeg = 45,
  report?: InfillReport,
): Segment[] {
  // density kommt in Prozent (20 = 20 %)
  const fraction = Math.min(1, Math.max(0.01, density / 100))
  const spacingForFamilies = (families: number) => {
    const r = 1 - Math.pow(Math.max(0, 1 - fraction), 1 / families)
    return Math.max(lineWidth, lineWidth / Math.max(0.02, r))
  }
  let spacing = lineWidth * 0.98
  if (!solid) {
    switch (pattern) {
      case 'grid':
      case 'crosshatch':
        spacing = spacingForFamilies(2)
        break
      case 'triangles':
      case 'cubic':
        spacing = spacingForFamilies(3)
        break
      case 'octet':
        spacing = spacingForFamilies(4)
        break
      default:
        spacing = Math.max(lineWidth, lineWidth / fraction)
    }
  }
  const flip = layerIndex % 2 === 0 ? 0 : 1
  const angle = angleDeg + flip * 90

  if (solid) {
    return clipLines(region, angleDeg + (layerIndex % 2) * 90, spacing, report)
  }

  switch (pattern) {
    case 'lines':
      return clipLines(region, angle, spacing, report)
    case 'zigzag': {
      const base = clipLines(region, angle, spacing, report).sort((p, q) => p.a.y - q.a.y || p.a.x - q.a.x)
      const out = [...base]
      // Verbindet die Enden benachbarter Bahnen — so entsteht ein durchgehendes
      // Zickzack statt einzelner Linien.
      for (let i = 1; i < base.length; i++) {
        const prev = base[i - 1]
        const cur = base[i]
        const prevEnd = Math.abs(prev.b.x - cur.a.x) < Math.abs(prev.b.x - cur.b.x) ? prev.b : prev.a
        const curStart = Math.abs(prev.b.x - cur.a.x) < Math.abs(prev.b.x - cur.b.x) ? cur.a : cur.b
        out.push(...clipSegmentToRegion(region, { a: prevEnd, b: curStart }))
      }
      return out
    }
    case 'concentric': {
      const rings: Segment[] = []
      let offset = -lineWidth * 0.5
      for (let k = 0; k < 300; k++) {
        const ring = offsetPolys(region, offset)
        if (!ring.length) break
        for (const poly of ring) {
          for (let i = 0; i < poly.length; i++) rings.push({ a: poly[i], b: poly[(i + 1) % poly.length] })
        }
        offset -= spacing
        if (k === 299 && ring.length && report) report.truncated = true
      }
      return rings
    }
    case 'triangles': {
      const a = clipLines(region, angle, spacing, report)
      const b = clipLines(region, angle + 60, spacing, report)
      const c = clipLines(region, angle + 120, spacing, report)
      return [...a, ...b, ...c]
    }
    case 'gyroid':
      return gyroidSegments(region, spacing, lineWidth, layerIndex, report)
    case 'honeycomb':
      return honeycombSegments(region, spacing, lineWidth, report)
    case 'crosshatch':
      return [
        ...clipLines(region, angle - 45, spacing, report),
        ...clipLines(region, angle + 45, spacing, report),
      ]
    case 'cubic':
      return cubicSegments(region, spacing, layerIndex, report)
    case 'octet':
      return octetSegments(region, spacing, report)
    case 'grid':
    default: {
      const a = clipLines(region, angle, spacing, report)
      const b = clipLines(region, angle + 90, spacing, report)
      return [...a, ...b]
    }
  }
}

/** Rechnet Fülldichte (%) in Bahnabstand um. */
export function infillSpacing(densityPct: number, lineWidth: number): number {
  if (densityPct <= 0) return Infinity
  return Math.max(lineWidth, lineWidth / (densityPct / 100))
}

type SegLike = { a: { x: number; y: number }; b: { x: number; y: number } }
type Ordered<T> = { segs: T[]; flipped: boolean[]; end: { x: number; y: number } }

/** Greedy-Reihenfolge: kürzeste Wege zwischen den Pfaden. */
function greedyOrder<T extends SegLike>(
  segs: T[],
  from: { x: number; y: number },
  report?: InfillReport,
): Ordered<T> {
  const remaining = segs.slice()
  const out: T[] = []
  const flipped: boolean[] = []
  let cur = from
  let guard = 0
  while (remaining.length && guard++ < 20000) {
    let best = -1
    let bestDist = Infinity
    let bestFlip = false
    for (let i = 0; i < remaining.length; i++) {
      const s = remaining[i]
      const d1 = (s.a.x - cur.x) ** 2 + (s.a.y - cur.y) ** 2
      const d2 = (s.b.x - cur.x) ** 2 + (s.b.y - cur.y) ** 2
      if (d1 < bestDist) { bestDist = d1; best = i; bestFlip = false }
      if (d2 < bestDist) { bestDist = d2; best = i; bestFlip = true }
    }
    const s = remaining.splice(best, 1)[0]
    out.push(s)
    flipped.push(bestFlip)
    cur = bestFlip ? s.a : s.b
  }
  // Sehr dichte Muster: Der Rest wird in Erzeugungsreihenfolge angehängt.
  // Die Greedy-Suche wäre hier quadratisch teuer, aber keine Bahn darf
  // verloren gehen — sonst fehlt Füllung in der Schicht.
  while (remaining.length) {
    if (report) report.orderFallback = true
    const s = remaining.shift() as T
    out.push(s)
    flipped.push(false)
    cur = s.b
  }
  return { segs: out, flipped, end: cur }
}

/**
 * Erkennt ein gleichgerichtetes Muster (Linien, Grid, Solid). Nur dann ist eine
 * zeilenweise Reihenfolge sinnvoll — bei Gyroid oder Waben wäre sie falsch.
 */
function dominantDirection(segs: SegLike[]): { x: number; y: number } | null {
  let vx = 0
  let vy = 0
  let total = 0
  for (const seg of segs) {
    const dx = seg.b.x - seg.a.x
    const dy = seg.b.y - seg.a.y
    const len = Math.hypot(dx, dy)
    if (len < 0.05) continue
    // Richtungen sind 180°-symmetrisch: immer in +X-Halbebene drehen.
    const sign = dx < -1e-9 || (Math.abs(dx) <= 1e-9 && dy < 0) ? -1 : 1
    vx += (dx / len) * sign * len
    vy += (dy / len) * sign * len
    total += len
  }
  if (total < 1) return null
  const n = Math.hypot(vx, vy)
  // Unter 85 % gemeinsamer Richtung ist es kein Linienmuster.
  if (n < total * 0.85) return null
  return { x: vx / n, y: vy / n }
}

/**
 * Orca-artige monotone Reihenfolge: Bahnen werden zeilenweise abgefahren, die
 * Richtung wechselt pro Zeile. Das ergibt kurze Verbindungen ohne Sprünge quer
 * über die Schicht — der klassische „Zickzack“ einer Solid-Schicht.
 */
function snakeOrder<T extends SegLike>(
  segs: T[],
  from: { x: number; y: number },
  dir: { x: number; y: number },
): Ordered<T> {
  const perp = { x: -dir.y, y: dir.x }
  const rows = segs.map((seg) => {
    const mx = (seg.a.x + seg.b.x) / 2
    const my = (seg.a.y + seg.b.y) / 2
    return { seg, row: mx * perp.x + my * perp.y, along: mx * dir.x + my * dir.y }
  })
  // Zeilenabstand aus den tatsächlichen Abständen schätzen, nicht raten.
  const coords = [...new Set(rows.map((r) => Math.round(r.row * 1000) / 1000))].sort((a, b) => a - b)
  const gaps: number[] = []
  for (let i = 1; i < coords.length; i++) {
    const g = coords[i] - coords[i - 1]
    if (g > 1e-3) gaps.push(g)
  }
  gaps.sort((a, b) => a - b)
  const tol = Math.max(0.05, (gaps[Math.floor(gaps.length / 2)] ?? 0.4) * 0.5)

  const groups: { row: number; items: typeof rows }[] = []
  for (const item of rows) {
    const last = groups[groups.length - 1]
    if (last && Math.abs(item.row - last.row) <= tol) last.items.push(item)
    else groups.push({ row: item.row, items: [item] })
  }
  // Immer von einer Außenzeile zur gegenüberliegenden arbeiten. Ohne diese
  // Sortierung konnte die Reihenfolge der Erzeugung (z. B. nach einer Insel)
  // wieder in der Mitte beginnen.
  groups.sort((p, q) => p.row - q.row)

  const out: T[] = []
  const flipped: boolean[] = []
  let cur = from
  for (let g = 0; g < groups.length; g++) {
    const items = groups[g].items.slice().sort((p, q) => p.along - q.along)
    if (g % 2 === 1) items.reverse()
    for (const item of items) {
      const da = (item.seg.a.x - cur.x) ** 2 + (item.seg.a.y - cur.y) ** 2
      const db = (item.seg.b.x - cur.x) ** 2 + (item.seg.b.y - cur.y) ** 2
      const flip = db < da
      out.push(item.seg)
      flipped.push(flip)
      cur = flip ? item.seg.a : item.seg.b
    }
  }
  return { segs: out, flipped, end: cur }
}

/**
 * Deckschicht-Reihenfolge: mit der längsten Zeile beginnen und von dort
 * abwechselnd nach beiden Seiten laufen. Bei runden Flächen ist die längste
 * Zeile die Mitte; die kurzen Randstücke kommen ans Ende. Damit beginnt die
 * sichtbare Fläche mit einer langen Bahn statt mit den kurzen Randstücken, die
 * sonst eine Unterextrusionskante hinterlassen.
 */
function serpentineOrder<T extends SegLike>(
  segs: T[],
  from: { x: number; y: number },
): Ordered<T> {
  const dir = dominantDirection(segs)
  if (!dir) return greedyOrder(segs, from)
  const perp = { x: -dir.y, y: dir.x }
  const rows = segs.map((seg) => {
    const mx = (seg.a.x + seg.b.x) / 2
    const my = (seg.a.y + seg.b.y) / 2
    return { seg, row: mx * perp.x + my * perp.y, along: mx * dir.x + my * dir.y }
  })
  // Zeilenabstand aus den tatsächlichen Abständen schätzen, nicht raten.
  const coords = [...new Set(rows.map((r) => Math.round(r.row * 1000) / 1000))].sort((a, b) => a - b)
  const gaps: number[] = []
  for (let i = 1; i < coords.length; i++) {
    const g = coords[i] - coords[i - 1]
    if (g > 1e-3) gaps.push(g)
  }
  gaps.sort((a, b) => a - b)
  const tol = Math.max(0.05, (gaps[Math.floor(gaps.length / 2)] ?? 0.4) * 0.5)

  // Sortieren, damit die Zeilen unabhängig von der Erzeugungsreihenfolge
  // von einer Kante zur anderen laufen.
  const sorted = rows.slice().sort((p, q) => p.row - q.row || p.along - q.along)
  const groups: { row: number; items: typeof rows }[] = []
  for (const item of sorted) {
    const last = groups[groups.length - 1]
    if (last && Math.abs(item.row - last.row) <= tol) last.items.push(item)
    else groups.push({ row: item.row, items: [item] })
  }

  // Die längste Zeile liegt bei runden Flächen in der Mitte. Von dort nach
  // oben und unten abwechseln; so bleiben die kurzen Randstücke am Ende.
  let start = 0
  let bestLength = -1
  for (let i = 0; i < groups.length; i++) {
    const length = groups[i].items.reduce(
      (sum, item) => sum + Math.hypot(item.seg.b.x - item.seg.a.x, item.seg.b.y - item.seg.a.y),
      0,
    )
    if (length > bestLength) {
      bestLength = length
      start = i
    }
  }
  const visit: number[] = []
  for (let d = 0; d < groups.length; d++) {
    if (d === 0) visit.push(start)
    else {
      if (start + d < groups.length) visit.push(start + d)
      if (start - d >= 0) visit.push(start - d)
    }
  }

  const out: T[] = []
  const flipped: boolean[] = []
  let cur = from
  const dist2 = (p: { x: number; y: number }) => (p.x - cur.x) ** 2 + (p.y - cur.y) ** 2
  for (const gi of visit) {
    const items = groups[gi].items.slice()
    // Die Zeile so drehen, dass sie am näheren Ende beginnt. Die nächste Zeile
    // liegt auf der anderen Seite der Mitte und beginnt wieder am näheren Ende.
    const first = items[0].seg
    const last = items[items.length - 1].seg
    const firstDistance = Math.min(dist2(first.a), dist2(first.b))
    const lastDistance = Math.min(dist2(last.a), dist2(last.b))
    if (lastDistance < firstDistance) items.reverse()
    for (const item of items) {
      const da = dist2(item.seg.a)
      const db = dist2(item.seg.b)
      const flip = db < da
      out.push(item.seg)
      flipped.push(flip)
      cur = flip ? item.seg.a : item.seg.b
    }
  }
  return { segs: out, flipped, end: cur }
}

/** Tatsächliche Reiselänge einer geordneten Bahnfolge. */
function orderedCost<T extends SegLike>(o: Ordered<T>, from: { x: number; y: number }): number {
  let cur = from
  let total = 0
  for (let i = 0; i < o.segs.length; i++) {
    const s = o.segs[i]
    const a = o.flipped[i] ? s.b : s.a
    const b = o.flipped[i] ? s.a : s.b
    total += Math.hypot(a.x - cur.x, a.y - cur.y)
    cur = b
  }
  return total
}

/**
 * Reihenfolge der Füllbahnen: gleichgerichtete Muster laufen zeilenweise
 * (monoton), unregelmäßige Muster greedy von der Düsenposition aus. Beide
 * Varianten werden berechnet und die mit weniger Leerweg genommen — bei
 * mehreren Inseln gewinnt dadurch die Insel-für-Insel-Reihenfolge.
 * `serpentine` ist für die sichtbare Deckschicht gedacht: Dann beginnt die
 * Fläche mit der längsten Zeile, nicht mit den kurzen Randstücken.
 */
export function orderSegments<T extends SegLike>(
  segs: T[],
  from: { x: number; y: number },
  report?: InfillReport,
  serpentine = false,
  rowsFirst = false,
): Ordered<T> {
  if (!segs.length) return { segs: [], flipped: [], end: from }
  if (serpentine) return serpentineOrder(segs, from)
  const greedy = greedyOrder(segs, from, report)
  const dir = segs.length >= 4 ? dominantDirection(segs) : null
  if (!dir) return greedy
  const snake = snakeOrder(segs, from, dir)
  // Deckschicht: immer die reine Zeilenreihenfolge nehmen, auch wenn Greedy
  // rechnerisch kürzer wäre. Greedy beginnt sonst gern in der Mitte.
  if (rowsFirst) return snake
  return orderedCost(snake, from) <= orderedCost(greedy, from) ? snake : greedy
}
