import { useEffect, useMemo, useRef, useState } from 'react'
import {
  formatDuration,
  type CalibrationTool,
  type PreviewLayer,
  type PrintSettings,
  type SliceFeatureStats,
  type SliceStats,
} from '../../shared/types.ts'
import { PREVIEW_KIND_CODE } from '../../shared/preview.ts'
import type { PreviewSection, PreviewSegmentRef } from '../viewer/scene.ts'
import {
  analyzePreviewRisks,
  compareSliceResults,
  type PreviewRisk,
  type PreviewSegment,
} from '../viewer/previewDiagnostics.ts'
import {
  RESERVE_GRADIENT,
  RESERVE_GRADIENT_ACCESSIBLE,
  previewFlowLimitInfo,
  previewFlowReserveLabel,
  formatFeatureValue,
  previewFeatureColor,
  reserveHex,
  type PreviewPalette,
} from '../viewer/previewColors.ts'
import { buildPreviewReport } from '../viewer/previewReport.ts'
import type { PreviewFilterBounds } from '../viewer/previewFilters.ts'
import { FloatingPanelHandle } from './FloatingPanel.tsx'

type LabResult = {
  layers: PreviewLayer[]
  stats: SliceStats
  features?: SliceFeatureStats[]
}

type CompareData = {
  layers: PreviewLayer[]
  stats: Pick<
    SliceStats,
    'estimatedSeconds' | 'filamentMm' | 'filamentGrams' | 'maxFlowMm3s' | 'layerCount'
  >
}

type LabTab = 'radar' | 'playback' | 'filter' | 'compare' | 'section' | 'segment' | 'report'

type Props = {
  result: LabResult
  settings?: PrintSettings
  /** Aktiver Kalibriertest; geplante Stufenwerte gelten als Sollzustand. */
  calibration?: CalibrationTool | null
  layer: number
  onLayer: (index: number) => void
  compare: CompareData | null
  onCompare: () => void
  onClearCompare: () => void
  section: PreviewSection | null
  onSection: (section: PreviewSection | null) => void
  pick: PreviewSegmentRef | null
  segment: PreviewSegment | null
  inspect: boolean
  onInspect: (enabled: boolean) => void
  onClearPick: () => void
  bed: { x: number; y: number; z: number }
  filterObjects?: PreviewFilterBounds[]
  filterId?: string | null
  onFilter?: (id: string | null) => void
  activePlate?: number
  sourceName?: string
  palette?: PreviewPalette
  /** SCV ist nur auf Klipper wirksam; steuert den Tempo-Hinweis im Bericht. */
  scvActive?: boolean
  /** Optionaler Sprung in den G-Code-Editor; ohne Callback bleibt die Zeile nur lesbar. */
  onJumpToGcode?: (line: number) => void
}

const TABS: { id: LabTab; label: string; icon: string }[] = [
  { id: 'radar', label: 'Radar', icon: '◉' },
  { id: 'playback', label: 'Play', icon: '▶' },
  { id: 'filter', label: 'Filter', icon: '▣' },
  { id: 'compare', label: 'Vergleich', icon: '⇄' },
  { id: 'section', label: 'Schnitt', icon: '◧' },
  { id: 'segment', label: 'Segment', icon: '⌖' },
  { id: 'report', label: 'Bericht', icon: '▤' },
]

const SEVERITY_STYLE: Record<PreviewRisk['severity'], string> = {
  hoch: 'border-rose/40 bg-rose/10 text-rose',
  mittel: 'border-amber/40 bg-amber/10 text-amber',
  niedrig: 'border-sky/40 bg-sky/10 text-sky',
}

const SEVERITY_LABEL: Record<PreviewRisk['severity'], string> = {
  hoch: 'Hoch',
  mittel: 'Mittel',
  niedrig: 'Hinweis',
}

function value(value: number, digits = 1): string {
  return formatFeatureValue(Number.isFinite(value) ? value : 0, digits)
}

