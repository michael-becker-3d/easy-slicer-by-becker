import {
  formatDuration,
  type CalibrationTool,
  type PreviewLayer,
  type PrintSettings,
  type SliceFeatureStats,
  type SliceStats,
} from '../../shared/types.ts'
import { PREVIEW_STRIDE } from '../../shared/types.ts'
import type { PreviewRiskReport, SliceComparison } from './previewDiagnostics.ts'
import { previewFlowLimitInfo } from './previewColors.ts'
import { buildCalibrationPlan, calibrationSpeedHint } from './calibrationPlan.ts'

export type PreviewReportInput = {
  result: {
    layers: PreviewLayer[]
    stats: SliceStats
    features?: SliceFeatureStats[]
  }
  settings?: PrintSettings
  report: PreviewRiskReport
  comparison?: SliceComparison | null
  layerIndex: number
  sourceName?: string
  generatedAt?: string
  /** Aktiver Kalibriertest; ergänzt den Tempo-Hinweis im Bericht. */
  calibration?: CalibrationTool | null
  /** SCV wirkt nur auf Klipper. */
  scvActive?: boolean
}

function number(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits).replace('.', ',') : '—'
}

function grams(value: number): string {
  return `${number(value, 2)} g`
}

function layerValues(layer: PreviewLayer | undefined): { segments: number; seconds: number; maxFlow: number } {
  if (!layer) return { segments: 0, seconds: 0, maxFlow: 0 }
  let segments = 0
  let seconds = 0
  let maxFlow = 0
  for (let k = 0; k + PREVIEW_STRIDE - 1 < layer.data.length; k += PREVIEW_STRIDE) {
    segments += 1
    const speed = layer.data[k + 5]
    if (speed > 0) {
      seconds += Math.hypot(layer.data[k + 3] - layer.data[k + 1], layer.data[k + 4] - layer.data[k + 2]) / speed
    }
    if (layer.data[k] !== 10 && Number.isFinite(layer.data[k + 6])) {
      maxFlow = Math.max(maxFlow, layer.data[k + 6])
    }
  }
  return { segments, seconds, maxFlow }
}

function severityLabel(severity: string): string {
  if (severity === 'hoch') return 'Hoch'
  if (severity === 'mittel') return 'Mittel'
  return 'Hinweis'
}

function riskLayerLabel(risk: PreviewRiskReport['risks'][number]): string {
  if (risk.layerEndIndex !== undefined && risk.layerEndIndex > risk.layerIndex) {
    return `${risk.layerIndex + 1}–${risk.layerEndIndex + 1}`
  }
  return `${risk.layerIndex + 1}`
}

/**
 * Erzeugt einen lesbaren Markdown-Bericht aus der Vorschau. Der Bericht ist
 * bewusst rein clientseitig und enthält keine Druck- oder Upload-Aktion.
 */
