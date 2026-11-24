import assert from 'node:assert/strict'
import { box } from '../server/meshlib.ts'
import { planSupport, type SupportPlan } from '../server/slicer/support.ts'
import { makeMesh } from '../server/slicer/stl.ts'
import { sliceMesh } from '../server/slicer/index.ts'
import { signedArea, type Poly } from '../server/slicer/clipper.ts'
import { patternSegments } from '../server/slicer/infill.ts'
import { printerById } from '../shared/catalog.ts'
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  type PrintSettings,
  type SupportPattern,
  type SupportSettings,
} from '../shared/types.ts'

const square = (size: number): Poly => [
  { x: -size / 2, y: -size / 2 },
  { x: size / 2, y: -size / 2 },
  { x: size / 2, y: size / 2 },
  { x: -size / 2, y: size / 2 },
]

function width(polys: Poly[]): number {
  let min = Infinity
  let max = -Infinity
  for (const poly of polys) {
    for (const p of poly) {
      min = Math.min(min, p.x)
      max = Math.max(max, p.x)
    }
  }
  return Number.isFinite(min) ? max - min : 0
}

function supportLayers(topSize: number) {
  return [0, 1, 2, 3].map((index) => ({
    loops: index === 3 ? [square(topSize)] : [],
    inner: [],
    z: (index + 1) * 0.2,
    height: 0.2,
  }))
}

const base: SupportSettings = {
  kind: 'normal',
  threshold: 50,
  density: 15,
  pattern: 'grid',
  interfaceLayers: 2,
  interfaceDensity: 80,
  zDistance: 0.2,
  xyDistance: 0.2,
  branchAngle: 30,
  interfacePattern: 'grid',
}

function settings(
  pattern: SupportPattern,
  interfacePattern: SupportPattern,
  interfaceDensity = 80,
  supportDensity = 15,
): PrintSettings {
  return mergeSettings(DEFAULT_SETTINGS, {
    layerHeight: 0.2,
    firstLayerHeight: 0.2,
    walls: 1,
    topLayers: 1,
    bottomLayers: 1,
    infillDensity: 20,
    adhesion: 'none',
    primeLine: { enabled: false },
    output: { objectLabels: false, verbosePaths: true, excludeObjects: false },
    support: {
      kind: 'normal',
      threshold: 50,
      density: supportDensity,
      pattern,
      interfaceLayers: 2,
      interfaceDensity,
      zDistance: 0.2,
      xyDistance: 0.7,
      branchAngle: 30,
      interfacePattern,
    },
  })
}

function supportGcode(
  pattern: SupportPattern,
  interfacePattern: SupportPattern,
  interfaceDensity = 80,
  supportDensity = 15,
): string {
  const tris = [...box(8, 10, 8, 0, 0, 0), ...box(20, 2, 8, 0, 0, 10)]
  const mesh = makeMesh(new Float32Array(tris.flat()))
  return sliceMesh(
    mesh,
    settings(pattern, interfacePattern, interfaceDensity, supportDensity),
    printerById('anycubic-vyper'),
    null,
  ).gcode
}

function narrowTestSettings(): PrintSettings {
  const printSettings = settings('lines', 'lines')
  printSettings.support = {
    ...printSettings.support,
    density: 1,
    interfaceDensity: 20,
    xyDistance: 0.01,
  }
  return printSettings
}

/** Ein schmaler Überhang quer oder längs zur X-Achse. */
function narrowSupportGcode(horizontal: boolean): { gcode: string; plan: SupportPlan } {
  const base = 8
  const topWidth = 10
  const narrow = 0.05
  const top = horizontal
    ? box(topWidth, base, narrow, 0, base / 2 + narrow / 2, 10)
    : box(narrow, base, topWidth, base / 2 + narrow / 2, 0, 10)
  const tris = [...box(base, 10, base, 0, 0, 0), ...top]
  const mesh = makeMesh(new Float32Array(tris.flat()))
  let plan: SupportPlan | null = null
  const result = sliceMesh(
    mesh,
    narrowTestSettings(),
    printerById('anycubic-vyper'),
    null,
    [],
    { onSupportPlan: (actual) => { plan = actual } },
  )
  assert.ok(plan, 'Der Support-Plan muss für den G-code-Test vorliegen')
  return { gcode: result.gcode, plan }
}

/** Nur Linien aus als Support markierten Abschnitten; Außenwände zählen nicht. */
function supportLines(gcode: string, speed: number): string[] {
  const out: string[] = []
  let inSupport = false
  for (const line of gcode.split(/\r?\n/)) {
    if (line.startsWith('; TYPE:')) {
      inSupport = line.includes('support')
      continue
    }
    if (inSupport && line.startsWith('G1 X') && line.endsWith(`F${speed}`)) out.push(line)
  }
  return out
}

function area(polys: Poly[]): number {
  return polys.reduce((sum, poly) => sum + Math.abs(signedArea(poly)), 0)
}