function signed(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—'
  const prefix = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${prefix}${formatFeatureValue(Math.abs(value), digits)}`
}

function deltaClass(value: number, inverse = false): string {
  if (Math.abs(value) < 1e-9) return 'text-white/45'
  const positive = inverse ? value < 0 : value > 0
  return positive ? 'text-rose' : 'text-mint'
}

function timeDelta(seconds: number): string {
  if (!Number.isFinite(seconds) || Math.abs(seconds) < 1) return '±0 s'
  return `${seconds > 0 ? '+' : '−'}${formatDuration(Math.abs(seconds))}`
}

function axisMax(axis: PreviewSection['axis'], bed: { x: number; y: number; z: number }, layerZ: number): number {
  if (axis === 'x') return Math.max(1, bed.x)
  if (axis === 'y') return Math.max(1, bed.y)
  return Math.max(1, layerZ)
}

function layerRangeText(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '<1 s'
  if (seconds < 60) return `${seconds.toFixed(1)} s`
  return formatDuration(seconds)
}

/**
 * Werkstatt für die Vorschau: Problem-Radar, Slice-Vergleich, Schnittansicht
 * und Segment-Steckbrief an einer Stelle. Die Komponente hält keinen
 * eigenen Slice-Zustand — sie liest nur die aktuelle Vorschau.
 */
export function PreviewLab({
  result,
  settings,
  calibration = null,
  layer,
  onLayer,
  compare,
  onCompare,
  onClearCompare,
  section,
  onSection,
  pick,
  segment,
  inspect,
  onInspect,
  onClearPick,
  bed,
  filterObjects,
  filterId = null,
  onFilter,
  activePlate = 0,
  sourceName,
  palette = 'standard',
  scvActive = false,
  onJumpToGcode,
}: Props) {
  const [tab, setTab] = useState<LabTab>('radar')
  const [open, setOpen] = useState(true)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(4)
  const [loop, setLoop] = useState(true)
  const [copied, setCopied] = useState<'copy' | 'error' | null>(null)
  const layerRef = useRef(layer)
  const onLayerRef = useRef(onLayer)
  layerRef.current = layer
  onLayerRef.current = onLayer
  const report = useMemo(
    () => analyzePreviewRisks(result.layers, settings, calibration),
    [result.layers, settings, calibration],
  )
  const comparison = useMemo(
    () => (compare ? compareSliceResults(result, compare) : null),
    [result, compare],
  )
  const flowLimit = previewFlowLimitInfo(settings?.maxVolumetricFlow, result.stats.maxFlowMm3s)
  const maxFlow = flowLimit.limit
  const lastZ = result.layers[result.layers.length - 1]?.z ?? 0
  const clampedLayer = Math.max(0, Math.min(result.layers.length - 1, layer))
  const visibleRisks = report.risks.slice(0, 12)
  const generatedAt = useMemo(() => new Date().toLocaleString('de-DE'), [result.layers.length])
  const reportText = useMemo(
    () =>
      buildPreviewReport({
        result,
        settings,
        report,
        comparison,
        layerIndex: clampedLayer,
        sourceName,
        generatedAt,
        calibration,
        scvActive,
      }),
    [result, settings, report, comparison, clampedLayer, sourceName, generatedAt, calibration, scvActive],
  )

  useEffect(() => {
    if (!playing) return
    if (result.layers.length < 2) {
      setPlaying(false)
      return
    }
    const delay = Math.max(30, Math.round(1000 / speed))
    const timer = window.setInterval(() => {
      const next = layerRef.current + 1
      if (next >= result.layers.length) {
        if (loop) onLayerRef.current(0)
        else setPlaying(false)
      } else {
        onLayerRef.current(next)
      }
    }, delay)
    return () => window.clearInterval(timer)
  }, [playing, speed, loop, result.layers.length])

  useEffect(() => {
    setPlaying(false)
  }, [result.layers.length])

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(reportText)
      setCopied('copy')
    } catch {
      setCopied('error')
    }
    window.setTimeout(() => setCopied(null), 1800)
  }

  const saveReport = () => {
    const blob = new Blob([reportText], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const name = (sourceName || 'Vorschau').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 48) || 'Vorschau'
    link.href = url
    link.download = `Easy-Slicer-${name}-Bericht.md`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pointer-events-auto mt-1.5 flex w-full items-center justify-between rounded-lg border border-line/60 bg-ink-950/80 px-2.5 py-1.5 text-[10px] text-white/55 shadow-lg backdrop-blur-md transition hover:border-mint/40 hover:text-white"
      >
        <span className="flex items-center gap-1.5">
          <span className="text-mint">◉</span>
          Vorschau-Werkstatt
        </span>
        <span className="text-white/30">öffnen</span>
      </button>
    )
  }

  // Beim Auswählen einer Bahn bleibt nur eine schmale Leiste stehen. Sonst
  // würde die Werkstatt genau die Modellmitte verdecken, in die geklickt
  // werden soll — besonders bei schmalem Vorschaufenster.
  if (tab === 'segment' && inspect && !segment) {
    return (
      <div className="pointer-events-auto overflow-hidden rounded-xl border border-amber/35 bg-ink-950/95 text-white shadow-2xl backdrop-blur-md">
        <div className="flex items-center gap-1.5 px-2.5 py-1.5">
          <FloatingPanelHandle label="Vorschau-Werkstatt" />
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber" />
          <span className="text-[10px] font-medium text-white/80">Segment prüfen</span>
          <button
            type="button"
            onClick={() => {
              onInspect(false)
              onClearPick()
              setOpen(false)
            }}
            className="ml-auto grid h-5 w-5 place-items-center rounded text-[13px] leading-none text-white/40 transition hover:bg-white/10 hover:text-white"
            aria-label="Segmentauswahl abbrechen"
          >
            ×
          </button>
        </div>
        <div className="flex items-center gap-2 border-t border-line/50 px-2.5 py-1.5">
          <p className="min-w-0 flex-1 text-[8px] leading-snug text-white/45">
            Eine sichtbare Bahn im 3D-Bild anklicken. Die Werkstatt tritt während der Auswahl zur Seite.
          </p>
          <button
            type="button"
            onClick={() => {
              onInspect(false)
              onClearPick()
            }}
            className="shrink-0 rounded border border-line/70 px-1.5 py-1 text-[8px] text-white/50 transition hover:border-rose/40 hover:text-rose"
          >
            Beenden
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="pointer-events-auto mt-1.5 overflow-hidden rounded-xl border border-line/70 bg-ink-950/95 text-white shadow-2xl backdrop-blur-md">
      <div className="flex items-center gap-1.5 border-b border-line/60 px-2.5 py-1.5">
        <FloatingPanelHandle label="Vorschau-Werkstatt" />
        <span className="h-1.5 w-1.5 rounded-full bg-sky shadow-[0_0_7px_rgba(96,165,250,0.7)]" />
        <span className="text-[10px] font-medium text-white/75">Vorschau-Werkstatt</span>
        {report.highCount > 0 && (
          <span className="rounded border border-rose/35 bg-rose/10 px-1 py-0.5 text-[8px] text-rose">
            {report.highCount} kritisch
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setPlaying(false)
            onInspect(false)
          }}
          className="ml-auto grid h-5 w-5 place-items-center rounded text-[13px] leading-none text-white/40 transition hover:bg-white/10 hover:text-white"
          aria-label="Vorschau-Werkstatt schließen"
        >
          ×
        </button>
      </div>

      <div className="grid grid-cols-4 gap-1 border-b border-line/50 p-1">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => {
              setTab(entry.id)
              if (entry.id !== 'playback') setPlaying(false)
              onInspect(entry.id === 'segment')
            }}
            className={`flex items-center justify-center gap-1 rounded px-1 py-1 text-[9px] transition ${
              tab === entry.id
                ? 'bg-mint/15 text-mint'
                : 'text-white/45 hover:bg-white/5 hover:text-white/75'
            }`}
            aria-pressed={tab === entry.id}
          >
            <span className="text-[10px]">{entry.icon}</span>
            {entry.label}
            {entry.id === 'radar' && report.risks.length > 0 && (
              <span className="tabular text-[8px] opacity-70">{report.risks.length}</span>
            )}
            {entry.id === 'compare' && compare && <span className="text-[8px] text-sky">•</span>}
            {entry.id === 'section' && section && <span className="text-[8px] text-amber">•</span>}
            {entry.id === 'segment' && pick && <span className="text-[8px] text-amber">•</span>}
          </button>
        ))}
      </div>

      {tab === 'radar' && (
        <div className="p-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[10px] font-medium text-white/70">Problem-Layer-Radar</div>
              <div className="text-[8px] text-white/30">
                {result.layers.length} Schichten · Median {layerRangeText(report.medianSeconds)}
              </div>
            </div>
            <div className="flex gap-1">
              <span className="rounded border border-rose/30 bg-rose/10 px-1 py-0.5 text-[8px] text-rose">
                {report.highCount} hoch
              </span>
              <span className="rounded border border-amber/30 bg-amber/10 px-1 py-0.5 text-[8px] text-amber">
                {report.mediumCount} mittel
              </span>
            </div>
          </div>

          {flowLimit.source !== 'profile' && (
            <div className="mt-1.5 rounded border border-sky/20 bg-sky/[0.04] px-1.5 py-1 text-[8px] leading-snug text-sky/70">
              {flowLimit.source === 'measured'
                ? `Kein Profil-Limit — die Durchfluss-Reserve wird nicht gegen eine Grenze bewertet. Legende und Bericht nutzen den gemessenen Spitzenfluss (${value(maxFlow, 1)} mm³/s) als Referenz.`
                : 'Kein Profil-Limit — die Durchfluss-Reserve wird nicht bewertet.'}
            </div>
          )}

          {calibration && calibration.steps.length > 0 && (
            <div className="mt-1.5 rounded border border-mint/20 bg-mint/[0.04] px-1.5 py-1 text-[8px] leading-snug text-mint/70">
              Kalibriertest aktiv: Geplante Temperatur- und Volumenstromstufen sind Sollwerte und kein Risiko.
              Echte Abweichungen vom Testplan bleiben als Warnung sichtbar.
            </div>
          )}

          <div className="mt-1.5 max-h-[210px] space-y-1 overflow-y-auto">
            {visibleRisks.length ? (
              visibleRisks.map((risk) => (
                <button
                  key={risk.id}
                  type="button"
                  onClick={() => onLayer(risk.layerIndex)}
                  className={`w-full rounded-md border px-1.5 py-1 text-left transition hover:brightness-110 ${
                    risk.layerIndex === clampedLayer
                      ? 'border-amber/50 bg-amber/[0.08]'
                      : 'border-line/60 bg-white/[0.025]'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`shrink-0 rounded border px-1 py-0.5 text-[7px] ${SEVERITY_STYLE[risk.severity]}`}>
                      {SEVERITY_LABEL[risk.severity]}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[9px] font-medium text-white/80">
                      {risk.title}
                    </span>
                    <span className="tabular shrink-0 text-[8px] text-amber/85">
                      {risk.layerEndIndex !== undefined && risk.layerEndIndex > risk.layerIndex
                        ? `L${risk.layerIndex + 1}–${risk.layerEndIndex + 1}`
                        : `L${risk.layerIndex + 1}`}
                    </span>
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[8px] leading-snug text-white/45">
                    {risk.detail}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[8px] leading-snug text-mint/65">
                    {risk.recommendation}
                  </div>
                </button>
              ))
            ) : (
              <div className="rounded-md border border-mint/20 bg-mint/[0.04] px-2 py-3 text-center text-[9px] text-mint/70">
                Keine auffälligen Schichten in den vorhandenen Bahndaten.
              </div>
            )}
          </div>
          {report.risks.length > visibleRisks.length && (
            <div className="mt-1 text-[8px] text-white/35">
              Zeigt {visibleRisks.length} von {report.risks.length} Hinweisen — im Bericht stehen alle.
            </div>
          )}
          <div className="mt-1 text-[8px] text-white/25">
            Klick auf einen Eintrag springt direkt zur betroffenen Schicht.
          </div>
        </div>
      )}

      {tab === 'playback' && (
        <div className="p-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[10px] font-medium text-white/70">Layer-Playback</div>
              <div className="text-[8px] text-white/30">
                Schichten automatisch durchlaufen · aktuell L{clampedLayer + 1} / {result.layers.length}
              </div>
            </div>
            <span className="tabular rounded border border-line/60 px-1 py-0.5 text-[8px] text-amber/80">
              z {value(result.layers[clampedLayer]?.z ?? lastZ, 2)} mm
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line/70">
            <div
              className="h-full rounded-full bg-mint transition-[width] duration-150"
              style={{ width: `${result.layers.length ? ((clampedLayer + 1) / result.layers.length) * 100 : 0}%` }}
            />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => {
                if (!playing) {
                  onInspect(false)
                  if (!loop && clampedLayer >= result.layers.length - 1) onLayer(0)
                }
                setPlaying((value) => !value)
              }}
              className={`rounded border px-2 py-1 text-[9px] transition ${
                playing
                  ? 'border-amber/55 bg-amber/15 text-amber'
                  : 'border-mint/45 bg-mint/10 text-mint hover:border-mint/70'
              }`}
            >
              {playing ? '❚❚ Pause' : '▶ Abspielen'}
            </button>
            <button
              type="button"
              onClick={() => {
                onLayer(0)
                setPlaying(true)
              }}
              className="rounded border border-line/70 px-1.5 py-1 text-[8px] text-white/45 transition hover:border-mint/40 hover:text-white/75"
            >
              Von vorn
            </button>
            <label className="ml-auto flex items-center gap-1 text-[8px] text-white/35">
              Tempo
              <select
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                className="rounded border border-line/70 bg-ink-900 px-1 py-0.5 text-[8px] text-white/70 outline-none"
                aria-label="Playback-Geschwindigkeit"
              >
                {[1, 2, 4, 8, 12].map((entry) => (
                  <option key={entry} value={entry}>
                    {entry} Layer/s
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 text-[8px] text-white/40">
            <input
              type="checkbox"
              checked={loop}
              onChange={(e) => setLoop(e.target.checked)}
              className="accent-mint"
            />
            Am Ende wieder von vorn beginnen
          </label>
          <p className="mt-1 text-[8px] leading-snug text-white/25">
            Playback bewegt nur die Vorschau. Es startet keinen Druck und verändert keine Slice-Daten.
          </p>
        </div>
      )}

      {tab === 'filter' && (
        <div className="p-2">
          <div className="text-[10px] font-medium text-white/70">Objekt- und Plattenfilter</div>
          <div className="text-[8px] text-white/30">
            Platte {activePlate + 1} · {filterObjects?.length ?? 0} sichtbare Objekte im Slice
          </div>
          {filterObjects?.length ? (
            <>
              <select
                value={filterId ?? ''}
                onChange={(event) => onFilter?.(event.target.value || null)}
                className="mt-1.5 w-full rounded-md border border-line/70 bg-ink-900 px-1.5 py-1 text-[9px] text-white/75 outline-none focus:border-sky/60"
                aria-label="Objektfilter der Vorschau"
              >
                <option value="">Alle Objekte auf dieser Platte</option>
                {filterObjects.map((object) => (
                  <option key={object.id} value={object.id}>
                    {object.label}
                  </option>
                ))}
              </select>
              {filterId && (
                <div className="mt-1.5 flex items-center justify-between gap-2 rounded border border-sky/25 bg-sky/[0.05] px-1.5 py-1 text-[8px] text-sky/80">
                  <span className="truncate">
                    Nur {filterObjects.find((entry) => entry.id === filterId)?.label ?? 'Objekt'}
                  </span>
                  <button
                    type="button"
                    onClick={() => onFilter?.(null)}
                    className="shrink-0 text-white/45 transition hover:text-rose"
                  >
                    zurücksetzen
                  </button>
                </div>
              )}
              <p className="mt-1.5 text-[8px] leading-snug text-white/30">
                Der Filter blendet Bahnen aus, deren Endpunkte außerhalb der Objektfläche liegen. Andere Platten werden separat geslict.
              </p>
            </>
          ) : (
            <div className="mt-1.5 rounded border border-dashed border-line/60 px-2 py-3 text-center text-[8px] text-white/35">
              Für diese G-Code-Vorschau liegen keine Objektinformationen vor. Der Plattenfilter ist nur in der Studio-Vorschau verfügbar.
            </div>
          )}
        </div>
      )}

      {tab === 'compare' && (
        <div className="p-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[10px] font-medium text-white/70">Slice-Ergebnis vergleichen</div>
              <div className="text-[8px] text-white/30">
                {compare ? 'Vorher blau, aktuell in der gewählten Farbe' : 'Noch kein Vergleich gespeichert'}
              </div>
            </div>
            {compare && (
              <button
                type="button"
                onClick={onClearCompare}
                className="rounded border border-line/70 px-1.5 py-0.5 text-[8px] text-white/45 transition hover:border-rose/40 hover:text-rose"
              >
                löschen
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onCompare}
            className="mt-1.5 w-full rounded-md border border-sky/30 bg-sky/[0.07] px-1.5 py-1 text-[9px] text-sky transition hover:border-sky/55 hover:bg-sky/10"
          >
            {compare ? 'Aktuellen Stand als neuen Vergleich merken' : 'Aktuellen Stand als Vergleich merken'}
          </button>

          {comparison ? (
            <>
              <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_58px_58px] gap-x-1 gap-y-0.5 text-[8px]">
                <span className="text-white/30">Kennzahl</span>
                <span className="text-right text-white/35">Vorher</span>
                <span className="text-right text-white/35">Jetzt</span>
                <span className="text-white/45">Druckzeit</span>
                <span className="tabular text-right text-white/60">
                  {formatDuration(comparison.previous.stats.estimatedSeconds)}
                </span>
                <span className="tabular text-right text-white/80">
                  {formatDuration(comparison.current.stats.estimatedSeconds)}
                </span>
                <span className="text-white/45">Delta Zeit</span>
                <span className="col-span-2 tabular text-right font-medium">
                  <span className={deltaClass(comparison.secondsDelta, true)}>
                    {timeDelta(comparison.secondsDelta)}
                  </span>
                </span>
                <span className="text-white/45">Filament</span>
                <span className="tabular text-right text-white/60">
                  {value(comparison.previous.stats.filamentGrams, 2)} g
                </span>
                <span className="tabular text-right text-white/80">
                  {value(comparison.current.stats.filamentGrams, 2)} g
                </span>
                <span className="text-white/45">Delta Material</span>
                <span className="col-span-2 tabular text-right">
                  <span className={deltaClass(comparison.gramsDelta, true)}>
                    {signed(comparison.gramsDelta, 2)} g
                  </span>
                </span>
                <span className="text-white/45">Max. Volumenstrom</span>
                <span className="tabular text-right text-white/60">
                  {value(comparison.previous.stats.maxFlowMm3s)} mm³/s
                </span>
                <span className="tabular text-right text-white/80">
                  {value(comparison.current.stats.maxFlowMm3s)} mm³/s
                </span>
                <span className="text-white/45">Schichten</span>
                <span className="tabular text-right text-white/60">
                  {comparison.previous.stats.layerCount}
                </span>
                <span className="tabular text-right text-white/80">
                  {comparison.current.stats.layerCount}
                </span>
              </div>

              <div className="mt-1.5 rounded border border-line/60 bg-white/[0.02] px-1.5 py-1 text-[8px] text-white/40">
                Layer synchron: <span className="tabular text-amber/85">L{clampedLayer + 1}</span> /{' '}
                {comparison.current.layers.length} ↔{' '}
                {comparison.previous.layers.length}
              </div>

              {comparison.layerDifferences.length > 0 && (
                <div className="mt-1.5">
                  <div className="mb-0.5 text-[8px] uppercase tracking-wide text-white/30">
                    Größte Schichtunterschiede
                  </div>
                  <div className="max-h-[130px] space-y-0.5 overflow-y-auto">
                    {comparison.layerDifferences.map((entry) => (
                      <button
                        key={entry.layerIndex}
                        type="button"
                        onClick={() => onLayer(entry.layerIndex)}
                        className="flex w-full items-center gap-1 rounded border border-line/50 px-1 py-0.5 text-left text-[8px] hover:border-amber/40"
                      >
                        <span className="tabular w-9 shrink-0 text-amber/80">L{entry.layerIndex + 1}</span>
                        <span className={`tabular w-16 shrink-0 ${deltaClass(entry.secondsDelta, true)}`}>
                          {entry.secondsDelta > 0 ? '+' : '−'}
                          {Math.abs(entry.secondsDelta).toFixed(1)} s
                        </span>
                        <span className={`tabular truncate ${deltaClass(entry.flowDelta, true)}`}>
                          Fluss {signed(entry.flowDelta)} mm³/s
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="mt-1.5 text-[8px] leading-snug text-white/35">
              Nach dem nächsten Slicen bleiben beide Ergebnisse hier vergleichbar — Layernavigation und 3D-Ansicht laufen synchron.
            </p>
          )}
        </div>
      )}

      {tab === 'section' && (
        <div className="p-2">
          <div className="text-[10px] font-medium text-white/70">Röntgen- und Schnittansicht</div>
          <div className="text-[8px] leading-snug text-white/30">
            Öffnet Wände, Füllung und Hohlräume entlang einer Ebene. Die Schnittkante liegt in Bettkoordinaten.
          </div>
          <div className="mt-1.5 grid grid-cols-3 gap-1">
            {(['x', 'y', 'z'] as const).map((axis) => {
              const max = axisMax(axis, bed, lastZ)
              const active = section?.axis === axis
              return (
                <button
                  key={axis}
                  type="button"
                  onClick={() => onSection(active ? null : { axis, position: max / 2 })}
                  className={`rounded border px-1 py-1 text-[9px] transition ${
                    active
                      ? 'border-amber/60 bg-amber/15 text-amber'
                      : 'border-line/70 text-white/50 hover:border-amber/35 hover:text-white/75'
                  }`}
                >
                  {axis.toUpperCase()} · {active ? 'an' : 'schneiden'}
                </button>
              )
            })}
          </div>
          {section ? (
            <div className="mt-2 rounded border border-amber/20 bg-amber/[0.04] px-1.5 py-1.5">
              <div className="flex items-center justify-between text-[8px] text-white/45">
                <span>Position {section.axis.toUpperCase()}</span>
                <span className="tabular text-amber/90">
                  {value(section.position, 1)} / {value(axisMax(section.axis, bed, lastZ), 1)} mm
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={axisMax(section.axis, bed, lastZ)}
                step={0.5}
                value={Math.min(section.position, axisMax(section.axis, bed, lastZ))}
                onChange={(e) => onSection({ ...section, position: Number(e.target.value) })}
                className="mt-1 w-full accent-amber"
                aria-label={`Schnittebene ${section.axis.toUpperCase()}`}
              />
              <div className="mt-1 flex justify-between text-[8px] text-white/25">
                <span>0 mm</span>
                <button
                  type="button"
                  onClick={() => onSection(null)}
                  className="text-white/45 transition hover:text-rose"
                >
                  Schnitt ausblenden
                </button>
                <span>{value(axisMax(section.axis, bed, lastZ), 0)} mm</span>
              </div>
            </div>
          ) : (
            <p className="mt-1.5 text-[8px] leading-snug text-white/35">
              Tipp: Für Innenwände zuerst „Alle Layer“ einblenden und dann X oder Y wählen. Die Außenhaut wird mitgeschnitten.
            </p>
          )}
        </div>
      )}

      {tab === 'segment' && (
        <div className="p-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[10px] font-medium text-white/70">Segment-Steckbrief</div>
              <div className="text-[8px] text-white/30">
                {inspect ? 'Eine Linie im 3D-Bild anklicken' : 'Auswahlmodus ist aus'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                onInspect(!inspect)
                if (inspect) onClearPick()
              }}
              className={`rounded border px-1.5 py-0.5 text-[8px] transition ${
                inspect
                  ? 'border-amber/55 bg-amber/15 text-amber'
                  : 'border-line/70 text-white/45 hover:border-amber/40 hover:text-white/75'
              }`}
            >
              {inspect ? 'Auswahl beenden' : 'Segment prüfen'}
            </button>
          </div>
          {inspect && !segment && (
            <div className="mt-1.5 rounded border border-dashed border-amber/25 bg-amber/[0.04] px-2 py-3 text-center text-[8px] text-white/40">
              Klicke auf eine sichtbare Bahn. Der nächste Strich wird mit allen Bahnwerten angezeigt.
            </div>
          )}
          {segment ? (
            <div className="mt-1.5 rounded border border-line/60 bg-white/[0.025] p-1.5">
              <div className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-[1px]"
                  style={{ backgroundColor: previewFeatureColor(PREVIEW_KIND_CODE[segment.kind], palette) }}
                />
                <span className="text-[10px] font-medium text-white/80">{segment.label}</span>
                <span className="tabular ml-auto text-[8px] text-amber/85">
                  L{segment.layerIndex + 1} · z {value(segment.z, 2)} mm
                </span>
              </div>
              <div className="mt-1 grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-x-2 gap-y-0.5 text-[8px] leading-snug">
                <span className="text-white/35">Länge</span>
                <span className="tabular text-right text-white/75">{value(segment.length, 2)} mm</span>
                <span className="text-white/35">Bahnzeit</span>
                <span className="tabular text-right text-white/75">{layerRangeText(segment.seconds)}</span>
                <span className="text-white/35">Geschwindigkeit</span>
                <span className="tabular text-right text-white/75">{value(segment.speed, 0)} mm/s</span>
                <span className="text-white/35">Volumenstrom</span>
                <span className="tabular text-right text-white/75">{value(segment.flow, 1)} mm³/s</span>
                {segment.flowReserve !== null && (
                  <>
                    <span
                      className="text-white/35"
                      title={
                        flowLimit.source === 'profile'
                          ? 'Reserve bis zur Profilgrenze'
                          : 'Kein Profil-Limit: Bezug ist der gemessene Spitzenfluss (gemessene Referenz).'
                      }
                    >
                      {previewFlowReserveLabel(flowLimit.source)}
                    </span>
                    <span className="tabular text-right" style={{ color: reserveHex(segment.flowReserve, palette) }}>
                      {Math.max(0, Math.round((1 - segment.flowReserve) * 100))} %
                    </span>
                  </>
                )}
                <span className="text-white/35">Temperatur</span>
                <span className="tabular text-right text-white/75">{value(segment.temperature, 0)} °C</span>
                <span className="text-white/35">Beschleunigung</span>
                <span className="tabular text-right text-white/75">{value(segment.acceleration, 0)} mm/s²</span>
                <span className="text-white/35">Linienbreite</span>
                <span className="tabular text-right text-white/75">{value(segment.width, 2)} mm</span>
                <span className="text-white/35">Lüfter</span>
                <span className="tabular text-right text-white/75">{value(segment.fan, 0)} %</span>
                <span className="text-white/35">Pressure Advance</span>
                <span className="tabular text-right text-white/75">{value(segment.pressureAdvance, 3)}</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-line/40 pt-1 text-[8px] text-white/25">
                {segment.gcodeLine !== null ? (
                  onJumpToGcode ? (
                    <button
                      type="button"
                      onClick={() => onJumpToGcode(segment.gcodeLine!)}
                      className="truncate text-sky/75 transition hover:text-sky"
                      title="Zur passenden Zeile im G-Code springen"
                    >
                      G-Code öffnen · Zeile {segment.gcodeLine}
                    </button>
                  ) : (
                    <span className="truncate">G-Code-Zeile {segment.gcodeLine}</span>
                  )
                ) : (
                  <span className="truncate">G-Code-Zeile: nicht zugeordnet</span>
                )}
                <div className="flex shrink-0 items-center gap-2">
                  {segment.layerIndex !== clampedLayer && (
                    <button
                      type="button"
                      onClick={() => onLayer(segment.layerIndex)}
                      className="text-amber/75 transition hover:text-amber"
                    >
                      Zu Layer
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onClearPick}
                    className="text-white/45 transition hover:text-rose"
                  >
                    Auswahl aufheben
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-1.5 text-[8px] leading-snug text-white/35">
              Der Steckbrief zeigt exakte Werte des gewählten Segments. Bei vorhandener Zeilenzuordnung erscheint dort ein direkter Sprung in den G-Code.
            </p>
          )}
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="text-[8px] text-white/30">Reserve-Skala</span>
            <span
              className="h-2 flex-1 rounded border border-white/10"
              style={{
                background: `linear-gradient(90deg, ${(
                  palette === 'accessible' ? RESERVE_GRADIENT_ACCESSIBLE : RESERVE_GRADIENT
                ).join(', ')})`,
              }}
            />
            <span className="tabular text-[8px] text-white/35">
              {flowLimit.source === 'profile'
                ? `Limit ${value(maxFlow, 1)} mm³/s`
                : flowLimit.source === 'measured'
                  ? `Messreferenz ${value(maxFlow, 1)} mm³/s`
                  : 'Kein Profil-Limit'}
            </span>
          </div>
          {flowLimit.source === 'measured' && (
            <div className="mt-1 text-[8px] leading-snug text-white/30">
              Kein Profil-Limit — gemessene Referenz ist der höchste gemessene Fluss; rechts endet die Skala bei 0 % Reserve.
            </div>
          )}
        </div>
      )}

      {tab === 'report' && (
        <div className="p-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[10px] font-medium text-white/70">Vorschaubericht</div>
              <div className="text-[8px] text-white/30">
                Markdown zum Teilen · {result.layers.length} Schichten · {report.risks.length} Hinweise
              </div>
            </div>
            <span className="rounded border border-line/60 px-1 py-0.5 text-[7px] text-white/35">
              lokal
            </span>
          </div>
          <div className="mt-1.5 flex gap-1">
            <button
              type="button"
              onClick={() => void copyReport()}
              className="flex-1 rounded border border-mint/35 bg-mint/[0.07] px-1.5 py-1 text-[8px] text-mint/85 transition hover:border-mint/60"
            >
              {copied === 'copy' ? 'kopiert' : copied === 'error' ? 'Kopieren fehlgeschlagen' : 'Bericht kopieren'}
            </button>
            <button
              type="button"
              onClick={saveReport}
              className="flex-1 rounded border border-line/70 px-1.5 py-1 text-[8px] text-white/55 transition hover:border-sky/50 hover:text-sky"
            >
              Als .md speichern
            </button>
          </div>
          <pre className="mt-1.5 max-h-[230px] overflow-auto whitespace-pre-wrap rounded border border-line/60 bg-black/20 p-1.5 text-[8px] leading-snug text-white/55">
            {reportText}
          </pre>
          <p className="mt-1 text-[8px] leading-snug text-white/25">
            Der Bericht enthält nur lokale Vorschauwerte; er startet keinen Druck und lädt nichts hoch.
          </p>
        </div>
      )}
    </div>
  )
}
