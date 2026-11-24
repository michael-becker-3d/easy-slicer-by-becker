import { randomUUID } from 'node:crypto'
import type { LithophaneRequest, ModelPlacement, Vec3 } from '../shared/types.ts'
import { makeMesh, type Mesh } from './slicer/stl.ts'
import { boxMinMax, textBlocks } from './meshlib.ts'
import { defaultPlacement, placeMesh, type ModelObject } from './objects.ts'

/** Baut aus einer Dreiecksliste (9 Zahlen je Dreieck) ein Mesh. */
export function meshFromTris(tris: number[][]): Mesh {
  const positions = new Float32Array(tris.length * 9)
  for (let i = 0; i < tris.length; i++) {
    for (let v = 0; v < 9; v++) positions[i * 9 + v] = tris[i][v]
  }
  return makeMesh(positions, false)
}

export function mergeMeshes(meshes: Mesh[]): Mesh | null {
  const usable = meshes.filter((m) => m.triangles > 0)
  if (!usable.length) return null
  const total = usable.reduce((n, m) => n + m.positions.length, 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const mesh of usable) {
    out.set(mesh.positions, offset)
    offset += mesh.positions.length
  }
  return makeMesh(out, false)
}

/**
 * Skaliert ein Netz gleichmäßig um den Ursprung. Das ist der Weg aus „in
 * Metern exportiert“ zu Millimetern: Der Platzierungsmaßstab ist auf 0,05–10
 * begrenzt, ein Faktor 500 wäre dort nicht möglich.
 */
export function scaleMesh(mesh: Mesh, factor: number): Mesh {
  const positions = new Float32Array(mesh.positions.length)
  for (let i = 0; i < mesh.positions.length; i++) positions[i] = mesh.positions[i] * factor
  return makeMesh(positions, mesh.ascii)
}

/** Faktor von der größten Kante auf das Soll-Maß — null, wenn nichts Messbares da ist. */
export function rescaleFactor(largest: number, targetMm: number): number | null {
  if (!Number.isFinite(largest) || largest <= 0) return null
  if (!Number.isFinite(targetMm) || targetMm <= 0) return null
  const factor = targetMm / largest
  return factor >= 0.001 && factor <= 10_000 ? factor : null
}

// ---------- Ausrichten und Anordnen ----------

export type BedSize = { x: number; y: number; z?: number }

/** Setzt ein Objekt mit seiner tiefsten Stelle aufs Bett. */
export function dropToBed(object: ModelObject): Partial<ModelPlacement> {
  const placed = placeMesh(object.mesh, object.placement)
  return { offsetZ: object.placement.offsetZ - placed.bbox.min.z }
}

/**
 * Sucht die günstigste der sechs 90°-Lagen: größte Auflagefläche bei
 * geringster Höhe. Danach steht das Objekt auf dem Bett.
 */
export function autoOrient(object: ModelObject, bed: BedSize): Partial<ModelPlacement> {
  const candidates: { rotationX: number; rotationY: number }[] = [
    { rotationX: 0, rotationY: 0 },
    { rotationX: 90, rotationY: 0 },
    { rotationX: -90, rotationY: 0 },
    { rotationX: 0, rotationY: 90 },
    { rotationX: 0, rotationY: -90 },
    { rotationX: 180, rotationY: 0 },
    { rotationX: 0, rotationY: 180 },
  ]

  let best: { rx: number; ry: number; score: number; offsetZ: number } | null = null
  for (const c of candidates) {
    const probe: ModelPlacement = {
      ...object.placement,
      rotationX: c.rotationX,
      rotationY: c.rotationY,
      offsetZ: 0,
    }
    const placed = placeMesh(object.mesh, probe)
    const size = placed.bbox.size
    if (size.x > bed.x + 0.01 || size.y > bed.y + 0.01) continue
    const footprint = Math.max(0.01, size.x * size.y)
    const height = Math.max(0.01, size.z)
    const score = footprint / height
    const offsetZ = -placed.bbox.min.z
    if (!best || score > best.score) best = { rx: c.rotationX, ry: c.rotationY, score, offsetZ }
  }

  if (!best) return {}
  return { rotationX: best.rx, rotationY: best.ry, offsetZ: object.placement.offsetZ + best.offsetZ }
}

