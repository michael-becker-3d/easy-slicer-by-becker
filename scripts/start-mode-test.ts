import fs from 'node:fs'
import assert from 'node:assert/strict'
import { parseSTL } from '../server/slicer/stl.ts'
import { sliceMesh } from '../server/slicer/index.ts'
import { printerById } from '../shared/catalog.ts'
import { DEFAULT_SETTINGS, mergeSettings } from '../shared/types.ts'

const profile = printerById('flashforge-ad5x')
const mesh = parseSTL(fs.readFileSync('artifacts/universal-printer-test-v1.stl'))
const settings = mergeSettings(DEFAULT_SETTINGS, {
  meshCompensation: 'off',
  primeLine: { enabled: true, length: 60, speed: 20 },
})

// Ein Makro wie START_PRINT darf den Drucker in M83/G91 zurücklassen. Der
// nachfolgende Slicer-Code ist absolut und muss deshalb wieder M82/G90 setzen.
const start = [
  'START_PRINT EXTRUDER_TEMP=215 BED_TEMP=65 MESH=65',
  'M190 S65',
  'M104 S215 T0 T0',
  'M83 ; relative extrusion aus dem Makro',
  'G91 ; relative positioning aus dem Makro',
].join('\n')

const result = sliceMesh(mesh, settings, profile, null, [], {
  customGcode: {
    start,
    end: 'END_PRINT',
    layerChange: '',
    pause: '',
    fullMachineGcode: true,
  },
})

const lines = result.gcode.split('\n')
const startAt = lines.findIndex((line) => line.startsWith('START_PRINT'))
const g90At = lines.findIndex((line) => line.startsWith('G90 ; absolute Positionierung'))
const m82At = lines.findIndex((line) => line.startsWith('M82 ; absolute Extrusion'))
const resetAt = lines.findIndex((line) => line.startsWith('G92 E0 ; E-Nullpunkt'))
const firstMoveAt = lines.findIndex((line) => /^G[01] .*E-?\d/.test(line))

assert.ok(startAt >= 0, 'START_PRINT fehlt')
assert.ok(g90At > startAt, 'G90 muss nach dem Startmakro stehen')
assert.ok(m82At > g90At, 'M82 muss nach dem Startmakro stehen')
assert.ok(resetAt > m82At, 'G92 E0 muss vor dem Slicer-Code stehen')
assert.ok(firstMoveAt > resetAt, 'Die erste E-Bewegung muss nach der Modus-Korrektur kommen')

console.log('OK: Startmakro wird vor dem Slicer-Code auf G90/M82/G92 E0 zurückgesetzt.')
console.log(lines.slice(startAt, resetAt + 1).join('\n'))
