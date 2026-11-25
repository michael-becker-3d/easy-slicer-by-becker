/**
 * Mehrfarbdruck: Filamentwechsel und Spülen.
 *
 * Die Engine druckt Objekte mit unterschiedlichen Filamenten nacheinander und
 * setzt dazwischen einen Wechsel. Was dabei passiert, hängt vom Drucker ab:
 * echte Werkzeugwechsler bekommen `T0`…`T3`, Einzel-Extruder mit
 * Mehrfachzuführung (IFS, AMS, ACE, CFS, MMU) bekommen einen Wechselbefehl wie
 * `M600` oder ein eigenes Makro. Danach muss die Düse gespült werden, sonst
 * zieht die alte Farbe in das neue Bauteil.
 *
 * Dieses Modul rechnet nur — es kennt weder Server noch Oberfläche. Dadurch
 * lässt es sich ohne Drucker prüfen.
 */

export type FilamentChangeMode = 'm600' | 'tool' | 'custom'

/** Wohin die Spüllinie gelegt wird (Bettkoordinaten). */
export type PurgeSide = 'back' | 'front'

export type MultiMaterialSettings = {
  /** m600 = Filamentwechsel am Drucker, tool = T0…Tn, custom = eigenes Makro. */
  change: FilamentChangeMode
  /** Makro für change = 'custom'. Platzhalter: {tool}, {nozzle}, {bed}. */
  changeGcode: string
  /** Rückzug vor dem Wechsel in mm. */
  retract: number
  purge: {
    enabled: boolean
    /** Spülvolumen je Wechsel in mm³. */
    volume: number
    /** Länge der Spüllinie in mm; 0 = aus dem Volumen berechnen. */
    length: number
    /** Tempo der Spüllinie in mm/s. */
    speed: number
    /** Hinten (hinter den Objekten) oder vorne am Bettrand. */
    side: PurgeSide
  }
}

export const DEFAULT_MULTI_MATERIAL: MultiMaterialSettings = {
  change: 'm600',
  changeGcode: 'M600',
  retract: 2,
  purge: { enabled: true, volume: 60, length: 0, speed: 20, side: 'back' },
}

/** Ältere Profile kennen den Abschnitt noch nicht. */
export function normalizeMultiMaterial(value?: Partial<MultiMaterialSettings> | null): MultiMaterialSettings {
  const purge = { ...DEFAULT_MULTI_MATERIAL.purge, ...(value?.purge ?? {}) }
  const merged: MultiMaterialSettings = {
    ...DEFAULT_MULTI_MATERIAL,
    ...(value ?? {}),
    purge,
  }
  if (merged.change !== 'm600' && merged.change !== 'tool' && merged.change !== 'custom') merged.change = 'm600'
  if (!Number.isFinite(merged.retract)) merged.retract = DEFAULT_MULTI_MATERIAL.retract
  if (!Number.isFinite(purge.volume) || purge.volume < 0) purge.volume = DEFAULT_MULTI_MATERIAL.purge.volume
  if (!Number.isFinite(purge.length) || purge.length < 0) purge.length = 0
  if (!Number.isFinite(purge.speed) || purge.speed <= 0) purge.speed = DEFAULT_MULTI_MATERIAL.purge.speed
  if (purge.side !== 'back' && purge.side !== 'front') purge.side = 'back'
  if (typeof merged.changeGcode !== 'string' || !merged.changeGcode.trim()) merged.changeGcode = 'M600'
  return merged
}

export type FilamentChangeInput = {
  multi: MultiMaterialSettings
  /** 0-basierte Werkzeugnummer des neuen Filaments. */
  tool: number
  /** Temperaturen, die nach dem Wechsel angefahren werden. */
  nozzle: number
  bed: number
}

/**
 * G-Code für den Wechsel selbst. Der Aufrufer parkt vorher über dem Bauteil —
 * hier stehen nur Rückzug und der eigentliche Wechselbefehl.
 */
export function filamentChangeGcode({ multi, tool, nozzle, bed }: FilamentChangeInput): string[] {
  const lines: string[] = []
  if (multi.retract > 0) lines.push(`G1 E-${multi.retract.toFixed(2)} F1800`)
  if (multi.change === 'tool') {
    lines.push(`T${Math.max(0, Math.round(tool))} ; Werkzeugwechsel`)
  } else if (multi.change === 'custom') {
    lines.push(
      multi.changeGcode
        .replaceAll('{tool}', String(Math.max(0, Math.round(tool))))
        .replaceAll('{nozzle}', String(nozzle))
        .replaceAll('{bed}', String(bed)),
    )
  } else {
    lines.push('M600 ; Filamentwechsel — Farbe/Material tauschen')
  }
  // Nach einem Wechsel ist die Düse kalt oder leer: Temperatur abwarten.
  if (Number.isFinite(bed)) lines.push(`M140 S${bed}`)
  if (Number.isFinite(nozzle)) {
    lines.push(`M104 S${nozzle}`, `M109 S${nozzle}`)
  }
  return lines
}

export type PurgeBox = { minX: number; minY: number; maxX: number; maxY: number }

export type PurgeLineInput = {
  /** Bauvolumen in mm. */
  bed: { x: number; y: number }
  /** Belegte Bereiche (Objekt-Bounding-Boxen inkl. Haftrand). */
  objects: PurgeBox[]
  multi: MultiMaterialSettings
  /** Anzahl der bisherigen Wechsel — jede Spüllinie bekommt ihren eigenen Platz. */
  index: number
  /** Düsendurchmesser und Filamentdurchmesser in mm. */
  nozzle: number
  filamentDiameter: number
  /** Höhe, in der gespült wird (erste Schicht des neuen Objekts). */
  z: number
  /** Schichthöhe, mit der die Spüllinie gerechnet wird. */
  layerHeight: number
}

