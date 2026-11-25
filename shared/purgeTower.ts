/**
 * Purge-Turm für den schichtweisen Mehrfarbdruck.
 *
 * Beim Drucken nach Schichten wechselt die Farbe in jeder Schicht. Damit die
 * alte Farbe nicht in das Bauteil zieht, wird nach jedem Wechsel gespült — und
 * zwar in einen Turm neben den Objekten.
 *
 * Es gibt genau EINEN Turm für alle Farben. Sein Querschnitt ist in Farbbänder
 * geteilt (ein Band je Farbe, übereinander in Y); jede Farbe spült nur in ihr
 * eigenes Band. So überlappt keine Spülung, und das Bett braucht eine freie
 * Ecke statt einer eigenen Fläche je Farbe.
 *
 * Die Fläche folgt aus dem Spülvolumen: je Band Fläche = Volumen / Schichthöhe,
 * also Kantenlänge = Wurzel(Farben × Volumen / Schichthöhe).
 *
 * Dieses Modul rechnet nur. Es kennt weder Server noch Oberfläche, damit sich
 * Platzierung und G-Code ohne Drucker prüfen lassen.
 */

export type PurgeTowerBox = { minX: number; minY: number; maxX: number; maxY: number }

export type PurgeTowerBand = {
  /** Farbgruppe — nicht die Werkzeugnummer: zwei Filamente können einen Slot teilen. */
  tool: number
  /** 0-basierte Lage im Turm (0 = vorderstes Band). */
  index: number
  /** Linke Kante des Turms in X. */
  x: number
  /** Breite des Turms in X (= Kantenlänge). */
  width: number
  /** Unter- und Oberkante des Bandes in Y. */
  y0: number
  y1: number
}

export type PurgeTower = {
  /** Linke untere Ecke des Turmquaders in Bettkoordinaten. */
  x: number
  y: number
  /** Kantenlänge in mm. */
  size: number
  /** Ein Band je Farbe, lückenlos übereinander. */
  bands: PurgeTowerBand[]
}

export type PurgeTowerPlan =
  | { ok: true; tower: PurgeTower; side: 'back' | 'front'; size: number; colors: number }
  | { ok: false; error: string; size: number }

/** Rand des Turms zum Bett in mm. */
export const TOWER_MARGIN = 6
/** Größer lässt sich der Turm neben normalen Objekten nicht mehr unterbringen. */
export const TOWER_MAX = 60

function overlaps(a: PurgeTowerBox, b: PurgeTowerBox): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY
}

/**
 * Kantenlänge des Turms. Jedes Farbband muss das Spülvolumen einer Schicht als
 * volle Fläche aufnehmen: Fläche je Band = Volumen / Schichthöhe. Bei n Farben
 * ist der Turm deshalb Wurzel(n × Volumen / Schichthöhe) groß — ein Turm für
 * alle, nicht n einzelne. Unter 4 mm wird er zu dünn und kippt.
 */
export function purgeTowerSize(volume: number, layerHeight: number, colors = 1): number {
  const height = Math.max(0.05, Number.isFinite(layerHeight) ? layerHeight : 0.2)
  const count = Math.max(1, Math.round(Number.isFinite(colors) ? colors : 1))
  const area = (Math.max(0, Number.isFinite(volume) ? volume : 0) / height) * count
  const side = Math.ceil(Math.sqrt(area) * 2) / 2
  return Math.max(4, Math.min(TOWER_MAX, side))
}

export type PurgeTowerPlanInput = {
  bed: { x: number; y: number }
  /** Belegte Bereiche der Objekte in Bettkoordinaten (inkl. Haftrand). */
  objects: PurgeTowerBox[]
  /** Farbgruppen im Druck — je Gruppe ein Band im gemeinsamen Turm. */
  tools: number[]
  volume: number
  layerHeight: number
  /** Abstand zwischen Turm und Objekten in mm. */
  gap?: number
  /** Rand zum Bett in mm. */
  margin?: number
}

function makeTower(x: number, y: number, size: number, tools: number[]): PurgeTower {
  const bandHeight = size / tools.length
  const bands: PurgeTowerBand[] = tools.map((tool, index) => {
    const y0 = y + index * bandHeight
    return {
      tool,
      index,
      x,
      width: size,
      y0,
      y1: index === tools.length - 1 ? y + size : y0 + bandHeight,
    }
  })
  return { x, y, size, bands }
}

/**
 * Sucht EINEN freien Platz für den gemeinsamen Turm, zuerst an der hinteren
 * Bettkante, dann an der vorderen. Der Turm steht immer vollständig auf dem
 * Bett und berührt kein Objekt; findet sich kein Platz, wird der Slice
 * abgelehnt statt ohne Turm zu drucken.
 */
