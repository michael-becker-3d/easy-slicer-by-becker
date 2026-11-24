import assert from 'node:assert/strict'
import type { ModelObjectInfo, PreviewLayer, SliceStats } from '../shared/types.ts'
import { analyzeGcode } from '../shared/gcode-import.ts'
import { demoSTL } from '../server/demo.ts'
import { parseSTL } from '../server/slicer/stl.ts'
import { sliceMesh } from '../server/slicer/index.ts'
import { DEFAULT_SETTINGS, mergeSettings } from '../shared/types.ts'
import { printerById } from '../shared/catalog.ts'
import {
  analyzePreviewRisks,
  compareSliceResults,
  describePreviewSegment,
  type SliceComparisonSide,
} from '../src/viewer/previewDiagnostics.ts'
import {
  computePreviewRange,
  effectivePreviewFlowLimit,
  previewFlowLimitInfo,
  previewFlowReserveLabel,
  previewFeatureColor,
  reserveHex,
} from '../src/viewer/previewColors.ts'
import { buildPreviewFilterBounds, segmentInsideFilter } from '../src/viewer/previewFilters.ts'
import { buildPreviewReport } from '../src/viewer/previewReport.ts'

function segment(
  kind: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  speed: number,
  flow: number,
  fan = 100,
  temperature = 210,
): number[] {
  return [kind, x1, y1, x2, y2, speed, flow, temperature, 2500, 0.45, fan, 0.04]
}

function layer(z: number, data: number[]): PreviewLayer {
  return { z, data }
}

const normal = layer(0.2, segment(1, 0, 0, 600, 0, 20, 5))
const flowPeak = layer(0.4, segment(4, 0, 0, 10, 0, 10, 9.8))
const shortLayer = layer(0.6, segment(1, 0, 0, 10, 0, 20, 4))
const travelHeavy = layer(0.8, [
  ...segment(1, 0, 0, 10, 0, 20, 5),
  ...segment(10, 0, 0, 600, 0, 20, 0),
])
const layers = [normal, flowPeak, shortLayer, travelHeavy]

const report = analyzePreviewRisks(layers, {
  maxVolumetricFlow: 10,
  temps: { nozzle: 210 },
  cooling: { fanOffLayers: 0 },
})
assert.ok(report.risks.some((risk) => risk.id === 'layer-1-flow' && risk.severity === 'hoch'))
assert.ok(report.risks.some((risk) => risk.id === 'layer-2-short-layer'))
assert.ok(report.risks.some((risk) => risk.id === 'layer-3-travel'))
assert.equal(report.highCount >= 2, true)

const segmentInfo = describePreviewSegment(layers, 1, 0, 10)
assert.ok(segmentInfo)
assert.equal(segmentInfo?.kind, 'sparse')
assert.equal(segmentInfo?.flow, 9.8)
assert.equal(segmentInfo?.length, 10)
assert.ok(Math.abs((segmentInfo?.flowReserve ?? 0) - 0.98) < 1e-9)
assert.equal(reserveHex(0), '#22c55e')
assert.equal(reserveHex(1), '#ef4444')
assert.deepEqual(previewFlowLimitInfo(18, 12.8), { limit: 18, source: 'profile' })
assert.deepEqual(previewFlowLimitInfo(0, 12.8), { limit: 12.8, source: 'measured' })
assert.deepEqual(previewFlowLimitInfo(undefined, 0), { limit: 0, source: 'none' })
assert.equal(previewFlowReserveLabel('profile'), 'Reserve zum Limit')
assert.equal(previewFlowReserveLabel('measured'), 'Reserve (gemessene Referenz)')
assert.equal(effectivePreviewFlowLimit(18, 12.8), 18)
assert.equal(effectivePreviewFlowLimit(0, 12.8), 12.8)
assert.equal(effectivePreviewFlowLimit(undefined, 0), 0)
const lineMappedLayer: PreviewLayer = { ...normal, lines: [42] }
assert.equal(describePreviewSegment([lineMappedLayer], 0, 0, 10)?.gcodeLine, 42)
const imported = analyzeGcode(
  ['; test', 'G28', 'M104 S210', 'G1 Z0.2 F600', ';LAYER:0', 'G1 X0 Y0 F3000', 'G1 X10 Y0 E1 F1200', 'G1 X20 Y0 E2 F1200'].join('\n'),
  { x: 220, y: 220, z: 250 },
  'corner',
)
assert.deepEqual(imported.layers[0]?.lines, [7, 8])
assert.equal(describePreviewSegment(imported.layers, 0, 0, 10)?.gcodeLine, 7)
assert.equal(previewFeatureColor(1), '#ff8a3d')
assert.equal(previewFeatureColor(1, 'accessible'), '#E69F00')

const outlierLayers = Array.from({ length: 100 }, (_, index) =>
  layer(
    (index + 1) * 0.2,
    segment(1, 0, 0, 600, 0, index === 99 ? 100000 : 50 + index, 5),
  ),
)
const robustRange = computePreviewRange(outlierLayers)
assert.ok(robustRange.speed[1] < 10000, 'Ein Rekordwert darf die robuste Skala nicht dominieren')