export type PurgeLinePlan = {
  lines: string[]
  /** Verbrauchtes Filament in mm. */
  filamentMm: number
  /** Dauer in Sekunden. */
  seconds: number
  /** Volumen in mm³ (für Statistik und Vorschau). */
  volumeMm3: number
  /** Warum keine Spüllinie erzeugt wurde. */
  skipped?: string
}

const PURGE_MARGIN = 8
const PURGE_GAP = 10

/**
 * Länge der Spüllinie. Ohne Wunschlänge folgt sie aus dem Volumen, damit die
 * Linie bei 0,2 mm Schichthöhe und 0,45 mm Breite genau das Spülvolumen fördert.
 */
export function purgeLineLength(input: {
  volume: number
  length: number
  layerHeight: number
  lineWidth: number
}): number {
  if (input.length > 0) return input.length
  const section = Math.max(0.05, input.layerHeight) * Math.max(0.2, input.lineWidth)
  return Math.max(20, Math.min(200, input.volume / section))
}

function overlaps(a: PurgeBox, b: PurgeBox): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY
}

/**
 * Sucht einen freien Platz für die Spüllinie. Die Linie läuft waagerecht am
 * hinteren oder vorderen Bettrand; überlappt sie ein Objekt, rückt sie nach
 * rechts, sonst auf die andere Seite. Ist das ganze Bett belegt, wird nichts
 * gespült — besser keine Linie als eine durch das Bauteil.
 */
export function planPurgeLine(input: PurgeLineInput): PurgeLinePlan {
  const { multi, bed, objects, index, nozzle, filamentDiameter, z, layerHeight } = input
  const empty: PurgeLinePlan = { lines: [], filamentMm: 0, seconds: 0, volumeMm3: 0 }
  if (!multi.purge.enabled || multi.purge.volume <= 0) return empty

  // Bahnbreite der Spüllinie: etwas breiter als die Düse, damit sie haftet.
  const width = Math.max(0.2, nozzle * 1.125)
  const maxLength = bed.x - 2 * PURGE_MARGIN
  const length = Math.max(
    1,
    Math.min(
      maxLength,
      purgeLineLength({ volume: multi.purge.volume, length: multi.purge.length, layerHeight, lineWidth: width }),
    ),
  )
  if (length <= 1) return { ...empty, skipped: 'Die Spüllinie ist kürzer als 1 mm — Volumen oder Länge prüfen.' }

  // Eine einzelne Linie von 0,45 × 0,24 mm hält nur rund 0,1 mm³ je Millimeter.
  // 60 mm³ brauchen deshalb mehrere parallele Bahnen — genau das ist der
  // Unterschied zwischen einer Spüllinie und einem Purge-Turm.
  const section = Math.max(0.02, layerHeight * width)
  const perLine = length * section
  const passes = Math.max(1, Math.min(8, Math.ceil(multi.purge.volume / perLine)))
  const perPassVolume = multi.purge.volume / passes
  const rowHeight = passes * width * 1.2 + 4
  const rows = Math.max(1, Math.floor((bed.y - 2 * PURGE_MARGIN) / rowHeight))
  if (index >= rows) {
    return {
      ...empty,
      skipped: `Nur ${rows} freie Spülreihen am Bettrand — Objekte weiter nach vorn stellen oder Spülen ausschalten.`,
    }
  }

  const x0 = PURGE_MARGIN
  const x1 = x0 + length
  const row = index
  const back = multi.purge.side !== 'front'
  const firstY = back
    ? bed.y - PURGE_MARGIN - width / 2 - row * rowHeight
    : PURGE_MARGIN + width / 2 + row * rowHeight
  const step = width * 1.2 * (back ? -1 : 1)
  const band: PurgeBox = {
    minX: x0 - 1,
    maxX: x1 + 1,
    minY: Math.min(firstY, firstY + step * (passes - 1)) - width,
    maxY: Math.max(firstY, firstY + step * (passes - 1)) + width,
  }
  if (objects.some((object) => overlaps(object, band))) {
    return {
      ...empty,
      skipped:
        'Kein freier Platz für die Spüllinie am Bettrand — Objekte weiter nach innen stellen oder Spülen ausschalten.',
    }
  }

  const filamentArea = Math.PI * (Math.max(0.5, filamentDiameter) / 2) ** 2
  const perPassMm = perPassVolume / filamentArea
  const feed = Math.round(multi.purge.speed * 60)

  const lines = [`G0 Z${Math.max(0.2, z).toFixed(2)} F600`]
  for (let pass = 0; pass < passes; pass++) {
    const y = firstY + step * pass
    lines.push(`G0 X${x0.toFixed(2)} Y${y.toFixed(2)} F9000`)
    lines.push(`G1 X${x1.toFixed(2)} E${perPassMm.toFixed(3)} F${feed} ; Spüllinie`)
  }
  lines.push('G1 E-0.6 F1800')

  const filamentMm = perPassMm * passes
  const seconds = (length * passes) / Math.max(1, multi.purge.speed) + 3
  return { lines, filamentMm, seconds, volumeMm3: multi.purge.volume }
}
