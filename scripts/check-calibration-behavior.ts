import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildCalibration } from '../server/calibration.ts'
import { parse3MFObjectSettings } from '../server/formats.ts'
import { parseSTL } from '../server/slicer/stl.ts'
import { sliceMesh } from '../server/slicer/index.ts'
import { applyPrinterLimits } from '../shared/limits.ts'
import { DEFAULT_SETTINGS, mergeSettings, PREVIEW_STRIDE } from '../shared/types.ts'
import { PREVIEW_CODE_KIND } from '../shared/preview.ts'
import {
  correctedFlow,
  flowCubeWallWidth,
  MAX_FLOW_TEST_SCV,
  MAX_FLOW_TEST_STRAIGHT,
  summarizeFlowMeasurements,
} from '../shared/calibration.ts'
import { filamentById, printerById } from '../shared/catalog.ts'
import { buildCalibrationPlan, calibrationLayerRange, calibrationSpeedHint } from '../src/viewer/calibrationPlan.ts'
import { analyzePreviewRisks } from '../src/viewer/previewDiagnostics.ts'
import { buildPreviewReport } from '../src/viewer/previewReport.ts'
import {
  applyCalibrationTestReset,
  calibrationTestStateForNextTest,
  dailyStructurePatch,
  normalSettingsForTest,
} from '../src/calibrationSettings.ts'
import type { CalibrationOptions } from '../shared/types.ts'

fs.mkdirSync('artifacts', { recursive: true })
const printer = printerById('flashforge-ad5x')
const filament = filamentById('pla')

type Layer = { n: number; code: string }

function slices(
  id: string,
  options?: CalibrationOptions,
  baseSettings = DEFAULT_SETTINGS,
  withEnd = false,
) {
  const bundle = buildCalibration(id, printer, filament, baseSettings, options)
  assert.ok(bundle, `${id}: buildCalibration liefert kein Bundle`)
  const settings = applyPrinterLimits(
    printer,
    mergeSettings(baseSettings, {
      ...bundle.tool.settingsPatch,
      primeLine: { ...DEFAULT_SETTINGS.primeLine, enabled: false },
      ironing: { ...DEFAULT_SETTINGS.ironing, enabled: false },
      output: { ...DEFAULT_SETTINGS.output, verbosePaths: true },
    }),
  )
  const result = sliceMesh(parseSTL(bundle.stl), settings, printer, null, bundle.overrides, {
    start: false,
    end: withEnd,
  })
  fs.writeFileSync(`artifacts/calibration-${id}.gcode`, result.gcode)
  const layers: Layer[] = result.gcode
    .split(/(?=^;LAYER:)/m)
    .filter((part) => /^;LAYER:/.test(part))
    .map((code) => ({ n: Number(code.match(/^;LAYER:(\d+)/m)?.[1] ?? 0), code }))
  return { bundle, settings, result, layers }
}

function extrusionSpeeds(layer: Layer): number[] {
  return [...layer.code.matchAll(/^G1 X[^\n]*? E-?\d[^\n]*? F(\d+(?:\.\d+)?)$/gm)].map(
    (match) => Number(match[1]) / 60,
  )
}

/** Tatsächliche Extrusionsbreite aus E-Weg, Bahnlänge und Schichthöhe. */
function extrusionWidths(layer: Layer, layerHeight: number, filamentDiameter: number): number[] {
  const points = [...layer.code.matchAll(/^G1 X([-0-9.]+) Y([-0-9.]+)[^\n]* E([-0-9.]+)[^\n]*$/gm)].map(
    (match) => ({ x: Number(match[1]), y: Number(match[2]), e: Number(match[3]) }),
  )
  const filamentArea = Math.PI * (filamentDiameter / 2) ** 2
  const widths: number[] = []
  for (let i = 1; i < points.length; i++) {
    const length = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
    const de = points[i].e - points[i - 1].e
    if (length <= 5 || de <= 0) continue
    widths.push((de * filamentArea) / (length * layerHeight))
  }
  return widths
}

function maxSpeed(layer: Layer | undefined): number {
  assert.ok(layer, 'Layer fehlt')
  const values = extrusionSpeeds(layer)
  assert.ok(values.length, `Layer ${layer.n}: keine Extrusionsgeschwindigkeit`)
  return Math.max(...values)
}

/** Längste einzelne Außenwandstrecke einer Vorschauschicht in mm. */
function longestOuterWallSegment(layer: { data: number[] } | undefined): number {
  assert.ok(layer, 'Vorschauschicht fehlt')
  let longest = 0
  for (let k = 0; k + PREVIEW_STRIDE - 1 < layer.data.length; k += PREVIEW_STRIDE) {
    if (PREVIEW_CODE_KIND.get(layer.data[k]) !== 'outer-wall') continue
    const length = Math.hypot(layer.data[k + 3] - layer.data[k + 1], layer.data[k + 4] - layer.data[k + 2])
    if (length > longest) longest = length
  }
  return longest
}

/** Vereinfachte erreichbare Spitzengeschwindigkeit auf einer geraden Strecke. */
function reachableOnStraight(length: number, acceleration: number, cornerSpeed: number): number {
  return Math.sqrt(Math.max(0, cornerSpeed) ** 2 + Math.max(0, acceleration) * Math.max(0, length))
}

function at(layers: Layer[], n: number): Layer {
  const layer = layers.find((entry) => entry.n === n)
  assert.ok(layer, `Layer ${n} fehlt`)
  return layer
}

function commands(code: string, pattern: RegExp): number[] {
  return [...code.matchAll(pattern)].map((match) => Number(match[1]))
}

