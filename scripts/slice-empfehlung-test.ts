import fs from 'node:fs'
import path from 'node:path'
import { parseSTL } from '../server/slicer/stl.ts'
import { sliceMesh } from '../server/slicer/index.ts'
import { printerById } from '../shared/catalog.ts'
import { applyPrinterLimits } from '../shared/limits.ts'
import { DEFAULT_SETTINGS, mergeSettings, type CustomGcode, type PrintSettings } from '../shared/types.ts'

const home = process.env.USERPROFILE || 'C:/Users/Michael Becker'
const storePath = path.join(home, 'AppData/Local/EasySlicerBecker/data/profiles.json')
const raw = fs.readFileSync(storePath, 'utf8')
const store = JSON.parse(raw) as { entries: Record<string, { value: string; savedAt: number }> }
const list = JSON.parse(store.entries['kepler.quality-profiles.v1'].value) as Array<{
  id: string
  name: string
  printerId: string
  settings: PrintSettings
  savedAt: number
}>
const entry = list.find((p) => p.id === 'quality-empfehlung-test')
if (!entry) throw new Error('empfehlung-test fehlt')

// Die Geschwindigkeiten und Beschleunigungen bleiben exakt auf dem Orca-Stand.
// Qualität wird über Bahnbreite, Wandzahl, Decklage, Füllung, Rückzug, Naht und
// Ironing verbessert, nicht über langsameres Drucken.
entry.settings.speeds = {
  ...entry.settings.speeds,
  print: 250,
  outerWall: 150,
  innerWall: 200,
  infill: 200,
  solid: 200,
  topSurface: 50,
  bridge: 25,
  support: 80,
  supportInterface: 50,
  overhang: 25,
  travel: 500,
  firstLayer: 60,
}
entry.settings.accelerations = {
  ...entry.settings.accelerations,
  print: 10000,
  outerWall: 5000,
  innerWall: 5000,
  infill: 5000,
  solid: 7000,
  topSurface: 2000,
  bridge: 5000,
  support: 5000,
  supportInterface: 5000,
  travel: 10000,
  firstLayer: 1500,
}
entry.settings.retraction = { distance: 1, speed: 40, minTravel: 2, onLayerChange: true }
entry.settings.zHop = 0.2
entry.settings.cooling = { fanOffLayers: 1, minLayerTime: 4 }
entry.settings.walls = 4
entry.settings.topLayers = 6
entry.settings.infillDensity = 30
entry.settings.lineWidth = 0.42
entry.settings.outerWallLineWidth = 0.44
entry.settings.innerWallLineWidth = 0.46
entry.settings.topSurfaceLineWidth = 0.45
entry.settings.topSurfaceFlow = 1.03
entry.settings.ironing = { enabled: true, flow: 0.1, speed: 20, spacing: 0.1, angle: 45, type: 'top' }
entry.settings.squareCornerVelocity = { enabled: true, value: 5 }
entry.settings.output = { ...entry.settings.output, reduceInfillRetraction: true }
entry.savedAt = Date.now()

const now = Date.now()
store.entries['kepler.quality-profiles.v1'].value = JSON.stringify(list)
store.entries['kepler.quality-profiles.v1'].savedAt = now
const setup = JSON.parse(store.entries['kepler.setup.v1'].value)
setup.qualityPresetId = entry.id
store.entries['kepler.setup.v1'].value = JSON.stringify(setup)
store.entries['kepler.setup.v1'].savedAt = now
const printers = JSON.parse(store.entries['kepler.printers.v1'].value)
const printerState = printers['flashforge-ad5x']
printerState.setup.qualityPresetId = entry.id
printerState.settings = entry.settings
printerState.savedAt = now
store.entries['kepler.printers.v1'].value = JSON.stringify(printers)
store.entries['kepler.printers.v1'].savedAt = now
fs.writeFileSync('artifacts/profiles-before-empfehlung-speed.json', raw)
fs.writeFileSync(storePath, JSON.stringify(store, null, 2))
fs.writeFileSync('artifacts/empfehlung-test-profile.json', JSON.stringify(entry, null, 2))

const printer = printerById('flashforge-ad5x')
const settings = applyPrinterLimits(
  printer,
  mergeSettings(DEFAULT_SETTINGS, entry.settings),
)
const mesh = parseSTL(fs.readFileSync('artifacts/pla-wie-orca-wuerfel.stl'))
const customGcode = printerState.setup.customGcode as CustomGcode
const result = sliceMesh(mesh, settings, printer, null, [], { customGcode })
fs.writeFileSync('artifacts/empfehlung-test-wuerfel.gcode', result.gcode)

const lines = result.gcode.split(/\r?\n/)
const eOnly = lines.filter((l) => /^G1 E-?\d/.test(l))
const neg = lines.filter((l) => /E\s*-\d/.test(l))
const z = lines.filter((l) => /^G1 Z/.test(l))
const m204 = lines.filter((l) => /^M204/.test(l))
const svl = lines.filter((l) => /SET_VELOCITY_LIMIT/.test(l))
const f3000 = lines.filter((l) => /F3000\b/.test(l))
const f6000 = lines.filter((l) => /F6000\b/.test(l))
const f9000 = lines.filter((l) => /F9000\b/.test(l))
const f12000 = lines.filter((l) => /F12000\b/.test(l))
const types = lines.filter((l) => /^;TYPE:/.test(l))
console.log(
  JSON.stringify(
    {
      active: setup.qualityPresetId,
      stats: result.stats,
      warnings: result.warnings,
      gcode: {
        bytes: result.gcode.length,
        lines: lines.length,
        layers: result.layers.length,
        types: types.length,
        eOnly: eOnly.length,
        retractions: neg.length,
        zMoves: z.length,
        m204: m204.length,
        scv: svl.length,
        f3000: f3000.length,
        f6000: f6000.length,
        f9000: f9000.length,
        f12000: f12000.length,
      },
      speeds: settings.speeds,
      accelerations: settings.accelerations,
      retraction: settings.retraction,
      zHop: settings.zHop,
      topLayers: settings.topLayers,
      infill: settings.infillDensity,
      ironing: settings.ironing,
    },
    null,
    2,
  ),
)
