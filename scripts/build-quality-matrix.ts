/**
 * Erzeugt die feste Qualitätsmatrix für A-46/A-51.
 *
 * Die Dateien sind bewusst reproduzierbar: Alle Varianten gehen von derselben
 * Baseline aus, und jede Variante ändert genau eine Einstellung. Die
 * Schrumpfkompensation und der Elefantenfuß sind in der Baseline aus, damit
 * zuerst die rohen Maße gemessen und daraus die Korrekturen berechnet werden.
 *
 * Fluss und Z-Hop: Baseline und Varianten 03–07 laufen seit 18.11. mit dem am
 * 17.11. kalibrierten Fluss 1,05 und dem Z-Hop 0,60 mm. Damit ändert jede
 * Variante gegenüber der Baseline nur noch ihre eine Einstellung; vorher
 * standen die Varianten auf 1,00/0,20 und ein Vergleich hätte zwei Variablen
 * gleichzeitig bewegt. Die Kalibriertests 00/01 bleiben bei 1,00/0,20
 * (CALIBRATION_FLOW/CALIBRATION_Z_HOP), weil der Flowwürfel die Referenz der
 * Flusskalibrierung ist und mit 1,05 sich selbst bestätigen würde.
 *
 * Z-Hop: Die Baseline fährt seit 18.11. mit 0,6 mm statt 0,2 mm. Die
 * ZMod-Düsenkontrolle des AD5X (Lastzelle, `ZCONTROL_ON 1500 AUTO`, unter
 * Z 10 mm Abbruch statt Pause) hat den Lauf mit 0,2 mm zweimal als
 * Düsenaufprall abgeschaltet (Jobs `0000C8`/`0000C9`, „Weight 1560>1500.0.
 * Z=10."). Der höhere Z-Hop ist die eine geänderte Variable; Fluss,
 * Temperaturen und Geometrie bleiben unverändert.
 *
 * Aufruf: npm run quality-matrix
 * Ergebnis: Testdruck/Qualitaetsmatrix_2026-11-16/
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { boxMinMax, type Tri } from '../server/meshlib.ts'
import { buildBinarySTL, parseSTL } from '../server/slicer/stl.ts'
import { sliceMesh } from '../server/slicer/index.ts'
import { buildCalibration } from '../server/calibration.ts'
import { applyPrinterLimits } from '../shared/limits.ts'
import { printerById } from '../shared/catalog.ts'
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  type CustomGcode,
  type DeepPartial,
  type FilamentProfile,
  type PrintSettings,
} from '../shared/types.ts'

const PRINTER_ID = 'flashforge-ad5x'
const FILAMENT_ID = 'my-mw7ndoxu'
const OUT = join('Testdruck', 'Qualitaetsmatrix_2026-11-16')

/** Kalibrierter Fluss der Baseline (Flowwürfel `0000C6`/`0000C7`, 17.11.). */
const BASELINE_FLOW = 1.05
/** Kalibrierter Z-Hop der Baseline (ZMod-Abschaltungen `0000C8`/`0000C9`, 18.11.). */
const BASELINE_Z_HOP = 0.6
/** Fluss der Kalibriertests 00/01, mit dem sie geslict und gedruckt wurden. */
const CALIBRATION_FLOW = 1
/** Z-Hop der Kalibriertests 00/01, mit dem sie geslict und gedruckt wurden. */
const CALIBRATION_Z_HOP = 0.2

const printer = printerById(PRINTER_ID)
const filament: FilamentProfile = {
  id: FILAMENT_ID,
  name: 'test pla',
  material: 'PLA',
  density: 1.24,
  nozzle: 200,
  bed: 65,
  maxVolumetricFlow: 25,
  flow: 1,
  fanSpeed: 100,
  settings: DEFAULT_SETTINGS,
} as FilamentProfile

function readCustomGcode(): CustomGcode | undefined {
  try {
    const raw = JSON.parse(readFileSync(join('data', 'profiles.json'), 'utf8')) as {
      entries?: Record<string, { value?: string }>
    }
    const setup = raw.entries?.['kepler.setup.v1']?.value
    if (!setup) return undefined
    const parsed = JSON.parse(setup) as { customGcode?: CustomGcode }
    return parsed.customGcode
  } catch {
    return undefined
  }
}

