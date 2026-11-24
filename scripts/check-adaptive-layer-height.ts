import assert from 'node:assert/strict'
import { box } from '../server/meshlib.ts'
import { makeMesh } from '../server/slicer/stl.ts'
import { sliceMesh } from '../server/slicer/index.ts'
import { printerById } from '../shared/catalog.ts'
import { DEFAULT_SETTINGS, mergeSettings, type AdaptiveLayerHeightSettings, type PrintSettings } from '../shared/types.ts'
import { SETTING_INFO } from '../src/settingsInfo.ts'

const printer = printerById('flashforge-ad5x')
const cube = makeMesh(new Float32Array(box(30, 10, 30).flat()))

/** Quadratische Pyramide: vier geneigte Seitenflächen und ein flacher Boden. */
function pyramid(width: number, height: number): Float32Array {
  const h = width / 2
  const apex = [0, 0, height]
  const a = [-h, -h, 0]
  const b = [h, -h, 0]
  const c = [h, h, 0]
  const d = [-h, h, 0]
  return new Float32Array([
    ...a, ...b, ...apex,
    ...b, ...c, ...apex,
    ...c, ...d, ...apex,
    ...d, ...a, ...apex,
    ...a, ...c, ...b,
    ...a, ...d, ...c,
  ])
}

const pyramidMesh = makeMesh(pyramid(30, 10))

const OFF: AdaptiveLayerHeightSettings = { enabled: false, minHeight: 0.08, maxHeight: 0.28, quality: 0.1 }

function settings(adaptive: Partial<AdaptiveLayerHeightSettings> = {}, extra: Partial<PrintSettings> = {}): PrintSettings {
  return mergeSettings(DEFAULT_SETTINGS, {
    layerHeight: 0.2,
    firstLayerHeight: 0.2,
    walls: 1,
    topLayers: 1,
    bottomLayers: 1,
    infillDensity: 0,
    adhesion: 'none',
    support: { kind: 'none' },
    primeLine: { enabled: false },
    ironing: { enabled: false },
    surfaceGuard: { enabled: false },
    fuzzySkin: { mode: 'off' },
    seam: { position: 'rear', gap: 0, wipe: false, scarf: { enabled: false } },
    adaptiveLayerHeight: { ...OFF, ...adaptive },
    output: { verbosePaths: true },
    ...extra,
  })
}

function slice(adaptive: Partial<AdaptiveLayerHeightSettings> = {}, extra: Partial<PrintSettings> = {}, mesh = cube) {
  return sliceMesh(mesh, settings(adaptive, extra), printer, null, [], {
    start: false,
    end: false,
    metadata: false,
  })
}

function layerTops(gcode: string): number[] {
  return [...gcode.matchAll(/^; Z:([\d.]+)/gm)].map((match) => Number(match[1]))
}

function heightsFromTops(tops: number[]): number[] {
  return tops.map((top, index) => (index === 0 ? top : top - tops[index - 1]))
}

function wallEPerMm(gcode: string, layer: number): number {
  const section = gcode.split(/;LAYER:/)[layer]
  assert.ok(section, `Schicht ${layer} fehlt im G-Code`)
  let active = false
  let lastX: number | null = null
  let lastY: number | null = null
  let lastE: number | null = null
  let eSum = 0
  let distance = 0
  for (const raw of section.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('; TYPE:')) {
      active = line === '; TYPE: outer-wall'
      continue
    }
    const match = /^G1 X(-?[\d.]+) Y(-?[\d.]+)(?: Z(-?[\d.]+))? E(-?[\d.]+)/.exec(line)
    if (!active || !match) continue
    const x = Number(match[1])
    const y = Number(match[2])
    const e = Number(match[4])
    if (lastX !== null && lastY !== null && lastE !== null) {
      const d = Math.hypot(x - lastX, y - lastY)
      if (d > 1e-6) {
        distance += d
        eSum += e - lastE
      }
    }
    lastX = x
    lastY = y
    lastE = e
  }
  assert.ok(distance > 0, 'Testbedingung: keine Außenwand gefunden')
  return eSum / distance
}

// Feste Höhe bleibt unverändert und liefert 50 Schichten für den 10-mm-Würfel.
const fixed = slice()
assert.equal(fixed.stats.layerCount, 50, 'Feste Schichthöhe muss 50 Schichten ergeben')
assert.ok(heightsFromTops(layerTops(fixed.gcode)).every((h) => Math.abs(h - 0.2) < 0.002), 'Feste Schichten müssen 0,2 mm hoch bleiben')