// 1) Flowwürfel: eine Wand, kein Boden/Deckel, keine Füllung.
const flow = slices('flow-cube')
assert.ok(flow.layers.length > 60, `Flowwürfel zu niedrig: ${flow.layers.length} Schichten`)
assert.match(flow.result.gcode, /^M221 S100\b/m, 'Flowwürfel muss den Drucker-Flussfaktor auf 100 % setzen')
assert.equal((flow.result.gcode.match(/^M221 S100\b/gm) ?? []).length, 1, 'Flowwürfel muss den Flussfaktor genau einmal setzen')
for (const layer of flow.layers) {
  assert.doesNotMatch(layer.code, /; TYPE: solid/, `Flowwürfel L${layer.n}: Deckschicht vorhanden`)
  assert.doesNotMatch(layer.code, /; TYPE: sparse/, `Flowwürfel L${layer.n}: Füllung vorhanden`)
  assert.doesNotMatch(layer.code, /; TYPE: inner-wall/, `Flowwürfel L${layer.n}: Innenwand vorhanden`)
  assert.equal(
    (layer.code.match(/; TYPE: outer-wall/g) ?? []).length,
    1,
    `Flowwürfel L${layer.n}: genau eine Außenwand erwartet`,
  )
}

// 1a) Aktives Profil mit 0,42-mm-Linienbreite: Der Flowwürfel muss weiterhin
// echte Wände und nicht nur den Brim drucken. Bei exakt gleicher Wand- und
// Planungsbreite kollabierte die Kontur früher; 0,5/0,6 mm waren dann
// Brim/erste Schicht und der Fluss-Rechner empfahl einen falschen Wert.
const flowWithActiveLineWidth = slices(
  'flow-cube',
  undefined,
  mergeSettings(DEFAULT_SETTINGS, {
    lineWidth: 0.42,
    firstLayerLineWidth: 0.45,
    outerWallLineWidth: 0.42,
    innerWallLineWidth: 0.44,
    topSurfaceLineWidth: 0.44,
  }),
)
assert.equal(flowWithActiveLineWidth.layers.length, flow.layers.length, 'Flowwürfel mit 0,42-mm-Profil hat eine andere Schichtzahl')
for (const layer of flowWithActiveLineWidth.layers) {
  assert.equal(
    (layer.code.match(/; TYPE: outer-wall/g) ?? []).length,
    1,
    `Flowwürfel mit 0,42-mm-Profil: Schicht ${layer.n} hat keine eindeutige Außenwand`,
  )
}

// 1a-2) Eine aktive Schrumpfkompensation darf den Testwürfel nicht verändern.
// Sonst wurde aus 30 × 30 × 15 mm ein 30,6 × 30,6 × 15,3 mm großer Würfel mit
// 77 Schichten und einer dünnen Restlage am Deckel; die Messung am oberen Rand
// konnte dann wie eine 0,1-mm-Wand aussehen.
const flowWithShrinkage = slices(
  'flow-cube',
  undefined,
  mergeSettings(DEFAULT_SETTINGS, {
    shrinkage: { x: 2.0408, y: 2.0408, z: 2.04 },
  }),
)
assert.equal(flowWithShrinkage.layers.length, 75, 'Schrumpfkompensation verändert die Schichtzahl des Flowwürfels')
assert.equal(flowWithShrinkage.layers[flowWithShrinkage.layers.length - 1]?.n, 75, 'Flowwürfel endet nicht bei Schicht 75')
assert.match(at(flowWithShrinkage.layers, 75).code, /\bG1 Z15 F600\b/, 'Letzte Flowwürfel-Schicht liegt nicht auf Z=15 mm')
assert.doesNotMatch(flowWithShrinkage.result.gcode, /;LAYER:76/, 'Flowwürfel hat eine zusätzliche Schicht durch Schrumpfkompensation')
assert.equal(flowWithShrinkage.settings.shrinkage.x, 0, 'Flowwürfel darf X-Schrumpfung nicht übernehmen')
assert.equal(flowWithShrinkage.settings.shrinkage.y, 0, 'Flowwürfel darf Y-Schrumpfung nicht übernehmen')
assert.equal(flowWithShrinkage.settings.shrinkage.z, 0, 'Flowwürfel darf Z-Schrumpfung nicht übernehmen')
for (const width of extrusionWidths(at(flowWithShrinkage.layers, 10), flowWithShrinkage.settings.layerHeight, flowWithShrinkage.settings.filamentDiameter)) {
  assert.ok(
    Math.abs(width - flowCubeWallWidth(DEFAULT_SETTINGS.nozzle)) < 0.02,
    `Flowwürfel mit Schrumpfprofil: Bahn ${width.toFixed(3)} mm statt ${flowCubeWallWidth(DEFAULT_SETTINGS.nozzle).toFixed(2)} mm`,
  )
}