function main(): void {
  const layers = supportLayers(10)
  const narrowXy = planSupport(layers, base)
  const wideXy = planSupport(layers, { ...base, xyDistance: 1.0 })
  const supportFootprint = (plan: ReturnType<typeof planSupport>, index: number) => [
    ...plan.area[index],
    ...plan.interfaceArea[index],
  ]
  assert.ok(area(supportFootprint(narrowXy, 0)) > 0, 'Stützfläche fehlt')
  assert.ok(
    width(supportFootprint(wideXy, 0)) > width(supportFootprint(narrowXy, 0)) + 0.5,
    `XY-Abstand muss die Stützfläche verbreitern: ${width(supportFootprint(narrowXy, 0))} → ${width(supportFootprint(wideXy, 0))}`,
  )

  const noGap = planSupport(layers, { ...base, zDistance: 0 })
  const withGap = planSupport(layers, base)
  const topOf = (plan: ReturnType<typeof planSupport>) => {
    for (let i = layers.length - 1; i >= 0; i--) if (plan.area[i].length || plan.interfaceArea[i].length) return i
    return -1
  }
  assert.ok(topOf(noGap) > topOf(withGap), 'Z-Abstand muss die Stützspitze absenken')

  // Sehr schmale Überhänge dürfen beim Baum-Verrunden nicht verschwinden.
  // 0,2 mm Kantenlänge liegen unter dem Mindestradius der Astspitze.
  const thin = supportLayers(0.2)
  for (const kind of ['normal', 'tree'] as const) {
    const plan = planSupport(thin, { ...base, kind, xyDistance: 0.7 })
    const occupied = plan.area.some((p) => p.length) || plan.interfaceArea.some((p) => p.length)
    assert.ok(occupied, `Schmaler ${kind}-Überhang darf nicht ohne Stütze bleiben`)
  }

  // Muster werden tatsächlich verwendet: Zickzack erzeugt Verbindungsbahnen,
  // und das Kontaktmuster unterscheidet sich von Gitter.
  const grid = supportLines(supportGcode('grid', 'grid'), 2700)
  const lines = supportLines(supportGcode('lines', 'grid'), 2700)
  const zigzag = supportLines(supportGcode('zigzag', 'grid'), 2700)
  assert.ok(grid.length > 0 && lines.length > 0 && zigzag.length > 0)
  assert.notDeepEqual(grid, lines, 'Stützmuster Linien muss sich von Gitter unterscheiden')
  assert.ok(zigzag.length > grid.length, 'Zickzack muss die Verbindungsbahnen des gewählten Musters enthalten')

  const ifaceGrid = supportLines(supportGcode('grid', 'grid'), 2100)
  const ifaceLines = supportLines(supportGcode('grid', 'lines'), 2100)
  const ifaceZigzag = supportLines(supportGcode('grid', 'zigzag'), 2100)
  assert.ok(ifaceGrid.length > 0 && ifaceLines.length > 0 && ifaceZigzag.length > 0)
  assert.notDeepEqual(ifaceLines, ifaceGrid, 'Kontaktmuster Linien muss sich von Gitter unterscheiden')
  assert.notDeepEqual(ifaceZigzag, ifaceGrid, 'Kontaktmuster Zickzack muss sich von Gitter unterscheiden')

  // Ohne Fallback liefert das reguläre Linienmuster auf dieser sehr schmalen
  // Fläche keine Bahn. Der G-code muss trotzdem Stütz- und Kontaktbahnen
  // enthalten — in beiden Ausrichtungen der Schmalfläche.
  const narrowCounts: string[] = []
  for (const horizontal of [true, false]) {
    const printSettings = narrowTestSettings()
    const lineWidth = printSettings.lineWidth > 0 ? printSettings.lineWidth : printSettings.nozzle
    const { gcode, plan } = narrowSupportGcode(horizontal)
    const regularBody = plan.area.flatMap((polys, layerIndex) =>
      patternSegments(
        polys,
        printSettings.support.pattern,
        printSettings.support.density,
        lineWidth,
        layerIndex,
        false,
        printSettings.infillAngle,
      ),
    )
    assert.equal(regularBody.length, 0, `Ohne Fallback darf der schmale ${horizontal ? 'X' : 'Y'}-Stützkörper keine Linie haben`)
    const body = supportLines(gcode, 2700)
    const contact = supportLines(gcode, 2100)
    assert.ok(body.length > 0, `Schmale ${horizontal ? 'X' : 'Y'}-Fläche ohne Stützbahn`)
    assert.ok(contact.length > 0, `Schmale ${horizontal ? 'X' : 'Y'}-Fläche ohne Kontaktbahn`)
    narrowCounts.push(`${horizontal ? 'X' : 'Y'}:${body.length}/${contact.length} (regulär ${regularBody.length})`)
  }

  const denseContact = supportLines(supportGcode('grid', 'grid', 90), 2100)
  const sparseContact = supportLines(supportGcode('grid', 'grid', 20), 2100)
  assert.ok(
    denseContact.length > sparseContact.length,
    `Kontaktdichte muss die Bahnzahl erhöhen: ${sparseContact.length} → ${denseContact.length}`,
  )

  const denseSupport = supportLines(supportGcode('grid', 'grid', 80, 60), 2700)
  const sparseSupport = supportLines(supportGcode('grid', 'grid', 80, 15), 2700)
  assert.ok(
    denseSupport.length > sparseSupport.length,
    `Stützdichte muss die Bahnzahl erhöhen: ${sparseSupport.length} → ${denseSupport.length}`,
  )

  console.log(
    `OK: Support; XY ${width(supportFootprint(narrowXy, 0)).toFixed(2)} → ${width(supportFootprint(wideXy, 0)).toFixed(2)} mm, ` +
      `Z-Spitze ${topOf(withGap)} → ${topOf(noGap)}, schmale Flächen ${narrowCounts.join(', ')}, ` +
      `Muster ${grid.length}/${lines.length}/${zigzag.length} Linien, ` +
      `Dichten Kontakt ${sparseContact.length} → ${denseContact.length}, Stütz ${sparseSupport.length} → ${denseSupport.length}.`,
  )
}

main()