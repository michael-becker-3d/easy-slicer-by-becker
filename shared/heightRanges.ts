import { mergeSettings, type DeepPartial, type HeightRangeModifier, type PrintSettings } from './types.ts'

/** Erster passender Höhenbereich; `to` ist exklusiv. */
export function heightRangeAt(ranges: HeightRangeModifier[] | undefined, z: number): HeightRangeModifier | null {
  if (!Array.isArray(ranges) || !Number.isFinite(z)) return null
  for (const range of ranges) {
    const from = Number(range.from)
    const to = Number(range.to)
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue
    if (z >= from && z < to) return range
  }
  return null
}

/**
 * Wendet den ersten passenden Höhenbereich auf eine vollständige
 * Einstellungsbasis an. Die Funktion ist bewusst frei von Geometrie, damit
 * Vorschau, Writer und Slice-Planung dieselben Werte sehen.
 */
export function heightRangeSettings(base: PrintSettings, z: number): PrintSettings {
  const range = heightRangeAt(base.heightRanges, z)
  if (!range) return base
  const patch = range.patch ?? {}
  const out: DeepPartial<PrintSettings> = {}

  if (Number.isFinite(patch.flow) && (patch.flow as number) > 0) {
    out.flow = Math.max(0.05, Math.min(3, patch.flow as number))
  }
  // Der Vasenmodus ist eine feste Druckstrategie: Eine Wand und keine
  // Füllung dürfen auch ein Höhenbereich nicht aufbrechen.
  if (base.special?.vase !== true) {
    if (Number.isFinite(patch.walls)) out.walls = Math.max(0, Math.min(8, Math.round(patch.walls as number)))
    if (Number.isFinite(patch.infillDensity)) {
      out.infillDensity = Math.max(0, Math.min(100, patch.infillDensity as number))
    }
  }

  if (Number.isFinite(patch.lineWidthFactor) && (patch.lineWidthFactor as number) > 0) {
    const factor = Math.max(0.5, Math.min(2, patch.lineWidthFactor as number))
    const width = (value: number) => (Number.isFinite(value) && value > 0 ? value * factor : value)
    out.lineWidth = width(base.lineWidth)
    out.firstLayerLineWidth = width(base.firstLayerLineWidth)
    out.outerWallLineWidth = width(base.outerWallLineWidth)
    out.innerWallLineWidth = width(base.innerWallLineWidth)
    out.topSurfaceLineWidth = width(base.topSurfaceLineWidth)
  }

  if (Number.isFinite(patch.speedFactor) && (patch.speedFactor as number) > 0) {
    const factor = Math.max(0.1, Math.min(3, patch.speedFactor as number))
    const speeds = Object.fromEntries(
      Object.entries(base.speeds).map(([key, value]) => [key, Math.max(5, Math.round(value * factor))]),
    ) as PrintSettings['speeds']
    out.speeds = speeds
  }

  return mergeSettings(base, out)
}

/** Kurztext für Slice-Bericht und UI-Zusammenfassung. */
export function describeHeightRange(range: HeightRangeModifier): string {
  const parts: string[] = []
  const p = range.patch ?? {}
  if (p.speedFactor !== undefined) parts.push(`Tempo ×${p.speedFactor.toFixed(2)}`)
  if (p.flow !== undefined) parts.push(`Fluss ×${p.flow.toFixed(2)}`)
  if (p.lineWidthFactor !== undefined) parts.push(`Linie ×${p.lineWidthFactor.toFixed(2)}`)
  if (p.walls !== undefined) parts.push(`${p.walls} Wände`)
  if (p.infillDensity !== undefined) parts.push(`${p.infillDensity} % Füllung`)
  return parts.length ? parts.join(' · ') : 'keine Änderung'
}