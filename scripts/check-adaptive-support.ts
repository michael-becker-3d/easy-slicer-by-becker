import assert from 'node:assert/strict'
import { planSupport } from '../server/slicer/support.ts'
import { signedArea, type Poly } from '../server/slicer/clipper.ts'
import type { SupportSettings } from '../shared/types.ts'
import { SETTING_INFO } from '../src/settingsInfo.ts'

const square = (size: number): Poly => [
  { x: -size / 2, y: -size / 2 },
  { x: size / 2, y: -size / 2 },
  { x: size / 2, y: size / 2 },
  { x: -size / 2, y: size / 2 },
]

/**
 * Die Höhen sind absichtlich gemischt. Der Mittelwert wäre 0,186 mm; die
 * tatsächliche Stützspitze liegt bei 0,8 mm, weil die beiden Lagen darüber
 * zusammen genau 0,3 mm hoch sind. Eine Rechnung mit dem Mittelwert würde
 * eine Lage zu hoch ansetzen.
 */
const heights = [0.2, 0.2, 0.1, 0.3, 0.2, 0.1, 0.2]
let top = 0
const layers = heights.map((height, index) => {
  top += height
  return {
    loops: index === heights.length - 1 ? [square(20)] : [],
    inner: [],
    z: top,
    height,
  }
})

const base: SupportSettings = {
  kind: 'normal',
  threshold: 50,
  density: 15,
  pattern: 'grid',
  interfaceLayers: 2,
  interfaceDensity: 80,
  zDistance: 0.3,
  xyDistance: 0.1,
  branchAngle: 30,
  interfacePattern: 'grid',
}

function occupied(plan: ReturnType<typeof planSupport>, index: number): number {
  return plan.area[index].length + plan.interfaceArea[index].length
}

function supportTop(plan: ReturnType<typeof planSupport>): number {
  for (let i = layers.length - 1; i >= 0; i--) if (occupied(plan, i) > 0) return i
  return -1
}

function width(polys: Poly[]): number {
  let min = Infinity
  let max = -Infinity
  for (const poly of polys) {
    for (const p of poly) {
      min = Math.min(min, p.x)
      max = Math.max(max, p.x)
    }
  }
  return Number.isFinite(min) ? max - min : 0
}

function area(polys: Poly[]): number {
  return polys.reduce((sum, poly) => sum + Math.abs(signedArea(poly)), 0)
}

const normal = planSupport(layers, base)
assert.equal(normal.overhangLayers, 1, 'Der Überhang muss genau einmal erkannt werden')

// Stützspitze: 0,3 mm unter der Überhangunterseite, nicht nach Mittelwert.
const topIndex = supportTop(normal)
assert.equal(topIndex, 3, `Stützspitze muss auf Schichtindex 3 liegen, nicht ${topIndex}`)
const overhangBottom = layers[6].z - layers[6].height
const actualGap = overhangBottom - layers[3].z
assert.ok(actualGap >= 0.3 - 1e-6, `Tatsächlicher Z-Abstand zu klein: ${actualGap}`)
assert.ok(overhangBottom - layers[4].z < 0.3 - 1e-6, 'Eine Lage höher darf den Z-Abstand unterschreiten')

// Kontaktlagen liegen an der tatsächlichen Spitze, nicht an einer gemittelten Lage.
assert.ok(occupied(normal, 3) > 0, 'Kontaktlage an der Stützspitze fehlt')
assert.ok(occupied(normal, 2) > 0, 'Zweite Kontaktlage fehlt')
assert.equal(normal.area[3].length, 0, 'Die oberste Kontaktlage darf nicht zusätzlich als Stützfläche zählen')
assert.equal(normal.area[2].length, 0, 'Die zweite Kontaktlage darf nicht zusätzlich als Stützfläche zählen')
assert.ok(normal.area[1].length > 0, 'Unter den Kontaktlagen muss die Stützfläche beginnen')
assert.equal(occupied(normal, 4), 0, 'Über der Stützspitze darf keine Stütze stehen')
assert.equal(occupied(normal, 5), 0, 'Im Z-Abstand darf keine Stütze stehen')
assert.ok(area(normal.area[1]) > 0, 'Stützfläche muss eine positive Fläche haben')

// Eine Kontaktlage weniger verschiebt nur die Kontaktzone, nicht die Spitze.
const oneContact = planSupport(layers, { ...base, interfaceLayers: 1 })
assert.equal(supportTop(oneContact), 3, 'Kontaktlagen dürfen die Stützspitze nicht verschieben')
assert.ok(oneContact.area[2].length > 0, 'Bei einer Kontaktlage muss Schicht 2 normaler Stützbereich sein')
assert.ok(oneContact.area[1].length > 0)
assert.ok(oneContact.interfaceArea[3].length > 0)
assert.equal(oneContact.area[3].length, 0)

// Baumstützen: Aufweitung pro tatsächlicher Schichthöhe, nicht pro Mittelwert.
const tree = planSupport(layers, { ...base, kind: 'tree' })
assert.equal(supportTop(tree), 3, 'Baumspitze muss denselben tatsächlichen Z-Abstand nutzen')
const w3 = width([...tree.interfaceArea[3], ...tree.area[3]])
const w2 = width([...tree.interfaceArea[2], ...tree.area[2]])
const w1 = width([...tree.interfaceArea[1], ...tree.area[1]])
const w0 = width([...tree.interfaceArea[0], ...tree.area[0]])
assert.ok(w3 > 0 && w2 > w3 && w1 > w2 && w0 > w1, `Baumbreiten müssen nach unten wachsen: ${[w3, w2, w1, w0]}`)
const slope = Math.tan((30 * Math.PI) / 180)
const near = (actual: number, expected: number, message: string) => {
  assert.ok(Math.abs(actual - expected) < 0.02, `${message}: ${actual} statt ${expected}`)
}
near(w2 - w3, 2 * slope * layers[3].height, 'Aufweitung von Lage 4 nach 3')
near(w1 - w2, 2 * slope * layers[2].height, 'Aufweitung von Lage 3 nach 2')
near(w0 - w1, 2 * slope * layers[1].height, 'Aufweitung von Lage 2 nach 1')

assert.ok(!/\bNaN\b|Infinity/.test(JSON.stringify(normal)), 'Stützplan enthält ungültige Werte')
assert.equal(JSON.stringify(planSupport(layers, base)), JSON.stringify(normal), 'Stützplan muss deterministisch sein')

for (const key of ['Z-Abstand|mm', 'Kontaktlagen', 'Baumwinkel|°']) {
  assert.ok(SETTING_INFO[key], `Info-Punkt fehlt: ${key}`)
}

console.log(
  `OK: Adaptive Stützen; Spitze Index ${topIndex}, tatsächlicher Z-Abstand ${actualGap.toFixed(2)} mm, ` +
    `Kontaktlagen ${normal.interfaceArea.map((p, i) => (p.length ? i : -1)).filter((i) => i >= 0).join('/')}, ` +
    `Baumbreiten ${w3.toFixed(2)} → ${w2.toFixed(2)} → ${w1.toFixed(2)} → ${w0.toFixed(2)} mm.`,
)