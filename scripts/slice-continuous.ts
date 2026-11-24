// Schneidet ein Modell mit einem gespeicherten Profil.
// --mode own  : Profil unverändert (Continuous v3)
// --mode orca : zusätzlich auf die Orca-Werte gesetzt (gleiche Profilwerte)
// Liest nur; die Profildatei des Nutzers wird nicht verändert.
import fs from 'node:fs'
import path from 'node:path'
import { parseSTL } from '../server/slicer/stl.ts'
import { sliceMesh } from '../server/slicer/index.ts'
import { printerById } from '../shared/catalog.ts'
import { applyPrinterLimits } from '../shared/limits.ts'
import { DEFAULT_SETTINGS, mergeSettings, type CustomGcode, type PrintSettings } from '../shared/types.ts'

const args = process.argv.slice(2)
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const profilePath = arg('profile', 'artifacts/empfehlung-test-profile.json')
const stlPath = arg('stl', 'artifacts/pla-wie-orca-wuerfel.stl')
const outPath = arg('out', 'artifacts/empfehlung-test-wuerfel-continuous-v3.gcode')
const mode = arg('mode', 'own')
const wallOrder = arg('walls', 'inner-first')

const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8')) as { settings: PrintSettings }
const home = process.env.USERPROFILE || 'C:/Users/Michael Becker'
const storePath = path.join(home, 'AppData/Local/EasySlicerBecker/data/profiles.json')
const store = JSON.parse(fs.readFileSync(storePath, 'utf8')) as {
  entries: Record<string, { value: string; savedAt: number }>
}
const printers = JSON.parse(store.entries['kepler.printers.v1'].value) as Record<
  string,
  { setup: { customGcode: CustomGcode } }
>
const customGcode = printers['flashforge-ad5x'].setup.customGcode

let settings = mergeSettings(DEFAULT_SETTINGS, profile.settings)
if (mode === 'orca') {
  settings = mergeSettings(settings, {
    walls: 3,
    topLayers: 4,
    bottomLayers: 3,
    infillDensity: 25,
    infillPattern: 'gyroid',
    speeds: { ...settings.speeds, outerWall: 120, innerWall: 200, infill: 200, solid: 200, topSurface: 50, travel: 500 },
    retraction: { distance: 1, speed: 40, minTravel: 2, onLayerChange: true },
    zHop: 0.2,
    seam: { ...settings.seam, gap: 0.1 },
    brim: { ...settings.brim, width: 5 },
    ironing: { ...settings.ironing, enabled: false },
  } as Partial<PrintSettings>)
}

settings = mergeSettings(settings, { printOrder: { ...settings.printOrder, walls: wallOrder as 'inner-first' | 'outer-first' } })

const printer = printerById('flashforge-ad5x')
settings = applyPrinterLimits(printer, settings)
const mesh = parseSTL(fs.readFileSync(stlPath))
const result = sliceMesh(mesh, settings, printer, null, [], { customGcode })
fs.writeFileSync(outPath, result.gcode)

console.log(
  JSON.stringify(
    {
      mode,
      wallOrder,
      stl: stlPath,
      out: outPath,
      bytes: result.gcode.length,
      layers: result.layers.length,
      stats: result.stats,
      warnings: result.warnings,
      settings: {
        walls: settings.walls,
        topLayers: settings.topLayers,
        bottomLayers: settings.bottomLayers,
        infillDensity: settings.infillDensity,
        infillPattern: settings.infillPattern,
        speeds: settings.speeds,
        retraction: settings.retraction,
        zHop: settings.zHop,
        seam: settings.seam,
        brimWidth: settings.brim.width,
        ironing: settings.ironing.enabled,
      },
    },
    null,
    2,
  ),
)
