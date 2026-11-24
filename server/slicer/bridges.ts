/*
 * Proprietaerer Bestandteil der Easy-Slicer-Slice-Engine.
 * Copyright (c) 2026 Michael Becker. Alle Rechte vorbehalten.
 * Nutzung nur im Rahmen von LICENSE und LICENSE-SLICE-ENGINE.md.
 */
import { booleanPolys, offsetPolys, pointInPoly, type Poly } from './clipper.ts'
import { polysBounds } from './geom.ts'
import { clipLines, type Segment } from './infill.ts'

export type BridgePlan = {
  /** Luftfläche plus Ankerrand; ersetzt dort die normale Deckschicht. */
  area: Poly[]
  /** Tatsächlich ungestützte Fläche, nur für die Diagnose. */
  air: Poly[]
  /** 0 = waagerechte Bahnen, 90 = senkrechte Bahnen. */
  angle: number
  /** Kürzeste unterstützte Spanne in mm. */
  span: number
  lines: Segment[]
}

function insidePolys(polys: Poly[], p: { x: number; y: number }): boolean {
  let inside = false
  for (const poly of polys) if (pointInPoly(p, poly)) inside = !inside
  return inside
}

function isSupported(
  area: Poly,
  support: Poly[],
  axis: 'x' | 'y',
  side: 'min' | 'max',
  margin: number,
): boolean {
  const b = polysBounds([area])
  if (!Number.isFinite(b.minX)) return false
  // Der Anker muss über eine echte Auflage laufen, nicht nur an einer Ecke
  // kleben. Deshalb an mehreren Stellen entlang der Gegenachse prüfen.
  for (const t of [0.25, 0.5, 0.75]) {
    const p =
      axis === 'x'
        ? { x: side === 'min' ? b.minX - margin : b.maxX + margin, y: b.minY + (b.maxY - b.minY) * t }
        : { x: b.minX + (b.maxX - b.minX) * t, y: side === 'min' ? b.minY - margin : b.maxY + margin }
    if (insidePolys(support, p)) return true
  }
  return false
}

/**
 * Erkennt echte Brücken: eine ungestützte Fläche braucht auf zwei
 * gegenüberliegenden Seiten Auflage. Eine nur einseitig gehaltene Fläche ist
 * ein Überhang, kein Brückenband.
 *
 * Die Bahnrichtung folgt der kürzeren unterstützten Spanne. Bei einer Lücke
 * zwischen zwei Türmen ist das die X-Achse, bei einem Loch in einer Platte
 * die kürzere Lochseite. Der Ankerrand wird in die Auflage hinein verlängert.
 */
export function planBridges(region: Poly[], support: Poly[], lineWidth: number): BridgePlan[] {
  if (!region.length || !support.length || !(lineWidth > 0)) return []
  const air = booleanPolys(region, support, 'diff')
  if (!air.length) return []
  const margin = Math.max(0.5, lineWidth * 1.25)
  const anchor = Math.max(0.6, lineWidth * 1.5)
  const plans: BridgePlan[] = []

  for (const area of air) {
    if (area.length < 3) continue
    const b = polysBounds([area])
    const width = b.maxX - b.minX
    const height = b.maxY - b.minY
    if (width < lineWidth * 1.5 || height < lineWidth * 0.75) continue

    const xSupported =
      isSupported(area, support, 'x', 'min', margin) && isSupported(area, support, 'x', 'max', margin)
    const ySupported =
      isSupported(area, support, 'y', 'min', margin) && isSupported(area, support, 'y', 'max', margin)
    const candidates: { axis: 'x' | 'y'; angle: number; span: number }[] = []
    if (xSupported) candidates.push({ axis: 'x', angle: 0, span: width })
    if (ySupported) candidates.push({ axis: 'y', angle: 90, span: height })
    if (!candidates.length) continue
    candidates.sort((p, q) => p.span - q.span)
    const chosen = candidates[0]

    // Ankerrand in die Auflage hinein, aber nie über die aktuelle Kontur hinaus.
    const expanded = booleanPolys(offsetPolys([area], anchor), region, 'and')
    const lineArea = expanded.length ? expanded : [area]
    const lines = clipLines(lineArea, chosen.angle, Math.max(0.1, lineWidth * 0.98))
    if (!lines.length) continue
    plans.push({ area: lineArea, air: [area], angle: chosen.angle, span: chosen.span, lines })
  }
  return plans
}

export function bridgeArea(plans: BridgePlan[]): Poly[] {
  return plans.flatMap((plan) => plan.area)
}