/** Zentriert das Objekt auf der Bettmitte (XY), Z bleibt erhalten. */
export function centerOnBed(object: ModelObject, bed: BedSize): Partial<ModelPlacement> {
  const placed = placeMesh(object.mesh, object.placement)
  const min = placed.bbox.min
  const max = placed.bbox.max
  return {
    offsetX: object.placement.offsetX + (bed.x / 2 - (min.x + max.x) / 2),
    offsetY: object.placement.offsetY + (bed.y / 2 - (min.y + max.y) / 2),
  }
}

/**
 * Ordnet alle sichtbaren Objekte nebeneinander aufs Bett (Reihen-Packen,
 * größte Teile zuerst). Objekte, die nicht mehr passen, bleiben stehen.
 */
export function arrangeObjects(
  objects: ModelObject[],
  bed: BedSize,
  gap = 4,
): { objects: ModelObject[]; placed: number; skipped: number } {
  const visible = objects.filter((o) => o.placement.visible)
  const boxes = visible.map((o) => {
    const placed = placeMesh(o.mesh, o.placement)
    return {
      object: o,
      min: placed.bbox.min,
      size: placed.bbox.size,
    }
  })

  boxes.sort((a, b) => b.size.y * b.size.x - a.size.y * a.size.x)
  let cursorX = 0
  let cursorY = 0
  let rowDepth = 0
  let placed = 0
  let skipped = 0

  for (const box of boxes) {
    const w = box.size.x
    const d = box.size.y
    if (w > bed.x || d > bed.y) {
      skipped++
      continue
    }
    if (cursorX + w > bed.x) {
      cursorX = 0
      cursorY += rowDepth + gap
      rowDepth = 0
    }
    if (cursorY + d > bed.y) {
      skipped++
      continue
    }
    box.object.placement = {
      ...box.object.placement,
      offsetX: box.object.placement.offsetX + (cursorX - box.min.x),
      offsetY: box.object.placement.offsetY + (cursorY - box.min.y),
    }
    cursorX += w + gap
    rowDepth = Math.max(rowDepth, d)
    placed++
  }

  return { objects, placed, skipped }
}

/**
 * Legt Teile nebeneinander, ohne eines zu verwerfen.
 *
 * `arrangeObjects` lässt Objekte stehen, die nicht aufs Bett passen. Nach dem
 * Teilen ist das falsch: Dann liegen die Teile übereinander und der Slicer
 * druckt sie ineinander. Diese Variante reiht sie notfalls über das Bett hinaus.
 */
export function packParts(parts: ModelObject[], bed: BedSize, gap = 4): void {
  const boxes = parts.map((o) => ({ object: o, bbox: placeMesh(o.mesh, o.placement).bbox }))
  let x = 0
  let y = 0
  let rowDepth = 0
  for (const { object, bbox } of boxes) {
    const w = Math.max(1, bbox.size.x)
    const d = Math.max(1, bbox.size.y)
    if (x > 0 && x + w > bed.x) {
      x = 0
      y += rowDepth + gap
      rowDepth = 0
    }
    object.placement = {
      ...object.placement,
      offsetX: object.placement.offsetX + (x - bbox.min.x),
      offsetY: object.placement.offsetY + (y - bbox.min.y),
    }
    x += w + gap
    rowDepth = Math.max(rowDepth, d)
  }
}

// ---------- Zuschneiden ----------

export type CutProfile = 'flat' | 'zigzag' | 'dovetail' | 'wave' | 'step' | 'undercut'
export type CutRequest = {
  z: number
  keep: 'top' | 'bottom' | 'both'
  profile: CutProfile
  /** Größe des Verbinders in mm */
  connectorSize: number
  /** Anzahl der Verbinder über die Schnittbreite */
  count: number
}

type Point = [number, number, number]

const EPS = 1e-7

function clipPolygon(points: Point[], distances: number[], keepPositive: boolean): Point[] {
  const out: Point[] = []
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length
    const di = distances[i]
    const dj = distances[j]
    const insideI = keepPositive ? di >= -EPS : di <= EPS
    const insideJ = keepPositive ? dj >= -EPS : dj <= EPS
    if (insideI) out.push(points[i])
    if (insideI !== insideJ) {
      const denom = di - dj
      const t = Math.abs(denom) < 1e-12 ? 0.5 : di / denom
      out.push([
        points[i][0] + (points[j][0] - points[i][0]) * t,
        points[i][1] + (points[j][1] - points[i][1]) * t,
        points[i][2] + (points[j][2] - points[i][2]) * t,
      ])
    }
  }
  return dedupe(out)
}

