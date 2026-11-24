import assert from 'node:assert/strict'
import { box } from '../server/meshlib.ts'
import { buildBinarySTL, parseSTL } from '../server/slicer/stl.ts'
import { sliceMesh } from '../server/slicer/index.ts'
import { applyPrinterLimits } from '../shared/limits.ts'
import { DEFAULT_SETTINGS, mergeSettings, type FuzzySkinSettings } from '../shared/types.ts'
import { printerById } from '../shared/catalog.ts'

const printer = printerById('flashforge-ad5x')
// 40 × 10 × 30 mm: vier klar getrennte Wandseiten, zehn Schichten Höhe.
const mesh = parseSTL(buildBinarySTL(box(40, 10, 30)))

const ALL = { enabled: true, front: true, back: true, left: true, right: true }

function sliceFaces(faces: FuzzySkinSettings['faces']): ReturnType<typeof sliceMesh> {
  const settings = applyPrinterLimits(
    printer,
    mergeSettings(DEFAULT_SETTINGS, {
      layerHeight: 0.2,
      firstLayerHeight: 0.2,
      walls: 1,
      topLayers: 1,
      bottomLayers: 1,
      infillDensity: 0,
      adhesion: 'none',
      ironing: { ...DEFAULT_SETTINGS.ironing, enabled: false },
      surfaceGuard: { ...DEFAULT_SETTINGS.surfaceGuard, enabled: false },
      seam: { ...DEFAULT_SETTINGS.seam, gap: 0, wipe: false },
      primeLine: { ...DEFAULT_SETTINGS.primeLine, enabled: false },
      output: { ...DEFAULT_SETTINGS.output, verbosePaths: true },
      fuzzySkin: {
        mode: 'external',
        thickness: 0.6,
        pointDistance: 0.4,
        pattern: 'noise',
        scale: 3,
        angle: 0,
        topSurfaces: false,
        faces,
      },
    }),
  )
  return sliceMesh(mesh, settings, printer, null, [], { start: false, end: false, metadata: false })
}

function layerSection(gcode: string, index: number): string {
  const starts = [...gcode.matchAll(/;LAYER:/g)].map((match) => match.index ?? 0)
  assert.ok(index >= 0 && index < starts.length, `Schicht ${index} fehlt`)
  return gcode.slice(starts[index], starts[index + 1] ?? gcode.length)
}

type Bounds = { minX: number; maxX: number; minY: number; maxY: number; points: number }

function bounds(gcode: string, index: number): Bounds {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let points = 0
  for (const line of layerSection(gcode, index).split(/\r?\n/)) {
    const match = /^G1 X(-?[\d.]+) Y(-?[\d.]+) E/.exec(line)
    if (!match) continue
    const x = Number(match[1])
    const y = Number(match[2])
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    points++
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  assert.ok(points > 4, `Schicht ${index}: keine Wandpunkte gefunden`)
  return { minX, maxX, minY, maxY, points }
}

const LAYER = 10
const plain = sliceFaces({ ...ALL, enabled: false })
const base = bounds(plain.gcode, LAYER)
assert.ok(base.maxX - base.minX > 39, 'Testbedingung: 40-mm-Breite fehlt')
assert.ok(base.maxY - base.minY > 9, 'Testbedingung: 10-mm-Tiefe fehlt')

type Move = [number, number]

/** Abstand eines Punktes zur Strecke a–b. */
function pointSegmentDistance(point: Move, a: Move, b: Move): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / len2)) : 0
  return Math.hypot(point[0] - (a[0] + dx * t), point[1] - (a[1] + dy * t))
}

/**
 * Größter Abstand der texturierten Punkte zur untexturierten Wand derselben
 * Seite. Die Wand selbst ist leicht gewellt; der Vergleich gegen dieselbe
 * Kontur neutralisiert das und misst nur die Texturauslenkung.
 */
function maxDeviation(points: Move[], base: Move[]): number {
  if (!points.length || base.length < 2) return 0
  let max = 0
  for (const point of points) {
    let best = Infinity
    for (let index = 1; index < base.length; index++) {
      best = Math.min(best, pointSegmentDistance(point, base[index - 1], base[index]))
    }
    if (Number.isFinite(best)) max = Math.max(max, best)
  }
  return max
}

function faceMoves(gcode: string, face: 'front' | 'back' | 'left' | 'right'): Move[] {
  const moves: Move[] = []
  for (const line of layerSection(gcode, LAYER).split(/\r?\n/)) {
    const match = /^G1 X(-?[\d.]+) Y(-?[\d.]+) E/.exec(line)
    if (!match) continue
    const point: Move = [Number(match[1]), Number(match[2])]
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue
    if (face === 'right' && point[0] > 128 && point[1] > 105 && point[1] < 115) moves.push(point)
    if (face === 'left' && point[0] < 92 && point[1] > 105 && point[1] < 115) moves.push(point)
    if (face === 'back' && point[1] > 124 && point[0] > 105 && point[0] < 115) moves.push(point)
    if (face === 'front' && point[1] < 96 && point[0] > 105 && point[0] < 115) moves.push(point)
  }
  return moves
}

