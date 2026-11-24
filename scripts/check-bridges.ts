import assert from 'node:assert/strict'
import { box } from '../server/meshlib.ts'
import { sliceMesh } from '../server/slicer/index.ts'
import { makeMesh } from '../server/slicer/stl.ts'
import { planBridges } from '../server/slicer/bridges.ts'
import type { Poly } from '../server/slicer/clipper.ts'
import { printerById } from '../shared/catalog.ts'
import { DEFAULT_SETTINGS, mergeSettings, type PrintSettings } from '../shared/types.ts'

const rect = (x0: number, y0: number, x1: number, y1: number): Poly => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
]

function settings(bridgeFlow = 0.9): PrintSettings {
  return mergeSettings(DEFAULT_SETTINGS, {
    layerHeight: 0.2,
    firstLayerHeight: 0.2,
    walls: 1,
    topLayers: 1,
    bottomLayers: 1,
    infillDensity: 20,
    speeds: { ...DEFAULT_SETTINGS.speeds, overhang: 20 },
    adhesion: 'none',
    primeLine: { enabled: false },
    bridgeFlow,
    output: { objectLabels: false, excludeObjects: false },
  })
}

function bridgeGcode(flow = 0.9) {
  const tris = [
    ...box(8, 10, 10, -7, 0, 0),
    ...box(8, 10, 10, 7, 0, 0),
    ...box(22, 2, 10, 0, 0, 10),
  ]
  const mesh = makeMesh(new Float32Array(tris.flat()))
  const result = sliceMesh(mesh, settings(flow), printerById('anycubic-vyper'), null)
  return result
}

function cantileverGcode() {
  const tris = [
    ...box(8, 10, 10, -7, 0, 0),
    ...box(22, 2, 10, 0, 0, 10),
  ]
  const mesh = makeMesh(new Float32Array(tris.flat()))
  return sliceMesh(mesh, settings(), printerById('anycubic-vyper'), null)
}

function bridgeFlowRate(gcode: string): number {
  const lines = gcode.split(/\r?\n/)
  let previousE = 0
  let previousX = Number.NaN
  let previousY = Number.NaN
  let extruded = 0
  let length = 0
  for (const entry of lines) {
    const travel = entry.match(/^G0 X(-?[\d.]+) Y(-?[\d.]+)/)
    if (travel) {
      previousX = Number(travel[1])
      previousY = Number(travel[2])
      continue
    }
    const m = entry.match(/^G1 X(-?[\d.]+) Y(-?[\d.]+)(?: E(-?[\d.]+))?(?: F(\d+))?$/)
    if (!m) continue
    const x = Number(m[1])
    const y = Number(m[2])
    const e = m[3] === undefined ? previousE : Number(m[3])
    if (entry.endsWith('F1500') && Number.isFinite(previousX)) {
      const segment = Math.hypot(x - previousX, y - previousY)
      if (segment > 0.1 && previousE > 0) {
        extruded += e - previousE
        length += segment
      }
    }
    previousX = x
    previousY = y
    previousE = e
  }
  return length > 0 ? extruded / length : 0
}