export function buildPreviewReport(input: PreviewReportInput): string {
  const { result, settings, report, comparison, layerIndex, sourceName, calibration, scvActive = false } = input
  const currentLayer = result.layers[layerIndex]
  const current = layerValues(currentLayer)
  const flowLimit = previewFlowLimitInfo(settings?.maxVolumetricFlow, result.stats.maxFlowMm3s)
  const calibrationPlan = calibration?.steps.length
    ? buildCalibrationPlan(calibration, result.layers, layerIndex, result.layers.length)
    : null
  const speedHint = calibrationPlan
    ? calibrationSpeedHint(calibrationPlan, calibration!.id, settings, scvActive)
    : null
  const lines: string[] = []
  const generatedAt = input.generatedAt ?? new Date().toLocaleString('de-DE')

  lines.push('# Easy-Slicer Vorschaubericht')
  lines.push('')
  lines.push(`Erstellt: ${generatedAt}`)
  if (sourceName) lines.push(`Quelle: ${sourceName}`)
  lines.push('')
  lines.push('## Übersicht')
  lines.push('')
  lines.push(`- Schichten: **${result.layers.length}**`)
  lines.push(`- Druckzeit (geschätzt): **${formatDuration(result.stats.estimatedSeconds)}**`)
  lines.push(`- Filament: **${number(result.stats.filamentMm / 1000, 2)} m / ${grams(result.stats.filamentGrams)}**`)
  lines.push(`- Max. Volumenstrom: **${number(result.stats.maxFlowMm3s)} mm³/s**`)
  if (flowLimit.source === 'profile') {
    lines.push(`- Profilgrenze Volumenstrom: **${number(flowLimit.limit)} mm³/s**`)
  } else if (flowLimit.source === 'measured') {
    lines.push(
      `- Volumenstrom-Referenz: **${number(flowLimit.limit)} mm³/s** (gemessener Spitzenfluss; kein Profil-Limit)`,
    )
  } else {
    lines.push('- Volumenstrom-Referenz: **keine** (kein Profil-Limit; Reserve nicht bewertet)')
  }
  if (settings) {
    const layerHeight = settings.adaptiveLayerHeight?.enabled
      ? `${number(settings.adaptiveLayerHeight.minHeight, 2)}–${number(settings.adaptiveLayerHeight.maxHeight, 2)} mm (adaptiv)`
      : `${number(settings.layerHeight, 2)} mm`
    lines.push(`- Schichthöhe: **${layerHeight}**`)
    lines.push(`- Düse / Bett: **${number(settings.temps.nozzle, 0)} / ${number(settings.temps.bed, 0)} °C**`)
    lines.push(`- Wände / Deck / Boden: **${settings.walls} / ${settings.topLayers} / ${settings.bottomLayers}**`)
  }
  lines.push('')

  if (speedHint) {
    lines.push('## Kalibrier-Tempo')
    lines.push('')
    lines.push(speedHint.text)
    if (speedHint.limitedStages.length) {
      lines.push('')
      lines.push('Im Slice unter dem Sollwert:')
      for (const stage of speedHint.limitedStages) {
        lines.push(
          `- Stufe ${stage.index + 1} (${stage.label}): **${number(stage.observed, 0)} statt ${number(stage.expected, 0)} mm/s**`,
        )
      }
    }
    lines.push('')
  }

  if (currentLayer) {
    lines.push('## Aktive Schicht')
    lines.push('')
    lines.push(`- Schicht: **${layerIndex + 1} / ${result.layers.length}**`)
    lines.push(`- z: **${number(currentLayer.z, 2)} mm**`)
    lines.push(`- Segmente: **${current.segments}**`)
    lines.push(`- Bahnzeit: **${number(current.seconds, 1)} s**`)
    lines.push(`- Max. Fluss: **${number(current.maxFlow)} mm³/s**`)
    lines.push('')
  }

  lines.push('## Problem-Schichten')
  lines.push('')
  if (!report.risks.length) {
    lines.push('Keine auffälligen Schichten in den vorhandenen Bahndaten.')
  } else {
    lines.push('| Schwere | Schicht | z | Befund | Maßnahme |')
    lines.push('| --- | ---: | ---: | --- | --- |')
    for (const risk of report.risks.slice(0, 8)) {
      lines.push(
        `| ${severityLabel(risk.severity)} | ${riskLayerLabel(risk)} | ${number(risk.z, 2)} mm | ${risk.title}: ${risk.detail} | ${risk.recommendation} |`,
      )
    }
  }
  lines.push('')

  if (comparison) {
    lines.push('## Vergleich mit vorherigem Slice')
    lines.push('')
    lines.push(`- Zeitdifferenz: **${comparison.secondsDelta >= 0 ? '+' : '−'}${formatDuration(Math.abs(comparison.secondsDelta))}**`)
    lines.push(`- Materialdifferenz: **${comparison.gramsDelta >= 0 ? '+' : '−'}${grams(Math.abs(comparison.gramsDelta))}**`)
    lines.push(`- Max.-Fluss-Differenz: **${comparison.flowDelta >= 0 ? '+' : '−'}${number(Math.abs(comparison.flowDelta))} mm³/s**`)
    lines.push(`- Schichtdifferenz: **${comparison.layerCountDelta >= 0 ? '+' : ''}${comparison.layerCountDelta}**`)
    if (comparison.layerDifferences.length) {
      lines.push('')
      lines.push('Größte Schichtunterschiede:')
      for (const entry of comparison.layerDifferences.slice(0, 5)) {
        lines.push(
          `- Schicht ${entry.layerIndex + 1}: ${entry.secondsDelta >= 0 ? '+' : '−'}${number(Math.abs(entry.secondsDelta), 1)} s, Fluss ${entry.flowDelta >= 0 ? '+' : '−'}${number(Math.abs(entry.flowDelta))} mm³/s`,
        )
      }
    }
    lines.push('')
  }

  lines.push('---')
  lines.push('Erzeugt aus der lokalen Easy-Slicer-Vorschau; keine Druck- oder Upload-Aktion.')
  return lines.join('\n')
}
