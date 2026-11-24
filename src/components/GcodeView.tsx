import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GcodeAnalysis, GcodeConversion } from '../../shared/gcode-import.ts'
import type { GcodeFlavor, PreviewFeatureKind } from '../../shared/types.ts'
import { formatDuration } from '../../shared/types.ts'
import { flavorLabel, GCODE_FLAVORS } from '../../shared/gcode-flavors.ts'
import * as api from '../api.ts'
import { saveGcodeAs } from '../saveGcode.ts'
import { Viewport } from '../viewer/Viewport.tsx'
import { PreviewLegend } from './PreviewLegend.tsx'
import type { PreviewColorMode, PreviewPalette } from '../viewer/previewColors.ts'
import { describePreviewSegment } from '../viewer/previewDiagnostics.ts'
import type { PreviewSection, PreviewSegmentRef } from '../viewer/scene.ts'
import { PreviewLab } from './PreviewLab.tsx'
import { FloatingPanel } from './FloatingPanel.tsx'
import { Chip } from './ui.tsx'

type Props = {
  bed: { x: number; y: number; z: number }
  printerName: string
  origin: 'corner' | 'center'
  /** Einmaliger Import aus der Studio-Vorschau samt Zielzeile. */
  initialRequest?: { gcode: string; name: string; line: number } | null
  onInitialConsumed?: () => void
}

const MAX_GCODE_BYTES = 200 * 1024 * 1024
const SEARCH_LIMIT_CHARS = 8_000_000
const SEARCH_MAX_HITS = 5000
const LINE_COUNT_LIMIT = 4_000_000
const CURSOR_LINE_LIMIT = 4_000_000

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function num(value: number, digits = 1): string {
  return value.toFixed(digits).replace('.', ',')
}

function targetFor(dialect: GcodeAnalysis['dialect']): GcodeFlavor {
  return dialect === 'klipper' ? 'marlin2' : 'klipper'
}

function lineNumberAt(text: string, offset: number): number {
  const end = Math.max(0, Math.min(offset, text.length))
  let line = 1
  for (let index = 0; index < end; index++) {
    if (text.charCodeAt(index) === 10) line++
  }
  return line
}

function offsetForLine(text: string, line: number): number {
  if (line <= 1) return 0
  let offset = 0
  for (let current = 1; current < line; current++) {
    const next = text.indexOf('\n', offset)
    if (next < 0) return text.length
    offset = next + 1
  }
  return offset
}