const customGcode = readCustomGcode()

/**
 * Alltagswerte des aktiven Profils, aber ohne Schrumpf- und Fußkorrektur.
 * Nur so lässt sich aus dem gedruckten Teil die tatsächliche Abweichung
 * ableiten; die Kompensation kommt erst danach.
 */
const BASELINE: PrintSettings = applyPrinterLimits(
  printer,
  mergeSettings(DEFAULT_SETTINGS, {
    layerHeight: 0.2,
    firstLayerHeight: 0.2,
    lineWidth: 0.42,
    firstLayerLineWidth: 0.45,
    outerWallLineWidth: 0.42,
    innerWallLineWidth: 0.44,
    topSurfaceLineWidth: 0.44,
    walls: 3,
    topLayers: 4,
    bottomLayers: 4,
    infillDensity: 20,
    infillPattern: 'gyroid',
    infillAngle: 45,
    infillOverlap: 20,
    flow: BASELINE_FLOW,
    maxVolumetricFlow: 25,
    temps: { nozzle: 200, bed: 65, firstLayerNozzle: 200, firstLayerBed: 65 },
    speeds: {
      topSurface: 100,
      bridge: 25,
      supportInterface: 50,
      print: 200,
      outerWall: 120,
      innerWall: 150,
      infill: 150,
      solid: 110,
      support: 80,
      overhang: 25,
      travel: 400,
      firstLayer: 50,
    },
    retraction: { distance: 0.8, speed: 30, minTravel: 2, onLayerChange: true },
    zHop: BASELINE_Z_HOP,
    cooling: { fanOffLayers: 1, minLayerTime: 0 },
    adhesion: 'brim',
    brim: { type: 'outer_only', width: 5, gap: 0.1, flow: 1 },
    seam: { position: 'rear', gap: 0, wipe: true },
    shrinkage: { x: 0, y: 0, z: 0 },
    elephantFoot: { enabled: false, amount: 0.2, scope: 'outer-wall' },
    ironing: { enabled: false },
    surfaceGuard: { enabled: false },
  } as DeepPartial<PrintSettings>),
)

type Variant = {
  id: string
  title: string
  note: string
  settings: PrintSettings
  tris: Tri[]
  stlName: string
  overrides?: Parameters<typeof sliceMesh>[4]
}

function boxAt(width: number, depth: number, height: number, cx: number, cy: number): Tri[] {
  return boxMinMax(cx - width / 2, cy - depth / 2, 0, cx + width / 2, cy + depth / 2, height)
}

/** 20er und 40er Würfel plus 40 × 40 × 4 mm Deckschicht-Coupon. */
function baselineTris(): Tri[] {
  return [
    ...boxAt(20, 20, 20, -62.5, -5),
    ...boxAt(40, 40, 40, -2.5, 5),
    ...boxAt(40, 40, 4, 52.5, -5),
  ]
}

/** 20er Würfel plus Coupon für die Ein-Variablen-Vergleiche. */
function cubeAndCouponTris(): Tri[] {
  return [...boxAt(20, 20, 20, -32.5, 0), ...boxAt(40, 40, 4, 22.5, 0)]
}

/** Nur der flache Coupon für die Oberflächenvarianten. */
function couponTris(): Tri[] {
  return boxAt(40, 40, 4, 0, 0)
}

function withPatch(patch: DeepPartial<PrintSettings>): PrintSettings {
  return applyPrinterLimits(printer, mergeSettings(BASELINE, patch))
}

/**
 * Variante ändert genau eine Einstellung; Fluss und Z-Hop bleiben auf den
 * kalibrierten Werten der Baseline. Die Vorgaben stehen bewusst *vor* dem
 * Patch: standen sie dahinter, hat jeder bewusste Override (z. B. `06` mit
 * zHop 0,6) still verloren und die Datei bekam doch 0,20 mm.
 */
function variantSettings(patch: DeepPartial<PrintSettings>): PrintSettings {
  return withPatch({ flow: BASELINE_FLOW, zHop: BASELINE_Z_HOP, ...patch })
}