function dedupe(points: Point[]): Point[] {
  const out: Point[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (last && Math.abs(last[0] - p[0]) < 1e-6 && Math.abs(last[1] - p[1]) < 1e-6 && Math.abs(last[2] - p[2]) < 1e-6) {
      continue
    }
    out.push(p)
  }
  if (out.length > 1) {
    const first = out[0]
    const last = out[out.length - 1]
    if (Math.abs(last[0] - first[0]) < 1e-6 && Math.abs(last[1] - first[1]) < 1e-6 && Math.abs(last[2] - first[2]) < 1e-6) {
      out.pop()
    }
  }
  return out
}

function fanTriangles(out: number[][], poly: Point[]) {
  if (poly.length < 3) return
  for (let i = 1; i < poly.length - 1; i++) {
    const a = poly[0]
    const b = poly[i]
    const c = poly[i + 1]
    // entartete Dreiecke überspringen
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    if (Math.sqrt(nx * nx + ny * ny + nz * nz) < 1e-9) continue
    out.push([a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]])
  }
}

/**
 * Höhe der Nahtfläche über der Bauteilbreite. Dieselbe Formel benutzen der
 * Flächenschnitt und der CSG-Schnitt, damit die Naht in beiden Wegen gleich
 * aussieht.
 */
export function seamHeight(
  profile: CutProfile,
  x: number,
  z0: number,
  amp: number,
  period: number,
  minX: number,
): number {
  const u = (x - minX) / period
  switch (profile) {
    case 'zigzag':
      return z0 + (amp / 2) * (1 - 4 * Math.abs(Math.round(u) - u))
    case 'dovetail': {
      // flach gedeckelter Keil: selbstzentrierend, ohne Hinterschneidung
      const f = u - Math.floor(u)
      const tri = 1 - Math.abs(2 * f - 1)
      return z0 + (amp / 2) * Math.min(1, tri / 0.6)
    }
    case 'step': {
      // Treppe: je Periode eine halbe Stufe oben, eine halbe unten. Die
      // senkrechten Flanken greifen formschlüssig — hält gegen Verrutschen.
      const f = u - Math.floor(u)
      return z0 + (f < 0.5 ? amp / 2 : -amp / 2)
    }
    case 'wave':
      return z0 + (amp / 2) * Math.cos(u * Math.PI * 2)
    case 'undercut': {
      // Rastnase: breiter Fuß, schmaler Hals, darüber wieder breiter. Die
      // eigentliche Hinterschneidung liefert der Riegel in csg.ts; diese
      // Kontur gibt der Naht zusätzlich eine formschlüssige Stufe.
      const f = u - Math.floor(u)
      return z0 + (amp / 2) * (f < 0.35 ? -1 : f < 0.65 ? 1 : -0.2)
    }
    case 'flat':
    default:
      return z0
  }
}

/**
 * Teilt ein bereits platziertes Mesh an einer Höhenfläche.
 * Die Schnittfläche ist eine Funktion z(x,y): gerade, Zickzack, Keil oder
 * Zapfen. Beide Hälften entstehen aus denselben Schnittpunkten und passen
 * deshalb exakt zusammen — ohne CSG.
 */