export function planPurgeTowers(input: PurgeTowerPlanInput): PurgeTowerPlan {
  const tools = [...new Set(input.tools)]
    .filter((tool) => Number.isFinite(tool))
    .sort((a, b) => a - b)
  const size = purgeTowerSize(input.volume, input.layerHeight, Math.max(1, tools.length))
  const gap = Math.max(0, Number.isFinite(input.gap ?? 3) ? (input.gap ?? 3) : 3)
  const margin = Math.max(1, Number.isFinite(input.margin ?? TOWER_MARGIN) ? (input.margin ?? TOWER_MARGIN) : TOWER_MARGIN)
  if (!tools.length) return { ok: false, size, error: 'Kein Werkzeug für den Purge-Turm vorhanden.' }
  if (input.bed.x < size + 2 * margin || input.bed.y < size + 2 * margin) {
    return { ok: false, size, error: 'Das Bett ist zu klein für einen Purge-Turm.' }
  }

  for (const side of ['back', 'front'] as const) {
    const y = side === 'back' ? input.bed.y - margin - size : margin
    for (let x = margin; x <= input.bed.x - margin - size + 1e-6; x += 0.5) {
      const box: PurgeTowerBox = {
        minX: x - gap,
        minY: y - gap,
        maxX: x + size + gap,
        maxY: y + size + gap,
      }
      if (input.objects.some((object) => overlaps(object, box))) continue
      const px = Math.round(x * 100) / 100
      const py = Math.round(y * 100) / 100
      return { ok: true, tower: makeTower(px, py, size, tools), side, size, colors: tools.length }
    }
  }

  return {
    ok: false,
    size,
    error:
      `Kein freier Platz für einen Purge-Turm (${size} × ${size} mm für ${tools.length} Farben). ` +
      'Objekte weiter zur Bettmitte stellen, das Spülvolumen senken oder den Turm ausschalten.',
  }
}

export type PurgeTowerPatchInput = {
  /** Band der Farbe, die gerade gespült wird. */
  band: PurgeTowerBand
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
  /** Tatsächlich zurückgezogen (mm) — der nächste Block muss das übernehmen. */
  retractMm: number
}

/**
 * G-Code für eine Turmschicht: nur das Band dieser Farbe wird als geschlossener
 * Rand und parallele Bahnen gefüllt; die Extrusion wird so verteilt, dass genau
 * das Spülvolumen gefördert wird. Danach: Rückzug und Z-Hub, damit die Düse
 * nicht durch den frischen Wulst zum nächsten Objekt zieht.
 */
export function purgeTowerPatch(input: PurgeTowerPatchInput): PurgeTowerPatch {
  const volume = Math.max(0, Number.isFinite(input.volume) ? input.volume : 0)
  const height = Math.max(0.05, Number.isFinite(input.height) ? input.height : 0.2)
  const z = Math.max(0, Number.isFinite(input.z) ? input.z : 0)
  const width = Math.max(0.25, Math.max(0.1, input.nozzle) * 1.125)
  const inset = width / 2
  const x0 = input.band.x + inset
  const x1 = input.band.x + input.band.width - inset
  const y0 = input.band.y0 + inset
  const y1 = input.band.y1 - inset
  if (volume <= 0 || x1 - x0 < width || y1 - y0 < width) {
    return { lines: [], filamentMm: 0, seconds: 0, volumeMm3: 0, pathMm: 0, retractMm: 0 }
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
  if (!(totalMm > 0)) return { lines: [], filamentMm: 0, seconds: 0, volumeMm3: 0, pathMm: 0, retractMm: 0 }

  const filamentArea = Math.PI * (Math.max(0.5, input.filamentDiameter) / 2) ** 2
  const totalFilament = volume / filamentArea
  const ePerMm = totalFilament / totalMm
  const feed = Math.max(60, Math.round(Math.max(1, input.speed) * 60))
  const lift = Math.max(0, Number.isFinite(input.zLift) ? input.zLift : 0.6)
  const retract = Math.max(0, Number.isFinite(input.retract) ? input.retract : 2)

  const lines = [
    `; Purge-Turm Werkzeug ${input.band.tool + 1} · Band ${input.band.index + 1}`,
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
  // Der tatsächliche Rückzug ist der kleinere von beiden Werten: Bei einer
  // sehr kleinen Spülung wurde weniger gefördert als der Wunsch-Rückzug.
  const retractMm = Math.min(retract, e)
  lines.push(`G1 E${(e - retractMm).toFixed(3)} F1800 ; Rückzug`)
  lines.push(`G1 Z${(z + lift).toFixed(3)} F600 ; Z-Hub nach dem Spülen`)

  return {
    lines,
    filamentMm: totalFilament,
    seconds: totalMm / Math.max(1, input.speed) + 3,
    volumeMm3: volume,
    pathMm: totalMm,
    retractMm,
  }
}
