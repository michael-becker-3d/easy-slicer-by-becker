import assert from 'node:assert/strict'
import { box } from '../server/meshlib.ts'
import { buildBinarySTL, parseSTL } from '../server/slicer/stl.ts'
import { compensateFirstLayer, sliceMesh } from '../server/slicer/index.ts'
import { signedArea, type Poly } from '../server/slicer/clipper.ts'
import { elephantFootInset } from '../shared/calibration.ts'
import { printerById } from '../shared/catalog.ts'
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  type ElephantFootSettings,
  type PrintSettings,
} from '../shared/types.ts'

const printer = printerById('flashforge-ad5x')
const mesh = parseSTL(buildBinarySTL(box(40, 1, 40)))

// Messwert-Rechner: 20 mm Soll, 20,4 mm Fuß → 0,2 mm Einzug pro Seite.
assert.equal(elephantFootInset(20, 20.4), 0.2, 'Fußbreite muss den Einzug pro Seite ergeben')
assert.equal(elephantFootInset(40, 39.8), -0.1, 'Ein schmalerer Fuß muss negativ weiten')
assert.equal(elephantFootInset(20, 20), 0, 'Sollmaß muss null Einzug ergeben')
assert.equal(elephantFootInset(0, 20.4), null, 'Ungültiges Sollmaß darf keinen Einzug liefern')
assert.equal(elephantFootInset(20, 0), null, 'Ungültige Fußbreite darf keinen Einzug liefern')

function settings(foot: Partial<ElephantFootSettings> | null): PrintSettings {
  return mergeSettings(DEFAULT_SETTINGS, {
    layerHeight: 0.2,
    firstLayerHeight: 0.2,
    walls: 1,
    topLayers: 1,
    bottomLayers: 1,
    infillDensity: 0,
    adhesion: 'none',
    ironing: { enabled: false },
    surfaceGuard: { enabled: false },
    fuzzySkin: { mode: 'off' },
    primeLine: { enabled: false },
    seam: { gap: 0, wipe: false },
    output: { verbosePaths: true },
    elephantFoot: foot
      ? { enabled: true, amount: 0.2, scope: 'outer-wall', ...foot }
      : { enabled: false },
  })
}

function slice(foot: Partial<ElephantFootSettings> | null) {
  return sliceMesh(mesh, settings(foot), printer, null, [], {
    start: false,
    end: false,
    metadata: false,
  })
}

type Bounds = { minX: number; maxX: number; minY: number; maxY: number; points: number }

/**
 * Liest die tatsächlich gedruckten Außenwandbahnen einer Schicht aus. Die
 * Linienbreite ändert nur die Extrusion, nicht die Bahnmitte; gemessen wird
 * deshalb der Abstand der Wandmittellinien.
 */
function outerWallBounds(code: string, layer: number): Bounds {
  const section = code.split(/;LAYER:/)[layer]
  assert.ok(section, `Schicht ${layer} fehlt im G-Code`)
  let inOuter = false
  let points = 0
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const raw of section.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('; TYPE:')) {
      // Direkt über einer eingezogenen ersten Schicht wird die Außenwand als
      // Überhang eingestuft; für die Messung zählt sie trotzdem als Außenwand.
      inOuter = line === '; TYPE: outer-wall' || line === '; TYPE: overhang'
      continue
    }
    if (!inOuter) continue
    const match = line.match(/^G1 X(-?[\d.]+) Y(-?[\d.]+)/)
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
  assert.ok(points >= 4, `Schicht ${layer}: keine Außenwandbahnen gefunden`)
  return { minX, maxX, minY, maxY, points }
}

const width = (bounds: Bounds) => bounds.maxX - bounds.minX
const height = (bounds: Bounds) => bounds.maxY - bounds.minY
const near = (actual: number, expected: number, message: string) => {
  assert.ok(Math.abs(actual - expected) <= 0.02, `${message}: ${actual.toFixed(3)} statt ${expected.toFixed(3)}`)
}

