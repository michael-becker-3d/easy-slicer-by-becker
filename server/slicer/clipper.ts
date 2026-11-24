/*
 * Proprietaerer Bestandteil der Easy-Slicer-Slice-Engine.
 * Copyright (c) 2026 Michael Becker. Alle Rechte vorbehalten.
 * Nutzung nur im Rahmen von LICENSE und LICENSE-SLICE-ENGINE.md.
 */
import {
  ClipType,
  EndType,
  FillRule,
  JoinType,
  booleanOp,
  inflatePaths,
  simplifyPaths,
  union,
  type Paths64,
} from 'clipper2-ts'

export type Pt = { x: number; y: number }
export type Poly = Pt[]

/**
 * Clipper2 rechnet mit ganzzahligen Koordinaten. 1000 Einheiten pro mm sind
 * 1 µm Auflösung — feiner als jede Düse, aber weit unter der 2^53-Grenze.
 */
const SCALE = 1000
/** Zulässige Abweichung beim Abrunden von Ecken: 0,05 mm wie in Clipper 1. */
const ARC_TOLERANCE = 0.05 * SCALE
/** Miter-Grenze: ab dieser Länge wird eine Ecke abgeschrägt statt gespitzt. */
const MITER_LIMIT = 2
/** Punkte unter 0,002 mm Abstand gelten als doppelt. */
const CLEAN_EPSILON = 2

const toCP = (polys: Poly[]): Paths64 =>
  polys.map((p) => p.map((q) => ({ x: Math.round(q.x * SCALE), y: Math.round(q.y * SCALE) })))

/**
 * Ab dieser Abweichung gilt ein Zwischenpunkt als verzichtbar. Clipper rundet
 * Ecken mit 0,05 mm Toleranz ab und erzeugt dabei Bögen aus vielen kurzen
 * Stücken; ungefiltert wächst der G-Code dadurch auf ein Vielfaches und der
 * Drucker kann die Bewegungen nicht mehr rechtzeitig nachladen.
 * 0,02 mm liegt weit unter der Auflösung einer 0,4-mm-Düse.
 */
const SIMPLIFY_EPSILON = 0.02

/** Ramer-Douglas-Peucker für einen offenen Streckenzug. */
function rdp(pts: Pt[], eps: number): Pt[] {
  if (pts.length <= 2) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = 1
  keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop() as [number, number]
    const ax = pts[first].x, ay = pts[first].y
    const bx = pts[last].x, by = pts[last].y
    const dx = bx - ax, dy = by - ay
    const len = Math.hypot(dx, dy) || 1
    let far = -1
    let farD = eps
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

/**
 * Geschlossene Ringe vereinfachen. Zwei Ankerpunkte sind nötig, damit auch die
 * Schlusskante geprüft wird — sonst bliebe genau dort ein Bogen stehen.
 */
function simplifyRing(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 4) return pts
  let far = 1
  let farD = -1
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i].x - pts[0].x) ** 2 + (pts[i].y - pts[0].y) ** 2
    if (d > farD) {
      farD = d
      far = i
    }
  }
  const a = rdp(pts.slice(0, far + 1), eps)
  const b = rdp([...pts.slice(far), pts[0]], eps)
  const out = [...a, ...b.slice(1, -1)]
  return out.length >= 3 ? out : pts
}

const fromCP = (paths: Paths64): Poly[] =>
  paths
    .map((p) => simplifyRing(p.map((q) => ({ x: q.x / SCALE, y: q.y / SCALE })), SIMPLIFY_EPSILON))
    .filter((p) => p.length >= 3)

export function signedArea(poly: Poly): number {
  let a = 0
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

export function pointInPoly(pt: Pt, poly: Poly): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

/** Außenkonturen gegen den Uhrzeigersinn, Löcher im Uhrzeigersinn. */
export function normalizeOrientation(loops: Poly[]): Poly[] {
  const cleaned = loops.filter((l) => l.length >= 3 && Math.abs(signedArea(l)) > 1e-5)
  return cleaned.map((loop, i) => {
    let probe = loop[0]
    // Probe leicht nach innen verschieben, damit Punkte auf Nachbarkanten nicht täuschen
    const cx = loop.reduce((s, p) => s + p.x, 0) / loop.length
    const cy = loop.reduce((s, p) => s + p.y, 0) / loop.length
    probe = { x: probe.x + (cx - probe.x) * 0.01, y: probe.y + (cy - probe.y) * 0.01 }
    let depth = 0
    for (let j = 0; j < cleaned.length; j++) {
      if (j !== i && pointInPoly(probe, cleaned[j])) depth++
    }
    const wantCCW = depth % 2 === 0
    const isCCW = signedArea(loop) > 0
    return isCCW === wantCCW ? loop : [...loop].reverse()
  })
}

/**
 * Verschiebt die Kontur um `delta` mm (negativ = nach innen). Clipper2 löst
 * dabei auch Selbstüberschneidungen auf, die beim Slicing an dünnen Stellen
 * entstehen — genau die Stellen, an denen Clipper 1 Lücken hinterließ.
 */
export function offsetPolys(polys: Poly[], delta: number, miter = false): Poly[] {
  if (!polys.length) return []
  const input = union(toCP(polys), FillRule.EvenOdd)
  if (!input.length) return []
  const sol = inflatePaths(
    input,
    delta * SCALE,
    miter ? JoinType.Miter : JoinType.Round,
    EndType.Polygon,
    MITER_LIMIT,
    ARC_TOLERANCE,
  )
  if (!sol.length) return []
  return fromCP(simplifyPaths(sol, CLEAN_EPSILON))
}

export function booleanPolys(a: Poly[], b: Poly[], op: 'and' | 'diff' | 'or'): Poly[] {
  if (!a.length) return op === 'or' ? b : []
  if (!b.length) return op === 'and' ? [] : a
  const type =
    op === 'and' ? ClipType.Intersection : op === 'diff' ? ClipType.Difference : ClipType.Union
  const sol = booleanOp(type, toCP(a), toCP(b), FillRule.EvenOdd)
  if (!sol.length) return []
  return fromCP(simplifyPaths(sol, CLEAN_EPSILON))
}

/** Vereinigt beliebig viele Polygone (auch überlappende) zu sauberen Ringen. */
export function unionPolys(polys: Poly[]): Poly[] {
  if (!polys.length) return []
  const sol = union(toCP(polys), FillRule.EvenOdd)
  if (!sol.length) return []
  return fromCP(simplifyPaths(sol, CLEAN_EPSILON))
}

export function totalArea(polys: Poly[]): number {
  return polys.reduce((s, p) => s + signedArea(p), 0)
}
