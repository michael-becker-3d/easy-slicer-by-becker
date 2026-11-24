/**
 * Planung für sequenziellen Druck: Ein Objekt wird vollständig gedruckt,
 * bevor das nächste beginnt. Die reine Geometrieprüfung ist absichtlich von
 * der Slice-Engine getrennt, damit UI, Server und Regressionstest dieselbe
 * Reihenfolge und dieselben Abstandsfehler sehen.
 */
export type SequentialObjectBox = {
  id: string
  name: string
  minX: number
  minY: number
  maxX: number
  maxY: number
  /** Höhe der platzierten Objekt-Bounding-Box über dem Bett. */
  maxZ: number
}

export type SequentialViolation = {
  a: string
  b: string
  /** Kürzester Abstand der beiden achsenparallelen Boxen in mm. */
  gap: number
}

export type SequentialPlan = {
  /** Indizes in der übergebenen Liste, in Druckreihenfolge. */
  order: number[]
  violations: SequentialViolation[]
  /** Auf 0…50 mm begrenzter, tatsächlich verwendeter Mindestabstand. */
  clearance: number
}

/**
 * Sortiert nach geringster Höhe (niedrige Teile zuerst), damit der Druckkopf
 * später über bereits fertige Teile fahren kann. Bei gleicher Höhe entscheidet
 * Y, dann X — das ist stabil und reproduzierbar.
 *
 * Der Abstand wird zwischen den achsenparallelen Bounding-Boxen geprüft. Das
 * ist bewusst konservativ: Der tatsächliche Kopfweg und die Portalhöhe lassen
 * sich ohne Druckerprofil nicht vollständig simulieren.
 */
export function planSequentialOrder(
  boxes: SequentialObjectBox[],
  requestedClearance: number,
): SequentialPlan {
  const clearance = Math.max(0, Math.min(50, Number.isFinite(requestedClearance) ? requestedClearance : 5))
  const order = boxes
    .map((_box, index) => index)
    .sort((a, b) => {
      const aa = boxes[a]
      const bb = boxes[b]
      return aa.maxZ - bb.maxZ || aa.minY - bb.minY || aa.minX - bb.minX || aa.id.localeCompare(bb.id)
    })

  const violations: SequentialViolation[] = []
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      // Abstand der Projektionen auf beiden Achsen. Bei Überlappung ist er 0.
      const gapX = Math.max(0, Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX))
      const gapY = Math.max(0, Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY))
      const gap = Math.hypot(gapX, gapY)
      if (gap + 1e-6 < clearance) {
        violations.push({ a: a.name, b: b.name, gap })
      }
    }
  }
  return { order, violations, clearance }
}

/** Kurztext für die Slice-Warnung. */
export function describeSequentialPlan(plan: SequentialPlan, count: number): string {
  return `Sequenzieller Druck: ${count} Objekte werden nacheinander gedruckt (niedrige zuerst, ` +
    `Mindestabstand ${plan.clearance.toFixed(1)} mm). Der Slicer prüft den horizontalen Abstand; ` +
    'Druckkopf-, Portal- und Kabelwege vor dem Start am Drucker kontrollieren.'
}