// 1b) Der Fluss-Rechner muss die tatsächliche Soll-Wandbreite des Testwürfels
// verwenden. Eine korrekt gemessene 0,42-mm-Wand darf den Fluss nicht senken.
const flowMesh = parseSTL(flow.bundle.stl)
let flowMinX = Infinity, flowMaxX = -Infinity, flowMinY = Infinity, flowMaxY = -Infinity, flowMaxZ = -Infinity
for (let i = 0; i < flowMesh.positions.length; i += 3) {
  flowMinX = Math.min(flowMinX, flowMesh.positions[i])
  flowMaxX = Math.max(flowMaxX, flowMesh.positions[i])
  flowMinY = Math.min(flowMinY, flowMesh.positions[i + 1])
  flowMaxY = Math.max(flowMaxY, flowMesh.positions[i + 1])
  flowMaxZ = Math.max(flowMaxZ, flowMesh.positions[i + 2])
}
assert.ok(Math.abs(flowMaxX - flowMinX - 30) < 1e-6, 'Flowwürfel muss 30 mm breit sein')
assert.ok(Math.abs(flowMaxY - flowMinY - 30) < 1e-6, 'Flowwürfel muss 30 mm tief sein')
assert.ok(Math.abs(flowMaxZ - 15) < 1e-6, 'Flowwürfel muss 15 mm hoch sein')
const flowTargetWall = flowCubeWallWidth(DEFAULT_SETTINGS.nozzle)
assert.equal(flow.settings.outerWallLineWidth, flowTargetWall, 'Flowwürfel muss die Sollwand als Außenwandbreite setzen')
const flowWidths = extrusionWidths(at(flow.layers, 10), flow.settings.layerHeight, flow.settings.filamentDiameter)
assert.ok(flowWidths.length > 0, 'Flowwürfel: keine langen Extrusionsbahnen zum Messen der Breite')
for (const width of flowWidths) {
  assert.ok(Math.abs(width - flowTargetWall) < 0.02, `Flowwürfel-Bahn ${width.toFixed(3)} mm statt ${flowTargetWall.toFixed(2)} mm`)
}
assert.equal(
  correctedFlow(1, DEFAULT_SETTINGS.nozzle, 0.42),
  0.952,
  'Regression: Die alte Düsenbreite würde eine korrekte 0,42-mm-Wand um 4,8 % absenken',
)
assert.equal(
  correctedFlow(1, flowTargetWall, 0.42),
  1,
  'Eine korrekt gemessene 0,42-mm-Wand muss den Fluss unverändert lassen',
)
assert.equal(correctedFlow(1, flowTargetWall, 0.5), 0.84, 'Fluss-Rechner nutzt nicht die Testwand als Ziel')
assert.equal(correctedFlow(1, flowTargetWall, 0), null, 'Ungültiger Messwert muss ein leeres Ergebnis liefern')
assert.equal(flowCubeWallWidth(0.6), 0.6, 'Größere Düsen müssen die Wand des Testwürfels vergrößern')

// 1c) Vier Wandmessungen: Der empfohlene Fluss kommt aus dem Mittelwert,
// Streuung und Flussbereich machen eine einzelne Fehlmessung sichtbar.
const flowSummary = summarizeFlowMeasurements([0.41, 0.42, 0.42, 0.43], 1, flowTargetWall)
assert.equal(flowSummary.count, 4, 'Fluss-Zusammenfassung zählt nicht alle vier Wandmessungen')
assert.ok(Math.abs((flowSummary.mean ?? 0) - 0.42) < 1e-12, 'Mittelwert der Wandmessungen ist falsch')
assert.ok(
  Math.abs((flowSummary.standardDeviation ?? 0) - Math.sqrt(0.00005)) < 1e-12,
  'Streuung der Wandmessungen ist falsch',
)
assert.equal(flowSummary.flow, 1, 'Empfohlener Fluss nutzt nicht den Mittelwert')
assert.equal(flowSummary.flowMinimum, 0.977, 'Flussbereich: dickste Wand ergibt nicht den kleinsten Fluss')
assert.equal(flowSummary.flowMaximum, 1.024, 'Flussbereich: dünnste Wand ergibt nicht den größten Fluss')

const flowOutlier = summarizeFlowMeasurements([0.42, 0.42, 0.42, 0.5], 1, flowTargetWall)
assert.ok(Math.abs((flowOutlier.mean ?? 0) - 0.44) < 1e-12, 'Eine Fehlmessung verschiebt den Mittelwert unerwartet')
assert.equal(flowOutlier.flow, 0.955, 'Eine einzelne 0,50-mm-Messung verschiebt den empfohlenen Fluss zu stark')
assert.equal(flowOutlier.flowMinimum, 0.84, 'Flussbereich zeigt nicht den Fluss aus der dicksten Wand')
assert.equal(flowOutlier.flowMaximum, 1, 'Flussbereich zeigt nicht den Fluss aus der dünnsten Wand')

const partialFlow = summarizeFlowMeasurements([0.42, Number.NaN, 0, 0.42], 1, flowTargetWall)
assert.equal(partialFlow.count, 2, 'Ungültige Wandmessungen werden nicht ignoriert')
assert.equal(partialFlow.mean, 0.42, 'Teilweise Messreihe mittelt nicht die gültigen Werte')
assert.equal(partialFlow.standardDeviation, 0, 'Zwei gleiche gültige Messungen müssen Streuung 0 haben')
assert.equal(partialFlow.flowMinimum, 1, 'Teilweise Messreihe hat einen falschen kleinsten Fluss')
assert.equal(partialFlow.flowMaximum, 1, 'Teilweise Messreihe hat einen falschen größten Fluss')
assert.equal(summarizeFlowMeasurements([], 1, flowTargetWall).flow, null, 'Leere Messreihe muss ohne Fluss bleiben')

// 2) Max-Flow-Core: sieben Bänder à 5 mm. Die tatsächliche G-code-Geschwindigkeit
// muss pro Band steigen; sie folgt aus Volumenstrom, Düse und Schichthöhe.
const maxFlow = slices('max-flow')
assert.equal(maxFlow.bundle.tool.steps.length, 7, 'Max-Flow-Core muss sieben Stufen haben')
assert.deepEqual(
  maxFlow.bundle.tool.steps.map((step) => step.expectedFlow),
  [4, 6, 8, 10, 12, 14, 16],
  'Max-Flow-Core: Voreinstellung ist nicht 4–16 mm³/s in 2er-Schritten',
)
const maxFlowSpeeds = [20, 45, 70, 95, 120, 145, 170].map((n) => maxSpeed(at(maxFlow.layers, n)))
for (let i = 1; i < maxFlowSpeeds.length; i++) {
  assert.ok(
    maxFlowSpeeds[i] > maxFlowSpeeds[i - 1] + 1,
    `Max-Flow-Geschwindigkeit steigt nicht: ${maxFlowSpeeds.join(' / ')}`,
  )
}
// 16 mm³/s geteilt durch (0,4 mm × 0,2 mm) ergeben 200 mm/s im obersten Band.
assert.equal(Math.round(maxFlowSpeeds[6] ?? 0), 200, 'Max-Flow-Band 7 muss 200 mm/s fahren')

