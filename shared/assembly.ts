/**
 * Montage-Assistent (V-20).
 *
 * Schlägt aus Bettgröße, Bauteilmaßen, Belastung und Werkstoff eine
 * Schnittachse, die Teilezahl, die Verbinderart und die Passung vor. Die
 * Passung kommt aus dem Kalibrier-Kreislauf (V-18), damit der Vorschlag nicht
 * mit einem geratenen Spalt arbeitet. Die Begründungen stehen im Ergebnis,
 * nicht im Kopf des Anwenders.
 */
export type AssemblyMaterial = 'pla' | 'petg' | 'abs' | 'asa' | 'tpu'
export type AssemblyLoad = 'light' | 'normal' | 'heavy'

export type AssemblyConnector =
  | 'pin'
  | 'dovetail'
  | 'puzzle'
  | 'tongue'
  | 'bayonet'
  | 'thread'
  | 'undercut'

export type AssemblyInput = {
  size: { x: number; y: number; z: number }
  bed: { x: number; y: number; z: number }
  material: AssemblyMaterial
  load: AssemblyLoad
  /** Gemessene Passung aus V-18 in mm; positiv = mehr Luft. */
  tolerance?: number
  /** Auch ein passendes Teil teilen (für leichteres Drucken/Handling). */
  forceSplit?: boolean
}

export type AssemblyPlan = {
  /** true, wenn das Teil ungeteilt auf das Bett passt. */
  fits: boolean
  axis: 'x' | 'y' | 'z'
  pieces: number
  /** Länge eines Teils entlang der Schnittachse in mm. */
  eachExtent: number
  connector: AssemblyConnector | 'none'
  seam: 'flat' | 'wave'
  clearance: number
  connectorClearance: number
  pinCount: number
  pinWidth: number
  pinLength: number
  pinHeight: number
  pinDepth: number
  pinTaper: number
  /** Abstand für die Explosionsdarstellung in mm. */
  explodeGap: number
  reasons: string[]
  warnings: string[]
}

const MATERIAL_ALLOWANCE: Record<AssemblyMaterial, number> = {
  pla: 0,
  petg: 0.05,
  abs: 0.04,
  asa: 0.04,
  tpu: 0.12,
}

const MATERIAL_LABEL: Record<AssemblyMaterial, string> = {
  pla: 'PLA',
  petg: 'PETG',
  abs: 'ABS',
  asa: 'ASA',
  tpu: 'TPU',
}

const LOAD_LABEL: Record<AssemblyLoad, string> = {
  light: 'leichte Belastung',
  normal: 'normale Belastung',
  heavy: 'hohe Belastung',
}

const round2 = (value: number) => Math.round(value * 100) / 100
const round1 = (value: number) => Math.round(value * 10) / 10
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** Verbinder nach Belastung und Werkstoff. */
function chooseConnector(
  material: AssemblyMaterial,
  load: AssemblyLoad,
): { connector: AssemblyConnector; reason: string } {
  if (material === 'tpu') {
    return {
      connector: 'tongue',
      reason: 'TPU ist flexibel: eine gerade Nut/Feder lässt sich ohne Kraft fügen und bricht an dünnen Zapfen nicht aus.',
    }
  }
  if (load === 'heavy') {
    if (material === 'abs' || material === 'asa') {
      return {
        connector: 'undercut',
        reason: 'ABS/ASA lassen sich mit Aceton dauerhaft verbinden. Der Hinterschnitt hält die Teile schon vor dem Kleben in Position.',
      }
    }
    return {
      connector: 'undercut',
      reason: 'Bei hoher Belastung hält die Rastnase mit breitem Kopf auch gegen Abheben — ein einfacher Zapfen würde ausscheren.',
    }
  }
  if (load === 'light') {
    return {
      connector: 'puzzle',
      reason: 'Bei leichter Belastung reicht die eingeschobene T-Nut: sie zentriert, ist leicht zu fügen und braucht wenig Material.',
    }
  }
  if (material === 'abs' || material === 'asa') {
    return {
      connector: 'undercut',
      reason: 'Der Hinterschnitt zentriert und hält beim Kleben; bei ABS/ASA ist die Naht später unsichtbar zu verschweißen.',
    }
  }
  return {
    connector: 'dovetail',
    reason: 'Der Schwalbenschwanz zieht die Hälften beim Fügen selbst zusammen und trägt normale Lasten ohne Kleber.',
  }
}

