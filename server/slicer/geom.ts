/*
 * Proprietaerer Bestandteil der Easy-Slicer-Slice-Engine.
 * Copyright (c) 2026 Michael Becker. Alle Rechte vorbehalten.
 * Nutzung nur im Rahmen von LICENSE und LICENSE-SLICE-ENGINE.md.
 */
import { normalizeOrientation, type Poly } from './clipper.ts'

type Seg = { x1: number; y1: number; x2: number; y2: number }

/** Diagnose der Konturverkettung: offene Ketten bedeuten fehlende Geometrie. */
export type SliceGeomReport = { openChains: number }

/**
 * Schneidet ein Dreiecksnetz mit der Ebene z und verkettet die Schnittpunkte
 * zu geschlossenen Konturen. Orientierung folgt der Dreiecks-Windung.
 */
export function sliceAtZ(
  positions: Float32Array,
  triangles: number,
  z: number,
  report?: SliceGeomReport,
): Poly[] {
  const segs: Seg[] = []
  const EPS = 1e-7

  for (let t = 0; t < triangles; t++) {
    const i = t * 9
    const ax = positions[i], ay = positions[i + 1], az = positions[i + 2]
    const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5]
    const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8]

    const aBelow = az < z
    const bBelow = bz < z
    const cBelow = cz < z
    if (aBelow === bBelow && bBelow === cBelow) continue

    let down: { x: number; y: number } | null = null
    let up: { x: number; y: number } | null = null

    // Kante a->b
    if (aBelow !== bBelow) {
      const f = (z - az) / (bz - az)
      const p = { x: ax + (bx - ax) * f, y: ay + (by - ay) * f }
      if (bBelow) down = p
      else up = p
    }
    // Kante b->c
    if (bBelow !== cBelow) {
      const f = (z - bz) / (cz - bz)
      const p = { x: bx + (cx - bx) * f, y: by + (cy - by) * f }
      if (cBelow) down = p
      else up = p
    }
    // Kante c->a
    if (cBelow !== aBelow) {
      const f = (z - cz) / (az - cz)
      const p = { x: cx + (ax - cx) * f, y: cy + (ay - cy) * f }
      if (aBelow) down = p
      else up = p
    }

    if (down && up) {
      const dx = up.x - down.x, dy = up.y - down.y
      if (Math.abs(dx) > EPS || Math.abs(dy) > EPS) segs.push({ x1: down.x, y1: down.y, x2: up.x, y2: up.y })
    }
  }

  return chain(segs, report)
}

function key(x: number, y: number): string {
  return `${Math.round(x * 1000)}:${Math.round(y * 1000)}`
}

function chain(segs: Seg[], report?: SliceGeomReport): Poly[] {
  // Sehr kurze Segmente an fast gleichen Schnittpunkten (z. B. an einer
  // senkrechten Kante) können denselben gerundeten Schlüssel belegen.
  // Doppelte Segmente würden dort mehrere Nachfolger erzeugen; einmal
  // behalten reicht für die Kontur.
  const fineKey = (x: number, y: number) => `${Math.round(x * 1e5)}:${Math.round(y * 1e5)}`
  const unique = new Map<string, Seg>()
  for (const s of segs) {
    const a = fineKey(s.x1, s.y1)
    const b = fineKey(s.x2, s.y2)
    const edge = a < b ? `${a}|${b}` : `${b}|${a}`
    if (!unique.has(edge)) unique.set(edge, s)
  }
  segs = [...unique.values()]

  const starts = new Map<string, number[]>()
  for (let i = 0; i < segs.length; i++) {
    const k = key(segs[i].x1, segs[i].y1)
    const arr = starts.get(k)
    if (arr) arr.push(i)
    else starts.set(k, [i])
  }
  const used = new Uint8Array(segs.length)
  const loops: Poly[] = []

  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue
    const loop: Poly = []
    let cur = i
    let guard = 0
    while (cur >= 0 && !used[cur] && guard++ < segs.length + 5) {
      used[cur] = 1
      const s = segs[cur]
      loop.push({ x: s.x1, y: s.y1 })
      const nextKey = key(s.x2, s.y2)
      const candidates = starts.get(nextKey)
      let next = -1
      if (candidates) {
        // Bei mehreren Kandidaten den geometrisch nächsten nehmen. Die reine
        // Reihenfolge im Array kann an kurzen Kanten den falschen Nachbarn
        // erwischen und erzeugt dann scheinbar offene Konturen.
        let best = Infinity
        for (const c of candidates) {
          if (used[c]) continue
          const t = segs[c]
          const d = (t.x1 - s.x2) ** 2 + (t.y1 - s.y2) ** 2
          if (d < best) {
            best = d
            next = c
          }
        }
      }
      if (next < 0) {
        // Ein geschlossener Ring endet wieder am Startpunkt. Nur wenn das
        // nicht der Fall ist, ist die Kette wirklich offen (Lücke im Mesh).
        if (key(s.x2, s.y2) !== key(loop[0].x, loop[0].y)) {
          loop.push({ x: s.x2, y: s.y2 })
          if (loop.length >= 3 && report) report.openChains++
        }
        break
      }
      cur = next
    }
    if (loop.length >= 3) loops.push(loop)
    else if (loop.length > 0 && report) report.openChains++
  }

  return normalizeOrientation(loops)
}

/** Bounding-Box über mehrere Polygone. */
export function polysBounds(polys: Poly[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const poly of polys) {
    for (const p of poly) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
  }
  return { minX, minY, maxX, maxY }
}

/** Streckenlänge einer Polylinie. */
export function pathLength(pts: { x: number; y: number }[], closed: boolean): number {
  let len = 0
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  }
  if (closed && pts.length > 2) {
    const a = pts[pts.length - 1], b = pts[0]
    len += Math.hypot(a.x - b.x, a.y - b.y)
  }
  return len
}