// 2b) 3MF-Objektwerte: 0 muss erhalten bleiben, nicht als „nicht gesetzt“ gelten.
const objectSettings = parse3MFObjectSettings(`
<config>
  <object id="2">
    <metadata key="name" value="Max Flow Test"/>
    <metadata key="sparse_infill_density" value="0%"/>
    <metadata key="wall_loops" value="1"/>
    <metadata key="top_shell_layers" value="0"/>
    <metadata key="bottom_shell_layers" value="0"/>
    <metadata key="spiral_mode" value="1"/>
    <metadata key="outer_wall_speed" value="180"/>
    <part id="1"><metadata key="name" value="Spirale"/></part>
  </object>
</config>`).get('2')
assert.ok(objectSettings, '3MF-Objektwerte fehlen')
assert.equal(objectSettings.infillDensity, 0)
assert.equal(objectSettings.walls, 1)
assert.equal(objectSettings.topLayers, 0)
assert.equal(objectSettings.bottomLayers, 0)
assert.equal(objectSettings.special?.vase, true)
assert.equal(objectSettings.speeds?.outerWall, 180)

// 3) VFA: ebenfalls echte F-Geschwindigkeit je 40-Schicht-Stufe.
const vfa = slices('vfa')
const vfaSpeeds = [55, 95, 135, 175].map((n) => maxSpeed(at(vfa.layers, n)))
for (let i = 1; i < vfaSpeeds.length; i++) {
  assert.ok(vfaSpeeds[i] > vfaSpeeds[i - 1] + 1, `VFA-Geschwindigkeit steigt nicht: ${vfaSpeeds.join(' / ')}`)
}

// 4) Temperaturturm: M104 muss an den Stufengrenzen wirklich wechseln.
const temp = slices('temp-tower')
const temps = [...new Set(commands(temp.result.gcode, /^M104 S(\d+)/gm))]
assert.ok(temps.length >= 5, `Temperaturturm hat nur ${temps.length} Temperaturen`)
assert.ok(Math.max(...temps) > Math.min(...temps), 'Temperaturturm ändert die Temperatur nicht')

// 5) Pressure Advance: der Firmware-Befehl muss pro Segment wechseln.
const pa = slices('pressure-advance')
const paValues = [
  ...new Set(
    commands(
      pa.result.gcode,
      /^(?:SET_PRESSURE_ADVANCE ADVANCE=|M900 K|M572 S|M233 X)([\d.]+)/gm,
    ),
  ),
]
assert.ok(paValues.length >= 5, `Pressure-Advance-Turm hat nur ${paValues.length} Werte`)
assert.ok(Math.max(...paValues) > Math.min(...paValues), 'Pressure-Advance-Turm ändert den Wert nicht')

// 6) PA-Linientest: viele Werte entlang X, nicht nur ein Startwert.
const paLine = slices('pressure-advance-line')
const paLineValues = commands(paLine.result.gcode, /^SET_PRESSURE_ADVANCE ADVANCE=([\d.]+)/gm)
assert.ok(new Set(paLineValues).size >= 20, `PA-Linientest hat nur ${new Set(paLineValues).size} Werte`)
assert.ok(Math.max(...paLineValues) - Math.min(...paLineValues) > 0.05, 'PA-Linientest-Rampe ist zu klein')

// 7) Input Shaper: Frequenzbefehl muss pro Segment wechseln.
const shaper = slices('input-shaper')
const shaperValues = [
  ...new Set([
    ...commands(shaper.result.gcode, /^SET_INPUT_SHAPER[^\n]*SHAPER_FREQ_X=([\d.]+)/gm),
    ...commands(shaper.result.gcode, /^M593 X([\d.]+)/gm),
  ]),
]
assert.ok(shaperValues.length >= 4, `Input-Shaper-Turm hat nur ${shaperValues.length} Frequenzen`)
assert.ok(Math.max(...shaperValues) > Math.min(...shaperValues), 'Input-Shaper-Turm ändert die Frequenz nicht')

// 8) Retract: erste Stufe muss mit Von beginnen, danach steigen.
const retract = slices('retract-tower')
const retractValues = commands(retract.result.gcode, /^; Retract ([\d.]+) mm/gm)
assert.ok(retractValues.length >= 5, `Needle-Grid hat nur ${retractValues.length} Stufen`)
assert.equal(retractValues[0], 0.2, `Retract beginnt bei ${retractValues[0]} statt 0.2 mm`)
assert.ok(retractValues[retractValues.length - 1] > retractValues[0], 'Retract-Distanz steigt nicht')
assert.match(at(retract.layers, 1).code, /^G1 E-0\.2 /m, 'Erste Retract-Bewegung nutzt nicht 0.2 mm')

// 9) Erste Schicht und Passungskupon: Modelle müssen vollständig entstehen.
const first = slices('first-layer')
assert.ok(first.layers.length >= 1, 'Erste-Schicht-Test hat keine Schicht')
assert.ok((first.result.gcode.match(/; TYPE: /g) ?? []).length > 0, 'Erste-Schicht-Test hat keine Bahnen')
const fit = slices('fit-coupon')
assert.ok(fit.layers.length >= 20, `Passungskupon hat nur ${fit.layers.length} Schichten`)