export function cutMesh(mesh: Mesh, opts: CutRequest): { top: Mesh | null; bottom: Mesh | null } {
  const { min, max } = mesh.bbox
  const z0 = Math.min(max.z - 0.01, Math.max(min.z + 0.01, opts.z))
  const amp = Math.max(0.2, opts.connectorSize)
  const count = Math.max(1, Math.min(12, Math.round(opts.count)))
  const spanX = Math.max(0.01, max.x - min.x)
  const period = spanX / count

  // Alle Profile sind Höhenflächen, die die Bauteilwand erreichen — nur so
  // entstehen ohne CSG geschlossene, exakt zueinander passende Nahtflächen.
  const cutZ = (x: number, _y: number): number => seamHeight(opts.profile, x, z0, amp, period, min.x)

  const top: number[][] = []
  const bottom: number[][] = []
  const pos = mesh.positions
  // Verbinder müssen feiner abgetastet werden als die Dreiecke des Modells —
  // sonst fallen Zickzack und Zapfen bei grob vernetzten Teilen (z. B. Würfel)
  // zwischen den Eckpunkten einfach weg.
  // Grob abtasten ist besser als fein: jedes Nahtsegment endet an der Wand und
  // muss dort exakt mit dem Nachbarn zusammenlaufen. Sehr feine Netze erzeugen
  // viele winzige Segmente und damit offene Konturen beim Slicen.
  const maxEdge = opts.profile === 'flat' ? 1e9 : Math.max(2.5, Math.min(3, amp, period / 6))
  const budget = { left: 400000 }
  // Nur das Nahtband muss fein abgetastet werden. Alles darüber oder darunter
  // wird unverändert übernommen — sonst wächst das Netz bei jedem Schnitt massiv.
  const bandHalf = opts.profile === 'flat' ? 0 : amp / 2 + 0.5
  const bandLo = z0 - bandHalf
  const bandHi = z0 + bandHalf

  const cutTriangle = (p: Point[]) => {
    const d = p.map((v) => v[2] - cutZ(v[0], v[1]))
    const allTop = d.every((v) => v >= -EPS)
    const allBottom = d.every((v) => v <= EPS)
    if (allTop && !allBottom) {
      top.push(flatten(p))
      return
    }
    if (allBottom && !allTop) {
      bottom.push(flatten(p))
      return
    }
    if (allTop && allBottom) {
      // Dreieck liegt exakt in der Schnittfläche — beiden Hälften mitgeben.
      top.push(flatten(p))
      bottom.push(flatten(p))
      return
    }
    fanTriangles(top, clipPolygon(p, d, true))
    fanTriangles(bottom, clipPolygon(p, d, false))
  }

  for (let i = 0; i < pos.length; i += 9) {
    const p: Point[] = [
      [pos[i], pos[i + 1], pos[i + 2]],
      [pos[i + 3], pos[i + 4], pos[i + 5]],
      [pos[i + 6], pos[i + 7], pos[i + 8]],
    ]
    const inBand =
      maxEdge < 1e8 &&
      Math.max(p[0][2], p[1][2], p[2][2]) >= bandLo &&
      Math.min(p[0][2], p[1][2], p[2][2]) <= bandHi
    if (!inBand) {
      cutTriangle(p)
      continue
    }
    for (const piece of splitTriangle(p, maxEdge, budget)) cutTriangle(piece)
  }

  return {
    top: top.length ? meshFromTris(top) : null,
    bottom: bottom.length ? meshFromTris(bottom) : null,
  }
}

// ---------- Mehrfach-Schnitt ----------

export type CutAxis = 'z' | 'x' | 'y'

export type SplitRequest = {
  /** Achse, entlang der geteilt wird */
  axis: CutAxis
  /** Anzahl der Teile (2 … 12) */
  pieces: number
  profile: CutProfile
  connectorSize: number
  count: number
  /** Abstand der beiden Nahtflächen in mm: > 0 Luft, < 0 stramm */
  clearance?: number
  /** Nur bei zwei Teilen: freie Schnittlage in Achsenkoordinaten */
  position?: number
  /** Nur bei zwei Teilen: nur ein Teil behalten */
  keep?: 'both' | 'low' | 'high'
}

// Dreht das Mesh so, dass die Schnittachse zur Höhe wird. Beide Abbildungen
// haben Determinante +1, damit die Dreieckswindung (und damit die Normalen)
// erhalten bleibt. Schneiden muss dafür nicht neu geschrieben werden.
export function toCutFrame(axis: CutAxis, p: [number, number, number]): [number, number, number] {
  if (axis === 'x') return [p[2], p[1], -p[0]]
  if (axis === 'y') return [p[0], -p[2], p[1]]
  return p
}

export function fromCutFrame(axis: CutAxis, p: [number, number, number]): [number, number, number] {
  if (axis === 'x') return [-p[2], p[1], p[0]]
  if (axis === 'y') return [p[0], p[2], -p[1]]
  return p
}

export function permuteMesh(
  mesh: Mesh,
  map: (p: [number, number, number]) => [number, number, number],
): Mesh {
  const out = new Float32Array(mesh.positions.length)
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const q = map([mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]])
    out[i] = q[0]
    out[i + 1] = q[1]
    out[i + 2] = q[2]
  }
  return makeMesh(out, false)
}