const baseMoves = {
  right: faceMoves(plain.gcode, 'right'),
  left: faceMoves(plain.gcode, 'left'),
  back: faceMoves(plain.gcode, 'back'),
  front: faceMoves(plain.gcode, 'front'),
}

function residuals(gcode: string): Record<'front' | 'back' | 'left' | 'right', number> {
  return {
    right: maxDeviation(faceMoves(gcode, 'right'), baseMoves.right),
    left: maxDeviation(faceMoves(gcode, 'left'), baseMoves.left),
    back: maxDeviation(faceMoves(gcode, 'back'), baseMoves.back),
    front: maxDeviation(faceMoves(gcode, 'front'), baseMoves.front),
  }
}

// Die Kontur selbst ist nicht exakt gerade; verglichen wird deshalb immer
// gegen dieselbe Seite ohne Textur. Textur hebt den Rest deutlich an, eine
// abgeschaltete Seite bleibt beim Ausgangswert.
const plainResiduals = residuals(plain.gcode)
for (const [face, value] of Object.entries(plainResiduals)) {
  assert.ok(value <= 0.002, `${face}: Vergleichsbasis muss deckungsgleich sein (${value.toFixed(4)} mm)`)
}
const allFaces = residuals(sliceFaces(ALL).gcode)
for (const [face, value] of Object.entries(allFaces)) {
  assert.ok(value > 0.05, `${face}: Textur muss die Wand auslenken (${value.toFixed(3)} mm)`)
}

// Nur links: links texturiert, alle anderen Seiten bleiben beim Ausgangswert.
const leftOnly = residuals(sliceFaces({ ...ALL, front: false, back: false, right: false }).gcode)
assert.ok(leftOnly.left > 0.05, 'Linke Seite muss texturiert bleiben')
assert.ok(leftOnly.right <= 0.02, `Rechte Seite muss glatt bleiben (${leftOnly.right.toFixed(3)} mm)`)
assert.ok(leftOnly.back <= 0.02, 'Hintere Seite muss glatt bleiben')
assert.ok(leftOnly.front <= 0.02, 'Vordere Seite muss glatt bleiben')

// Nur rechts: genau umgekehrt.
const rightOnly = residuals(sliceFaces({ ...ALL, front: false, back: false, left: false }).gcode)
assert.ok(rightOnly.right > 0.05, 'Rechte Seite muss texturiert sein')
assert.ok(rightOnly.left <= 0.02, `Linke Seite muss glatt bleiben (${rightOnly.left.toFixed(3)} mm)`)

// Nur vorne: Y-Seite wechselt, X-Seiten bleiben.
const frontOnly = residuals(sliceFaces({ ...ALL, left: false, right: false, back: false }).gcode)
assert.ok(frontOnly.front > 0.05, 'Vordere Seite muss texturiert sein')
assert.ok(frontOnly.back <= 0.02, 'Hintere Seite muss glatt bleiben')
assert.ok(frontOnly.right <= 0.02 && frontOnly.left <= 0.02, 'X-Seiten müssen glatt bleiben')

// Alle Seiten aus: keine zusätzliche Auslenkung, aber gültiger G-Code.
const none = sliceFaces({ ...ALL, front: false, back: false, left: false, right: false })
const noneResiduals = residuals(none.gcode)
for (const [face, value] of Object.entries(noneResiduals)) {
  assert.ok(value <= 0.02, `${face}: ohne Flächenauswahl darf nichts ausgelenkt werden (${value.toFixed(3)} mm)`)
}
assert.ok(!/\bNaN\b|Infinity/.test(none.gcode), 'G-Code ohne Flächen enthält ungültige Koordinaten')

// Abschalten ändert nichts an der Deaktiviert-Einstellung des Hauptschalters.
const oldProfile = sliceFaces(undefined)
assert.ok(oldProfile.gcode.length > 0, 'Profile ohne faces-Feld müssen weiter funktionieren')
assert.ok(!/\bNaN\b|Infinity/.test(oldProfile.gcode), 'Altes Profil erzeugt ungültige Koordinaten')

console.log(
  `OK: Flächenzuweisung — Auslenkung rechts ${allFaces.right.toFixed(2)}, links ${allFaces.left.toFixed(2)}, ` +
    `hinten ${allFaces.back.toFixed(2)}, vorne ${allFaces.front.toFixed(2)} mm; ` +
    `nur links: links ${leftOnly.left.toFixed(2)} mm, rechts ${leftOnly.right.toFixed(3)} mm; ` +
    `nur rechts: rechts ${rightOnly.right.toFixed(2)} mm, links ${rightOnly.left.toFixed(3)} mm; ` +
    `alle Seiten aus bleibt glatt; alte Profile gültig.`,
)