// 10) Kein Test außer dem ausdrücklichen VFA-Geschwindigkeitsturm darf die
// Geschwindigkeit aus dem ausgewählten Profil überschreiben. Der frühere
// Temperaturtest setzte hier fest 45 mm/s und nahm das Tempo in den nächsten
// Test mit.
const fastProfile = mergeSettings(DEFAULT_SETTINGS, {
  speeds: { print: 123, outerWall: 74, innerWall: 104, solid: 111, bridge: 49 },
})
for (const id of [
  'flow-cube',
  'temp-tower',
  'retract-tower',
  'max-flow',
  'pressure-advance',
  'pressure-advance-line',
  'input-shaper',
  'first-layer',
  'fit-coupon',
]) {
  const bundle = buildCalibration(id, printer, filament, fastProfile)
  assert.ok(bundle, `${id}: Build fehlt`)
  assert.equal(
    (bundle.tool.settingsPatch as { speeds?: unknown }).speeds,
    undefined,
    `${id}: Test-Patch überschreibt die Profilgeschwindigkeit`,
  )
  const applied = mergeSettings(fastProfile, bundle.tool.settingsPatch)
  assert.equal(applied.speeds.print, fastProfile.speeds.print, `${id}: Profiltempo print geht verloren`)
  assert.equal(applied.speeds.outerWall, fastProfile.speeds.outerWall, `${id}: Profiltempo Außenwand geht verloren`)
}

// 10) Nach einem Test muss ein normales Modell wieder Alltagsstruktur bekommen,
// ohne die eigentlichen Kalibrierwerte zu verlieren.
const flowTestSettings = mergeSettings(DEFAULT_SETTINGS, flow.bundle.tool.settingsPatch)
flowTestSettings.flow = 0.97
flowTestSettings.maxVolumetricFlow = 14
flowTestSettings.pressureAdvance = { ...flowTestSettings.pressureAdvance, enabled: true, value: 0.045 }
flowTestSettings.inputShaper = { ...flowTestSettings.inputShaper, enabled: true, freqX: 48 }
flowTestSettings.temps = { ...flowTestSettings.temps, nozzle: 208, firstLayerNozzle: 212 }
flowTestSettings.retraction = { ...flowTestSettings.retraction, distance: 0.9 }
const flowRestored = mergeSettings(flowTestSettings, dailyStructurePatch(DEFAULT_SETTINGS))
assert.equal(flowRestored.walls, DEFAULT_SETTINGS.walls)
assert.equal(flowRestored.topLayers, DEFAULT_SETTINGS.topLayers)
assert.equal(flowRestored.bottomLayers, DEFAULT_SETTINGS.bottomLayers)
assert.equal(flowRestored.infillDensity, DEFAULT_SETTINGS.infillDensity)
assert.equal(flowRestored.special?.openShell, false)
assert.equal(flowRestored.flow, 0.97)
assert.equal(flowRestored.maxVolumetricFlow, 14)
assert.equal(flowRestored.pressureAdvance.value, 0.045)
assert.equal(flowRestored.inputShaper.freqX, 48)
assert.equal(flowRestored.temps.nozzle, 208)
assert.equal(flowRestored.retraction.distance, 0.9)

const tempTestSettings = mergeSettings(DEFAULT_SETTINGS, temp.bundle.tool.settingsPatch)
tempTestSettings.temps = { ...tempTestSettings.temps, nozzle: 223, firstLayerNozzle: 225 }
const tempRestored = mergeSettings(tempTestSettings, dailyStructurePatch(DEFAULT_SETTINGS))
assert.equal(tempRestored.walls, DEFAULT_SETTINGS.walls)
assert.equal(tempRestored.infillDensity, DEFAULT_SETTINGS.infillDensity)
assert.equal(tempRestored.special?.openShell, false)
assert.equal(tempRestored.temps.nozzle, 223)
assert.equal(tempRestored.temps.firstLayerNozzle, 225)

// Eine neue Testreihe darf die Struktur nicht aus einem alten Test übernehmen,
// aber die aktuellen Kalibrierwerte müssen erhalten bleiben. Geschwindigkeit
// und Beschleunigung kommen dagegen immer aus dem ausgewählten Profil.
const mutatedTestSettings = mergeSettings(flowTestSettings, {
  speeds: { print: 45, outerWall: 25, innerWall: 30 },
  accelerations: { print: 800, outerWall: 700, innerWall: 750 },
})
const baselineForNewSeries = normalSettingsForTest(mutatedTestSettings, DEFAULT_SETTINGS)
assert.equal(baselineForNewSeries.walls, DEFAULT_SETTINGS.walls)
assert.equal(baselineForNewSeries.topLayers, DEFAULT_SETTINGS.topLayers)
assert.equal(baselineForNewSeries.bottomLayers, DEFAULT_SETTINGS.bottomLayers)
assert.equal(baselineForNewSeries.infillDensity, DEFAULT_SETTINGS.infillDensity)
assert.equal(baselineForNewSeries.temps.nozzle, flowTestSettings.temps.nozzle)
assert.equal(baselineForNewSeries.retraction.distance, flowTestSettings.retraction.distance)
assert.equal(baselineForNewSeries.flow, flowTestSettings.flow)
assert.equal(baselineForNewSeries.pressureAdvance.value, flowTestSettings.pressureAdvance.value)
assert.equal(baselineForNewSeries.inputShaper.freqX, flowTestSettings.inputShaper.freqX)
assert.equal(baselineForNewSeries.speeds.print, DEFAULT_SETTINGS.speeds.print, 'Teststart behält 45 mm/s')
assert.equal(baselineForNewSeries.speeds.outerWall, DEFAULT_SETTINGS.speeds.outerWall)
assert.equal(baselineForNewSeries.accelerations.print, DEFAULT_SETTINGS.accelerations.print)