/**
 * Teilt ein platziertes Mesh in mehrere Stücke entlang einer Achse.
 *
 * Geschnitten wird nacheinander: jedes Mal fällt das untere Stück ab, der Rest
 * wird weitergeteilt. Die beiden Nahtflächen liegen `clearance` auseinander —
 * positiv ergibt Luft zum Stecken, negativ einen strammen Sitz.
 */
export function cutIntoPieces(mesh: Mesh, opts: SplitRequest): Mesh[] {
  const axis: CutAxis = opts.axis ?? 'z'
  const pieces = Math.max(2, Math.min(12, Math.round(opts.pieces ?? 2)))
  const clearance = Math.max(-1, Math.min(2, opts.clearance ?? 0.05))
  const work = axis === 'z' ? mesh : permuteMesh(mesh, (p) => toCutFrame(axis, p))
  const lo = work.bbox.min.z
  const hi = work.bbox.max.z
  const span = hi - lo
  if (!(span > 0.2)) return [mesh]

  const cuts: number[] = []
  for (let k = 1; k < pieces; k++) {
    cuts.push(
      pieces === 2 && opts.position !== undefined
        ? Math.max(lo + 0.5, Math.min(hi - 0.5, opts.position))
        : lo + (span * k) / pieces,
    )
  }

  const parts: Mesh[] = []
  let rest: Mesh | null = work
  for (const z of cuts) {
    if (!rest) break
    const lower = cutMesh(rest, {
      z: z - clearance / 2,
      keep: 'bottom',
      profile: opts.profile,
      connectorSize: opts.connectorSize,
      count: opts.count,
    })
    const upper = cutMesh(rest, {
      z: z + clearance / 2,
      keep: 'top',
      profile: opts.profile,
      connectorSize: opts.connectorSize,
      count: opts.count,
    })
    if (lower.bottom) parts.push(lower.bottom)
    rest = upper.top
  }
  if (rest) parts.push(rest)
  if (parts.length < 2) return [mesh]

  let kept = parts
  if (pieces === 2 && opts.keep === 'low') kept = [parts[0]]
  else if (pieces === 2 && opts.keep === 'high') kept = [parts[parts.length - 1]]

  return axis === 'z' ? kept : kept.map((m) => permuteMesh(m, (p) => fromCutFrame(axis, p)))
}

function flatten(p: Point[]): number[] {
  return [p[0][0], p[0][1], p[0][2], p[1][0], p[1][1], p[1][2], p[2][0], p[2][1], p[2][2]]
}

/** Kleiner als: lexikografischer Vergleich zweier Punkte. */
function pointBefore(a: Point, b: Point): boolean {
  if (a[0] !== b[0]) return a[0] < b[0]
  if (a[1] !== b[1]) return a[1] < b[1]
  return a[2] < b[2]
}

/**
 * Teilt eine Dreieckskante in gleich lange Stücke.
 *
 * Die Teilung hängt nur von den beiden Endpunkten ab (Richtung wird über eine
 * feste Sortierung egalisiert). Zwei benachbarte Dreiecke erzeugen dadurch
 * exakt dieselben Zwischenpunkte — ohne diese Gleichheit entstehen T-Stöße,
 * die beim Slicen als offene Konturen auftauchen.
 */
function splitEdge(a: Point, b: Point, maxEdge: number): Point[] {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const dz = b[2] - a[2]
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz)
  const parts = Math.max(1, Math.ceil(length / maxEdge))
  if (parts <= 1) return []
  const flip = pointBefore(a, b) === false
  const p = flip ? b : a
  const q = flip ? a : b
  const points: Point[] = []
  for (let i = 1; i < parts; i++) {
    const t = i / parts
    points.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t])
  }
  return flip ? points.reverse() : points
}

/** Zerlegt ein Dreieck so, dass keine Kante länger als maxEdge bleibt. */
function splitTriangle(p: Point[], maxEdge: number, budget: { left: number }): Point[][] {
  const poly: Point[] = []
  for (let i = 0; i < 3; i++) {
    const a = p[i]
    const b = p[(i + 1) % 3]
    poly.push(a)
    if (budget.left > 0) {
      for (const m of splitEdge(a, b, maxEdge)) poly.push(m)
    }
  }
  const out: Point[][] = []
  for (let i = 1; i < poly.length - 1; i++) {
    budget.left--
    out.push([poly[0], poly[i], poly[i + 1]])
  }
  return out
}

