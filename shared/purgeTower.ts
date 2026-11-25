/**
 * Purge-Turm für den schichtweisen Mehrfarbdruck.
 *
 * Beim Drucken nach Schichten wechselt die Farbe in jeder Schicht. Damit die
 * alte Farbe nicht in das Bauteil zieht, wird nach jedem Wechsel gespült — und
 * zwar in einen Turm neben den Objekten. Der Turm wächst mit der Schicht: je
 * Wechsel eine volle Fläche aus dem Spülvolumen. Weil das Spülvolumen die
 * Fläche bestimmt (Fläche = Volumen / Schichthöhe), kann der Turm nicht
 * beliebig schmal werden.
 *
 * Dieses Modul rechnet nur. Es kennt weder Server noch Oberfläche, damit sich
 * Platzierung und G-Code ohne Drucker prüfen lassen.
 */

export type PurgeTowerBox = { minX: number; minY: number; maxX: number; maxY: number }

export type PurgeTowerCell = {
  /** Werkzeug/Farbe, zu der dieser Turm gehört. */
  tool: number
  /** Linke untere Ecke des Turmquerschnitts in Bettkoordinaten. */
  x: number
  y: number
  /** Kantenlänge des quadratischen Querschnitts in mm. */
  size: number
}

export type PurgeTowerPlan =
  | { ok: true; cells: PurgeTowerCell[]; side: 'back' | 'front'; size: number }
  | { ok: false; error: string; size: number }

/** Rand des Turms zum Bett in mm. */
export const TOWER_MARGIN = 6

function overlaps(a: PurgeTowerBox, b: PurgeTowerBox): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY
}

function cellBox(cell: PurgeTowerCell, gap: number): PurgeTowerBox {
  return {
    minX: cell.x - gap,
    minY: cell.y - gap,
    maxX: cell.x + cell.size + gap,
    maxY: cell.y + cell.size + gap,
  }
}

/**
 * Kantenlänge des Turms. Das Spülvolumen einer Schicht wird als volle Fläche
 * abgelegt: Fläche = Volumen / Schichthöhe. Unter 4 mm wird der Turm zu dünn
 * und kippt; über 45 mm passt er neben normalen Objekten nicht mehr.
 */
export function purgeTowerSize(volume: number, layerHeight: number): number {
  const height = Math.max(0.05, Number.isFinite(layerHeight) ? layerHeight : 0.2)
  const area = Math.max(0, Number.isFinite(volume) ? volume : 0) / height
  const side = Math.sqrt(area)
  return Math.round(Math.max(4, Math.min(45, side)) * 2) / 2
}

export type PurgeTowerPlanInput = {
  bed: { x: number; y: number }
  /** Belegte Bereiche der Objekte in Bettkoordinaten (inkl. Haftrand). */
  objects: PurgeTowerBox[]
  /** Werkzeuge, die im Druck vorkommen — je Werkzeug ein eigener Turm. */
  tools: number[]
  volume: number
  layerHeight: number
  /** Abstand zwischen Turm und Objekt bzw. zwischen zwei Türmen in mm. */
  gap?: number
  /** Rand zum Bett in mm. */
  margin?: number
}

/**
 * Sucht für jedes Werkzeug einen freien Platz, zuerst an der hinteren
 * Bettkante, dann an der vorderen. Der Turm steht immer vollständig auf dem
 * Bett und berührt kein Objekt; findet sich kein Platz, wird der Slice
 * abgelehnt statt ohne Turm zu drucken.
 */
export function planPurgeTowers(input: PurgeTowerPlanInput): PurgeTowerPlan {
  const size = purgeTowerSize(input.volume, input.layerHeight)
  const gap = Math.max(0, Number.isFinite(input.gap ?? 3) ? (input.gap ?? 3) : 3)
  const margin = Math.max(1, Number.isFinite(input.margin ?? TOWER_MARGIN) ? (input.margin ?? TOWER_MARGIN) : TOWER_MARGIN)
  const tools = [...new Set(input.tools)]
    .filter((tool) => Number.isFinite(tool))
    .sort((a, b) => a - b)
  if (!tools.length) return { ok: false, size, error: 'Kein Werkzeug für den Purge-Turm vorhanden.' }
  if (input.bed.x < size + 2 * margin || input.bed.y < size + 2 * margin) {
    return { ok: false, size, error: 'Das Bett ist zu klein für einen Purge-Turm.' }
  }

  for (const side of ['back', 'front'] as const) {
    const cells: PurgeTowerCell[] = []
    let fits = true
    for (const tool of tools) {
      const y = side === 'back' ? input.bed.y - margin - size : margin
      let found = -1
      for (let x = margin; x <= input.bed.x - margin - size + 1e-6; x += 0.5) {
        const box: PurgeTowerBox = {
          minX: x - gap,
          minY: y - gap,
          maxX: x + size + gap,
          maxY: y + size + gap,
        }
        if (input.objects.some((object) => overlaps(object, box))) continue
        if (cells.some((cell) => overlaps(cellBox(cell, gap), box))) continue
        found = x
        break
      }
      if (found < 0) {
        fits = false
        break
      }
      cells.push({ tool, x: Math.round(found * 100) / 100, y: Math.round(y * 100) / 100, size })
    }
    if (fits) return { ok: true, cells, side, size }
  }

  return {
    ok: false,
    size,
    error:
      `Kein freier Platz für ${tools.length} Purge-Türme (${size} × ${size} mm). ` +
      'Objekte weiter zur Bettmitte stellen, das Spülvolumen senken oder den Turm ausschalten.',
  }
}