// Ein vorheriger Temperaturtest darf seine Von-Temperatur nicht in den
// nächsten Test tragen; der ausgewählte Profilwert gilt wieder.
let tempSeries = calibrationTestStateForNextTest(DEFAULT_SETTINGS, temp.bundle.tool.settingsPatch)
const afterTempTest = mergeSettings(DEFAULT_SETTINGS, temp.bundle.tool.settingsPatch)
const tempTestBase = normalSettingsForTest(afterTempTest, DEFAULT_SETTINGS, tempSeries)
assert.equal(tempTestBase.temps.nozzle, DEFAULT_SETTINGS.temps.nozzle, 'Temperaturtest-Wert bleibt im nächsten Test hängen')
assert.equal(tempTestBase.speeds.print, DEFAULT_SETTINGS.speeds.print)

// 11) Jeder Test startet wieder beim ausgewählten Profil. Ein Test-Patch darf
// nur die eigenen Testwerte setzen, nicht die Profilgeschwindigkeit erben.
const normalBeforeTests = mergeSettings(DEFAULT_SETTINGS, {
  temps: { nozzle: 225, firstLayerNozzle: 230 },
  speeds: { print: 80, outerWall: 50, innerWall: 60, solid: 70, bridge: 40 },
  accelerations: { print: 3000, outerWall: 2500, innerWall: 2800, solid: 2900 },
  retraction: { distance: 0.8 },
})
let testSeries = calibrationTestStateForNextTest(normalBeforeTests, first.bundle.tool.settingsPatch)
let afterTestSeries = mergeSettings(normalBeforeTests, first.bundle.tool.settingsPatch)
for (const patch of [
  temp.bundle.tool.settingsPatch,
  retract.bundle.tool.settingsPatch,
  vfa.bundle.tool.settingsPatch,
  shaper.bundle.tool.settingsPatch,
]) {
  const nextBase = normalSettingsForTest(afterTestSeries, normalBeforeTests, testSeries)
  testSeries = calibrationTestStateForNextTest(nextBase, patch)
  afterTestSeries = mergeSettings(nextBase, patch)
}
assert.equal(testSeries.normalSettings.temps.nozzle, 225, 'Testreihe verliert die Profil-Temperatur')
assert.equal(testSeries.normalSettings.speeds.print, 80, 'Testreihe verliert die Profilgeschwindigkeit')
assert.equal(testSeries.testPatches.length, 1, 'Alte Test-Patches werden fortgeschrieben')
assert.equal(testSeries.testPatches[0], shaper.bundle.tool.settingsPatch, 'Aktueller Test-Patch fehlt')
assert.equal(afterTestSeries.speeds.print, normalBeforeTests.speeds.print, 'Folgetest startet nicht mit Profilgeschwindigkeit')
assert.equal(afterTestSeries.temps.nozzle, normalBeforeTests.temps.nozzle, 'Folgetest startet nicht mit Profiltemperatur')

const restoredAfterTests = applyCalibrationTestReset(afterTestSeries, testSeries)
assert.equal(restoredAfterTests.layerHeight, normalBeforeTests.layerHeight, 'First-Layer-Testwert bleibt erhalten')
assert.equal(restoredAfterTests.walls, normalBeforeTests.walls)
assert.equal(restoredAfterTests.topLayers, normalBeforeTests.topLayers)
assert.equal(restoredAfterTests.bottomLayers, normalBeforeTests.bottomLayers)
assert.equal(restoredAfterTests.infillDensity, normalBeforeTests.infillDensity)
assert.equal(restoredAfterTests.special?.openShell, false)
assert.equal(restoredAfterTests.temps.nozzle, normalBeforeTests.temps.nozzle, 'Temperatur-Testwert bleibt erhalten')
assert.equal(restoredAfterTests.temps.firstLayerNozzle, normalBeforeTests.temps.firstLayerNozzle)
assert.equal(restoredAfterTests.speeds.print, normalBeforeTests.speeds.print, 'Geschwindigkeits-Testwert bleibt erhalten')
assert.equal(restoredAfterTests.speeds.outerWall, normalBeforeTests.speeds.outerWall)
assert.equal(restoredAfterTests.speeds.bridge, normalBeforeTests.speeds.bridge)
assert.equal(restoredAfterTests.accelerations.print, normalBeforeTests.accelerations.print, 'Input-Shaper-Testwert bleibt erhalten')
assert.equal(restoredAfterTests.accelerations.outerWall, normalBeforeTests.accelerations.outerWall)
assert.equal(restoredAfterTests.retraction.distance, normalBeforeTests.retraction.distance, 'Retract-Testwert bleibt erhalten')

// Bewusst übernommene Messwerte dürfen nicht als Test-Startwert zurückfallen.
const appliedCalibrationValues = mergeSettings(afterTestSeries, {
  temps: { nozzle: 222 },
  speeds: { print: 100 },
  accelerations: { print: 3500 },
  retraction: { distance: 1.1 },
})
const restoredWithAppliedValues = applyCalibrationTestReset(appliedCalibrationValues, testSeries)
assert.equal(restoredWithAppliedValues.temps.nozzle, 222, 'Übernommene Temperatur wurde zurückgesetzt')
assert.equal(restoredWithAppliedValues.temps.firstLayerNozzle, normalBeforeTests.temps.firstLayerNozzle)
assert.equal(restoredWithAppliedValues.speeds.print, 100, 'Übernommene Geschwindigkeit wurde zurückgesetzt')
assert.equal(restoredWithAppliedValues.speeds.outerWall, normalBeforeTests.speeds.outerWall)
assert.equal(restoredWithAppliedValues.accelerations.print, 3500, 'Übernommene Beschleunigung wurde zurückgesetzt')
assert.equal(restoredWithAppliedValues.retraction.distance, 1.1, 'Übernommene Retract-Distanz wurde zurückgesetzt')

