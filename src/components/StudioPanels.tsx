import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  BedMesh,
  ModelAnalysis,
  ModelObjectInfo,
  ModelPlacement,
  PrinterStatus,
  SliceResult,
  Suggestion,
} from '../../shared/types.ts'
import { describeSettingsOverrides, formatDuration, formatWeight } from '../../shared/types.ts'
import { INTENTS, type IntentId } from '../../shared/advisor.ts'
import { Chip, InfoDot, Panel, Stepper } from './ui.tsx'

export const DEMO_SHAPES = [
  { id: 'wuerfel', label: 'Würfel' },
  { id: 'zylinder', label: 'Zylinder' },
  { id: 'bruecke', label: 'Brücke' },
  { id: 'turm', label: 'Turm' },
]

export function ModelPanel({
  analysis,
  fileName,
  format,
  objects,
  onObjects,
  filaments,
  selectedId,
  selectedIds = [],
  onSelect,
  onFile,
  onDemo,
  onClear,
  onExportStl,
  onExport3mf,
  onExportProfile,
  onImportProfile,
  busy,
}: {
  analysis: ModelAnalysis | null
  fileName: string | null
  format: string | null
  objects: ModelObjectInfo[]
  onObjects: (next: ModelObjectInfo[]) => void
  /** Auswahl für die Filamentzuweisung je Objekt */
  filaments?: { id: string; name: string }[]
  /** Auswahl aus der 3D-Ansicht/Objektliste */
  selectedId?: string | null
  /** Alle markierten Objekte (Strg-Klick) — Grundlage fürs Zusammenbauen. */
  selectedIds?: string[]
  onSelect?: (id: string, additive?: boolean) => void
  onFile: (file: File) => void
  onDemo: (shape: string) => void
  onClear: () => void
  onExportStl: () => void
  onExport3mf: () => void
  onExportProfile: () => void
  onImportProfile: (file: File) => void
  busy: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const profileRef = useRef<HTMLInputElement>(null)

  return (
    <Panel title="Werkstück" hint={analysis ? undefined : 'STL · 3MF · OBJ · PLY hierher ziehen'}>
      {analysis ? (
        <div>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-white/90">{fileName}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/35">
                {format && (
                  <span className="rounded bg-white/8 px-1 py-0.5 text-[8px] font-semibold tracking-wide text-white/55 uppercase">
                    {format}
                  </span>
                )}
                {analysis.triangles.toLocaleString('de-DE')} Dreiecke
              </div>
            </div>
            <button
              type="button"
              onClick={onClear}
              className="rounded-lg border border-line/80 px-2 py-1 text-[10px] text-white/45 transition hover:text-white/80"
            >
              Leeren
            </button>
          </div>

          <dl className="mt-3 grid grid-cols-3 gap-2">
            {[
              { k: 'Maße', v: `${analysis.bbox.size.x.toFixed(0)}×${analysis.bbox.size.y.toFixed(0)}×${analysis.bbox.size.z.toFixed(0)}` },
              { k: 'Volumen', v: `${(analysis.volumeMm3 / 1000).toFixed(1)} cm³` },
              { k: 'Auflage', v: `${Math.round(analysis.footprintAreaMm2)} mm²` },
            ].map((s) => (
              <div key={s.k} className="rounded-xl border border-line/60 bg-ink-900/50 px-2 py-1.5">
                <dt className="text-[9px] tracking-wider text-white/30 uppercase">{s.k}</dt>
                <dd
                  data-testid={s.k === 'Maße' ? 'model-dimensions' : undefined}
                  className="tabular mt-0.5 text-[11px] font-semibold text-white/80"
                >
                  {s.v}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <Chip tone={analysis.overhangRatio > 0.015 ? 'rose' : 'neutral'}>
              Überhang {(analysis.overhangRatio * 100).toFixed(1)} %
            </Chip>
            <Chip tone={analysis.flatTopRatio > 0.08 ? 'mint' : 'neutral'}>
              Deckfläche {(analysis.flatTopRatio * 100).toFixed(0)} %
            </Chip>
          </div>

          {objects.length > 0 && (
            <ObjectsEditor
              objects={objects}
              filaments={filaments ?? []}
              selectedId={selectedId}
              selectedIds={selectedIds}
              onSelect={onSelect}
              onObjects={onObjects}
            />
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            e.currentTarget.dataset.over = '1'
          }}
          onDragLeave={(e) => delete e.currentTarget.dataset.over}
          onDrop={(e) => {
            e.preventDefault()
            delete e.currentTarget.dataset.over
            const f = e.dataTransfer.files?.[0]
            if (f) onFile(f)
          }}
          className="group flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line bg-ink-900/30 px-3 py-7 text-center transition hover:border-amber/50 hover:bg-amber/5 data-[over]:border-amber data-[over]:bg-amber/10"
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" className="text-white/25 transition group-hover:text-amber/80">
            <path d="M12 3v12m0-12 4 4m-4-4L8 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span className="text-xs text-white/50">Datei ablegen oder klicken</span>
          <span className="text-[10px] text-white/25">STL · 3MF · OBJ · PLY — 3MF bringt Druckeinstellungen mit</span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".stl,.3mf,.obj,.ply,.json,model/stl,model/3mf"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />

      <div className="mt-3 flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="rounded-lg bg-gradient-to-r from-amber to-[#ff9f45] px-2.5 py-1 text-[10px] font-semibold text-ink-950 transition hover:brightness-110 disabled:opacity-40"
        >
          Datei laden …
        </button>
        {analysis && (
          <>
            <button
              type="button"
              onClick={onExportStl}
              className="rounded-lg border border-line/80 bg-ink-900/40 px-2 py-1 text-[10px] text-white/55 transition hover:border-mint/40 hover:text-mint"
            >
              STL ↓
            </button>
            <button
              type="button"
              onClick={onExport3mf}
              className="rounded-lg border border-line/80 bg-ink-900/40 px-2 py-1 text-[10px] text-white/55 transition hover:border-mint/40 hover:text-mint"
            >
              3MF ↓
            </button>
            <button
              type="button"
              onClick={onExportProfile}
              className="rounded-lg border border-line/80 bg-ink-900/40 px-2 py-1 text-[10px] text-white/55 transition hover:border-sky/40 hover:text-sky"
            >
              Profil ↓
            </button>
            <button
              type="button"
              onClick={() => profileRef.current?.click()}
              className="rounded-lg border border-line/80 bg-ink-900/40 px-2 py-1 text-[10px] text-white/55 transition hover:border-sky/40 hover:text-sky"
            >
              Profil ↑
            </button>
          </>
        )}
      </div>

      <input
        ref={profileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onImportProfile(f)
          e.target.value = ''
        }}
      />

      <div className="mt-2 flex flex-wrap gap-1.5">
        {DEMO_SHAPES.map((d) => (
          <button
            key={d.id}
            type="button"
            disabled={busy}
            onClick={() => onDemo(d.id)}
            className="rounded-lg border border-line/80 bg-ink-900/40 px-2 py-1 text-[10px] text-white/55 transition hover:border-mint/40 hover:text-mint disabled:opacity-40"
          >
            {d.label}
          </button>
        ))}
      </div>
    </Panel>
  )
}

export function IntentPanel({ intent, onIntent }: { intent: IntentId | null; onIntent: (id: IntentId) => void }) {
  return (
    <Panel title="Absicht" hint="Statt hunderter Regler: erst das Ziel, dann feinjustieren">
      <div className="grid gap-1.5">
        {INTENTS.map((i) => (
          <button
            key={i.id}
            type="button"
            onClick={() => onIntent(i.id)}
            className={`rounded-xl border px-3 py-2 text-left transition ${
              intent === i.id
                ? 'border-amber/60 bg-amber/10'
                : 'border-line/70 bg-ink-900/40 hover:border-white/15 hover:bg-white/4'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className={`text-xs font-semibold ${intent === i.id ? 'text-amber' : 'text-white/80'}`}>{i.label}</span>
              {intent === i.id && <span className="text-[9px] tracking-widest text-amber/70 uppercase">aktiv</span>}
            </div>
            <div className="mt-0.5 text-[10px] leading-snug text-white/35">{i.hint}</div>
          </button>
        ))}
      </div>
    </Panel>
  )
}

export function SuggestionsPanel({
  suggestions,
  dismissed,
  onApply,
  onDismiss,
  onApplyAll,
}: {
  suggestions: Suggestion[]
  dismissed: string[]
  onApply: (s: Suggestion) => void
  onDismiss: (id: string) => void
  onApplyAll: () => void
}) {
  const open = suggestions.filter((s) => !dismissed.includes(s.id))
  const tone: Record<string, 'mint' | 'amber' | 'sky' | 'rose'> = {
    quality: 'mint',
    speed: 'sky',
    adhesion: 'amber',
    safety: 'rose',
  }
  const dot: Record<string, string> = {
    quality: 'bg-mint',
    speed: 'bg-sky',
    adhesion: 'bg-amber',
    safety: 'bg-rose',
  }

  return (
    <Panel
      title="Vorschläge"
      hint={open.length ? 'Aus der Modellanalyse abgeleitet' : undefined}
      right={
        open.length > 1 ? (
          <button
            type="button"
            onClick={onApplyAll}
            className="rounded-lg border border-mint/30 bg-mint/10 px-2 py-1 text-[10px] font-medium text-mint transition hover:bg-mint/20"
          >
            Alle
          </button>
        ) : undefined
      }
    >
      {open.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-white/30">
          Keine offenen Empfehlungen. Sobald ein Modell geladen ist, prüfe ich Überhänge, Deckflächen und Standfläche.
        </p>
      ) : (
        <div className="space-y-1.5">
          {open.map((s) => (
            <div key={s.id} className="rounded-xl border border-line/70 bg-ink-900/50 px-2 py-1.5">
              <div className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot[s.impact] ?? 'bg-white/30'}`}
                />
                <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-white/85" title={s.detail}>
                  {s.title}
                </span>
                <InfoDot label={s.title} text={s.detail} />
                <button
                  type="button"
                  onClick={() => onDismiss(s.id)}
                  className="shrink-0 text-white/20 transition hover:text-white/60"
                  aria-label="Vorschlag ausblenden"
                >
                  ✕
                </button>
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                <Chip tone={tone[s.impact] ?? 'neutral'}>
                  {s.impact === 'quality' ? 'Qualität' : s.impact === 'speed' ? 'Tempo' : s.impact === 'adhesion' ? 'Haftung' : 'Sicherheit'}
                </Chip>
                <span className="min-w-0 flex-1 truncate text-[9px] leading-snug text-white/35" title={s.detail}>
                  {s.detail}
                </span>
                <button
                  type="button"
                  onClick={() => onApply(s)}
                  className="shrink-0 rounded-lg bg-white/8 px-2 py-0.5 text-[10px] font-medium text-white/75 transition hover:bg-amber hover:text-ink-950"
                >
                  Übernehmen
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

/**
 * Kompakte Ablaufleiste für den Alltag: laden, Material/Bett prüfen, slicen,
 * Ergebnis sichern. Die vorhandenen Panels bleiben unverändert; die Leiste
 * bietet nur den jeweils nächsten Schritt ohne Suchen in den Spalten.
 */
export function WorkflowBar({
  hasModel,
  hasResult,
  dirty,
  slicing,
  material,
  plate,
  printerName,
  autosaveText,
  autosaveTone,
  onLoad,
  onSetup,
  onSlice,
  onSave,
}: {
  hasModel: boolean
  hasResult: boolean
  dirty: boolean
  slicing: boolean
  material: string
  plate: string
  printerName: string
  autosaveText: string
  autosaveTone: 'mint' | 'amber' | 'rose' | 'muted'
  onLoad: () => void
  onSetup: () => void
  onSlice: () => void
  onSave: () => void
}) {
  const dot = {
    mint: 'bg-mint',
    amber: 'bg-amber',
    rose: 'bg-rose',
    muted: 'bg-white/25',
  }
  const stepClass = (active: boolean, done = false) =>
    `flex min-w-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-left text-[10px] transition ${
      active
        ? 'border-amber/55 bg-amber/10 text-amber'
        : done
          ? 'border-mint/30 bg-mint/5 text-mint/85'
          : 'border-line/60 bg-ink-900/45 text-white/55 hover:border-white/20 hover:text-white/80'
    }`

  return (
    <div
      data-testid="workflow-bar"
      className="mx-3 mt-2 flex flex-wrap items-center gap-1.5 rounded-2xl border border-line/60 bg-ink-900/55 px-2 py-1.5"
    >
      <span className="px-1 text-[9px] font-semibold tracking-[0.16em] text-white/30 uppercase">Ablauf</span>
      <button
        type="button"
        data-testid="workflow-load"
        onClick={onLoad}
        className={stepClass(!hasModel, hasModel)}
        title="STL, 3MF, OBJ oder PLY laden"
      >
        <span className="grid h-4 w-4 place-items-center rounded-full bg-white/8 text-[8px]">1</span>
        {hasModel ? 'Datei geladen' : 'Datei laden'}
      </button>
      <button
        type="button"
        data-testid="workflow-setup"
        onClick={onSetup}
        className={stepClass(false)}
        title={`Material, Platte und Bett prüfen · ${printerName}`}
      >
        <span className="grid h-4 w-4 place-items-center rounded-full bg-white/8 text-[8px]">2</span>
        <span className="truncate">
          {material} · {plate}
        </span>
      </button>
      <button
        type="button"
        data-testid="workflow-slice"
        onClick={onSlice}
        disabled={!hasModel || slicing}
        className={`${stepClass(hasModel && (!hasResult || dirty))} disabled:cursor-not-allowed disabled:opacity-35`}
        title={hasModel ? 'Aktuelle Einstellungen slicen' : 'Zuerst ein Objekt laden'}
      >
        <span className="grid h-4 w-4 place-items-center rounded-full bg-white/8 text-[8px]">3</span>
        {slicing ? 'Slicen läuft …' : hasResult && dirty ? 'Neu slicen' : hasResult ? 'Erneut slicen' : 'Slicen'}
      </button>
      <button
        type="button"
        data-testid="workflow-save"
        onClick={onSave}
        disabled={!hasResult}
        className={`${stepClass(hasResult)} disabled:cursor-not-allowed disabled:opacity-35`}
        title={hasResult ? 'G-Code speichern; Senden steht direkt im Ergebnis-Panel' : 'Erst nach dem Slicen verfügbar'}
      >
        <span className="grid h-4 w-4 place-items-center rounded-full bg-white/8 text-[8px]">4</span>
        G-Code speichern
      </button>
      <span
        data-testid="autosave-status"
        className="ml-auto flex items-center gap-1.5 px-1 text-[9px] text-white/35"
        title="Die aktuelle Geometrie wird lokal gesichert und nach einem Absturz angeboten."
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dot[autosaveTone]}`} />
        {autosaveText}
      </span>
    </div>
  )
}

export function ResultPanel({
  result,
  dirty,
  busy,
  canSlice,
  onSlice,
  onDownload,
  outputName,
  onOutputName,
  layer,
  onLayer,
  showAll,
  onShowAll,
  mesh,
  status,
  printerName,
  onSend,
  sending,
  outputInfo,
}: {
  result: (SliceResult & { sliceMs?: number }) | null
  dirty: boolean
  busy: boolean
  canSlice: boolean
  onSlice: () => void
  onDownload: () => void
  /** Name für Speichern und Drucker-Versand */
  outputName: string
  onOutputName: (value: string) => void
  layer: number
  onLayer: (n: number) => void
  showAll: boolean
  onShowAll: (v: boolean) => void
  mesh: BedMesh | null
  status: PrinterStatus
  printerName: string
  onSend: (target: 'usb' | 'network' | 'network-idle') => void
  sending: boolean
  outputInfo: string | null
}) {
  return (
    <Panel title="Ergebnis">
      <button
        type="button"
        data-testid="result-slice"
        disabled={!canSlice || busy}
        onClick={onSlice}
        className="w-full rounded-xl bg-gradient-to-r from-amber to-[#ff9f45] px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35"
      >
        {busy ? 'Berechne Schichten …' : result ? (dirty ? 'Neu slicen' : 'Erneut slicen') : 'Slicen'}
      </button>

      {result ? (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-2">
            {[
              { k: 'Druckzeit', v: formatDuration(result.stats.estimatedSeconds) },
              { k: 'Material', v: formatWeight(result.stats.filamentGrams) },
              { k: 'Schichten', v: `${result.stats.layerCount}` },
              { k: 'Bauteil', v: `${result.stats.volumeCm3.toFixed(1)} cm³` },
            ].map((s) => (
              <div key={s.k} className="rounded-xl border border-line/60 bg-ink-900/50 px-2.5 py-2">
                <dt className="text-[9px] tracking-wider text-white/30 uppercase">{s.k}</dt>
                <dd className="tabular mt-0.5 text-xs font-semibold text-white/85">{s.v}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-3 rounded-xl border border-line/70 bg-ink-900/40 p-2.5">
            <label htmlFor="gcode-output-name" className="text-[9px] font-semibold tracking-[0.14em] text-white/40 uppercase">
              Dateiname
            </label>
            <input
              id="gcode-output-name"
              type="text"
              value={outputName}
              onChange={(e) => onOutputName(e.target.value)}
              placeholder="z. B. Zusammenbau"
              spellCheck={false}
              className="mt-1 w-full rounded-lg border border-line/80 bg-ink-950/70 px-2 py-1.5 font-mono text-[11px] text-white/85 outline-none transition placeholder:text-white/25 focus:border-mint/60"
            />
            <p className="mt-1 text-[9px] leading-snug text-white/30">
              Gilt für Speichern und Drucker-Versand. Ohne Endung wird .gcode ergänzt; Leerzeichen werden zu
              Unterstrichen.
            </p>
          </div>

          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-[10px] text-white/40">
              <span>Schicht {Math.min(layer + 1, result.layers.length)} / {result.layers.length}</span>
              <span className="tabular">z {result.layers[Math.min(layer, result.layers.length - 1)]?.z.toFixed(2)} mm</span>
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(0, result.layers.length - 1)}
              value={Math.min(layer, result.layers.length - 1)}
              onChange={(e) => onLayer(parseInt(e.target.value, 10))}
              className="w-full cursor-pointer appearance-none rounded-full bg-line"
            />
            <div className="mt-2 flex items-center justify-between">
              <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-white/45">
                <input
                  type="checkbox"
                  checked={showAll}
                  onChange={(e) => onShowAll(e.target.checked)}
                  className="accent-amber"
                />
                alle Schichten bis hier
              </label>
              <button
                type="button"
                onClick={onDownload}
                className="rounded-lg border border-line/80 px-2 py-1 text-[10px] text-white/55 transition hover:border-mint/40 hover:text-mint"
              >
                G-Code speichern…
              </button>
            </div>
          </div>

          <OutputMenu
            result={result}
            mesh={mesh}
            status={status}
            printerName={printerName}
            onDownload={onDownload}
            onSend={onSend}
            sending={sending}
            info={outputInfo}
          />

          {result.postProcess && (
            <div className="mt-3 rounded-lg border border-mint/25 bg-mint/[0.04] px-2 py-1.5 text-[9px] leading-snug text-mint/80">
              Post-Processing: <span className="font-mono">{result.postProcess.script}</span> ·{' '}
              {result.postProcess.durationMs} ms. Vorschau und Statistik beziehen sich auf den G-Code davor.
            </div>
          )}

          {result.warnings.length > 0 && (
            <ul className="mt-3 space-y-1">
              {result.warnings.map((w, i) => (
                <li key={i} className="rounded-lg border border-rose/25 bg-rose/8 px-2 py-1 text-[10px] text-rose/90">
                  {w}
                </li>
              ))}
            </ul>
          )}
          {result.sliceMs !== undefined && (
            <p className="mt-2 text-[9px] text-white/20">Slicing in {result.sliceMs} ms</p>
          )}
        </>
      ) : (
        <p className="mt-3 text-[11px] leading-relaxed text-white/30">
          Noch nicht geslict. Der Kern rechnet Konturen, Wände, Decklagen und Füllung — alles hier im Workspace.
        </p>
      )}
    </Panel>
  )
}

/**
 * Nach dem Slicen: G-Code speichern oder direkt an den Drucker geben — per USB
 * (Streaming) oder WLAN (Moonraker/OctoPrint). Zeigt außerdem, welches
 * Bett-Mesh im G-Code steckt.
 */
export function OutputMenu({
  result,
  mesh,
  status,
  printerName,
  onDownload,
  onSend,
  sending,
  info,
}: {
  result: SliceResult
  mesh: BedMesh | null
  status: PrinterStatus
  printerName: string
  onDownload: () => void
  onSend: (target: 'usb' | 'network' | 'network-idle') => void
  sending: boolean
  info: string | null
}) {
  const [action, setAction] = useState<'save' | 'usb' | 'network' | 'network-idle'>('save')
  const [confirm, setConfirm] = useState<{ target: 'usb' | 'network' } | null>(null)
  const [checked, setChecked] = useState(false)
  const online = status.connection === 'connected'
  const usbReady = online && (status.mode === 'serial' || status.mode === 'simulation')
  const netReady = online && (status.mode === 'klipper' || status.mode === 'octoprint')

  const values = mesh ? mesh.z.flat().filter((v) => Number.isFinite(v)) : []
  const mean = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0
  const rows = mesh?.z.length ?? 0
  const cols = mesh?.z[0]?.length ?? 0

  const run = () => {
    if (action === 'save') {
      onDownload()
      return
    }
    if (action === 'network-idle') {
      onSend(action)
      return
    }
    setChecked(false)
    setConfirm({ target: action })
  }
  const actionLabel =
    action === 'save'
      ? 'Speichern'
      : action === 'usb'
        ? 'USB-Druck starten'
        : action === 'network'
          ? 'WLAN-Druck starten'
          : 'Nur ablegen'
  const canRun =
    action === 'save' ? true : action === 'usb' ? usbReady : action === 'network' ? netReady : netReady

  return (
    <div data-testid="output-menu" className="mt-3 rounded-xl border border-line/70 bg-ink-900/40 p-2.5">
      <div className="flex items-center justify-between gap-2 text-[9px]">
        <span className="font-semibold tracking-[0.14em] text-white/40 uppercase">Ausgabe</span>
        <span className={mesh ? 'text-mint/80' : 'text-amber/70'}>
          {mesh
            ? `Bett-Mesh ${cols}×${rows} · Mittel ${mean >= 0 ? '+' : ''}${mean.toFixed(3)} mm · im G-Code`
            : 'Kein Mesh — G-Code ohne Bettkorrektur'}
        </span>
      </div>

      <div className="mt-2 flex gap-1.5">
        <select
          data-testid="output-action"
          value={action}
          onChange={(e) => setAction(e.target.value as 'save' | 'usb' | 'network' | 'network-idle')}
          className="min-w-0 flex-1 rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[10px] text-white/75 outline-none"
        >
          <option value="save">G-Code speichern unter… (SD-Karte)</option>
          <option value="usb" disabled={!usbReady}>
            USB-Druck starten{usbReady ? '' : ' (nicht verbunden)'}
          </option>
          <option value="network" disabled={!netReady}>
            WLAN-Druck starten{netReady ? ` (${printerName})` : ' (nicht verbunden)'}
          </option>
          <option value="network-idle" disabled={!netReady}>
            Nur ablegen — WLAN (ohne Start){netReady ? '' : ' (nicht verbunden)'}
          </option>
        </select>
        <button
          type="button"
          data-testid="output-run"
          disabled={sending || !canRun}
          onClick={run}
          className="rounded-lg bg-gradient-to-r from-mint to-[#8ef0c8] px-3 py-1.5 text-[10px] font-semibold text-ink-950 transition hover:brightness-110 disabled:opacity-40"
        >
          {sending ? 'Übertrage …' : actionLabel}
        </button>
      </div>

      <p className="mt-1.5 text-[9px] leading-snug text-white/30">
        {info ??
          (usbReady || netReady
            ? 'Speichern fragt den Zielort ab. Ein Druckstart wird zusätzlich mit einer kurzen Bestätigung abgesichert.'
            : 'Beim Speichern wird der Zielort abgefragt. Für USB oder WLAN zuerst unter „Drucker“ verbinden.')}
      </p>

      {confirm &&
        createPortal(
          <div
            className="fixed inset-0 z-[90] grid place-items-center bg-ink-950/75 p-4 backdrop-blur-sm"
            role="presentation"
            onMouseDown={() => setConfirm(null)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Druckstart bestätigen"
              data-testid="print-confirm"
              className="w-full max-w-md rounded-2xl border border-amber/40 bg-ink-900 p-4 shadow-2xl"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white/90">Druck wirklich starten?</div>
                  <div className="mt-1 text-[10px] leading-snug text-white/45">
                    {confirm.target === 'usb' ? 'USB-Streaming' : 'WLAN'} · {printerName}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirm(null)}
                  className="text-white/30 hover:text-white/70"
                  aria-label="Druckbestätigung schließen"
                >
                  ✕
                </button>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-line/60 bg-ink-950/50 px-2.5 py-2">
                  <dt className="text-[9px] tracking-wider text-white/30 uppercase">Druckzeit</dt>
                  <dd className="tabular mt-0.5 text-xs font-semibold text-white/80">
                    {formatDuration(result.stats.estimatedSeconds)}
                  </dd>
                </div>
                <div className="rounded-xl border border-line/60 bg-ink-950/50 px-2.5 py-2">
                  <dt className="text-[9px] tracking-wider text-white/30 uppercase">Material</dt>
                  <dd className="tabular mt-0.5 text-xs font-semibold text-white/80">
                    {formatWeight(result.stats.filamentGrams)}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 rounded-xl border border-amber/30 bg-amber/8 px-2.5 py-2 text-[10px] leading-relaxed text-amber/85">
                Der Druck startet direkt nach der Bestätigung. Bitte Bett, Düse und Material vorher prüfen.
              </p>
              <label className="mt-3 flex cursor-pointer items-start gap-2 text-[10px] leading-snug text-white/60">
                <input
                  type="checkbox"
                  data-testid="print-confirm-check"
                  checked={checked}
                  onChange={(event) => setChecked(event.target.checked)}
                  className="mt-0.5 accent-amber"
                />
                Ich habe Bett, Düse und Material geprüft.
              </label>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  data-testid="print-confirm-cancel"
                  onClick={() => setConfirm(null)}
                  className="rounded-lg border border-line/80 px-3 py-1.5 text-[10px] text-white/60 transition hover:text-white"
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  data-testid="print-confirm-start"
                  disabled={!checked}
                  onClick={() => {
                    const target = confirm.target
                    setConfirm(null)
                    onSend(target)
                  }}
                  className="rounded-lg bg-gradient-to-r from-amber to-[#ff9f45] px-3 py-1.5 text-[10px] font-semibold text-ink-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Druck starten
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}

/**
 * Einzelobjekte (aus 3MF) einzeln auswählen, aus-/einblenden, verschieben,
 * drehen und skalieren. Die Auswahl bestimmt, welches Objekt die Regler zeigt.
 */
export function ObjectsEditor({
  objects,
  filaments = [],
  selectedId,
  selectedIds = [],
  onSelect,
  onObjects,
}: {
  objects: ModelObjectInfo[]
  filaments?: { id: string; name: string }[]
  selectedId?: string | null
  selectedIds?: string[]
  onSelect?: (id: string, additive?: boolean) => void
  onObjects: (next: ModelObjectInfo[]) => void
}) {
  const [internalSelected, setInternalSelected] = useState<string | null>(null)
  const selected = selectedId !== undefined ? selectedId : internalSelected
  const active = objects.find((o) => o.id === selected) ?? objects[0] ?? null
  const marked = selectedIds.length ? selectedIds : selected ? [selected] : []
  const select = (id: string, additive = false) => {
    setInternalSelected(id)
    onSelect?.(id, additive)
  }
  const visible = objects.filter((o) => o.placement.visible).length
  const excluded = objects.filter((o) => o.excluded).length

  const patch = (id: string, next: Partial<ModelPlacement>) => {
    onObjects(objects.map((o) => (o.id === id ? { ...o, placement: { ...o.placement, ...next } } : o)))
  }

  return (
    <div className="mt-3 rounded-xl border border-line/70 bg-ink-900/40 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold tracking-[0.14em] text-white/40 uppercase">Objekte</span>
        <span className="text-[9px] text-white/30">
          {visible} von {objects.length} sichtbar{excluded > 0 ? ` · ${excluded} ausgeschlossen` : ''}
        </span>
      </div>

      <ul className="mt-1.5 space-y-1">
        {objects.map((o) => {
          const isActive = marked.includes(o.id)
          const lastVisible = o.placement.visible && visible === 1
          const objectSettingsText = o.settings
            ? describeSettingsOverrides(o.settings) || 'eigene Objektwerte'
            : ''
          return (
            <li key={o.id}>
              <div
                className={`flex items-center gap-1.5 rounded-lg border px-1.5 py-1 transition ${
                  isActive ? 'border-amber/50 bg-amber/8' : 'border-line/60 bg-ink-900/50 hover:border-white/15'
                }`}
              >
                <input
                  type="checkbox"
                  checked={o.placement.visible}
                  disabled={lastVisible}
                  onChange={(e) => patch(o.id, { visible: e.target.checked })}
                  className="accent-amber"
                  title={lastVisible ? 'Mindestens ein Objekt muss sichtbar bleiben' : 'Sichtbarkeit'}
                  aria-label={`${o.name} sichtbar`}
                />
                <button
                  type="button"
                  onClick={(e) => select(o.id, e.ctrlKey || e.metaKey)}
                  title="Strg-Klick wählt mehrere Teile fürs Zusammenbauen"
                  className="min-w-0 flex-1 text-left"
                >
                  <div className={`flex items-center gap-1.5 truncate text-[11px] font-medium ${
                      o.excluded
                        ? 'text-white/30 line-through'
                        : o.placement.visible
                          ? isActive
                            ? 'text-amber'
                            : 'text-white/80'
                          : 'text-white/30 line-through'
                    }`}>
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/25"
                      style={{ background: `hsl(${(filaments.findIndex((f) => f.id === o.placement.filamentId) * 67 + 28) % 360} 70% 55%)` }}
                    />
                    {o.name}
                    {o.text && (
                      <span className={`shrink-0 rounded px-1 py-0.5 text-[8px] ${o.negative ? 'bg-rose/20 text-rose/90' : 'bg-amber/20 text-amber/90'}`}>
                        {o.negative ? 'eingelassen' : 'Text'}
                      </span>
                    )}
                    {o.excluded && (
                      <span className="shrink-0 rounded bg-rose/20 px-1 py-0.5 text-[8px] text-rose/90">
                        ausgeschlossen
                      </span>
                    )}
                  </div>
                  <div className="tabular truncate text-[9px] text-white/30">
                    {o.plate !== undefined ? `Platte ${o.plate + 1} · ` : ''}
                    {o.size.x.toFixed(0)}×{o.size.y.toFixed(0)}×{o.size.z.toFixed(0)} mm · x {o.center.x.toFixed(1)} / y{' '}
                    {o.center.y.toFixed(1)}
                  </div>
                  {objectSettingsText && (
                    <div className="truncate text-[8px] leading-tight text-mint/60" title={`3MF-Objektwerte: ${objectSettingsText}`}>
                      3MF: {objectSettingsText}
                    </div>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onObjects(
                      objects.map((item) =>
                        item.id === o.id ? { ...item, excluded: !item.excluded } : item,
                      ),
                    )
                  }
                  className={`shrink-0 rounded px-1 py-0.5 text-[10px] ${
                    o.excluded ? 'text-rose hover:text-rose/80' : 'text-white/25 hover:text-rose'
                  }`}
                  title={o.excluded ? 'Wieder drucken' : 'Objekt ausschließen (nicht drucken)'}
                  aria-label={o.excluded ? `${o.name} wieder einschließen` : `${o.name} ausschließen`}
                >
                  {o.excluded ? '↺' : '⊘'}
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      {active && (
        <div className={`mt-2 space-y-1.5 ${active.placement.visible ? '' : 'opacity-40'}`}>
          <div className="grid grid-cols-2 gap-1.5">
            <Stepper
              label="X"
              unit="mm"
              value={active.placement.offsetX}
              step={1}
              min={-400}
              max={400}
              onChange={(v) => patch(active.id, { offsetX: v })}
            />
            <Stepper
              label="Y"
              unit="mm"
              value={active.placement.offsetY}
              step={1}
              min={-400}
              max={400}
              onChange={(v) => patch(active.id, { offsetY: v })}
            />
            <Stepper
              label="Drehung"
              unit="°"
              value={active.placement.rotationZ}
              step={15}
              min={-360}
              max={360}
              onChange={(v) => patch(active.id, { rotationZ: v })}
            />
            <Stepper
              label="Maßstab"
              unit="×"
              value={active.placement.scaleX}
              step={0.05}
              min={0.05}
              max={10}
              onChange={(v) => patch(active.id, { scaleX: v, scaleY: v, scaleZ: v })}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[9px] text-white/25">
              {active.placement.visible ? `Ausgewählt: ${active.name}` : 'ausgeblendet'}
            </span>
            <button
              type="button"
              onClick={() =>
                onObjects(
                  objects.map((o) =>
                    o.id === active.id
                      ? {
                          ...o,
                          placement: {
                            offsetX: 0,
                            offsetY: 0,
                            offsetZ: 0,
                            rotationX: 0,
                            rotationY: 0,
                            rotationZ: 0,
                            scaleX: 1,
                            scaleY: 1,
                            scaleZ: 1,
                            visible: true,
                          },
                        }
                      : o,
                  ),
                )
              }
              className="rounded-lg border border-line/80 px-2 py-0.5 text-[9px] text-white/45 transition hover:border-amber/40 hover:text-amber"
            >
              Zurücksetzen
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
