/**
 * Kreisbogen-Erkennung für polygonale Konturen. Die STL-Konturen bestehen aus
 * vielen kurzen Sehnen; wenn eine Folge innerhalb der eingestellten Toleranz
 * auf einem gemeinsamen Kreis liegt, kann sie als G2/G3 ausgegeben werden.
 * Die Funktion ist rein geometrisch und wird auch vom Regressionstest genutzt.
 */
export type ArcPoint = { x: number; y: number }

export type ArcCandidate = {
  startIndex: number
  endIndex: number
  center: ArcPoint
  radius: number
  startAngle: number
  /** Vorzeichenbehafteter Winkel; positiv = gegen den Uhrzeigersinn. */
  sweep: number
  ccw: boolean
}

const MAX_SWEEP = Math.PI * 0.94
const MIN_SWEEP = 0.15

function circleThrough(a: ArcPoint, b: ArcPoint, c: ArcPoint): { center: ArcPoint; radius: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y))
  if (Math.abs(d) < 1e-9) return null
  const a2 = a.x * a.x + a.y * a.y
  const b2 = b.x * b.x + b.y * b.y
  const c2 = c.x * c.x + c.y * c.y
  const cx = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d
  const cy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d
  const radius = Math.hypot(a.x - cx, a.y - cy)
  return Number.isFinite(radius) && radius > 0.05 ? { center: { x: cx, y: cy }, radius } : null
}

function signedSweep(startAngle: number, endAngle: number, ccw: boolean): number {
  let sweep = endAngle - startAngle
  if (ccw) {
    while (sweep <= 1e-9) sweep += Math.PI * 2
  } else {
    while (sweep >= -1e-9) sweep -= Math.PI * 2
  }
  return sweep
}

/**
 * Prüft eine konkrete Punktfolge. Die drei Stützpunkte definieren den Kreis;
 * alle Zwischenpunkte müssen innerhalb der Toleranz auf ihm liegen und die
 * Richtungswechsel dürfen nicht das Vorzeichen wechseln.
 */
export function fitArc(
  points: ArcPoint[],
  startIndex: number,
  endIndex: number,
  tolerance: number,
): ArcCandidate | null {
  if (startIndex < 0 || endIndex >= points.length || endIndex - startIndex < 2) return null
  const start = points[startIndex]
  const end = points[endIndex]
  const middle = points[startIndex + Math.floor((endIndex - startIndex) / 2)]
  const circle = circleThrough(start, middle, end)
  if (!circle) return null
  const tol = Math.max(0.005, Math.min(0.5, Number.isFinite(tolerance) ? tolerance : 0.05))

  let turn = 0
  for (let i = startIndex; i < endIndex; i++) {
    const a = points[i]
    const b = points[i + 1]
    const c = points[Math.min(endIndex, i + 2)]
    if (i + 2 > endIndex) break
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (Math.abs(cross) < 1e-8) continue
    const sign = cross > 0 ? 1 : -1
    if (turn && sign !== turn) return null
    turn = sign
  }
  if (!turn) return null

  for (let i = startIndex + 1; i < endIndex; i++) {
    const p = points[i]
    if (Math.abs(Math.hypot(p.x - circle.center.x, p.y - circle.center.y) - circle.radius) > tol) return null
  }

  const startAngle = Math.atan2(start.y - circle.center.y, start.x - circle.center.x)
  const endAngle = Math.atan2(end.y - circle.center.y, end.x - circle.center.x)
  const ccw = turn > 0
  const sweep = signedSweep(startAngle, endAngle, ccw)
  if (Math.abs(sweep) < MIN_SWEEP || Math.abs(sweep) > MAX_SWEEP) return null
  return {
    startIndex,
    endIndex,
    center: circle.center,
    radius: circle.radius,
    startAngle,
    sweep,
    ccw,
  }
}

/**
 * Sucht ab `startIndex` den längsten gültigen Bogen. Sobald ein Endpunkt nicht
 * mehr auf dem Kreis liegt, wird abgebrochen; der vorherige gültige Bogen
 * bleibt erhalten. So entstehen keine Sprünge über Ecken hinweg.
 */
export function findLongestArc(
  points: ArcPoint[],
  startIndex: number,
  tolerance: number,
  minSegments: number,
): ArcCandidate | null {
  const minCount = Math.max(3, Math.min(32, Math.round(Number.isFinite(minSegments) ? minSegments : 4)))
  let best: ArcCandidate | null = null
  for (let end = startIndex + 2; end < points.length; end++) {
    const candidate = fitArc(points, startIndex, end, tolerance)
    if (!candidate) break
    if (end - startIndex >= minCount) best = candidate
  }
  return best
}

/** Kreisbogenlänge in mm. */
export function arcLength(arc: ArcCandidate): number {
  return arc.radius * Math.abs(arc.sweep)
}

/** Punkt auf dem Bogen für Vorschau und Tests. */
export function arcPointAt(arc: ArcCandidate, fraction: number): ArcPoint {
  const angle = arc.startAngle + arc.sweep * Math.max(0, Math.min(1, fraction))
  return {
    x: arc.center.x + Math.cos(angle) * arc.radius,
    y: arc.center.y + Math.sin(angle) * arc.radius,
  }
}