// 12) Der Kalibrierplan muss den tatsächlich geslicten Schichten zugeordnet
// werden. Geplante Stufenzahl und Schichtzahl werden gegen den Slice geprüft.
const planEntries: [string, ReturnType<typeof slices>][] = [
  ['flow-cube', flow],
  ['temp-tower', temp],
  ['retract-tower', retract],
  ['max-flow', maxFlow],
  ['pressure-advance', pa],
  ['pressure-advance-line', paLine],
  ['input-shaper', shaper],
  ['vfa', vfa],
  ['first-layer', first],
  ['fit-coupon', fit],
]
for (const [id, entry] of planEntries) {
  const plan = buildCalibrationPlan(entry.bundle.tool, entry.result.layers, 0, entry.result.stats.layerCount)
  assert.equal(plan.steps.length, entry.bundle.tool.steps.length, `${id}: Plan zeigt nicht alle Stufen`)
  assert.ok(plan.steps.every((step) => step.startLayer !== null), `${id}: nicht jede Planstufe liegt im Slice`)
  assert.equal(plan.plannedLayers, entry.result.stats.layerCount, `${id}: geplante Schichtzahl fehlt im Slice`)
  assert.equal(plan.stagesInSlice, plan.plannedStages, `${id}: geplante Stufen fehlen im Slice`)
  assert.equal(plan.ok, true, `${id}: Kalibrierplan und Slice stimmen nicht überein`)
}

const maxFlowPlan = buildCalibrationPlan(maxFlow.bundle.tool, maxFlow.result.layers, 60, maxFlow.result.stats.layerCount)
assert.equal(maxFlowPlan.steps.filter((step) => step.active).length, 1, 'Max-Flow: nicht genau eine aktive Stufe')
assert.equal(maxFlowPlan.steps.find((step) => step.active)?.index, 2, 'Max-Flow: aktive Stufe folgt nicht der Schicht')
assert.equal(maxFlowPlan.steps[2]?.startLayer, 49, 'Max-Flow: Stufe 3 beginnt nicht bei z 10 mm')
assert.equal(maxFlowPlan.steps[2]?.endLayer, 73, 'Max-Flow: Stufe 3 endet nicht vor z 15 mm')
assert.equal(calibrationLayerRange(maxFlowPlan.steps[2]!), 'L50–74')
const partialPlan = buildCalibrationPlan(
  maxFlow.bundle.tool,
  maxFlow.result.layers.slice(0, 5),
  0,
  5,
)
assert.equal(partialPlan.ok, false, 'Unvollständiger Slice darf den Plan nicht als vollständig melden')
assert.equal(partialPlan.stagesInSlice, 1, 'Unvollständiger Slice enthält nur die erste Stufe')
assert.equal(partialPlan.layersOk, false, 'Unvollständiger Slice muss bei der Schichtzahl abweichen')

// 13) P0-3: Absichtliche Kalibrierstufen sind kein Risiko. Wiederholte
// Planabweichungen werden je Stufe gruppiert, echte Abweichungen bleiben
// als Warnung erhalten.
const tempIntentional = analyzePreviewRisks(temp.result.layers, temp.settings, temp.bundle.tool)
assert.equal(
  tempIntentional.risks.filter((risk) => risk.id.includes('temperature')).length,
  0,
  'Temperaturturm: geplante Temperaturstufen werden fälschlich als Risiko gemeldet',
)
const maxFlowIntentional = analyzePreviewRisks(maxFlow.result.layers, maxFlow.settings, maxFlow.bundle.tool)
assert.equal(
  maxFlowIntentional.risks.filter((risk) => risk.id.includes('flow')).length,
  0,
  'Max-Flow-Turm: geplante Volumenstromstufen werden fälschlich als Risiko gemeldet',
)
const vfaIntentional = analyzePreviewRisks(vfa.result.layers, vfa.settings, vfa.bundle.tool)
assert.equal(
  vfaIntentional.risks.filter((risk) => risk.id.includes('flow') || risk.id.includes('speed')).length,
  0,
  'VFA-Turm: geplante Geschwindigkeitsstufen werden fälschlich als Risiko gemeldet',
)

// Der Kalibrierplan erklärt, warum die angezeigte Geschwindigkeit auf der
// kurzen VFA-Testwand unter dem Sollwert liegen kann. Die Zahlen im Beispiel
// werden aus der schnellsten geplanten Stufe abgeleitet.
const vfaPlan = buildCalibrationPlan(vfa.bundle.tool, vfa.result.layers, 0, vfa.result.stats.layerCount)
const scvSettings = mergeSettings(vfa.settings, {
  squareCornerVelocity: { enabled: true, value: 5 },
})
const speedHint = calibrationSpeedHint(vfaPlan, 'vfa', scvSettings, true)
assert.ok(speedHint, 'VFA: Tempo-Hinweis fehlt')
assert.match(speedHint.text, /Square-Corner-Velocity \(SCV 5 mm\/s\)/)
assert.match(speedHint.text, /20 × 14 mm-Testwand/)
assert.match(speedHint.text, /statt 120 mm\/s nur etwa 108–112 mm\/s/)
assert.equal(calibrationSpeedHint(vfaPlan, 'max-flow', scvSettings, true), null, 'Max-Flow darf keinen VFA-Tempo-Hinweis bekommen')