/**
 * Die Kalibriertests bleiben bei Fluss 1,00: Der Flowwürfel ist der
 * Referenzkörper der Flusskalibrierung. Mit 1,05 geslict würde seine Wand den
 * schon korrigierten Fluss messen und die Kalibrierung sich selbst bestätigen.
 * Aus demselben Grund bleibt der Z-Hop hier bei 0,20 mm: Die vorhandenen
 * Dateien `00`/`01` sind mit diesem Wert geslict und gedruckt.
 */
const CALIBRATION: PrintSettings = withPatch({ flow: CALIBRATION_FLOW, zHop: CALIBRATION_Z_HOP })

const variants: Variant[] = [
  {
    id: '02_Baseline_20-40-Coupon',
    title: 'Baseline: 20er + 40er Würfel + Deckschicht-Coupon',
    note: 'Fluss 1,05 (kalibriert); 200 °C; 4 Deckschichten; 20 % Gyroid; Z-Hop 0,6; Schrumpfung 0; Fuß aus.',
    settings: BASELINE,
    tris: baselineTris(),
    stlName: '02_Baseline_20-40-Coupon.stl',
  },
  {
    id: '03_Temperatur-210',
    title: 'Temperatur 210 °C',
    note: 'Nur die Düsentemperatur steigt von 200 auf 210 °C.',
    settings: variantSettings({
      temps: { nozzle: 210, bed: 65, firstLayerNozzle: 210, firstLayerBed: 65 },
    }),
    tris: cubeAndCouponTris(),
    stlName: '03_Temperatur-210.stl',
  },
  {
    id: '04_Deckschichten-6',
    title: 'Deckschichten 6',
    note: 'Nur topLayers steigt von 4 auf 6.',
    settings: variantSettings({ topLayers: 6 }),
    tris: couponTris(),
    stlName: '04_Deckschichten-6.stl',
  },
  {
    id: '05_Fuellung-35',
    title: 'Füllung 35 %',
    note: 'Nur die Füllungsdichte steigt von 20 auf 35 % (Gyroid).',
    settings: variantSettings({ infillDensity: 35 }),
    tris: couponTris(),
    stlName: '05_Fuellung-35.stl',
  },
  {
    id: '06_ZHop-0.6',
    title: 'Z-Hop 0,6 mm',
    note: 'Z-Hop 0,6 mm und Fluss 1,05 wie die Baseline; dieser Coupon ist damit eine reine Wiederholungs-/Körperkontrolle (nur Coupon, sonst Baseline-Werte).',
    settings: variantSettings({ zHop: 0.6 }),
    tris: couponTris(),
    stlName: '06_ZHop-0.6.stl',
  },
  {
    id: '07_Oberflaechenschutz-an',
    title: 'Oberflächenschutz an',
    note: 'Nur surfaceGuard wird eingeschaltet (2 zusätzliche Deckschichten, 2 volle Stützschichten, 0,6 mm Hub).',
    settings: variantSettings({ surfaceGuard: { enabled: true } }),
    tris: couponTris(),
    stlName: '07_Oberflaechenschutz-an.stl',
  },
]

function writeVariant(variant: Variant): void {
  const stl = buildBinarySTL(variant.tris)
  writeFileSync(join(OUT, variant.stlName), stl)
  const result = sliceMesh(parseSTL(stl), variant.settings, printer, null, variant.overrides ?? [], {
    start: true,
    end: true,
    customGcode,
    metadata: true,
    filament: { type: 'PLA', name: 'test pla', density: 1.24, color: '#1ed3eb' },
  })
  writeFileSync(join(OUT, `${variant.id}.gcode`), result.gcode)
  writeFileSync(
    join(OUT, `${variant.id}.json`),
    JSON.stringify(
      {
        id: variant.id,
        title: variant.title,
        note: variant.note,
        stl: variant.stlName,
        gcode: `${variant.id}.gcode`,
        layers: result.layers.length,
        stats: result.stats,
        warnings: result.warnings,
        settings: {
          flow: variant.settings.flow,
          nozzle: variant.settings.temps.nozzle,
          firstLayerNozzle: variant.settings.temps.firstLayerNozzle,
          topLayers: variant.settings.topLayers,
          infillDensity: variant.settings.infillDensity,
          zHop: variant.settings.zHop,
          shrinkage: variant.settings.shrinkage,
          elephantFoot: variant.settings.elephantFoot,
          surfaceGuard: variant.settings.surfaceGuard,
        },
      },
      null,
      2,
    ) + '\n',
  )
}

