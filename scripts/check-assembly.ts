import assert from 'node:assert/strict'
import { planAssembly, type AssemblyInput } from '../shared/assembly.ts'

const bed = { x: 245, y: 245, z: 260 }
const base: AssemblyInput = {
  size: { x: 50, y: 50, z: 50 },
  bed,
  material: 'pla',
  load: 'normal',
}

// Passendes Teil: kein Schnitt, keine Naht, klare Begründung.
const fits = planAssembly(base)
assert.equal(fits.fits, true)
assert.equal(fits.pieces, 1)
assert.equal(fits.connector, 'none')
assert.equal(fits.seam, 'wave')
assert.equal(fits.pinCount, 0)
assert.ok(fits.reasons.some((reason) => reason.includes('ungeteilt')))
assert.ok(fits.reasons.some((reason) => reason.includes('Kein Schnitt nötig')))
assert.equal(fits.warnings.length, 0)

// Höhe zu groß: Z-Achse, zwei Teile, normaler Verbinder für PLA.
const tall = planAssembly({ ...base, size: { x: 100, y: 100, z: 300 } })
assert.equal(tall.fits, false)
assert.equal(tall.axis, 'z')
assert.equal(tall.pieces, 2)
assert.equal(tall.connector, 'dovetail')
assert.equal(tall.seam, 'flat')
assert.ok(tall.eachExtent <= 260 && tall.eachExtent >= 129)
assert.ok(tall.reasons.some((reason) => reason.includes('Z-Achse')))
assert.ok(tall.reasons.some((reason) => reason.includes('Schwalbenschwanz')))
assert.ok(tall.pinCount >= 2)

// X-Achse: 500 mm bei 237 mm nutzbar → drei Teile.
const wide = planAssembly({ ...base, size: { x: 500, y: 50, z: 50 } })
assert.equal(wide.axis, 'x')
assert.equal(wide.pieces, 3)
assert.ok(wide.reasons.some((reason) => reason.includes('X-Achse')))
assert.ok(wide.warnings.length === 0, 'Drei Teile dürfen noch nicht warnen')

// Viele Teile: Warnung vor zu vielen Nahtstellen.
const many = planAssembly({ ...base, size: { x: 1200, y: 50, z: 50 } })
assert.equal(many.pieces, 6)
assert.ok(many.warnings.some((warning) => warning.includes('Nahtstellen')))

// Belastung und Werkstoff ändern den Verbinder.
assert.equal(planAssembly({ ...base, size: { x: 300, y: 50, z: 50 }, load: 'heavy' }).connector, 'undercut')
assert.equal(planAssembly({ ...base, size: { x: 300, y: 50, z: 50 }, load: 'light' }).connector, 'puzzle')
assert.equal(planAssembly({ ...base, size: { x: 300, y: 50, z: 50 }, material: 'abs', load: 'normal' }).connector, 'undercut')
assert.equal(planAssembly({ ...base, size: { x: 300, y: 50, z: 50 }, material: 'tpu', load: 'normal' }).connector, 'tongue')
assert.equal(planAssembly({ ...base, size: { x: 300, y: 50, z: 50 }, material: 'tpu', load: 'heavy' }).connector, 'tongue')

// Passung: Messwert aus V-18 plus Werkstoff-Aufmaß.
const tight = planAssembly({ ...base, size: { x: 300, y: 50, z: 50 }, tolerance: 0.1 })
assert.equal(tight.clearance, 0.15)
assert.equal(tight.connectorClearance, 0.25)
const petg = planAssembly({ ...base, size: { x: 300, y: 50, z: 50 }, material: 'petg', tolerance: 0 })
assert.equal(petg.clearance, 0.07, 'PETG bekommt 0,02 mm Aufmaß auf die Passung')
assert.equal(petg.connectorClearance, 0.3)
const bigTolerance = planAssembly({ ...base, size: { x: 300, y: 50, z: 50 }, tolerance: 0.25 })
assert.ok(bigTolerance.warnings.some((warning) => warning.includes('klappern')))

// Auch ein passendes Teil teilen: zwei Hälften, Verbinder aktiv.
const forced = planAssembly({ ...base, forceSplit: true })
assert.equal(forced.fits, true)
assert.equal(forced.pieces, 2)
assert.notEqual(forced.connector, 'none')
assert.ok(forced.reasons.some((reason) => reason.includes('auf Wunsch')))

// Grenzen: Passung wird geklemmt, Zapfenmaße bleiben plausibel.
const clamped = planAssembly({ ...base, size: { x: 300, y: 50, z: 50 }, tolerance: 5 })
assert.equal(clamped.clearance, 0.4)
assert.ok(clamped.pinWidth >= 4 && clamped.pinWidth <= 10)
assert.ok(clamped.pinLength >= 5 && clamped.pinLength <= 12)
assert.ok(clamped.explodeGap >= 8 && clamped.explodeGap <= 30)
assert.ok(Number.isFinite(clamped.eachExtent) && clamped.eachExtent > 0)

// Jede Begründung ist ein echter Satz; Warnungen sind nur bei Bedarf da.
for (const plan of [fits, tall, wide, many, tight, forced]) {
  assert.ok(plan.reasons.length >= 1, 'Jeder Plan braucht mindestens eine Begründung')
  for (const reason of plan.reasons) {
    assert.ok(reason.trim().length > 20, `Begründung zu knapp: ${reason}`)
  }
}

console.log(
  `OK: passend → ungeteilt; 300 mm hoch → ${tall.pieces} Teile auf Z; ` +
    `500 mm breit → ${wide.pieces} Teile auf X; 1200 mm → ${many.pieces} Teile mit Warnung; ` +
    `Verbindermatrix (schwer/leicht/ABS/TPU) und Passung 0,10 → ${tight.clearance} mm geprüft.`,
)