const limitedVfaPlan = {
  ...vfaPlan,
  steps: vfaPlan.steps.map((step, index) =>
    index === vfaPlan.steps.length - 1 ? { ...step, expectedSpeed: 150, observedMaxSpeed: 140 } : step,
  ),
}
const limitedSpeedHint = calibrationSpeedHint(limitedVfaPlan, 'vfa', scvSettings, true)
assert.ok(limitedSpeedHint, 'VFA: begrenzter Tempo-Hinweis fehlt')
assert.equal(limitedSpeedHint.limitedStages.length, 1, 'VFA: begrenzte Stufe wird nicht erkannt')
assert.equal(limitedSpeedHint.focusSpeed, 150, 'VFA: Hinweis nutzt nicht die begrenzte Stufe')
assert.equal(limitedSpeedHint.exampleFrom, 135)
assert.equal(limitedSpeedHint.exampleTo, 140)
assert.match(limitedSpeedHint.text, /statt 150 mm\/s nur etwa 135–140 mm\/s/)
const noScvHint = calibrationSpeedHint(
  limitedVfaPlan,
  'vfa',
  mergeSettings(vfa.settings, { squareCornerVelocity: { enabled: false, value: 5 } }),
  true,
)
assert.ok(noScvHint && !noScvHint.text.includes('Square-Corner-Velocity'), 'Ohne aktive SCV darf sie nicht als Ursache genannt werden')
assert.match(noScvHint?.text ?? '', /Testgeometrie/)

const vfaReport = buildPreviewReport({
  result: vfa.result,
  settings: scvSettings,
  report: vfaIntentional,
  layerIndex: 0,
  calibration: vfa.bundle.tool,
  scvActive: true,
})
assert.match(vfaReport, /## Kalibrier-Tempo/, 'VFA-Bericht: Tempo-Abschnitt fehlt')
assert.match(vfaReport, /Square-Corner-Velocity/, 'VFA-Bericht: SCV-Hinweis fehlt')

const wrongTemperatureLayers = temp.result.layers.map((layer, index) => {
  if (index < 40 || index > 78) return layer
  const data = layer.data.slice()
  for (let k = 0; k + PREVIEW_STRIDE - 1 < data.length; k += PREVIEW_STRIDE) data[k + 7] = 230
  return { ...layer, data }
})
const wrongTemperature = analyzePreviewRisks(wrongTemperatureLayers, temp.settings, temp.bundle.tool)
const temperatureDeviations = wrongTemperature.risks.filter((risk) =>
  risk.title.includes('Temperaturstufe'),
)
assert.equal(temperatureDeviations.length, 1, 'Temperaturabweichung wird nicht pro Stufe gruppiert')
assert.equal(temperatureDeviations[0]?.occurrences, 39, 'Temperaturgruppe fasst nicht alle Stufenschichten zusammen')
assert.ok(
  (temperatureDeviations[0]?.layerEndIndex ?? -1) > (temperatureDeviations[0]?.layerIndex ?? -1),
  'Temperaturgruppe enthält keinen Schichtbereich',
)

const wrongFlowLayers = maxFlow.result.layers.map((layer, index) => {
  if (index < 25 || index > 49) return layer
  const data = layer.data.slice()
  for (let k = 0; k + PREVIEW_STRIDE - 1 < data.length; k += PREVIEW_STRIDE) {
    if (data[k] !== 10) data[k + 6] = 5
  }
  return { ...layer, data }
})
const wrongFlow = analyzePreviewRisks(wrongFlowLayers, maxFlow.settings, maxFlow.bundle.tool)
const flowDeviations = wrongFlow.risks.filter((risk) => risk.title.includes('Volumenstromstufe'))
assert.equal(flowDeviations.length, 1, 'Volumenstromabweichung wird nicht pro Stufe gruppiert')
assert.equal(flowDeviations[0]?.occurrences, 25, 'Volumenstromgruppe fasst nicht alle Stufenschichten zusammen')
assert.equal(flowDeviations[0]?.layerIndex, 25, 'Volumenstromgruppe beginnt nicht bei der geplanten Stufe')
assert.equal(flowDeviations[0]?.layerEndIndex, 49, 'Volumenstromgruppe endet nicht am Stufenende')

console.log('OK: Kalibrierverhalten geprüft')
console.log('  Jeder Test startet mit Geschwindigkeit und Beschleunigung des ausgewählten Profils')
console.log('  Kein Test-Patch außer VFA setzt eine eigene Profilgeschwindigkeit')
console.log('  Temperatur-/Retract-Testwerte werden im nächsten Test nicht fortgeschrieben')
console.log('  Alltagsstruktur nach Test: Wände/Füllung/Deckel/Boden zurückgesetzt, Kalibrierwerte erhalten')
console.log(`  Flowwürfel: ${flow.layers.length} Schichten, nur Außenwände, kein Boden/Deckel`)
console.log(`  Flow-Rechner: Zielwand ${flowTargetWall.toFixed(2)} mm · 0,42 mm gemessen → Fluss 1,000`)
console.log(`  Max-Flow: ${maxFlowSpeeds.map((v) => `${v.toFixed(0)} mm/s`).join(' → ')}`)
console.log(`  VFA: ${vfaSpeeds.map((v) => `${v.toFixed(0)} mm/s`).join(' → ')}`)
console.log(`  Temperatur: ${temps.join(' / ')} °C`)
console.log(`  PA-Turm: ${paValues.join(' / ')}`)
console.log(`  PA-Linie: ${new Set(paLineValues).size} Werte, ${Math.min(...paLineValues)} bis ${Math.max(...paLineValues)}`)
console.log(`  Input Shaper: ${shaperValues.join(' / ')} Hz`)
console.log(`  Retract: ${retractValues.join(' / ')} mm`)
console.log(`  Erste Schicht / Passung: ${first.layers.length} / ${fit.layers.length} Schichten`)
console.log('  Kalibrierplan: alle Stufen und geplanten Schichten im Slice vorhanden')
console.log('  Kalibrier-Radar: absichtliche Temperatur-/Max-Flow-/VFA-Stufen ohne Risiko, echte Planabweichungen gruppiert')