function main(): void {
  // Reine Planung: eine Lücke zwischen zwei Auflagern wird waagerecht
  // überspannt, obwohl die Fläche selbst nur ein Rechteck ist.
  const plate = rect(-10, -5, 10, 5)
  const twoSides = [rect(-10, -5, -3, 5), rect(3, -5, 10, 5)]
  const plan = planBridges([plate], twoSides, 0.4)
  assert.equal(plan.length, 1, 'Die zweiseitig gehaltene Lücke muss eine Brücke sein')
  assert.equal(plan[0].angle, 0, 'Die Brücke muss quer zur kürzesten Spanne liegen')
  assert.ok(plan[0].lines.length > 0)
  const line = plan[0].lines[0]
  assert.ok(Math.abs(line.a.y - line.b.y) < 0.01, 'Brückenbahn muss waagerecht sein')
  assert.ok(Math.abs(line.b.x - line.a.x) > 6.5, 'Der Ankerrand muss in beide Auflager hineinreichen')

  // Einseitig gehalten: Überhang, keine Brücke.
  assert.equal(planBridges([plate], [twoSides[0]], 0.4).length, 0, 'Einseitiger Überhang darf keine Brücke werden')

  // Loch in einer Platte: kürzere Lochseite gewinnt, also senkrechte Bahnen.
  const holePlate = rect(-10, -10, 10, 10)
  const holeSupport = [
    rect(-10, -10, 10, -2),
    rect(-10, 2, 10, 10),
  ]
  const vertical = planBridges([holePlate], holeSupport, 0.4)
  assert.equal(vertical.length, 1)
  assert.equal(vertical[0].angle, 90, 'Bei beidseitiger Auflage muss die kürzere Spanne gewinnen')

  // Integration: zwei Türme mit einer 2 mm hohen Brücke. Die erste
  // Brückenlage liegt über dem 6-mm-Spalt und wird als Füllungsbrücke gedruckt.
  const result = bridgeGcode()
  const lines = result.gcode.split(/\r?\n/)
  const bridgeLines = lines.filter((entry) => /^G1 X[^ ]+ Y[^ ]+ E[^ ]+ F1500$/.test(entry))
  assert.ok(bridgeLines.length > 0, 'Keine Brückenbahn mit 25 mm/s gefunden')

  let previousE = 0
  let previousX = Number.NaN
  let previousY = Number.NaN
  const ratios: number[] = []
  for (const entry of lines) {
    const travel = entry.match(/^G0 X(-?[\d.]+) Y(-?[\d.]+)/)
    if (travel) {
      previousX = Number(travel[1])
      previousY = Number(travel[2])
      continue
    }
    const m = entry.match(/^G1 X(-?[\d.]+) Y(-?[\d.]+)(?: E(-?[\d.]+))?(?: F(\d+))?$/)
    if (!m) continue
    const x = Number(m[1])
    const y = Number(m[2])
    const e = m[3] === undefined ? previousE : Number(m[3])
    const length = Number.isFinite(previousX) ? Math.hypot(x - previousX, y - previousY) : 0
    if (entry.endsWith('F1500')) {
      assert.ok(length > 6.5, `Brückenbahn überspannt die Lücke nicht: ${length}`)
      assert.ok(Math.abs(y - previousY) < 0.01, 'Brückenbahn muss waagerecht liegen')
      assert.ok(
        Math.min(x, previousX) < 119.5 && Math.max(x, previousX) > 125.5,
        'Brückenbahn muss in beiden Auflagern verankert sein',
      )
      if (previousE > 0) ratios.push((e - previousE) / length)
    }
    previousX = x
    previousY = y
    previousE = e
  }
  assert.ok(ratios.length > 0 && ratios.every((r) => r > 0), 'Brückenfluss muss positiv sein')

  const lowFlow = bridgeGcode(0.7)
  assert.ok(lowFlow.gcode.includes('F1500'), 'Auch bei kleinerem Brückenfluss muss die Brücke erhalten bleiben')
  const normalRate = ratios.reduce((sum, value) => sum + value, 0) / ratios.length
  const lowRate = bridgeFlowRate(lowFlow.gcode)
  assert.ok(normalRate > 0 && lowRate > 0, 'Brückenfluss muss messbar sein')
  assert.ok(lowRate < normalRate * 0.95, `Brückenfluss 0,7 muss weniger Material fördern als 0,9 (${lowRate} / ${normalRate})`)

  // Einseitig gehaltener Balken: Überhang mit eigener Geschwindigkeit, aber
  // keine Brücke und damit keine Brücken-Füllbahnen.
  const cantilever = cantileverGcode()
  assert.equal(cantilever.gcode.split(/\r?\n/).filter((entry) => /^G1 X[^ ]+ Y[^ ]+ E[^ ]+ F1500$/.test(entry)).length, 0)

  console.log(
    `OK: Brücken; 1 zweiseitige Lücke, Anker 0,6 mm je Seite, einseitiger Überhang bleibt außen vor, ` +
      `${bridgeLines.length} Brückenbahnen mit 25 mm/s, Querlage und Brückenfluss geprüft.`,
  )
}

main()