const current: SliceComparisonSide = {
  layers: [layer(0.2, segment(1, 0, 0, 600, 0, 20, 7)), normal],
  stats: {
    estimatedSeconds: 100,
    filamentMm: 2000,
    filamentGrams: 6,
    maxFlowMm3s: 7,
    layerCount: 2,
  },
}
const previous: SliceComparisonSide = {
  layers: [layer(0.2, segment(1, 0, 0, 400, 0, 20, 5)), normal],
  stats: {
    estimatedSeconds: 80,
    filamentMm: 1800,
    filamentGrams: 5.4,
    maxFlowMm3s: 5,
    layerCount: 2,
  },
}
const comparison = compareSliceResults(current, previous)
assert.equal(comparison.secondsDelta, 20)
assert.ok(Math.abs(comparison.gramsDelta - 0.6) < 1e-9)
assert.equal(comparison.flowDelta, 2)
assert.equal(comparison.layerDifferences[0]?.layerIndex, 0)
assert.equal(comparison.layerDifferences[0]?.secondsDelta, 10)
assert.equal(comparison.layerDifferences[0]?.flowDelta, 2)

const filterObject = {
  id: 'object-a',
  name: 'Objekt A',
  plate: 0,
  triangles: 12,
  size: { x: 10, y: 10, z: 5 },
  center: { x: 20, y: 20, z: 2.5 },
  placement: { visible: true },
} as ModelObjectInfo
const filter = buildPreviewFilterBounds([filterObject], 0)[0]
assert.equal(filter?.minX, 15)
assert.equal(segmentInsideFilter(segment(1, 18, 18, 22, 22, 50, 5), 0, filter), true)
assert.equal(segmentInsideFilter(segment(1, 50, 50, 60, 60, 50, 5), 0, filter), false)
const shiftedFilter = buildPreviewFilterBounds([filterObject], 0, 10)[0]
assert.equal(shiftedFilter?.minX, 5)
assert.equal(segmentInsideFilter(segment(1, 8, 18, 12, 22, 50, 5), 0, shiftedFilter), true)
// Die Studio-Vorschau liefert Segmentdaten in Bettkoordinaten, die Objektmitte
// dagegen im Modellkoordinatensystem. Bettmitte - modelCenter muss daher in
// die Filterfläche einfließen, sonst wird ein zentrierter Würfel komplett
// ausgeblendet.
const centeredObject = { ...filterObject, center: { x: 0, y: 0, z: 2.5 } }
const bedFilter = buildPreviewFilterBounds([centeredObject], 0, 0, 110, 110)[0]
assert.equal(bedFilter?.minX, 105)
assert.equal(bedFilter?.maxX, 115)
assert.equal(segmentInsideFilter(segment(1, 105, 105, 115, 115, 50, 5), 0, bedFilter), true)
assert.equal(segmentInsideFilter(segment(1, 50, 50, 60, 60, 50, 5), 0, bedFilter), false)
// Eine Leerfahrt von einem zweiten Objekt durch die Filterfläche darf nicht
// als vermeintliche Objektbahn stehen bleiben, nur weil ihr Mittelpunkt passt.
assert.equal(segmentInsideFilter(segment(10, 80, 110, 140, 110, 0, 0), 0, bedFilter), false)

const stats: SliceStats = {
  estimatedSeconds: 100,
  filamentMm: 2000,
  filamentGrams: 6,
  layerCount: layers.length,
  volumeCm3: 5,
  maxFlowMm3s: 9.8,
}
const reportText = buildPreviewReport({
  result: { layers, stats },
  report,
  comparison,
  layerIndex: 0,
  sourceName: 'Testwürfel',
  generatedAt: '2026-11-14 20:00',
})
assert.ok(reportText.includes('# Easy-Slicer Vorschaubericht'))
assert.ok(reportText.includes('## Problem-Schichten'))
assert.ok(reportText.includes('## Vergleich mit vorherigem Slice'))
assert.ok(reportText.includes('Testwürfel'))
assert.ok(
  reportText.includes(
    'Volumenstrom-Referenz: **9,8 mm³/s** (gemessener Spitzenfluss; kein Profil-Limit)',
  ),
  'Ohne Profil-Limit darf der Bericht den Spitzenfluss nicht als Profilgrenze ausgeben',
)
const profileReportText = buildPreviewReport({
  result: { layers, stats },
  settings: mergeSettings(DEFAULT_SETTINGS, { maxVolumetricFlow: 10 }),
  report,
  layerIndex: 0,
  generatedAt: '2026-11-14 20:00',
})
assert.ok(profileReportText.includes('Profilgrenze Volumenstrom: **10,0 mm³/s**'))
assert.ok(!profileReportText.includes('Volumenstrom-Referenz'))

const linePrinter = printerById('flashforge-ad5x')
const lineSettings = mergeSettings(DEFAULT_SETTINGS, {
  layerHeight: 0.2,
  firstLayerHeight: 0.2,
  topLayers: 2,
  bottomLayers: 1,
  adhesion: 'none',
  primeLine: { ...DEFAULT_SETTINGS.primeLine, enabled: false },
  ironing: { ...DEFAULT_SETTINGS.ironing, enabled: false },
})
const sliced = sliceMesh(parseSTL(demoSTL('wuerfel')), lineSettings, linePrinter, null, [], {})
const mappedLayer = sliced.layers.find((entry) => entry.lines?.length)
assert.ok(mappedLayer?.lines?.length, 'Geslicte Vorschau muss G-Code-Zeilen mitführen')
assert.equal(mappedLayer.lines.length * 12, mappedLayer.data.length)
const gcodeRows = sliced.gcode.split('\n')
for (const line of mappedLayer.lines.slice(0, 5)) {
  assert.match(gcodeRows[line - 1] ?? '', /^(?:N\d+\s+)?G[01]\b/, `Zeile ${line} muss eine Bewegung sein`)
}

console.log('Vorschau-Diagnose: Radar, Segment, Vergleich, Filter, robuste Skala, Bericht und G-Code-Zeilen sind konsistent.')