function writeCalibrationTest(toolId: 'first-layer' | 'flow-cube', id: string, stlName: string): void {
  const bundle = buildCalibration(toolId, printer, filament, CALIBRATION)
  if (!bundle) throw new Error(`Kalibriertest ${toolId} konnte nicht erzeugt werden.`)
  writeFileSync(join(OUT, stlName), bundle.stl)
  const settings = applyPrinterLimits(
    printer,
    mergeSettings(CALIBRATION, bundle.tool.settingsPatch as DeepPartial<PrintSettings>),
  )
  const result = sliceMesh(parseSTL(bundle.stl), settings, printer, null, bundle.overrides, {
    start: true,
    end: true,
    customGcode,
    metadata: true,
    filament: { type: 'PLA', name: 'test pla', density: 1.24, color: '#1ed3eb' },
  })
  writeFileSync(join(OUT, `${id}.gcode`), result.gcode)
  writeFileSync(
    join(OUT, `${id}.json`),
    JSON.stringify(
      {
        id,
        tool: bundle.tool,
        settings: {
          layerHeight: settings.layerHeight,
          firstLayerHeight: settings.firstLayerHeight,
          flow: settings.flow,
          topLayers: settings.topLayers,
          infillDensity: settings.infillDensity,
          zHop: settings.zHop,
        },
        layers: result.layers.length,
        stats: result.stats,
        warnings: result.warnings,
      },
      null,
      2,
    ) + '\n',
  )
}

mkdirSync(OUT, { recursive: true })
writeCalibrationTest('first-layer', '00_First-Layer', '00_First-Layer.stl')
writeCalibrationTest('flow-cube', '01_Flow-Wuerfel', '01_Flow-Wuerfel.stl')
for (const variant of variants) writeVariant(variant)

writeFileSync(
  join(OUT, 'matrix.json'),
  JSON.stringify(
    {
      printer: printer.name,
      printerId: PRINTER_ID,
      filament: filament.name,
      baseline: {
        layerHeight: BASELINE.layerHeight,
        firstLayerHeight: BASELINE.firstLayerHeight,
        lineWidth: BASELINE.lineWidth,
        walls: BASELINE.walls,
        topLayers: BASELINE.topLayers,
        bottomLayers: BASELINE.bottomLayers,
        infillDensity: BASELINE.infillDensity,
        infillPattern: BASELINE.infillPattern,
        flow: BASELINE.flow,
        nozzle: BASELINE.temps.nozzle,
        bed: BASELINE.temps.bed,
        zHop: BASELINE.zHop,
        shrinkage: BASELINE.shrinkage,
        elephantFoot: BASELINE.elephantFoot,
        surfaceGuard: BASELINE.surfaceGuard,
      },
      variantsFlow: BASELINE_FLOW,
      variantsFlowNote:
        'Die Varianten 03–07 werden seit 18.11. mit dem kalibrierten Basisfluss 1,05 geslict; je Vergleich ändert sich nur die Variablen-Einstellung. Die Kalibriertests 00/01 bleiben bei 1,00.',
      variantsZHop: BASELINE_Z_HOP,
      variantsZHopNote:
        'Die Varianten 03–07 werden seit 18.11. mit dem Basis-Z-Hop 0,60 mm geslict; je Vergleich ändert sich nur die Variablen-Einstellung. Die Kalibriertests 00/01 bleiben bei 0,20 mm.',
      variants: variants.map((variant) => ({
        id: variant.id,
        title: variant.title,
        note: variant.note,
        stl: variant.stlName,
        gcode: `${variant.id}.gcode`,
        flow: variant.settings.flow,
        zHop: variant.settings.zHop,
      })),
    },
    null,
    2,
  ) + '\n',
)

console.log(`OK: Qualitätsmatrix in ${OUT}`)
console.log('  00_First-Layer, 01_Flow-Wuerfel, 02_Baseline, 03–07 Varianten')