export type PurgeTowerPatchInput = {
  cell: PurgeTowerCell
  /** Oberkante der aktuellen Schicht in mm. */
  z: number
  /** Schichthöhe in mm. */
  height: number
  /** Spülvolumen dieser Schicht in mm³. */
  volume: number
  speed: number
  nozzle: number
  filamentDiameter: number
  /** Rückzug nach dem Spülen in mm. */
  retract: number
  /** Düse nach dem Spülen um diesen Betrag anheben (mm). */
  zLift: number
}

export type PurgeTowerPatch = {
  lines: string[]
  /** Verbrauchtes Filament in mm. */
  filamentMm: number
  seconds: number
  volumeMm3: number
  /** Gedruckte Bahnlänge in mm. */
  pathMm: number
}

/**
 * G-Code für eine Turmschicht. Der Querschnitt wird als geschlossener Rand und
 * parallele Bahnen gefüllt; die Extrusion wird so verteilt, dass genau das
 * Spülvolumen gefördert wird. Danach: Rückzug und Z-Hub, damit die Düse nicht
 * durch den frischen Wulst zum nächsten Objekt zieht.
 */
export function purgeTowerPatch(input: PurgeTowerPatchInput): PurgeTowerPatch {
  const volume = Math.max(0, Number.isFinite(input.volume) ? input.volume : 0)
  const height = Math.max(0.05, Number.isFinite(input.height) ? input.height : 0.2)
  const z = Math.max(0, Number.isFinite(input.z) ? input.z : 0)
  const width = Math.max(0.25, Math.max(0.1, input.nozzle) * 1.125)
  const inset = width / 2
  const x0 = input.cell.x + inset
  const x1 = input.cell.x + input.cell.size - inset
  const y0 = input.cell.y + inset
  const y1 = input.cell.y + input.cell.size - inset
  if (volume <= 0 || x1 - x0 < width || y1 - y0 < width) {
    return { lines: [], filamentMm: 0, seconds: 0, volumeMm3: 0, pathMm: 0 }
  }

  // Rand als geschlossener Ring, danach parallele Bahnen im Wechsel.
  const paths: { x: number; y: number }[][] = [
    [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
      { x: x0, y: y0 },
    ],
  ]
  let flip = false
  for (let y = y0 + width; y < y1 - 1e-6; y += width) {
    const line = flip ? [{ x: x1, y }, { x: x0, y }] : [{ x: x0, y }, { x: x1, y }]
    paths.push(line)
    flip = !flip
  }

  let totalMm = 0
  for (const path of paths) {
    for (let i = 1; i < path.length; i++) {
      totalMm += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y)
    }
  }
  if (!(totalMm > 0)) return { lines: [], filamentMm: 0, seconds: 0, volumeMm3: 0, pathMm: 0 }

  const filamentArea = Math.PI * (Math.max(0.5, input.filamentDiameter) / 2) ** 2
  const totalFilament = volume / filamentArea
  const ePerMm = totalFilament / totalMm
  const feed = Math.max(60, Math.round(Math.max(1, input.speed) * 60))
  const lift = Math.max(0, Number.isFinite(input.zLift) ? input.zLift : 0.6)
  const retract = Math.max(0, Number.isFinite(input.retract) ? input.retract : 2)

  const lines = [
    `; Purge-Turm Werkzeug ${input.cell.tool + 1}`,
    `G0 Z${(z + lift + 2).toFixed(2)} F600`,
    `G0 X${x0.toFixed(2)} Y${y0.toFixed(2)} F9000`,
    `G1 Z${z.toFixed(3)} F600`,
    'G92 E0',
  ]
  let e = 0
  for (const path of paths) {
    lines.push(`G0 X${path[0].x.toFixed(2)} Y${path[0].y.toFixed(2)} F9000`)
    for (let i = 1; i < path.length; i++) {
      const length = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y)
      e += length * ePerMm
      lines.push(`G1 X${path[i].x.toFixed(2)} Y${path[i].y.toFixed(2)} E${e.toFixed(3)} F${feed}`)
    }
  }
  // Rückzug auf den absoluten E-Stand (die Datei rechnet absolut) und Hub.
  lines.push(`G1 E${Math.max(0, e - retract).toFixed(3)} F1800 ; Rückzug`)
  lines.push(`G1 Z${(z + lift).toFixed(3)} F600 ; Z-Hub nach dem Spülen`)

  return {
    lines,
    filamentMm: totalFilament,
    seconds: totalMm / Math.max(1, input.speed) + 3,
    volumeMm3: volume,
    pathMm: totalMm,
  }
}