export function planAssembly(input: AssemblyInput): AssemblyPlan {
  const { size, bed, material, load } = input
  const reasons: string[] = []
  const warnings: string[] = []

  const room = {
    x: Math.max(20, bed.x - 8),
    y: Math.max(20, bed.y - 8),
    z: Math.max(20, bed.z - 2),
  }
  const overs = {
    x: size.x - room.x,
    y: size.y - room.y,
    z: size.z - room.z,
  }
  const worst = (['x', 'y', 'z'] as const).reduce((best, axis) =>
    overs[axis] > overs[best] ? axis : best,
  )
  const fits = overs.x <= 0 && overs.y <= 0 && overs.z <= 0
  const axis =
    !fits
      ? worst
      : size.x >= size.y && size.x >= size.z
        ? 'x'
        : size.y >= size.z
          ? 'y'
          : 'z'
  const extent = size[axis]
  const pieces = fits
    ? input.forceSplit
      ? 2
      : 1
    : clamp(Math.ceil(extent / room[axis]), 2, 12)
  const eachExtent = round1(extent / pieces)

  const { connector, reason } = pieces > 1 ? chooseConnector(material, load) : { connector: 'none' as const, reason: '' }

  const tolerance = Number.isFinite(input.tolerance) ? clamp(input.tolerance ?? 0, -0.3, 0.5) : 0
  const allowance = MATERIAL_ALLOWANCE[material]
  const clearance = round2(clamp(0.05 + tolerance + allowance * 0.4, 0, 0.4))
  const connectorClearance = round2(clamp(0.25 + allowance, 0.1, 0.6))

  const shortSide = Math.max(1, Math.min(size.x, size.y))
  const pinWidth = round1(clamp(shortSide / 5, 4, 10))
  const pinLength = round1(clamp(eachExtent * 0.18, 5, 12))
  const pinHeight = 4
  const pinDepth = 4
  const pinTaper = material === 'tpu' ? 0.12 : 0.08
  const pinCount = load === 'heavy' && pieces <= 3 ? 2 : 2

  if (fits && pieces === 1) {
    reasons.push(
      `Das Teil passt mit ${size.x.toFixed(1).replace('.', ',')} × ${size.y.toFixed(1).replace('.', ',')} × ${size.z.toFixed(1).replace('.', ',')} mm ungeteilt auf ${bed.x} × ${bed.y} × ${bed.z} mm.`,
    )
    reasons.push('Kein Schnitt nötig — jede Naht ist eine zusätzliche Schwachstelle und ein zusätzlicher Arbeitsschritt.')
  } else if (!fits) {
    reasons.push(
      `Auf der ${axis.toUpperCase()}-Achse sind ${extent.toFixed(1).replace('.', ',')} mm zu lang für ${room[axis].toFixed(0)} mm nutzbare Länge. ${pieces} Teile ergeben je ${eachExtent.toFixed(1).replace('.', ',')} mm.`,
    )
    reasons.push(
      `Die ${axis === 'z' ? 'Höhe' : axis === 'x' ? 'Breite' : 'Tiefe'} ist die stärkste Überschreitung; dort kostet der Schnitt die wenigsten sichtbaren Flächen.`,
    )
  } else {
    reasons.push(`Das Teil passt zwar, wird auf Wunsch aber in ${pieces} Teile geteilt — kürzere Druckwege und weniger Verzug an der langen Achse.`)
  }

  if (pieces > 1) {
    reasons.push(reason)
    reasons.push(
      `Passung ${clearance.toFixed(2).replace('.', ',')} mm aus ${tolerance === 0 ? 'Standardwert' : 'deiner Messung'} plus ${MATERIAL_LABEL[material]}-Aufmaß; Verbinderluft ${connectorClearance.toFixed(2).replace('.', ',')} mm.`,
    )
    reasons.push(`Vorschlag für ${LOAD_LABEL[load]}. Bei anderer Belastung ändert sich die Verbinderart, nicht die Teilung.`)
  }

  if (pieces > 4) {
    warnings.push(
      `${pieces} Teile bedeuten ${pieces - 1} Nahtstellen. Jede Naht kostet Genauigkeit — prüfe, ob eine andere Ausrichtung oder ein größerer Drucker nicht besser ist.`,
    )
  }
  if (tolerance > 0.2) {
    warnings.push(
      `Die gemessene Passung von ${tolerance.toFixed(2).replace('.', ',')} mm ist groß. Das Teil wird klappern; für eine Presspassung zuerst den Passungskupon neu drucken.`,
    )
  }
  if (pieces > 1 && eachExtent < 15) {
    warnings.push(
      `Ein Teilstück wäre nur ${eachExtent.toFixed(1).replace('.', ',')} mm lang. Sehr kurze Stücke lassen sich schlecht greifen und schlecht ausrichten.`,
    )
  }
  if (material === 'tpu' && pieces > 2) {
    warnings.push('TPU lässt sich schlecht kleben. Mehr als zwei Teile nur mit mechanischem Verbinder und viel Geduld.')
  }

  return {
    fits,
    axis,
    pieces,
    eachExtent,
    connector,
    seam: connector === 'none' ? 'wave' : 'flat',
    clearance,
    connectorClearance,
    pinCount: pieces > 1 ? pinCount : 0,
    pinWidth,
    pinLength,
    pinHeight,
    pinDepth,
    pinTaper,
    explodeGap: round1(clamp(Math.max(size.x, size.y, size.z) * 0.18, 8, 30)),
    reasons,
    warnings,
  }
}