// ---------- Text ----------

export type TextRequest = {
  text: string
  /** Schrifthöhe in mm (Oberkante der Buchstaben) */
  fontHeight: number
  /** Erhabenheit in mm */
  depth: number
  rotation: number
}

export function buildTextMesh(opts: TextRequest): { mesh: Mesh; width: number; height: number } {
  const text = opts.text.trim().slice(0, 60) || 'TEXT'
  const fontHeight = Math.max(3, Math.min(80, opts.fontHeight))
  const depth = Math.max(0.2, Math.min(10, opts.depth))
  const blocks = textBlocks(text, { fontHeight, depth })
  return { mesh: meshFromTris(blocks.tris), width: blocks.width, height: blocks.height }
}

// ---------- Lithophane ----------

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

function sampleGray(gray: number[], cols: number, rows: number, u: number, v: number): number {
  const x = clamp01(u) * (cols - 1)
  const y = clamp01(v) * (rows - 1)
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(cols - 1, x0 + 1)
  const y1 = Math.min(rows - 1, y0 + 1)
  const fx = x - x0
  const fy = y - y0
  const a = gray[y0 * cols + x0] ?? 0.5
  const b = gray[y0 * cols + x1] ?? 0.5
  const c = gray[y1 * cols + x0] ?? 0.5
  const d = gray[y1 * cols + x1] ?? 0.5
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
}

/**
 * Lithophane-Mesh aus einem Graustufenbild: Dunkel = dick, Hell = dünn.
 * Flach als Platte oder rund als Schirm (Umfang = Breite).
 */
export function lithophaneMesh(req: LithophaneRequest): Mesh {
  const cols = Math.max(8, Math.min(700, Math.round(req.cols)))
  const rows = Math.max(8, Math.min(700, Math.round(req.rows)))
  if (!Array.isArray(req.gray) || req.gray.length < cols * rows) {
    throw new Error('Bilddaten fehlen oder sind unvollständig.')
  }

  const widthMm = Math.max(10, Math.min(400, req.widthMm))
  const cylinder = req.shape === 'cylinder'
  const heightMm = Math.max(10, Math.min(400, req.heightMm))
  const minT = Math.max(0.3, Math.min(8, req.minThickness))
  const maxT = Math.max(minT + 0.1, Math.min(12, req.maxThickness))
  const contrast = Math.max(0.1, Math.min(4, req.contrast))
  const segments = Math.max(24, Math.min(480, Math.round(cols)))
  const gridRows = Math.max(12, Math.min(480, Math.round((segments * heightMm) / widthMm)))
  const radius = widthMm / (Math.PI * 2)

  const thickness = (u: number, v: number): number => {
    const g = sampleGray(req.gray, cols, rows, u, v)
    const density = req.invert ? g : 1 - g
    const adjusted = clamp01(0.5 + (density - 0.5) * contrast)
    return minT + (maxT - minT) * adjusted
  }

  const tris: number[][] = []
  const corner = (i: number, j: number): Point => {
    const u = i / segments
    const v = j / gridRows
    const t = thickness(u, v)
    if (cylinder) {
      const angle = u * Math.PI * 2
      const y = heightMm * (1 - v)
      const r = radius + t
      return [Math.cos(angle) * r, Math.sin(angle) * r, y]
    }
    return [-widthMm / 2 + widthMm * u, heightMm * (1 - v), t]
  }

  const inner = (i: number, j: number): Point => {
    const u = i / segments
    const v = j / gridRows
    if (cylinder) {
      const angle = u * Math.PI * 2
      const y = heightMm * (1 - v)
      return [Math.cos(angle) * radius, Math.sin(angle) * radius, y]
    }
    return [-widthMm / 2 + widthMm * u, heightMm * (1 - v), 0]
  }

  const push = (a: Point, b: Point, c: Point) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    if (Math.sqrt(nx * nx + ny * ny + nz * nz) < 1e-9) return
    tris.push([a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]])
  }

  for (let j = 0; j < gridRows; j++) {
    for (let i = 0; i < segments; i++) {
      const a = corner(i, j)
      const b = corner(i + 1, j)
      const c = corner(i + 1, j + 1)
      const d = corner(i, j + 1)
      const ai = inner(i, j)
      const bi = inner(i + 1, j)
      const ci = inner(i + 1, j + 1)
      const di = inner(i, j + 1)

      // Bildseite (außen) und Rückseite (innen)
      push(a, b, c)
      push(a, c, d)
      push(ai, ci, bi)
      push(ai, di, ci)
    }
  }

  // Rand: flache Platte bekommt Seitenwände, der runde Schirm Deckelringe.
  if (cylinder) {
    for (let i = 0; i < segments; i++) {
      const o0 = corner(i, 0)
      const o1 = corner(i + 1, 0)
      const i0 = inner(i, 0)
      const i1 = inner(i + 1, 0)
      push(o0, i0, i1)
      push(o0, i1, o1)
      const ot0 = corner(i, gridRows)
      const ot1 = corner(i + 1, gridRows)
      const it0 = inner(i, gridRows)
      const it1 = inner(i + 1, gridRows)
      push(ot0, it1, it0)
      push(ot0, ot1, it1)
    }
  } else {
    for (let i = 0; i < segments; i++) {
      const bottomA = corner(i, gridRows)
      const bottomB = corner(i + 1, gridRows)
      const backA = inner(i, gridRows)
      const backB = inner(i + 1, gridRows)
      push(bottomA, backA, backB)
      push(bottomA, backB, bottomB)

      const topA = corner(i, 0)
      const topB = corner(i + 1, 0)
      const topBackA = inner(i, 0)
      const topBackB = inner(i + 1, 0)
      push(topA, topBackB, topBackA)
      push(topA, topB, topBackB)
    }
    for (let j = 0; j < gridRows; j++) {
      const leftA = corner(0, j)
      const leftB = corner(0, j + 1)
      const leftBackA = inner(0, j)
      const leftBackB = inner(0, j + 1)
      push(leftA, leftBackA, leftBackB)
      push(leftA, leftBackB, leftB)

      const rightA = corner(segments, j)
      const rightB = corner(segments, j + 1)
      const rightBackA = inner(segments, j)
      const rightBackB = inner(segments, j + 1)
      push(rightA, rightBackB, rightBackA)
      push(rightA, rightB, rightBackB)
    }
  }

  if (!tris.length) throw new Error('Aus dem Bild konnte kein Lithophane erzeugt werden.')
  return meshFromTris(tris)
}

