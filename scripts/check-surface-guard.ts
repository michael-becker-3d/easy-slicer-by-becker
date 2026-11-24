import assert from 'node:assert/strict'
import { demoSTL } from '../server/demo.ts'
import { parseSTL } from '../server/slicer/stl.ts'
import { sliceMesh } from '../server/slicer/index.ts'
import { DEFAULT_SETTINGS, mergeSettings, type PrintSettings } from '../shared/types.ts'
import { printerById } from '../shared/catalog.ts'

const raw = demoSTL('wuerfel')
assert.ok(raw, 'Demo-Würfel muss vorhanden sein')
const mesh = parseSTL(raw)
const profile = printerById('flashforge-ad5x')

function settings(on: boolean): PrintSettings {
  return mergeSettings(DEFAULT_SETTINGS, {
    layerHeight: 0.2,
    firstLayerHeight: 0.2,
    topLayers: 4,
    bottomLayers: 3,
    infillDensity: 20,
    infillPattern: 'grid',
    zHop: 0.2,
    ironing: { enabled: false },
    surfaceGuard: { enabled: on },
  })
}

function gcode(on: boolean): string {
  return sliceMesh(mesh, settings(on), profile, null, [], { start: false, end: false }).gcode
}

const off = gcode(false)
const on = gcode(true)

function topLayerStats(code: string) {
  const layers = code.split(';LAYER:').slice(1)
  const top = layers.slice(-8)
  let hops = 0
  let guardedLayers = 0
  let maxHop = 0
  for (const layer of top) {
    const zMatch = layer.match(/; Z:\s*([\d.]+)/)
    if (!zMatch) continue
    const z = Number(zMatch[1])
    if (layer.includes('; Oberflaechenschutz')) guardedLayers++
    for (const line of layer.split('\n')) {
      const m = line.match(/^G1 Z([\d.]+)/)
      if (!m) continue
      const hop = Number(m[1]) - z
      if (hop > 0.4) {
        hops++
        maxHop = Math.max(maxHop, hop)
      }
    }
  }
  return { hops, guardedLayers, maxHop }
}

const plain = topLayerStats(off)
const guarded = topLayerStats(on)
assert.ok(guarded.guardedLayers >= 6, `Oberflächenschutz nur auf ${guarded.guardedLayers} Deckschichten aktiv`)
assert.ok(guarded.hops > plain.hops, `Keine zusätzlichen Hübe: ${plain.hops} → ${guarded.hops}`)
assert.ok(guarded.maxHop >= 0.5, `Hub zu klein: ${guarded.maxHop.toFixed(2)} mm`)
assert.ok(on.length > off.length, 'Geschützter G-Code muss durch den Unterbau länger sein')

console.log(
  `OK: Schutz auf ${guarded.guardedLayers} Deckschichten, Hübe ${plain.hops} → ${guarded.hops}, ` +
    `max. ${guarded.maxHop.toFixed(2)} mm, +${(((on.length / off.length - 1) * 100) || 0).toFixed(1)} % G-Code`,
)