const off = slice(null)
const outer = slice({ scope: 'outer-wall' })
const entire = slice({ scope: 'first-layer' })
const negative = slice({ amount: -0.2, scope: 'outer-wall' })
const tooLarge = slice({ amount: 0.3, scope: 'first-layer' })

// Die beiden Bereiche müssen sich bei einer Bohrung unterscheiden: Die
// Außenwand-Kompensation lässt sie unverändert, die ganze Schicht verschiebt
// auch ihren Rand.
const square = (x0: number, y0: number, x1: number, y1: number): Poly => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
]
const outerSquare = square(-20, -20, 20, 20)
const hole: Poly = square(-5, -5, 5, 5).reverse()
assert.ok(signedArea(outerSquare) > 0 && signedArea(hole) < 0, 'Testkonturen müssen die erwartete Orientierung haben')
const onlyOuter = compensateFirstLayer([outerSquare, hole], 0.2, 'outer-wall')
const wholeLayer = compensateFirstLayer([outerSquare, hole], 0.2, 'first-layer')
const unchangedHole = onlyOuter.find((poly) => signedArea(poly) < 0)
const shiftedHole = wholeLayer.find((poly) => signedArea(poly) < 0)
assert.deepEqual(unchangedHole, hole, 'Nur Außenwand darf eine Bohrung nicht verschieben')
assert.ok(
  shiftedHole && Math.max(...shiftedHole.map((point) => point.x)) > 5.1,
  'Gesamte erste Schicht muss den Bohrungsrand mit verschieben',
)

const offFirst = outerWallBounds(off.gcode, 1)
const offSecond = outerWallBounds(off.gcode, 2)
near(width(offFirst), width(offSecond), 'Ohne Kompensation darf die erste Schicht nicht schmaler sein')
near(height(offFirst), height(offSecond), 'Ohne Kompensation darf die erste Schicht nicht flacher sein')

const outerFirst = outerWallBounds(outer.gcode, 1)
const outerSecond = outerWallBounds(outer.gcode, 2)
near(width(outerFirst), width(offFirst) - 0.4, 'Außenkontur: Einzug pro Seite muss die Breite um 0.4 mm verringern')
near(height(outerFirst), height(offFirst) - 0.4, 'Außenkontur: Einzug pro Seite muss die Höhe um 0.4 mm verringern')
near(width(outerSecond), width(offSecond), 'Außenkontur: zweite Schicht muss unverändert bleiben')

const entireFirst = outerWallBounds(entire.gcode, 1)
const entireSecond = outerWallBounds(entire.gcode, 2)
near(width(entireFirst), width(outerFirst), 'Ohne Bohrungen müssen beide Bereiche gleich wirken')
near(height(entireFirst), height(outerFirst), 'Ohne Bohrungen müssen beide Bereiche gleich wirken')
near(width(entireSecond), width(offSecond), 'Gesamte Schicht: zweite Schicht muss unverändert bleiben')

const negativeFirst = outerWallBounds(negative.gcode, 1)
near(width(negativeFirst), width(offFirst) + 0.4, 'Negativer Offset muss die erste Schicht weiten')
near(height(negativeFirst), height(offFirst) + 0.4, 'Negativer Offset muss die erste Schicht weiten')

assert.ok(
  tooLarge.warnings.some((warning) => warning.includes('Elefantenfuß-Kompensation')),
  'Ein Einzug ab einer halben ersten Linienbreite muss warnen',
)
assert.ok(
  !outer.warnings.some((warning) => warning.includes('Elefantenfuß-Kompensation')),
  'Der normale Einzug von 0.2 mm darf nicht warnen',
)

console.log(
  `OK: 40-mm-Würfel, erste Schicht ${width(offFirst).toFixed(2)} mm; ` +
    `Einzug ${width(outerFirst).toFixed(2)} mm, Weitung ${width(negativeFirst).toFixed(2)} mm; ` +
    `zweite Schicht unverändert ${width(offSecond).toFixed(2)} mm; Warnung bei 0.3 mm.`,
)