// ---------- Objekt-Hilfen ----------

export type ToolAction =
  | 'duplicate'
  | 'delete'
  | 'clear'
  | 'merge'
  | 'arrange'
  | 'orient'
  | 'center'
  | 'bed'
  | 'repair'
  | 'separate'
  | 'removeplate'

export function duplicateObject(object: ModelObject): ModelObject {
  const placed = placeMesh(object.mesh, object.placement)
  return {
    id: randomUUID(),
    name: `${object.name} Kopie`,
    mesh: object.mesh,
    placement: {
      ...object.placement,
      offsetX: object.placement.offsetX + placed.bbox.size.x + 5,
    },
  }
}

/** Text auf die Oberseite des sichtbaren Modells setzen. */
export function textPlacement(objects: ModelObject[], textWidth: number): Partial<ModelPlacement> {
  const visible = objects.filter((o) => o.placement.visible)
  if (!visible.length) return { offsetX: 0, offsetY: 0, offsetZ: 0 }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, maxZ = -Infinity
  for (const o of visible) {
    const placed = placeMesh(o.mesh, o.placement)
    minX = Math.min(minX, placed.bbox.min.x)
    maxX = Math.max(maxX, placed.bbox.max.x)
    minY = Math.min(minY, placed.bbox.min.y)
    maxY = Math.max(maxY, placed.bbox.max.y)
    maxZ = Math.max(maxZ, placed.bbox.max.z)
  }
  const center: Vec3 = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: maxZ }
  void textWidth
  return { offsetX: center.x, offsetY: center.y, offsetZ: center.z - 0.1 }
}

export function newObject(name: string, mesh: Mesh, placement: Partial<ModelPlacement> = {}): ModelObject {
  return {
    id: randomUUID(),
    name,
    mesh,
    placement: { ...defaultPlacement(), ...placement },
  }
}