export function GcodeView({ bed, printerName, origin, initialRequest, onInitialConsumed }: Props) {
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [analysis, setAnalysis] = useState<GcodeAnalysis | null>(null)
  const [conversion, setConversion] = useState<GcodeConversion | null>(null)
  const [pendingConversion, setPendingConversion] = useState<GcodeConversion | null>(null)
  const [toFlavor, setToFlavor] = useState<GcodeFlavor>('klipper')
  const [layer, setLayer] = useState(0)
  const [showAll, setShowAll] = useState(true)
  const [colorMode, setColorMode] = useState<PreviewColorMode>('kind')
  const [palette, setPalette] = useState<PreviewPalette>('standard')
  const [hiddenFeatures, setHiddenFeatures] = useState<PreviewFeatureKind[]>([])
  const [compareAnalysis, setCompareAnalysis] = useState<GcodeAnalysis | null>(null)
  const [previewSection, setPreviewSection] = useState<PreviewSection | null>(null)
  const [previewPick, setPreviewPick] = useState<PreviewSegmentRef | null>(null)
  const [previewInspect, setPreviewInspect] = useState(false)
  const [busy, setBusy] = useState<'load' | 'analyze' | 'convert' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findIndex, setFindIndex] = useState(-1)
  const [cursorLine, setCursorLine] = useState<number | null>(1)
  const [pendingJumpLine, setPendingJumpLine] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const onInitialConsumedRef = useRef(onInitialConsumed)
  onInitialConsumedRef.current = onInitialConsumed
  const consumedRequestRef = useRef<Props['initialRequest']>(null)

  const previewSegment = useMemo(
    () =>
      analysis && previewPick
        ? describePreviewSegment(
            analysis.layers,
            previewPick.layerIndex,
            previewPick.offset,
            analysis.stats.maxFlowMm3s,
          )
        : null,
    [analysis, previewPick],
  )
  const handlePreviewPick = useCallback((ref: PreviewSegmentRef | null) => {
    setPreviewPick(ref)
  }, [])

  const lineCount = useMemo(
    () => (text.length > LINE_COUNT_LIMIT ? null : text ? text.split('\n').length : 0),
    [text],
  )
  const searchAvailable = text.length <= SEARCH_LIMIT_CHARS
  const search = useMemo(() => {
    if (!findQuery || !searchAvailable) return { hits: [] as number[], capped: false }
    const haystack = text.toLowerCase()
    const needle = findQuery.toLowerCase()
    const hits: number[] = []
    let from = 0
    while (hits.length < SEARCH_MAX_HITS) {
      const at = haystack.indexOf(needle, from)
      if (at < 0) break
      hits.push(at)
      from = at + Math.max(1, needle.length)
    }
    return { hits, capped: hits.length >= SEARCH_MAX_HITS }
  }, [findQuery, searchAvailable, text])

  const updateCursor = useCallback((value: string, offset: number) => {
    if (value.length > CURSOR_LINE_LIMIT) {
      setCursorLine(null)
      return
    }
    setCursorLine(lineNumberAt(value, offset))
  }, [])

  const selectRange = useCallback(
    (start: number, end: number) => {
      const element = textareaRef.current
      if (!element) return
      element.focus()
      element.setSelectionRange(start, end)
      if (text.length <= CURSOR_LINE_LIMIT) {
        const line = lineNumberAt(text, start)
        setCursorLine(line)
        // setSelectionRange() setzt den Cursor, scrollt das Textfeld aber nicht
        // zuverlässig mit. Die Zeilenhöhe ist bei `wrap="off"` konstant; so
        // landet die gewählte Zeile auch bei großen Dateien sichtbar in der
        // Mitte statt am bisherigen Scrollstand (typisch: Dateiende).
        const style = window.getComputedStyle(element)
        const computedLineHeight = Number.parseFloat(style.lineHeight)
        const lineHeight =
          Number.isFinite(computedLineHeight) && computedLineHeight > 0 ? computedLineHeight : 18
        const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight)
        const target = Math.max(0, (line - 1) * lineHeight - element.clientHeight / 2)
        element.scrollTop = Math.min(maxScroll, target)
      }
    },
    [text],
  )

  const jumpToLine = useCallback(
    (line: number) => {
      const start = offsetForLine(text, line)
      selectRange(start, start)
    },
    [selectRange, text],
  )

  const jumpToMatch = useCallback(
    (direction: 1 | -1) => {
      const hits = search.hits
      if (!hits.length) return
      const next =
        findIndex < 0
          ? direction > 0
            ? 0
            : hits.length - 1
          : (findIndex + direction + hits.length) % hits.length
      setFindIndex(next)
      selectRange(hits[next], hits[next] + findQuery.length)
    },
    [findIndex, findQuery.length, search.hits, selectRange],
  )

  const runAnalysis = useCallback(
    async (content: string) => {
      if (!content.trim()) {
        setAnalysis(null)
        return
      }
      setBusy('analyze')
      setError(null)
      setPendingConversion(null)
      try {
        const next = await api.analyzeGcode(content, bed, origin)
        setAnalysis(next)
        setPreviewPick(null)
        setLayer(Math.max(0, next.layers.length - 1))
        setShowAll(true)
        setDirty(false)
        setToFlavor(targetFor(next.dialect))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'G-Code konnte nicht analysiert werden.')
      } finally {
        setBusy(null)
      }
    },
    [bed, origin],
  )

  // Kommt der Sprung aus der Studio-Vorschau, wird der geslicte G-Code
  // einmalig in den Editor geladen. Die eigentliche Cursorwahl passiert im
  // nächsten Effekt, sobald der Text im Textfeld angekommen ist.
  useEffect(() => {
    if (!initialRequest || consumedRequestRef.current === initialRequest) return
    consumedRequestRef.current = initialRequest
    const request = initialRequest
    setText(request.gcode)
    setFileName(request.name)
    setFindIndex(-1)
    setCursorLine(1)
    setPendingJumpLine(request.line)
    setConversion(null)
    setPendingConversion(null)
    setPreviewPick(null)
    setDirty(false)
    onInitialConsumedRef.current?.()
    void runAnalysis(request.gcode)
  }, [initialRequest, runAnalysis])

  useEffect(() => {
    if (pendingJumpLine === null || !text) return
    const timer = window.setTimeout(() => {
      jumpToLine(pendingJumpLine)
      setPendingJumpLine(null)
    }, 30)
    return () => window.clearTimeout(timer)
  }, [jumpToLine, pendingJumpLine, text])

  const loadFile = useCallback(
    async (file: File) => {
      if (file.size === 0) {
        setError(`„${file.name}“ ist leer.`)
        return
      }
      if (file.size > MAX_GCODE_BYTES) {
        setError(`Die Datei ist größer als ${formatSize(MAX_GCODE_BYTES)} und kann nicht geladen werden.`)
        return
      }
      setBusy('load')
      setError(null)
      setInfo(null)
      setConversion(null)
      setPendingConversion(null)
      try {
        const content = await file.text()
        setText(content)
        setFileName(file.name)
        setDirty(false)
        setFindIndex(-1)
        setCursorLine(1)
        await runAnalysis(content)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Die Datei konnte nicht gelesen werden.')
      } finally {
        setBusy(null)
      }
    },
    [runAnalysis],
  )

  const convert = useCallback(async () => {
    if (!text.trim()) return
    setBusy('convert')
    setError(null)
    setInfo(null)
    try {
      const result = await api.convertGcode(text, toFlavor)
      setPendingConversion(result)
      setConversion(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'G-Code konnte nicht konvertiert werden.')
    } finally {
      setBusy(null)
    }
  }, [text, toFlavor])

  const applyConversion = useCallback(async () => {
    const result = pendingConversion
    if (!result) return
    setText(result.gcode)
    setFileName((current) => {
      const base = (current || 'druck').replace(/\.(gcode|gco|nc|txt)$/i, '')
      return `${base}-${result.to}.gcode`
    })
    setConversion(result)
    setPendingConversion(null)
    setDirty(false)
    setFindIndex(-1)
    setCursorLine(1)
    setInfo(
      `Konvertierung auf ${flavorLabel(result.to)} übernommen: ${result.changed} Zeile(n) angepasst, ${result.unsupported.length} Befehlstyp(en) unverändert.`,
    )
    if (textareaRef.current) textareaRef.current.setSelectionRange(0, 0)
    await runAnalysis(result.gcode)
  }, [pendingConversion, runAnalysis])

  const discardConversion = useCallback(() => {
    setPendingConversion(null)
    setInfo('Konvertierung verworfen — der Ausgangstext bleibt unverändert.')
  }, [])

  const save = useCallback(async () => {
    if (!text) return
    const result = await saveGcodeAs(text, fileName || 'gcode.gcode')
    if (result.status === 'saved' || result.status === 'downloaded') {
      setInfo(`Gespeichert: ${result.name}`)
    } else if (result.status === 'error') {
      setError(result.message)
    }
  }, [fileName, text])

  const issues = analysis?.issues ?? []
  const errorCount = issues.filter((issue) => issue.severity === 'error').length
  const warningCount = issues.length - errorCount
  const conversionWarnings = conversion?.warnings ?? []
  const findStatus = !findQuery
    ? 'Suchbegriff eingeben'
    : !searchAvailable
      ? 'Datei zu groß für die Suche'
      : search.hits.length === 0
        ? '0 Treffer'
        : `${(findIndex < 0 ? 0 : findIndex) + 1} / ${search.hits.length}${search.capped ? '+' : ''}`

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3"
      onDragOver={(e) => {
        if (!Array.from(e.dataTransfer.types).includes('Files')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        setDragging(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const file = e.dataTransfer.files?.[0]
        if (file) void loadFile(file)
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-50 grid place-items-center rounded-2xl border-2 border-dashed border-amber/70 bg-ink-950/85 backdrop-blur-sm">
          <div className="text-center">
            <div className="text-sm font-semibold text-amber">G-Code hier ablegen</div>
            <div className="mt-1 text-[11px] text-white/45">Die Datei wird lokal eingelesen und nicht hochgeladen.</div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line/70 bg-ink-900/55 px-3 py-2">
        <div className="mr-auto min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold text-white/90">G-Code einlesen</h1>
            <Chip tone="sky">Analyse</Chip>
            <Chip tone="amber">Vorschau</Chip>
            <Chip tone="mint">Konvertieren</Chip>
          </div>
          <p className="mt-0.5 max-w-2xl text-[10px] leading-snug text-white/40">
            Fremde G-Code-Dateien öffnen, Bahnen und Layer prüfen, Text bearbeiten und bekannte Befehle
            zwischen Marlin, Klipper, RepRapFirmware und Repetier übersetzen. Unbekannte Befehle bleiben
            unverändert — die Konvertierung ist keine Garantie für einen druckfertigen Ablauf.
          </p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".gcode,.gco,.nc,.txt,text/plain"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void loadFile(file)
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="rounded-xl border border-amber/50 bg-amber/10 px-3 py-1.5 text-xs font-medium text-amber transition hover:bg-amber/20"
        >
          Datei öffnen
        </button>
        <button
          type="button"
          disabled={!text || busy !== null}
          onClick={() => void runAnalysis(text)}
          className="rounded-xl border border-line/70 bg-ink-900/70 px-3 py-1.5 text-xs text-white/65 transition hover:border-sky/50 hover:text-sky disabled:opacity-40"
        >
          {busy === 'analyze' ? 'Analysiere …' : 'Analysieren'}
        </button>
        <button
          type="button"
          disabled={!text}
          onClick={() => void save()}
          className="rounded-xl border border-line/70 bg-ink-900/70 px-3 py-1.5 text-xs text-white/65 transition hover:border-mint/50 hover:text-mint disabled:opacity-40"
        >
          Speichern
        </button>
      </div>

      {error && (
        <div className="flex items-start justify-between gap-2 rounded-xl border border-rose/30 bg-rose/8 px-3 py-2 text-[11px] text-rose/90">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-white/35 hover:text-white">
            ✕
          </button>
        </div>
      )}
      {info && (
        <div className="flex items-start justify-between gap-2 rounded-xl border border-mint/25 bg-mint/8 px-3 py-2 text-[11px] text-mint/90">
          <span>{info}</span>
          <button type="button" onClick={() => setInfo(null)} className="text-white/35 hover:text-white">
            ✕
          </button>
        </div>
      )}

      {pendingConversion && (
        <section className="rounded-2xl border border-sky/30 bg-sky/5 p-3">
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-sky/80">
                Konvertierung prüfen
              </div>
              <div className="mt-0.5 text-[11px] text-white/65">
                {pendingConversion.from === 'unknown' ? 'Unbekanntes Format' : flavorLabel(pendingConversion.from)}{' '}
                → {flavorLabel(pendingConversion.to)} · {pendingConversion.changed} Zeile(n) geändert ·{' '}
                {pendingConversion.unsupported.length} Befehlstyp(en) unverändert
              </div>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void applyConversion()}
                className="rounded-lg border border-mint/50 bg-mint/10 px-2.5 py-1 text-[10px] font-medium text-mint transition hover:bg-mint/20 disabled:opacity-40"
              >
                Übernehmen
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={discardConversion}
                className="rounded-lg border border-line/70 px-2.5 py-1 text-[10px] text-white/55 transition hover:border-white/30 hover:text-white disabled:opacity-40"
              >
                Verwerfen
              </button>
            </div>
          </div>
          {pendingConversion.changes.length > 0 ? (
            <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-line/50 bg-ink-950/45">
              {pendingConversion.changes.map((change) => (
                <div
                  key={`${change.line}-${change.after}`}
                  className="border-b border-line/30 px-2.5 py-1.5 font-mono text-[10px] last:border-0"
                >
                  <div className="text-[9px] text-white/30">Zeile {change.line}</div>
                  <div className="mt-0.5 whitespace-pre-wrap break-all text-rose/75">− {change.before}</div>
                  <div className="whitespace-pre-wrap break-all text-mint/80">+ {change.after}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-[10px] text-white/40">Keine Zeile würde geändert werden.</p>
          )}
          {pendingConversion.warnings.length > 0 && (
            <ul className="mt-2 space-y-1 text-[10px] leading-snug text-white/50">
              {pendingConversion.warnings.map((warning) => (
                <li key={warning} className="flex gap-1.5">
                  <span className="text-sky/70">•</span>
                  {warning}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_430px]">
        <section
          data-preview-stage
          className="relative min-h-[380px] overflow-hidden rounded-2xl border border-line/70 bg-ink-950/80"
        >
          <Viewport
            geometry={null}
            layers={analysis?.layers ?? []}
            layer={layer}
            showAll={showAll}
            colorMode={colorMode}
            hiddenFeatures={hiddenFeatures}
            palette={palette}
            compareLayers={compareAnalysis?.layers ?? null}
            maxVolumetricFlow={analysis?.stats.maxFlowMm3s ?? 0}
            previewSection={previewSection}
            previewPick={previewInspect}
            onPreviewPick={handlePreviewPick}
            bed={bed}
            onFitReady={() => undefined}
          />
          <div className="pointer-events-none absolute left-3 top-3 rounded-xl border border-line/60 bg-ink-950/65 px-2.5 py-1.5 text-[10px] text-white/55 backdrop-blur-md">
            <div className="text-[9px] uppercase tracking-[0.16em] text-white/30">{printerName}</div>
            <div className="mt-0.5">
              {analysis ? `${analysis.layers.length} Layer · ${num(analysis.bounds.max.z, 1)} mm hoch` : 'Keine Datei geladen'}
            </div>
          </div>
          {!analysis && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="max-w-xs text-center">
                <div className="text-sm font-medium text-white/50">G-Code hier ablegen oder öffnen</div>
                <div className="mt-1 text-[11px] leading-snug text-white/30">
                  Die Vorschau zeigt Extrusionen und Reisen je Layer. Dateien bleiben lokal auf diesem Rechner.
                </div>
              </div>
            </div>
          )}
          {analysis && (
            <FloatingPanel
              storageKey="preview-legend"
              className="absolute right-3 top-3 z-20 max-h-[calc(100%-1.5rem)] w-[min(260px,calc(100%-1.5rem))] overflow-y-auto overscroll-contain"
            >
              <PreviewLegend
                result={analysis}
                layer={layer}
                colorMode={colorMode}
                onColorMode={setColorMode}
                hiddenFeatures={hiddenFeatures}
                onToggleFeature={(kind) =>
                  setHiddenFeatures((prev) =>
                    prev.includes(kind) ? prev.filter((entry) => entry !== kind) : [...prev, kind],
                  )
                }
                onShowAllFeatures={() => setHiddenFeatures([])}
                palette={palette}
                onPalette={setPalette}
              />
            </FloatingPanel>
          )}
          {analysis && (
            <FloatingPanel
              storageKey="preview-lab"
              className="absolute bottom-20 left-3 z-20 max-h-[calc(100%-6rem)] w-[min(280px,calc(100%-1.5rem))] overflow-y-auto overscroll-contain"
            >
              <PreviewLab
                result={analysis}
                layer={layer}
                onLayer={(index) => {
                  setLayer(index)
                }}
                compare={compareAnalysis}
                onCompare={() => setCompareAnalysis(analysis)}
                onClearCompare={() => setCompareAnalysis(null)}
                section={previewSection}
                onSection={setPreviewSection}
                pick={previewPick}
                segment={previewSegment}
                inspect={previewInspect}
                onInspect={setPreviewInspect}
                onClearPick={() => setPreviewPick(null)}
                bed={bed}
                sourceName={fileName || undefined}
                palette={palette}
                onJumpToGcode={dirty ? undefined : jumpToLine}
              />
            </FloatingPanel>
          )}
          {analysis && analysis.layers.length > 0 && (
            <div className="absolute inset-x-0 bottom-0 z-10 flex flex-wrap items-center gap-2 border-t border-line/50 bg-ink-950/75 px-3 py-2 backdrop-blur-md">
              <button
                type="button"
                onClick={() => setShowAll((value) => !value)}
                className={`rounded-lg border px-2 py-1 text-[10px] transition ${
                  showAll ? 'border-amber/50 bg-amber/10 text-amber' : 'border-line/70 text-white/45 hover:text-white'
                }`}
              >
                {showAll ? 'Alle Layer' : 'Bis Layer'}
              </button>
              <input
                type="range"
                min={0}
                max={Math.max(0, analysis.layers.length - 1)}
                value={Math.min(layer, Math.max(0, analysis.layers.length - 1))}
                onChange={(e) => {
                  setLayer(Number(e.target.value))
                }}
                className="min-w-[120px] flex-1 cursor-pointer"
                aria-label="Layer der G-Code-Vorschau"
              />
              <span className="tabular text-[10px] text-white/60">
                {Math.min(layer + 1, analysis.layers.length)} / {analysis.layers.length} · z{' '}
                {num(analysis.layers[Math.min(layer, analysis.layers.length - 1)]?.z ?? 0, 2)} mm
              </span>
            </div>
          )}
        </section>

        <section className="flex min-h-[380px] min-w-0 flex-col overflow-hidden rounded-2xl border border-line/70 bg-ink-900/45">
          <div className="flex flex-wrap items-center gap-2 border-b border-line/60 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-[11px] font-medium text-white/80">{fileName || 'Unbenannte Datei'}</div>
              <div className="text-[9px] text-white/35">
                {formatSize(new Blob([text]).size)}
                {lineCount !== null ? ` · ${lineCount.toLocaleString('de-DE')} Zeilen` : ''}
                {dirty && <span className="text-amber"> · geändert, noch nicht analysiert</span>}
              </div>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setFindOpen((value) => !value)}
                className={`rounded-lg border px-2 py-1 text-[10px] transition ${
                  findOpen ? 'border-amber/50 bg-amber/10 text-amber' : 'border-line/70 text-white/55 hover:text-white'
                }`}
              >
                Suchen
              </button>
              <select
                value={toFlavor}
                onChange={(e) => setToFlavor(e.target.value as GcodeFlavor)}
                className="rounded-lg border border-line/80 bg-ink-950 px-2 py-1 text-[10px] text-white/75 outline-none"
                aria-label="Ziel-Firmware"
              >
                {GCODE_FLAVORS.map((flavor) => (
                  <option key={flavor.id} value={flavor.id}>
                    nach {flavor.short}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!text || busy !== null}
                onClick={() => void convert()}
                className="rounded-lg border border-sky/40 bg-sky/10 px-2 py-1 text-[10px] font-medium text-sky transition hover:bg-sky/20 disabled:opacity-40"
              >
                {busy === 'convert' ? 'Konvertiere …' : 'Konvertieren'}
              </button>
            </div>
          </div>
          {findOpen && (
            <div className="flex flex-wrap items-center gap-1.5 border-b border-line/50 bg-ink-950/35 px-3 py-1.5">
              <input
                autoFocus
                value={findQuery}
                onChange={(e) => {
                  setFindQuery(e.target.value)
                  setFindIndex(-1)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    jumpToMatch(e.shiftKey ? -1 : 1)
                  } else if (e.key === 'Escape') {
                    setFindOpen(false)
                  }
                }}
                placeholder={searchAvailable ? 'Im G-Code suchen …' : 'Suche für große Dateien deaktiviert'}
                disabled={!searchAvailable}
                className="min-w-[130px] flex-1 rounded-lg border border-line/70 bg-ink-950 px-2 py-1 font-mono text-[10px] text-white/75 outline-none placeholder:text-white/25 disabled:opacity-40"
                aria-label="Im G-Code suchen"
              />
              <span className="min-w-[92px] text-right text-[9px] text-white/40">{findStatus}</span>
              <button
                type="button"
                disabled={!search.hits.length}
                onClick={() => jumpToMatch(-1)}
                className="rounded border border-line/60 px-1.5 py-0.5 text-[10px] text-white/55 hover:text-white disabled:opacity-30"
                aria-label="Vorheriger Treffer"
              >
                ↑
              </button>
              <button
                type="button"
                disabled={!search.hits.length}
                onClick={() => jumpToMatch(1)}
                className="rounded border border-line/60 px-1.5 py-0.5 text-[10px] text-white/55 hover:text-white disabled:opacity-30"
                aria-label="Nächster Treffer"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => setFindOpen(false)}
                className="px-1 text-[10px] text-white/35 hover:text-white"
                aria-label="Suche schließen"
              >
                ✕
              </button>
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => {
              const value = e.target.value
              setText(value)
              setDirty(true)
              setConversion(null)
              setPendingConversion(null)
              setFindIndex(-1)
              updateCursor(value, e.target.selectionStart)
            }}
            onSelect={(e) => updateCursor(e.currentTarget.value, e.currentTarget.selectionStart)}
            onClick={(e) => updateCursor(e.currentTarget.value, e.currentTarget.selectionStart)}
            onKeyUp={(e) => updateCursor(e.currentTarget.value, e.currentTarget.selectionStart)}
            spellCheck={false}
            wrap="off"
            placeholder="; G-Code einfügen oder Datei öffnen …"
            className="min-h-[300px] flex-1 resize-none bg-ink-950/55 p-3 font-mono text-[10px] leading-relaxed text-white/70 outline-none placeholder:text-white/20"
          />
          <div className="flex flex-wrap items-center gap-2 border-t border-line/60 px-3 py-1.5 text-[9px] text-white/35">
            <span>Bearbeiten ist möglich; vor dem Druck immer die erste Schicht und die Startsequenz prüfen.</span>
            <span className="text-white/40">{cursorLine === null ? 'Zeile —' : `Zeile ${cursorLine}`}</span>
            {analysis && (
              <span className="ml-auto text-white/50">
                erkannt: {analysis.dialect === 'unknown' ? 'unbekannt' : flavorLabel(analysis.dialect)} ({analysis.confidence})
              </span>
            )}
          </div>
        </section>
      </div>

      {analysis && (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Layer" value={String(analysis.stats.layerCount)} />
            <Stat label="Dauer" value={formatDuration(analysis.stats.estimatedSeconds)} />
            <Stat label="Filament" value={`${num(analysis.stats.filamentGrams, 1)} g`} />
            <Stat label="Max. Fluss" value={`${num(analysis.stats.maxFlowMm3s, 1)} mm³/s`} />
            <Stat
              label="Bauraum"
              value={`${num(analysis.bounds.max.x - analysis.bounds.min.x, 1)} × ${num(analysis.bounds.max.y - analysis.bounds.min.y, 1)} × ${num(analysis.bounds.max.z - analysis.bounds.min.z, 1)} mm`}
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-2xl border border-line/70 bg-ink-900/45 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">Analyse</span>
                <Chip tone={analysis.confidence === 'high' ? 'mint' : analysis.confidence === 'medium' ? 'amber' : 'neutral'}>
                  {analysis.dialect === 'unknown' ? 'Format unbekannt' : flavorLabel(analysis.dialect)}
                </Chip>
                <span className="text-[9px] text-white/35">{analysis.commandCount.toLocaleString('de-DE')} Befehle</span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
                <Info label="Düse" value={analysis.temperatures.nozzle !== null ? `${analysis.temperatures.nozzle} °C` : '—'} />
                <Info label="Bett" value={analysis.temperatures.bed !== null ? `${analysis.temperatures.bed} °C` : '—'} />
                <Info label="Max. Vorschub" value={`${analysis.maxFeedrate} mm/min`} />
                <Info label="Filamentlänge" value={`${analysis.stats.filamentMm.toLocaleString('de-DE')} mm`} />
                <Info label="Volumen" value={`${num(analysis.stats.volumeCm3, 1)} cm³`} />
                <Info label="Befehle" value={String(analysis.commandCount)} />
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {analysis.commandCounts.slice(0, 12).map((entry) => (
                  <span key={entry.command} className="rounded border border-line/60 px-1.5 py-0.5 text-[9px] text-white/45">
                    {entry.command} <span className="text-white/30">{entry.count}</span>
                  </span>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-line/70 bg-ink-900/45 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">Prüfung</span>
                {errorCount > 0 ? (
                  <Chip tone="rose">{errorCount} Fehler</Chip>
                ) : warningCount > 0 ? (
                  <Chip tone="amber">{warningCount} Hinweise</Chip>
                ) : (
                  <Chip tone="mint">keine Auffälligkeiten</Chip>
                )}
              </div>
              {conversion && (
                <div className="mb-2 rounded-lg border border-sky/30 bg-sky/8 px-2 py-1.5 text-[10px] text-sky/90">
                  {conversion.from === 'unknown' ? 'Unbekanntes Format' : flavorLabel(conversion.from)} → {flavorLabel(conversion.to)} ·{' '}
                  {conversion.changed} Zeile(n) geändert
                </div>
              )}
              {issues.length > 0 && (
                <ul className="space-y-1.5 text-[10px] leading-snug">
                  {issues.map((issue) => {
                    const color =
                      issue.severity === 'error'
                        ? 'text-rose/85'
                        : issue.severity === 'warning'
                          ? 'text-amber/85'
                          : 'text-sky/85'
                    return (
                      <li key={`${issue.code}-${issue.line ?? 'file'}`}>
                        <button
                          type="button"
                          disabled={issue.line === null}
                          onClick={() => {
                            if (issue.line !== null) jumpToLine(issue.line)
                          }}
                          className={`flex w-full gap-1.5 text-left ${color} ${
                            issue.line !== null ? 'rounded px-1 py-0.5 hover:bg-white/5' : 'cursor-default'
                          }`}
                          title={issue.message}
                        >
                          <span className="shrink-0">{issue.severity === 'error' ? '✕' : '•'}</span>
                          <span className="min-w-0">
                            {issue.line !== null && <span className="mr-1 font-medium text-white/45">Zeile {issue.line}:</span>}
                            {issue.message}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
              {conversionWarnings.length > 0 && (
                <ul className="mt-2 space-y-1 text-[10px] leading-snug text-sky/80">
                  {conversionWarnings.map((warning) => (
                    <li key={warning} className="flex gap-1.5">
                      <span className="text-sky/70">•</span>
                      {warning}
                    </li>
                  ))}
                </ul>
              )}
              {issues.length === 0 && conversionWarnings.length === 0 && (
                <p className="text-[10px] text-white/35">Keine Auffälligkeiten erkannt.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line/70 bg-ink-900/50 px-3 py-2">
      <div className="text-[9px] uppercase tracking-[0.14em] text-white/35">{label}</div>
      <div className="tabular mt-0.5 text-sm font-semibold text-white/85">{value}</div>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-line/30 py-0.5">
      <span className="text-white/35">{label}</span>
      <span className="tabular text-white/75">{value}</span>
    </div>
  )
}
