import { useState } from 'react'
import { PanelPortal } from './PanelPortal.tsx'
import * as api from '../api.ts'
import type {
  ScanFolderReport,
  ScanJobInfo,
  ScanMeshCandidate,
  ScanConfidence,
} from '../../shared/scanEngines.ts'
import { ENGINE_LABEL } from '../../shared/scanEngines.ts'

const field =
  'w-full rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[11px] text-white/80 outline-none focus:border-amber/60'

const CONFIDENCE_STYLE: Record<ScanConfidence, string> = {
  hoch: 'border-mint/35 bg-mint/[0.06] text-mint/90',
  mittel: 'border-amber/35 bg-amber/[0.06] text-amber/90',
  niedrig: 'border-white/15 bg-white/[0.04] text-white/50',
}

const ROLE_STYLE: Record<ScanMeshCandidate['role'], string> = {
  'Netz mit Textur': 'text-mint/85',
  Netz: 'text-white/75',
  Punktwolke: 'text-rose-300/85',
  unbekannt: 'text-amber/85',
}

/** Dateigrößen lesbar machen — unter 1 MB in KB, sonst in MB. */
const humanSize = (bytes: number | null) => {
  if (bytes === null) return ''
  if (bytes < 1048576) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1048576).toFixed(bytes > 10 * 1048576 ? 0 : 1).replace('.', ',')} MB`
}

/**
 * Scan-Ordner laden (V-23).
 *
 * Meshroom, COLMAP, openMVS und MicMac legen ihre Ergebnisse in eigenen
 * Ordnern ab. Der Dialog liest den Ordner nur, zeigt Engine, registrierte
 * Bilder und die Mesh-Kandidaten und lädt das gewählte Netz als Werkstück.
 * Danach übernimmt der Scan-Assistent Maßstab, Reparatur und Aushöhlen.
 */
export function ScanImportDialog({
  onLoad,
  onClose,
}: {
  onLoad: (buffer: ArrayBuffer, name: string) => Promise<boolean>
  onClose: () => void
}) {
  const [folder, setFolder] = useState('')
  const [report, setReport] = useState<ScanFolderReport | null>(null)
  const [job, setJob] = useState<ScanJobInfo | null>(null)
  const [files, setFiles] = useState(0)
  const [picked, setPicked] = useState<string | null>(null)
  const [busy, setBusy] = useState<'check' | 'load' | null>(null)
  const [error, setError] = useState('')

  const check = async () => {
    const target = folder.trim()
    if (!target) {
      setError('Bitte den Ordner der Engine angeben, z. B. C:\\Scans\\Büste.')
      return
    }
    setBusy('check')
    setError('')
    setReport(null)
    setJob(null)
    setPicked(null)
    try {
      const res = await api.inspectScanFolder(target)
      setReport(res.report)
      setJob(res.job)
      setFiles(res.files)
      // Der Server liefert den vollständigen Pfad — hier wird nichts gebaut.
      setPicked(res.report.candidates.find((entry) => entry.usable)?.absolutePath ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ordner konnte nicht gelesen werden.')
    } finally {
      setBusy(null)
    }
  }

  const load = async () => {
    if (!report || !picked) return
    setBusy('load')
    setError('')
    try {
      const { buffer, name } = await api.fetchScanMesh(picked)
      const ok = await onLoad(buffer, name)
      if (ok) {
        onClose()
        return
      }
      setError('Das Mesh ließ sich nicht als Werkstück laden.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mesh konnte nicht geladen werden.')
    } finally {
      setBusy(null)
    }
  }

  // Ein Job-Ordner ohne Engine-Spuren ist die Ausgabe der Scan-App — dann heißt
  // er auch so, statt „unbekannte Herkunft“.
  const appJob = report !== null && report.engine === 'unknown' && job !== null
  const engineName = report ? (appJob ? 'MeshScan-App' : ENGINE_LABEL[report.engine]) : ''
  const chosen = report?.candidates.find((entry) => entry.absolutePath === picked) ?? null

  const ui = (
    <div
      className="fixed inset-y-0 right-0 z-50 flex w-[460px] max-w-full flex-col border-l border-line/80 bg-ink-900/97 shadow-2xl backdrop-blur-xl"
      role="dialog"
      aria-modal="true"
      aria-label="Scan-Ordner laden"
    >
      <div className="flex items-start justify-between gap-3 border-b border-line/60 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-white/85">Scan-Ordner laden</h3>
          <p className="mt-0.5 text-[10px] leading-snug text-white/35">
            Meshroom, COLMAP, openMVS oder MicMac — der Ordner wird nur gelesen, nichts hochgeladen.
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-white/30 transition hover:text-white/70" aria-label="Schließen">
          ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[9px] tracking-wider text-white/40 uppercase">Ausgabeordner</span>
            <div className="flex gap-1.5">
              <input
                value={folder}
                onChange={(event) => setFolder(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void check()
                }}
                placeholder={'C:\\Scans\\Büste\\MeshroomCache'}
                spellCheck={false}
                className={field}
              />
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void check()}
                className="shrink-0 rounded-lg border border-line/80 px-2.5 py-1.5 text-[10px] text-white/70 transition hover:border-white/25 disabled:opacity-40"
              >
                {busy === 'check' ? 'Lese …' : 'Prüfen'}
              </button>
            </div>
            <p className="mt-1 text-[9px] leading-snug text-white/30">
              Vollständiger Pfad zum Ordner, in dem die Engine ihre Ergebnisse ablegt — auch ein übergeordneter
              Projektordner mit <span className="text-white/45">MeshroomCache</span> oder{' '}
              <span className="text-white/45">sparse/0</span> darin.
            </p>
          </label>

          {job && (
            <div className="rounded-xl border border-sky-500/25 bg-sky-500/[0.05] px-2.5 py-2 text-sky-200/90">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] font-semibold">{job.name ?? 'Scan-Job'}</span>
                <span className="shrink-0 text-[9px] opacity-70">{job.statusLabel}</span>
              </div>
              <p className="mt-0.5 text-[9px] leading-snug opacity-75">
                MeshScan-Job{job.id ? ` ${job.id}` : ''}
                {job.photos !== null ? ` · ${job.photos} Foto${job.photos === 1 ? '' : 's'}` : ''}
                                    {job.meshBytes ? ` · App-Mesh ${humanSize(job.meshBytes)} (GLB)` : ''}
              </p>
              {job.error && <p className="mt-0.5 text-[9px] leading-snug text-rose-300">{job.error}</p>}
            </div>
          )}

          {report && (
            <>
              <div className={`rounded-xl border px-2.5 py-2 ${CONFIDENCE_STYLE[report.confidence]}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] font-semibold">{engineName}</span>
                  <span className="shrink-0 text-[9px] opacity-70">
                    {appJob ? 'Herkunft aus job.json' : `Erkennung ${report.confidence}`}
                  </span>
                </div>
                <p className="mt-0.5 text-[9px] leading-snug opacity-75">
                  {report.images
                    ? `${report.images.count} registrierte Bild${report.images.count === 1 ? '' : 'er'} (${report.images.source})`
                    : job
                      ? 'Ausgabe der Scan-App — die Rechen-Engine steht im Job-Protokoll'
                      : report.engine === 'unknown'
                        ? 'Kein Engine-Projekt erkannt'
                        : 'Keine Bildliste im Ordner — Anzahl der registrierten Bilder unbekannt'}
                  {' · '}
                  {files.toLocaleString('de-DE')} {files === 1 ? 'Datei' : 'Dateien'} gelesen
                </p>
                {report.evidence.length > 0 && (
                  <p className="mt-0.5 text-[9px] leading-snug opacity-60">{report.evidence.join(' · ')}</p>
                )}
              </div>

              <div className="rounded-xl border border-line/60 bg-ink-950/40 p-2">
                <span className="text-[9px] font-semibold tracking-wider text-white/45 uppercase">
                  Mesh im Ordner
                </span>
                {report.candidates.length ? (
                  <ul className="mt-1.5 space-y-1">
                    {report.candidates.slice(0, 12).map((candidate) => (
                      <li key={candidate.absolutePath}>
                        <label
                          className={`flex cursor-pointer items-start gap-1.5 rounded-lg border px-2 py-1.5 transition ${
                            picked === candidate.absolutePath
                              ? 'border-amber/45 bg-amber/[0.06]'
                              : 'border-line/60 bg-ink-900/40 hover:border-white/20'
                          } ${candidate.usable ? '' : 'opacity-60'}`}
                        >
                          <input
                            type="radio"
                            name="scan-mesh"
                            className="mt-0.5 accent-amber"
                            checked={picked === candidate.absolutePath}
                            disabled={!candidate.usable}
                            onChange={() => setPicked(candidate.absolutePath)}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-[10px] text-white/80">{candidate.file}</span>
                              <span className={`shrink-0 text-[9px] ${ROLE_STYLE[candidate.role]}`}>
                                {candidate.role}
                                {candidate.size ? ` · ${humanSize(candidate.size)}` : ''}
                              </span>
                            </span>
                            {candidate.path !== candidate.file && (
                              <span className="block truncate text-[8px] text-white/30">{candidate.path}</span>
                            )}
                            {candidate.note && (
                              <span className="block text-[8px] leading-snug text-white/35">{candidate.note}</span>
                            )}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1.5 text-[10px] leading-snug text-white/40">
                    Kein STL, OBJ, PLY, 3MF oder GLB gefunden.
                  </p>
                )}
                {report.candidates.length > 12 && (
                  <p className="mt-1 text-[8px] text-white/25">
                    {report.candidates.length - 12} weitere Dateien nicht gelistet — das beste Netz steht oben.
                  </p>
                )}
              </div>

              {report.warnings.length > 0 && (
                <ul className="space-y-1">
                  {report.warnings.map((warning, index) => (
                    <li
                      key={index}
                      className="rounded-lg border border-amber/30 bg-amber/[0.05] px-2 py-1.5 text-[9px] leading-snug text-amber/85"
                    >
                      {warning}
                    </li>
                  ))}
                </ul>
              )}

              <p className="rounded-lg border border-line/60 bg-ink-950/40 px-2 py-1.5 text-[9px] leading-snug text-white/40">
                Nach dem Laden: Menü <span className="text-white/60">Bearbeiten → Scan-Assistent</span> für Maßstab,
                Reparatur und Aushöhlen.{' '}
                {chosen ? `Auswahl: ${engineName} · ${chosen.file}` : ''}
              </p>
            </>
          )}

          {error && (
            <p className="rounded-lg border border-rose-500/35 bg-rose-500/[0.07] px-2 py-1.5 text-[9px] leading-snug text-rose-200">
              {error}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line/60 px-4 py-3">
        <span className="text-[8px] leading-snug text-white/25">
          Der Ordner bleibt unverändert. Es wird nichts gedruckt und nichts an den Drucker geschickt.
        </span>
        <button
          type="button"
          disabled={!report || !picked || busy !== null}
          onClick={() => void load()}
          className="shrink-0 rounded-lg bg-gradient-to-r from-amber to-[#ffcf7a] px-3 py-1.5 text-[10px] font-semibold text-ink-950 transition hover:brightness-110 disabled:opacity-40"
        >
          {busy === 'load' ? 'Lade Mesh …' : 'Als Werkstück laden'}
        </button>
      </div>
    </div>
  )

  return <PanelPortal>{ui}</PanelPortal>
}
