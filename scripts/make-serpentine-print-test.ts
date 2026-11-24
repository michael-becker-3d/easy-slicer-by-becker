import fs from 'node:fs'
import path from 'node:path'
import { buildBinarySTL, parseSTL } from '../server/slicer/stl.ts'
import { sliceMesh } from '../server/slicer/index.ts'
import { printerById } from '../shared/catalog.ts'
import { applyPrinterLimits } from '../shared/limits.ts'
import { DEFAULT_SETTINGS, mergeSettings, type CustomGcode, type PrintSettings } from '../shared/types.ts'

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

const home = process.env.USERPROFILE || 'C:/Users/Michael Becker'
const storePath = path.join(home, 'AppData/Local/EasySlicerBecker/data/profiles.json')
const store = JSON.parse(fs.readFileSync(storePath, 'utf8')) as {
  entries: Record<string, { value: string }>
}
const setup = JSON.parse(store.entries['kepler.setup.v1'].value) as { printerId: string; qualityPresetId: string }
const quality = (JSON.parse(store.entries['kepler.quality-profiles.v1'].value) as Array<{
  id: string
  name: string
  settings: PrintSettings
}>).find((entry) => entry.id === setup.qualityPresetId)
if (!quality) throw new Error(`Qualitätsprofil nicht gefunden: ${setup.qualityPresetId}`)
const printers = JSON.parse(store.entries['kepler.printers.v1'].value) as Record<
  string,
  { setup: { customGcode: CustomGcode } }
>
const customGcode = printers[setup.printerId]?.setup?.customGcode
if (!customGcode) throw new Error('Kein Custom-G-code für den aktiven Drucker')

const printer = printerById(setup.printerId)
const settings = applyPrinterLimits(printer, mergeSettings(DEFAULT_SETTINGS, quality.settings))
const mesh = parseSTL(buildBinarySTL(cylinder(20, 2)))
const result = sliceMesh(mesh, settings, printer, null, [], { customGcode })
const out = 'artifacts/serpentine-top-skin-live.gcode'
fs.writeFileSync(out, result.gcode)

const lines = result.gcode.split(/\r?\n/)
let x = 0
let y = 0
let f = 0
let firstLong = 0
const topF = settings.speeds.topSurface * 60
for (const line of lines) {
  if (!line.startsWith('G1 ')) continue
  const ax = / X(-?\d+(?:\.\d+)?)/.exec(line)
  const ay = / Y(-?\d+(?:\.\d+)?)/.exec(line)
  const af = / F(\d+)/.exec(line)
  const ae = / E-?\d*\.?\d+/.exec(line)
  if (af) f = Number(af[1])
  const nx = ax ? Number(ax[1]) : x
  const ny = ay ? Number(ay[1]) : y
  const len = Math.hypot(nx - x, ny - y)
  if (ae && f === topF && len > firstLong) firstLong = len
  x = nx
  y = ny
}

console.log(
  JSON.stringify(
    {
      profile: quality.name,
      printer: printer.name,
      start: lines.find((line) => line.startsWith('START_PRINT')) ?? null,
      bytes: result.gcode.length,
      layers: result.layers.length,
      topSpeed: settings.speeds.topSurface,
      firstTopSkinPathMm: Math.round(firstLong * 10) / 10,
      warnings: result.warnings,
      out,
    },
    null,
    2,
  ),
)