// An senkrechten Wänden darf die adaptive Planung die maximale Höhe nutzen.
const adaptiveBox = slice({ enabled: true })
const boxTops = layerTops(adaptiveBox.gcode)
const boxHeights = heightsFromTops(boxTops)
assert.equal(adaptiveBox.stats.layerCount, boxTops.length, 'Vorschau und G-Code müssen dieselbe Schichtzahl haben')
assert.ok(adaptiveBox.stats.layerCount < fixed.stats.layerCount, 'Adaptive Schichthöhe muss am Würfel Schichten sparen')
assert.ok(Math.abs(boxHeights[0] - 0.2) < 0.002, 'Die erste Schicht muss fest bleiben')
assert.ok(Math.abs(boxHeights[1] - 0.28) < 0.005, `Senkrechte Wand muss die maximale Höhe nutzen: ${boxHeights[1]}`)
assert.ok(boxHeights.slice(1).every((h) => h <= 0.281 && h >= 0.279), 'Würfel darf nur die maximale adaptive Höhe nutzen')
assert.ok(Math.abs(boxTops[boxTops.length - 1] - 10) < 0.002, 'Der Würfel muss auf 10 mm enden')

// Die tatsächliche Schichthöhe fließt in die Extrusion ein: 0,28 statt 0,2 mm
// braucht rund 40 % mehr Material pro Millimeter Bahn.
const fixedFlow = wallEPerMm(fixed.gcode, 2)
const adaptiveFlow = wallEPerMm(adaptiveBox.gcode, 2)
assert.ok(adaptiveFlow > fixedFlow * 1.25, `Adaptive Schicht muss den Fluss erhöhen: ${adaptiveFlow} / ${fixedFlow}`)

// Eine Pyramide ist überall geneigt. Sie muss deutlich feiner werden als der
// Würfel und darf nicht in der maximalen Höhe hängen bleiben.
const adaptivePyramid = slice({ enabled: true }, {}, pyramidMesh)
const pyramidHeights = heightsFromTops(layerTops(adaptivePyramid.gcode))
assert.ok(adaptivePyramid.stats.layerCount > fixed.stats.layerCount, 'Geneigte Flächen müssen mehr Schichten bekommen')
assert.ok(pyramidHeights.slice(1, -1).some((h) => h < 0.2), `Pyramide muss feinere Schichten nutzen: ${pyramidHeights.slice(0, 8)}`)
assert.ok(pyramidHeights.slice(1, -1).every((h) => h >= 0.08 - 0.002), 'Pyramide darf die minimale Höhe nicht unterschreiten')

// Kleinere Zielabweichung = mehr Schichten; größere = weniger.
const fineQuality = slice({ enabled: true, quality: 0.05 }, {}, pyramidMesh)
const roughQuality = slice({ enabled: true, quality: 0.15 }, {}, pyramidMesh)
assert.ok(fineQuality.stats.layerCount > roughQuality.stats.layerCount, 'Kleinere Zielabweichung muss mehr Schichten erzeugen')

// Min/Max werden eingehalten; die letzte Restlage darf kleiner ausfallen.
const bounded = slice({ enabled: true, minHeight: 0.15, maxHeight: 0.25 }, {}, pyramidMesh)
const boundedHeights = heightsFromTops(layerTops(bounded.gcode))
assert.ok(boundedHeights[0] === 0.2, 'Erste Schicht darf nicht von Min/Max verändert werden')
assert.ok(boundedHeights.slice(1, -1).every((h) => h >= 0.149 && h <= 0.251), `Min/Max verletzt: ${boundedHeights.slice(0, 8)}`)
const boundedBox = slice({ enabled: true, maxHeight: 0.25 })
assert.ok(heightsFromTops(layerTops(boundedBox.gcode)).slice(1, -1).every((h) => h <= 0.251), 'Max. Höhe muss auch am Würfel gelten')

assert.ok(!/\bNaN\b|Infinity/.test(adaptiveBox.gcode), 'Adaptiver G-Code enthält ungültige Koordinaten')
assert.ok(adaptiveBox.stats.layerCount > 1, 'Adaptiver Slice darf nicht leer sein')
assert.equal(adaptiveBox.gcode, slice({ enabled: true }).gcode, 'Adaptive Schichthöhe muss deterministisch sein')

const oldProfile = mergeSettings(DEFAULT_SETTINGS, { layerHeight: 0.2 } as any)
assert.equal(oldProfile.adaptiveLayerHeight.enabled, false, 'Alte Profile müssen adaptive Schichthöhe ausgeschaltet bekommen')
assert.ok(oldProfile.adaptiveLayerHeight.minHeight > 0 && oldProfile.adaptiveLayerHeight.maxHeight > 0, 'Alte Profile brauchen gültige Grenzen')

for (const key of ['Adaptive Schichthöhe', 'Min. Schichthöhe|mm', 'Max. Schichthöhe|mm', 'Zielabweichung|mm']) {
  assert.ok(SETTING_INFO[key], `Info-Punkt fehlt: ${key}`)
}

console.log(
  `OK: Adaptive Schichthöhe; Würfel ${fixed.stats.layerCount} → ${adaptiveBox.stats.layerCount} Schichten ` +
    `(0,20–${Math.max(...boxHeights).toFixed(2)} mm), Pyramide ${adaptivePyramid.stats.layerCount} Schichten, ` +
    `Ziel 0,05 mm ${fineQuality.stats.layerCount} vs. 0,15 mm ${roughQuality.stats.layerCount}; ` +
    `Fluss ${fixedFlow.toFixed(3)} → ${adaptiveFlow.toFixed(3)} E/mm.`,
)