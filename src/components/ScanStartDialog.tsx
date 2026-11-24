import { useEffect, useRef, useState } from 'react'
import { PanelPortal } from './PanelPortal.tsx'
import * as api from '../api.ts'
import {
  SCAN_GENERATOR_LABEL,
  SCAN_MAX_PHOTOS,
  SCAN_MAX_VIDEO_SECONDS,
  scanJobStatusLabel,
  type ScanGeneratorId,
  type ScanJob,
  type ScanServerInfo,
} from '../../shared/scanJobs.ts'

const field =
  'w-full rounded-lg border border-line/80 bg-ink-900/70 px-2 py-1.5 text-[11px] text-white/80 outline-none focus:border-amber/60'

const GENERATORS: ScanGeneratorId[] = ['auto', 'meshroom', 'colmap', 'micmac', 'openmvs']

type Phase = 'setup' | 'uploading' | 'processing' | 'loading' | 'error'

const humanSize = (bytes: number) =>
  bytes < 1048576
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1048576).toFixed(bytes > 10 * 1048576 ? 0 : 1).replace('.', ',')} MB`

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

const IMAGE_NAME = /\.(jpe?g|png|tiff?|bmp|webp|heic)$/i
const VIDEO_NAME = /\.(mp4|mov|m4v|avi|mkv|webm|insv|3gp)$/i

/**
 * Scan starten (A-154).
 *
 * Der Dialog nimmt bis zu 80 Fotos oder ein Video bis 60 s, lässt das
 * Rechenprogramm wählen und schickt alles an den lokalen MeshScan-Server.
 * Der rechnet das Mesh; sobald es fertig ist, holt der Dialog `mesh.glb` und
 * übergibt es dem normalen Import — der macht daraus ein STL-Werkstück, mit
 * dem sich sofort arbeiten lässt.
 */
export function ScanStartDialog({
  onLoad,
  onClose,
}: {
  onLoad: (buffer: ArrayBuffer, name: string) => Promise<boolean>
  onClose: () => void
}) {
  const [server, setServer] = useState<ScanServerInfo | null>(null)
  const [serverError, setServerError] = useState('')
  const [source, setSource] = useState<'photos' | 'video'>('photos')
  const [photos, setPhotos] = useState<File[]>([])
  const [video, setVideo] = useState<File | null>(null)
  const [generator, setGenerator] = useState<ScanGeneratorId>('auto')
  const [note, setNote] = useState('')
  const [job, setJob] = useState<ScanJob | null>(null)
  const [phase, setPhase] = useState<Phase>('setup')
  const [busyLabel, setBusyLabel] = useState('')
  const [error, setError] = useState('')
  const photoInput = useRef<HTMLInputElement>(null)
  const videoInput = useRef<HTMLInputElement>(null)
  const pollRef = useRef<{ cancelled: boolean } | null>(null)

  const files = source === 'video' ? (video ? [video] : []) : photos
  const running = phase === 'uploading' || phase === 'processing' || phase === 'loading'
  const bytes = files.reduce((sum, file) => sum + file.size, 0)

  useEffect(() => {
    let cancelled = false
    api
      .scanServerInfo()
      .then((info) => {
        if (!cancelled) setServer(info)
      })
      .catch((err) => {
        if (!cancelled) setServerError(err instanceof Error ? err.message : 'Scan-Server nicht erreichbar.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Während des Pollings den Dialog nicht abräumen.
  useEffect(() => {
    return () => {
      if (pollRef.current) pollRef.current.cancelled = true
    }
  }, [])

  const addPhotos = (picked: FileList | null) => {
    if (!picked?.length) return
    const list = Array.from(picked)
    const images = list.filter((file) => file.type.startsWith('image/') || IMAGE_NAME.test(file.name))
    if (!images.length) {
      setNote('Keine Bilddatei erkannt — erlaubt sind JPG, PNG, TIFF, BMP und WebP.')
      return
    }
    const merged = [...photos]
    for (const file of images) {
      if (!merged.some((entry) => entry.name === file.name && entry.size === file.size)) merged.push(file)
    }
    if (merged.length > SCAN_MAX_PHOTOS) {
      setPhotos(merged.slice(0, SCAN_MAX_PHOTOS))
      setNote(
        `Höchstens ${SCAN_MAX_PHOTOS} Fotos je Scan — die übrigen ${merged.length - SCAN_MAX_PHOTOS} wurden nicht übernommen.`,
      )
      return
    }
    setPhotos(merged)
    setNote(
      images.length < list.length
        ? `${list.length - images.length} Datei${list.length - images.length === 1 ? '' : 'en'} war kein Bild und wurde übersprungen.`
        : '',
    )
  }

  const pickVideo = (picked: FileList | null) => {
    const file = picked?.[0]
    if (!file) return
    if (!file.type.startsWith('video/') && !VIDEO_NAME.test(file.name)) {
      setNote('Keine Videodatei erkannt — erlaubt sind MP4, MOV, AVI, MKV und WebM.')
      return
    }
    const url = URL.createObjectURL(file)
    const probe = document.createElement('video')
    probe.preload = 'metadata'
    probe.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      const seconds = probe.duration
      if (Number.isFinite(seconds) && seconds > SCAN_MAX_VIDEO_SECONDS + 0.5) {
        setVideo(null)
        setNote(
          `Das Video ist ${clock(seconds)} min lang — erlaubt sind höchstens ${SCAN_MAX_VIDEO_SECONDS} s. Bitte kürzen und erneut wählen.`,
        )
        return
      }
      setVideo(file)
      setNote(
        Number.isFinite(seconds)
          ? `${clock(seconds)} min — der Scan-Server nimmt daraus gleichmäßig verteilte Einzelbilder.`
          : 'Die Länge ließ sich nicht lesen; der Scan-Server prüft das Video beim Rechnen.',
      )
    }
    probe.onerror = () => {
      URL.revokeObjectURL(url)
      setVideo(file)
      setNote('Die Länge ließ sich nicht lesen; der Scan-Server prüft das Video beim Rechnen.')
    }
    probe.src = url
  }

  const reset = () => {
    setJob(null)
    setPhase('setup')
    setBusyLabel('')
    setError('')
    setNote('')
  }

  const poll = async (current: ScanJob) => {
    const token = { cancelled: false }
    pollRef.current = token
    while (!token.cancelled) {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      if (token.cancelled) return
      let next: ScanJob
      try {
        next = await api.scanJobStatus(current.id)
      } catch (err) {
        if (token.cancelled) return
        setError(err instanceof Error ? err.message : 'Der Status ließ sich nicht lesen.')
        setPhase('error')
        return
      }
      if (token.cancelled) return
      setJob(next)
      if (next.status === 'ready') {
        await loadMesh(next, token)
        return
      }
      if (next.status === 'failed' || next.status === 'cancelled') {
        setError(
          next.error ??
            (next.status === 'cancelled'
              ? 'Der Scan wurde abgebrochen.'
              : 'Der Scan ist fehlgeschlagen — das Protokoll nennt den Grund.'),
        )
        setPhase('error')
        return
      }
    }
  }

  const loadMesh = async (finished: ScanJob, token: { cancelled: boolean }) => {
    setPhase('loading')
    setBusyLabel('Mesh wird geholt und als STL-Werkstück übernommen …')
    try {
      const mesh = await api.fetchScanJobMesh(finished.id, finished.name)
      if (token.cancelled) return
      const ok = await onLoad(mesh.buffer, mesh.name)
      if (token.cancelled) return
      if (ok) {
        onClose()
        return
      }
      throw new Error('Das Mesh ließ sich nicht als Werkstück laden.')
    } catch (err) {
      if (token.cancelled) return
      setError(err instanceof Error ? err.message : 'Das Mesh konnte nicht geladen werden.')
      setPhase('error')
    }
  }

  const start = async () => {
    if (!files.length || phase !== 'setup') return
    setError('')
    let created: ScanJob | null = null
    try {
      created = await api.startScanJob({
        engine: generator === 'auto' ? undefined : generator,
        name: source === 'video' ? video?.name.replace(/\.[^.]+$/, '') : undefined,
      })
      setJob(created)
      setPhase('uploading')
      for (let index = 0; index < files.length; index += 1) {
        setBusyLabel(
          `${source === 'video' ? 'Video' : `Foto ${index + 1} von ${files.length}`} wird übertragen …`,
        )
        await api.uploadScanFile(created.id, files[index], index)
      }
      setBusyLabel('Rechnen wird gestartet …')
      const started = await api.processScanJob(created.id)
      setJob(started)
      setPhase('processing')
      void poll(started)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Der Scan ließ sich nicht starten.')
      setPhase('error')
      // Ein halb angelegter Auftrag soll nicht als Leiche im Scan-Server liegen.
      if (created) void api.cancelScanJob(created.id).catch(() => undefined)
    }
  }

  const cancel = async () => {
    if (!job) return
    if (pollRef.current) pollRef.current.cancelled = true
    setBusyLabel('Wird abgebrochen …')
    try {
      await api.cancelScanJob(job.id)
    } catch {
      // Der Auftrag ist dann schon vorbei — der Zustand unten stimmt trotzdem.
    }
    reset()
    setNote('Abgebrochen. Die übertragenen Dateien liegen noch im Scan-Server.')
  }

  const activeLabel =
    server?.engines.aktiv && server.engines.aktiv in SCAN_GENERATOR_LABEL
      ? SCAN_GENERATOR_LABEL[server.engines.aktiv as ScanGeneratorId]
      : null

  const selectable = files.length > 0 && !serverError

  return (
    <PanelPortal>
      <div
        className="fixed inset-y-0 right-0 z-50 flex w-[460px] max-w-full flex-col border-l border-line/80 bg-ink-900/97 shadow-2xl backdrop-blur-xl"
        role="dialog"
        aria-modal="true"
        aria-label="Scan starten"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line/60 px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-white/85">Scan starten</h3>
            <p className="mt-0.5 text-[10px] leading-snug text-white/35">
              Fotos oder ein Video aufnehmen, Rechenprogramm wählen — das fertige Mesh kommt als
              STL-Werkstück zurück.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={running}
            className="text-white/30 transition hover:text-white/70 disabled:opacity-30"
            aria-label="Schließen"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <div className="space-y-3">
            {serverError && (
              <div className="rounded-xl border border-rose-500/35 bg-rose-500/[0.07] px-2.5 py-2 text-[10px] leading-snug text-rose-200">
                {serverError}
              </div>
            )}

            {server && (
              <div className="rounded-xl border border-line/60 bg-ink-950/40 px-2.5 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[9px] font-semibold tracking-wider text-white/45 uppercase">
                    Scan-Server
                  </span>
                  <span className="text-[9px] text-white/30">{server.ping.server}</span>
                </div>
                <p className="mt-0.5 text-[9px] leading-snug text-white/45">{server.ping.message}</p>
                {server.engines.mock && (
                  <p className="mt-0.5 text-[9px] leading-snug text-amber/85">
                    Testmodus: der Scan-Server liefert nur ein Beispiel-Modell, kein echtes Mesh.
                  </p>
                )}
              </div>
            )}

            {phase === 'setup' && (
              <>
                <div className="rounded-xl border border-line/60 bg-ink-950/40 p-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[9px] font-semibold tracking-wider text-white/45 uppercase">
                      1 · Aufnahme
                    </span>
                    <span className="text-[9px] text-white/30">
                      bis {SCAN_MAX_PHOTOS} Fotos oder {SCAN_MAX_VIDEO_SECONDS} s Video
                    </span>
                  </div>
                  <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setSource('photos')
                        setVideo(null)
                        setNote('')
                      }}
                      className={`rounded-lg border px-2 py-1.5 text-[10px] font-semibold transition ${
                        source === 'photos'
                          ? 'border-amber/50 bg-amber/10 text-amber'
                          : 'border-line/80 text-white/60 hover:border-white/25'
                      }`}
                    >
                      Fotos
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSource('video')
                        setPhotos([])
                        setNote('')
                      }}
                      className={`rounded-lg border px-2 py-1.5 text-[10px] font-semibold transition ${
                        source === 'video'
                          ? 'border-amber/50 bg-amber/10 text-amber'
                          : 'border-line/80 text-white/60 hover:border-white/25'
                      }`}
                    >
                      Video
                    </button>
                  </div>

                  <input
                    ref={photoInput}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(event) => {
                      addPhotos(event.target.files)
                      event.target.value = ''
                    }}
                  />
                  <input
                    ref={videoInput}
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={(event) => {
                      pickVideo(event.target.files)
                      event.target.value = ''
                    }}
                  />

                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <span className="text-[9px] leading-snug text-white/40">
                      {source === 'photos'
                        ? photos.length
                          ? `${photos.length} von ${SCAN_MAX_PHOTOS} Fotos · ${humanSize(bytes)}`
                          : 'Noch keine Fotos gewählt.'
                        : video
                          ? `${video.name} · ${humanSize(video.size)}`
                          : 'Noch kein Video gewählt.'}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        source === 'photos' ? photoInput.current?.click() : videoInput.current?.click()
                      }
                      className="shrink-0 rounded-lg border border-line/80 px-2.5 py-1.5 text-[10px] text-white/70 transition hover:border-white/25"
                    >
                      {source === 'photos' ? 'Fotos wählen …' : 'Video wählen …'}
                    </button>
                  </div>
                  {(photos.length > 0 || video) && (
                    <button
                      type="button"
                      onClick={() => {
                        setPhotos([])
                        setVideo(null)
                        setNote('')
                      }}
                      className="mt-1 text-[9px] text-white/35 hover:text-white/60"
                    >
                      Auswahl leeren
                    </button>
                  )}
                  <p className="mt-1 text-[9px] leading-snug text-white/30">
                    {source === 'photos'
                      ? 'Das Objekt von allen Seiten fotografieren, mit Überlappung — 30 bis 80 Fotos sind ideal.'
                      : 'Einmal rund um das Objekt filmen. Der Scan-Server nimmt daraus die schärfsten Einzelbilder.'}
                  </p>
                </div>

                <div className="rounded-xl border border-line/60 bg-ink-950/40 p-2">
                  <span className="text-[9px] font-semibold tracking-wider text-white/45 uppercase">
                    2 · Rechenprogramm
                  </span>
                  <select
                    value={generator}
                    onChange={(event) => setGenerator(event.target.value as ScanGeneratorId)}
                    className={`${field} mt-1.5`}
                  >
                    {GENERATORS.map((id) => {
                      const unavailable = id !== 'auto' && server?.engines.verfuegbar[id] === false
                      const label =
                        id === 'auto'
                          ? activeLabel
                            ? `Automatisch — ${activeLabel}`
                            : 'Automatisch (Einstellung des Scan-Servers)'
                          : SCAN_GENERATOR_LABEL[id]
                      return (
                        <option key={id} value={id} disabled={unavailable}>
                          {label}
                          {unavailable ? ' — nicht gefunden' : ''}
                        </option>
                      )
                    })}
                  </select>
                  <p className="mt-1 text-[9px] leading-snug text-white/30">
                    „Automatisch“ behält die im Scan-Server gemerkte Wahl. Meshroom texturiert das
                    Mesh; COLMAP/openMVS sind der zweite Weg, wenn Meshroom scheitert.
                  </p>
                </div>

                {note && (
                  <p className="rounded-lg border border-sky-500/25 bg-sky-500/[0.05] px-2 py-1.5 text-[9px] leading-snug text-sky-200/90">
                    {note}
                  </p>
                )}

                {error && (
                  <p className="rounded-lg border border-rose-500/35 bg-rose-500/[0.07] px-2 py-1.5 text-[9px] leading-snug text-rose-200">
                    {error}
                  </p>
                )}

                <button
                  type="button"
                  disabled={!selectable}
                  onClick={() => void start()}
                  className="w-full rounded-lg bg-gradient-to-r from-amber to-[#ffcf7a] px-3 py-2 text-[11px] font-semibold text-ink-950 transition hover:brightness-110 disabled:opacity-40"
                >
                  Scan starten
                </button>
              </>
            )}

            {phase !== 'setup' && (
              <div className="rounded-xl border border-line/60 bg-ink-950/40 p-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] font-semibold text-white/80">
                    {job?.name ?? 'Scan'}
                  </span>
                  <span className="shrink-0 text-[9px] text-white/40">
                    {job ? scanJobStatusLabel(job.status) : ''}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber to-[#ffcf7a] transition-all"
                    style={{ width: `${Math.max(2, Math.min(100, job?.progress ?? 0))}%` }}
                  />
                </div>
                <p className="mt-1 text-[9px] leading-snug text-white/45">
                  {phase === 'uploading'
                    ? busyLabel
                    : phase === 'loading'
                      ? busyLabel
                      : job?.photo_count
                        ? `${job.photo_count} Datei${job.photo_count === 1 ? '' : 'en'} übertragen · ${job.progress} %`
                        : `${job?.progress ?? 0} %`}
                </p>
                {job?.log?.length ? (
                  <ul className="mt-1.5 space-y-0.5 text-[9px] leading-snug text-white/35">
                    {job.log.slice(-3).map((line, index) => (
                      <li key={index} className="truncate">
                        {line}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {phase === 'processing' && (
                  <p className="mt-1.5 text-[9px] leading-snug text-white/25">
                    Je nach Fotos und Rechenprogramm dauert das einige Minuten. Das Fenster kann
                    offen bleiben; der Fortschritt aktualisiert sich alle 2 s.
                  </p>
                )}
              </div>
            )}

            {phase === 'error' && (
              <>
                <p className="rounded-lg border border-rose-500/35 bg-rose-500/[0.07] px-2 py-1.5 text-[9px] leading-snug text-rose-200">
                  {error}
                </p>
                {job?.log?.length ? (
                  <ul className="space-y-0.5 text-[9px] leading-snug text-white/35">
                    {job.log.slice(-5).map((line, index) => (
                      <li key={index}>{line}</li>
                    ))}
                  </ul>
                ) : null}
                <button
                  type="button"
                  onClick={reset}
                  className="w-full rounded-lg border border-line/80 px-3 py-2 text-[10px] text-white/70 transition hover:border-white/25"
                >
                  Zurück zur Auswahl
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-line/60 px-4 py-3">
          <span className="text-[8px] leading-snug text-white/25">
            Nur lokal: Die Dateien gehen an den Scan-Server auf diesem Rechner
            {server ? ` (${server.url})` : ''}. Nichts wird gedruckt oder ins Internet geladen.
          </span>
          {running && job ? (
            <button
              type="button"
              onClick={() => void cancel()}
              className="shrink-0 rounded-lg border border-rose-500/40 px-2.5 py-1.5 text-[10px] text-rose-200 transition hover:bg-rose-500/10"
            >
              Abbrechen
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              disabled={running}
              className="shrink-0 text-[10px] text-white/40 hover:text-white/70 disabled:opacity-30"
            >
              Schließen
            </button>
          )}
        </div>
      </div>
    </PanelPortal>
  )
}

