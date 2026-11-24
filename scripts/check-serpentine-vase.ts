import fs from 'node:fs'
import assert from 'node:assert/strict'
import { buildBinarySTL, parseSTL } from '../server/slicer/stl.ts'
import { sliceMesh } from '../server/slicer/index.ts'
import { printerById } from '../shared/catalog.ts'
import { applyPrinterLimits } from '../shared/limits.ts'
import { DEFAULT_SETTINGS, mergeSettings } from '../shared/types.ts'

type Tri = number[]

function cylinder(r: number, h: number, seg = 72): Tri[] {
  const tris: Tri[] = []
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2
    const a1 = ((i + 1) / seg) * Math.PI * 2
    const x0 = Math.cos(a0) * r
    const y0 = Math.sin(a0) * r
    const x1 = Math.cos(a1) * r
    const y1 = Math.sin(a1) * r
    tris.push([0, 0, 0, x0, y0, 0, x1, y1, 0])
    tris.push([0, 0, h, x1, y1, h, x0, y0, h])
    tris.push([x0, y0, 0, x1, y1, 0, x1, y1, h])
    tris.push([x0, y0, 0, x1, y1, h, x0, y0, h])
  }
  return tris
}

function mesh(r: number, h: number) {
  return parseSTL(buildBinarySTL(cylinder(r, h)))
}

function baseSettings() {
  return mergeSettings(DEFAULT_SETTINGS, {
    layerHeight: 0.2,
    firstLayerHeight: 0.24,
    lineWidth: 0.4,
    walls: 3,
    topLayers: 3,
    bottomLayers: 2,
    infillDensity: 20,
    infillPattern: 'grid',
    adhesion: 'none',
    primeLine: { ...DEFAULT_SETTINGS.primeLine, enabled: false },
    ironing: { ...DEFAULT_SETTINGS.ironing, enabled: false },
    printOrder: { ...DEFAULT_SETTINGS.printOrder, paths: 'shortest' },
  })
}

function extrusionMoves(gcode: string, speed: number, startLine = 0) {
  const lines = gcode.split(/\r?\n/)
  let x = 0
  let y = 0
  let f = 0
  const out: { x1: number; y1: number; x2: number; y2: number; len: number }[] = []
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]
    if (!line.startsWith('G1 ')) continue
    const ax = / X(-?\d+(?:\.\d+)?)/.exec(line)
    const ay = / Y(-?\d+(?:\.\d+)?)/.exec(line)
    const af = / F(\d+)/.exec(line)
    const ae = / E(-?\d*\.?\d+)/.exec(line)
    if (af) f = Number(af[1])
    const nx = ax ? Number(ax[1]) : x
    const ny = ay ? Number(ay[1]) : y
    if (ae && f === speed && lineIndex >= startLine && Math.hypot(nx - x, ny - y) > 0.01) {
      out.push({ x1: x, y1: y, x2: nx, y2: ny, len: Math.hypot(nx - x, ny - y) })
    }
    x = nx
    y = ny
  }
  return out
}

// 1) Deckschicht: erste sichtbare Bahn muss lang sein, nicht ein Randstück.
const ad5x = printerById('flashforge-ad5x')
const skinSettings = applyPrinterLimits(ad5x, baseSettings())
const skinResult = sliceMesh(mesh(20, 2), skinSettings, ad5x, null, [], {})
fs.writeFileSync('artifacts/serpentine-top-skin-test.gcode', skinResult.gcode)
const skinLines = skinResult.gcode.split(/\r?\n/)
const lastSkinLine = skinLines.findLastIndex((line) => line === `;LAYER:${skinResult.layers.length}`)
const topMoves = extrusionMoves(skinResult.gcode, skinSettings.speeds.topSurface * 60, lastSkinLine)
assert.ok(topMoves.length > 10, 'Keine Deckschichtbahnen gefunden')
// Die Wand besteht aus vielen kurzen Segmenten; die erste lange Bahn ist die
// erste Deckschichtzeile. Bei der alten Reihenfolge war sie nur ~7 mm lang.
const longMoves = topMoves.filter((move) => move.len > 25)
assert.ok(longMoves.length > 0, 'Keine lange Deckschichtbahn gefunden')
const first = longMoves[0]
assert.ok(
  first.len > 25,
  `Erste Deckschichtbahn ist nur ${first.len.toFixed(1)} mm lang — Serpentine startet noch am Rand`,
)
console.log(
  `Deckschicht: ${topMoves.length} Bahnen, erste ${first.len.toFixed(1)} mm ` +
    `(${first.x1.toFixed(1)},${first.y1.toFixed(1)} -> ${first.x2.toFixed(1)},${first.y2.toFixed(1)})`,
)

// 2) Vase: kein Layer-Retract, kein Halt und kein Z-Sprung an der Naht.
const vyper = printerById('anycubic-vyper')
let vaseSettings = baseSettings()
vaseSettings = applyPrinterLimits(
  vyper,
  mergeSettings(vaseSettings, {
    walls: 1,
    topLayers: 0,
    bottomLayers: 0,
    infillDensity: 0,
    special: { vase: true },
    seam: { ...vaseSettings.seam, wipe: true },
    retraction: { ...vaseSettings.retraction, onLayerChange: true },
    cooling: { ...vaseSettings.cooling, minLayerTime: 2 },
  }),
)
const vaseResult = sliceMesh(mesh(15, 10), vaseSettings, vyper, null, [], {})
fs.writeFileSync('artifacts/vase-continuous-test.gcode', vaseResult.gcode)
const lines = vaseResult.gcode.split(/\r?\n/)
// Die erste Schicht ist noch eine normale flache Runde; die Spirale beginnt
// mit Schicht 2. Ab dort darf es keinen Rückzug und keinen Halt mehr geben.
const firstSpiral = lines.findIndex((line) => line === ';LAYER:2')
const lastLayer = lines.findIndex((line) => line === `;LAYER:${vaseResult.layers.length}`)
const body = lines.slice(firstSpiral, lastLayer + 1)
const retracts = body.filter((line) => /^G1 E-/.test(line))
const dwells = body.filter((line) => /^G4 P/.test(line))
const zMoves = body.filter((line) => /^G1 Z/.test(line))
assert.equal(retracts.length, 0, `Vase hat ${retracts.length} Layer-Retracts`)
assert.equal(dwells.length, 0, `Vase hat ${dwells.length} Haltepunkte`)
assert.equal(zMoves.length, 0, `Vase hat ${zMoves.length} separate Z-Moves`)
const spiralMoves = body.filter((line) => /^G1 X.* Y.* Z/.test(line))
assert.ok(spiralMoves.length > 100, 'Keine spiralförmigen Z-Bahnen gefunden')
console.log(
  `Vase: ${vaseResult.layers.length} Schichten, ${retracts.length} Retracts, ` +
    `${dwells.length} Halte, ${zMoves.length} separate Z-Moves, ${spiralMoves.length} Spiralbahnen`,
)
console.log('OK: Serpentine beginnt mit einer langen Bahn; Vase läuft ohne Z-Naht durch.')
