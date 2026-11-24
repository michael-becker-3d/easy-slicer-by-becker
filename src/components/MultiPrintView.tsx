import { useEffect, useRef, useState } from 'react'
import type {
  FilamentProfile,
  ModelAnalysis,
  ModelObjectInfo,
  PrintSettings,
  PrinterProfile,
  PrinterStatus,
  SliceResult,
} from '../../shared/types.ts'
import {
  DEFAULT_SETTINGS,
  formatDuration,
  formatGcodeFilename,
  formatWeight,
  mergeSettings,
  applyPrinterOverrides,
} from '../../shared/types.ts'
import { applyPrinterLimits, effectivePrinterLimits } from '../../shared/limits.ts'
import { filamentById, plateById, settingsForFilament } from '../../shared/catalog.ts'
import type { Catalog } from '../api.ts'
import * as api from '../api.ts'
import { loadSnapshot } from '../printers.ts'

type WorkspacePrinter = {
  id: string
  name: string
  studio: number
  active: boolean
  model: string | null
}

type MultiModel = {
  id: string
  name: string
  format: string
  objects: ModelObjectInfo[]
  analysis: ModelAnalysis
}

type JobState = 'slicing' | 'ready' | 'starting' | 'queued' | 'started' | 'error'

type PlateJob = {
  plate: number
  printerId: string
  status: JobState
  gcode?: string
  fileName?: string
  settings?: PrintSettings
  stats?: SliceResult['stats']
  message?: string
}

type Props = {
  catalog: Catalog | null
  printers: WorkspacePrinter[]
  statuses: Record<string, PrinterStatus>
  filaments: FilamentProfile[]
}

const MAX_PLATES = 8

function defaultPrinterMap(printers: WorkspacePrinter[], count: number): Record<number, string> {
  return Object.fromEntries(
    Array.from({ length: count }, (_, plate) => [plate, printers[plate % Math.max(1, printers.length)]?.id ?? '']),
  )
}

function plateObjects(model: MultiModel | null, plate: number): ModelObjectInfo[] {
  return (model?.objects ?? []).filter(
    (object) => (object.plate ?? 0) === plate && object.placement.visible && !object.negative,
  )
}

function statusLabel(status: PrinterStatus | undefined): string {
  if (!status) return 'nicht verbunden'
  if (status.connection === 'connecting') return 'verbindet …'
  if (status.connection === 'error') return status.message ?? 'Fehler'
  if (status.connection !== 'connected') return 'nicht verbunden'
  if (status.print.state === 'printing') return `${Math.round(status.print.progress * 100)} %`
  if (status.print.state === 'paused') return 'pausiert'
  return 'bereit'
}

function queueStatusLabel(job: api.PrintJob, status: PrinterStatus | undefined): string {
  if (job.status === 'queued') return 'wartet'
  if (job.status === 'running') {
    if (status?.print.state === 'printing') return `${Math.round(status.print.progress * 100)} %`
    if (status?.print.state === 'paused') return 'pausiert'
    return 'läuft'
  }
  if (job.status === 'done') return 'fertig'
  if (job.status === 'cancelled') return 'entfernt'
  return 'Fehler'
}

export function MultiPrintView({ catalog, printers, statuses, filaments }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [model, setModel] = useState<MultiModel | null>(null)
  const [plateCount, setPlateCount] = useState(3)
  const [platePrinters, setPlatePrinters] = useState<Record<number, string>>({})
  const [jobs, setJobs] = useState<Record<number, PlateJob>>({})
  const [queue, setQueue] = useState<api.PrintJob[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  // Die Queue liegt im Server und bleibt beim Ansichtswechsel erhalten.
  useEffect(() => {
    let alive = true
    const refresh = () => {
      void api
        .fetchPrintJobs()
        .then((next) => {
          if (alive) setQueue(next)
        })
        .catch(() => undefined)
    }
    refresh()
    const timer = setInterval(refresh, 2500)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  const loadFile = async (file: File) => {
    setBusy('load')
    setError(null)
    setNotice(null)
    try {
      const uploaded = await api.uploadModel(await file.arrayBuffer(), file.name, printers[0]?.id)
      const detected = Math.max(
        1,
        uploaded.plates ?? 1,
        ...uploaded.objects.map((object) => (object.plate ?? 0) + 1),
      )
      const count = Math.max(1, Math.min(MAX_PLATES, detected))
      setModel({
        id: uploaded.id,
        name: file.name,
        format: uploaded.format,
        objects: uploaded.objects,
        analysis: uploaded.analysis,
      })
      setPlateCount(count)
      setPlatePrinters(defaultPrinterMap(printers, count))
      setJobs({})
      setNotice(
        `${file.name} geladen — ${uploaded.objects.length} Teil(e). Platten anlegen, Teile zuordnen, dann Drucker wählen.` +
          (detected === 1 && uploaded.objects.length > 1
            ? ' Tipp: Oben 2 oder 3 Platten wählen und „Teile verteilen“ nutzen.'
            : ''),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Datei konnte nicht geladen werden.')
    } finally {
      setBusy(null)
    }
  }

  const assignObject = async (objectId: string, plate: number) => {
    if (!model) return
    setBusy('assign')
    setError(null)
    try {
      const res = await api.setObjects(model.id, [{ id: objectId, plate }])
      setModel((prev) => (prev ? { ...prev, objects: res.objects, analysis: res.analysis } : prev))
      setJobs({})
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Teil konnte nicht auf die Platte gelegt werden.')
    } finally {
      setBusy(null)
    }
  }

  const distributeParts = async () => {
    if (!model) return
    const parts = model.objects.filter((object) => object.placement.visible && !object.negative)
    if (!parts.length) return
    setBusy('assign')
    setError(null)
    try {
      const res = await api.setObjects(
        model.id,
        parts.map((object, index) => ({ id: object.id, plate: index % plateCount })),
      )
      setModel((prev) => (prev ? { ...prev, objects: res.objects, analysis: res.analysis } : prev))
      setJobs({})
      setNotice(`${parts.length} Teil(e) auf ${plateCount} Platten verteilt.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Teile konnten nicht verteilt werden.')
    } finally {
      setBusy(null)
    }
  }

  const changePlateCount = async (count: number) => {
    const next = Math.max(1, Math.min(MAX_PLATES, count))
    setPlateCount(next)
    setPlatePrinters((prev) => {
      const copy = { ...prev }
      for (let plate = 0; plate < next; plate++) {
        if (!copy[plate]) copy[plate] = printers[plate % Math.max(1, printers.length)]?.id ?? ''
      }
      return copy
    })
    setJobs({})
    if (!model) return
    const moved = model.objects.filter((object) => (object.plate ?? 0) >= next)
    if (!moved.length) return
    setBusy('assign')
    try {
      const res = await api.setObjects(
        model.id,
        moved.map((object) => ({ id: object.id, plate: Math.max(0, next - 1) })),
      )
      setModel((prev) => (prev ? { ...prev, objects: res.objects, analysis: res.analysis } : prev))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Platten konnten nicht angepasst werden.')
    } finally {
      setBusy(null)
    }
  }

  const assignPrinter = (plate: number, printerId: string) => {
    setPlatePrinters((prev) => ({ ...prev, [plate]: printerId }))
    setJobs((prev) => {
      const next = { ...prev }
      delete next[plate]
      return next
    })
  }

  const printerForPlate = (plate: number): PrinterProfile | null => {
    const id = platePrinters[plate]
    const base = catalog?.printers.find((printer) => printer.id === id)
    if (!base) return null
    return applyPrinterOverrides(base, loadSnapshot(base.id)?.setup.printerOverrides)
  }

  const settingsForPrinter = (printer: PrinterProfile): PrintSettings => {
    const snapshot = loadSnapshot(printer.id)
    const machine = { ...printer, ...effectivePrinterLimits(printer, snapshot?.setup.limits) }
    if (snapshot) {
      return applyPrinterLimits(machine, mergeSettings(DEFAULT_SETTINGS, snapshot.settings))
    }
    const filament = filaments[0] ?? filamentById('pla')
    const plate = catalog?.plates.find((item) => item.id === printer.defaultPlate) ?? plateById(printer.defaultPlate)
    return applyPrinterLimits(
      machine,
      settingsForFilament(catalog?.defaults ?? DEFAULT_SETTINGS, filament, plate, printer.nozzle),
    )
  }

  const preparePlate = async (plate: number) => {
    if (!model) return
    const printer = printerForPlate(plate)
    if (!printer) {
      setJobs((prev) => ({
        ...prev,
        [plate]: { plate, printerId: '', status: 'error', message: 'Kein Drucker zugewiesen.' },
      }))
      return
    }
    if (!plateObjects(model, plate).length) {
      setJobs((prev) => ({
        ...prev,
        [plate]: { plate, printerId: printer.id, status: 'error', message: 'Auf dieser Platte liegt kein Teil.' },
      }))
      return
    }
    const snapshot = loadSnapshot(printer.id)
    const settings = settingsForPrinter(printer)
    setJobs((prev) => ({
      ...prev,
      [plate]: { plate, printerId: printer.id, status: 'slicing' },
    }))
    try {
      const result = await api.sliceModel(
        model.id,
        settings,
        printer.id,
        plate,
        undefined,
        snapshot?.setup.customGcode,
        snapshot?.setup.postProcessing,
        snapshot?.setup.limits,
        snapshot?.setup.gcodeFlavor ?? printer.flavor,
        snapshot
          ? {
              filamentId: snapshot.setup.filamentId,
              slots: snapshot.setup.slots,
              activeSlotId: snapshot.setup.activeSlotId,
              printerOverrides: snapshot.setup.printerOverrides,
            }
          : undefined,
      )
      const fileName = formatGcodeFilename(settings.output.filenameFormat, {
        model: `${model.name.replace(/\.[^.]+$/, '')}_P${plate + 1}`,
        layerHeight: settings.layerHeight,
        filamentType: filaments.find((item) => item.id === snapshot?.setup.filamentId)?.material ?? 'PLA',
        printTime: formatDuration(result.stats.estimatedSeconds),
        nozzle: settings.nozzle,
      })
      setJobs((prev) => ({
        ...prev,
        [plate]: {
          plate,
          printerId: printer.id,
          status: 'ready',
          gcode: result.gcode,
          fileName,
          settings,
          stats: result.stats,
          message: `Fertig gerechnet — ${formatDuration(result.stats.estimatedSeconds)} · ${formatWeight(result.stats.filamentGrams)}.`,
        },
      }))
    } catch (err) {
      setJobs((prev) => ({
        ...prev,
        [plate]: {
          plate,
          printerId: printer.id,
          status: 'error',
          message: err instanceof Error ? err.message : 'Slicen fehlgeschlagen.',
        },
      }))
    }
  }

  const prepareAll = async () => {
    if (!model) return
    setBusy('slice')
    setError(null)
    for (let plate = 0; plate < plateCount; plate++) {
      if (plateObjects(model, plate).length) await preparePlate(plate)
    }
    setBusy(null)
  }

  const startPlate = async (plate: number) => {
    const job = jobs[plate]
    const printer = printerForPlate(plate)
    if (!job?.gcode || !job.settings || !model || !printer) return
    if (printer.control === 'manual') {
      setError(`${printer.name} unterstützt keinen Start aus dem Slicer.`)
      return
    }
    const connectionMode = statuses[printer.id]?.mode
    const target = connectionMode === 'klipper' || connectionMode === 'octoprint' ? 'network' : 'usb'
    if (queue.some((entry) => entry.printerId === printer.id && (entry.status === 'queued' || entry.status === 'running'))) {
      setError(`Für ${printer.name} läuft bereits ein Warteschlangen-Auftrag. Bitte dort einreihen oder den laufenden Auftrag abwarten.`)
      return
    }
    if (
      !window.confirm(
        `Druck auf „${printer.name}“ starten?\n\n${job.fileName ?? 'G-Code'}\n\nBitte Bett, Filament und Verbindung prüfen.`,
      )
    ) {
      return
    }
    setJobs((prev) => ({ ...prev, [plate]: { ...job, status: 'starting', message: 'Wird gesendet …' } }))
    try {
      await api.startPrint(
        job.gcode,
        job.fileName ?? 'easy-slicer.gcode',
        { modelId: model.id, settings: job.settings, profileId: printer.id },
        target,
      )
      setJobs((prev) => ({
        ...prev,
        [plate]: {
          ...job,
          status: 'started',
          message: `An ${printer.name} gesendet.`,
        },
      }))
    } catch (err) {
      setJobs((prev) => ({
        ...prev,
        [plate]: {
          ...job,
          status: 'error',
          message: err instanceof Error ? err.message : 'Druck konnte nicht gestartet werden.',
        },
      }))
    }
  }

  /**
   * Reiht einen fertig geslicten Auftrag ein. Der Server startet ihn sofort,
   * wenn der Drucker frei ist, sonst nach dem vorherigen Auftrag. Die
   * Sicherheitsabfrage steht bewusst vor dem Einreihen.
   */
  const enqueuePlate = async (plate: number, confirmed = false): Promise<boolean> => {
    const job = jobs[plate]
    const printer = printerForPlate(plate)
    if (!job?.gcode || !job.settings || !model || !printer) return false
    if (printer.control === 'manual') {
      setError(`${printer.name} unterstützt keinen Start aus dem Slicer.`)
      return false
    }
    const connectionMode = statuses[printer.id]?.mode
    const target = connectionMode === 'klipper' || connectionMode === 'octoprint' ? 'network' : 'usb'
    if (!confirmed) {
      const running = queue.some((entry) => entry.printerId === printer.id && (entry.status === 'queued' || entry.status === 'running'))
      if (
        !window.confirm(
          `Auftrag für „${printer.name}“ einreihen?\n\n${job.fileName ?? 'G-Code'}\n\n` +
            (running
              ? 'Der Auftrag startet automatisch nach dem laufenden Auftrag dieses Druckers.'
              : 'Der Druck startet nach dieser Bestätigung sofort. Bitte Bett, Filament und Verbindung prüfen.'),
        )
      ) {
        return false
      }
    }
    setJobs((prev) => ({
      ...prev,
      [plate]: { ...job, status: 'starting', message: 'Wird eingereiht …' },
    }))
    try {
      const queued = await api.enqueuePrintJob({
        printerId: printer.id,
        name: job.fileName ?? 'easy-slicer.gcode',
        gcode: job.gcode,
        target,
      })
      setQueue((prev) => [...prev.filter((entry) => entry.id !== queued.id), queued])
      setJobs((prev) => ({
        ...prev,
        [plate]: { ...job, status: 'queued', message: 'In der Warteschlange.' },
      }))
      return true
    } catch (err) {
      setJobs((prev) => ({
        ...prev,
        [plate]: {
          ...job,
          status: 'error',
          message: err instanceof Error ? err.message : 'Einreihen fehlgeschlagen.',
        },
      }))
      return false
    }
  }

  const enqueueAll = async () => {
    if (!model) return
    const ready = Array.from({ length: plateCount }, (_, plate) => plate).filter(
      (plate) => jobs[plate]?.status === 'ready' && jobs[plate]?.gcode,
    )
    if (!ready.length) {
      setError('Noch kein fertig geslicter Auftrag zum Einreihen.')
      return
    }
    const names = ready
      .map((plate) => `Platte ${plate + 1} → ${printerForPlate(plate)?.name ?? 'kein Drucker'}`)
      .join('\n')
    if (
      !window.confirm(
        `${ready.length} Auftrag/Aufträge einreihen?\n\n${names}\n\n` +
          'Pro Drucker läuft immer nur ein Auftrag; verschiedene Drucker starten parallel. Der nächste Auftrag startet automatisch nach dem vorherigen.',
      )
    ) {
      return
    }
    setBusy('queue')
    setError(null)
    for (const plate of ready) await enqueuePlate(plate, true)
    setBusy(null)
  }

  const removeQueued = async (id: string) => {
    try {
      const next = await api.cancelPrintJob(id)
      setQueue((prev) => prev.map((entry) => (entry.id === next.id ? next : entry)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Auftrag konnte nicht entfernt werden.')
    }
  }

  const reset = () => {
    setModel(null)
    setJobs({})
    setError(null)
    setNotice(null)
    setPlateCount(3)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-mint/25 bg-mint/[0.04] px-4 py-3">
        <div>
          <div className="text-[10px] font-semibold tracking-[0.18em] text-mint/70 uppercase">Multiprint</div>
          <h1 className="mt-1 text-sm font-semibold text-white/90">Eine Datei — mehrere Platten — mehrere Drucker</h1>
          <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-white/40">
            3MF laden, Teile auf Platten verteilen, jeder Platte einen Drucker zuweisen und die Jobs einzeln
            vorbereiten. Der bestehende Studio-Betrieb bleibt unverändert.
          </p>
        </div>
        {model && (
          <button
            type="button"
            onClick={reset}
            className="rounded-xl border border-line/80 px-3 py-1.5 text-[10px] text-white/55 transition hover:border-white/25 hover:text-white"
          >
            Neue Datei
          </button>
        )}
      </div>

      {error && (
        <div className="mb-3 flex items-start justify-between gap-2 rounded-xl border border-rose/30 bg-rose/10 px-3 py-2 text-[11px] text-rose/90">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-rose/60 hover:text-rose">✕</button>
        </div>
      )}
      {notice && (
        <div className="mb-3 flex items-start justify-between gap-2 rounded-xl border border-mint/25 bg-mint/8 px-3 py-2 text-[11px] text-mint/85">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-mint/50 hover:text-mint">✕</button>
        </div>
      )}

      {!model ? (
        <div
          className={`grid min-h-[420px] flex-1 place-items-center rounded-3xl transition ${
            dragging ? 'bg-amber/[0.06] ring-2 ring-inset ring-amber/40' : ''
          }`}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
          }}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            const file = event.dataTransfer.files?.[0]
            if (file) void loadFile(file)
          }}
        >
          <div className="w-full max-w-xl rounded-3xl border border-dashed border-line/80 bg-ink-900/35 p-8 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-amber/30 bg-amber/10 text-2xl text-amber">
              ▦
            </div>
            <h2 className="mt-4 text-sm font-semibold text-white/85">Welche Datei soll auf die Platten?</h2>
            <p className="mx-auto mt-2 max-w-md text-[11px] leading-relaxed text-white/40">
              3MF mit mehreren Platten wird direkt übernommen. Bei einer Datei mit mehreren Teilen auf einer Platte
              kannst du anschließend 2 oder 3 Platten anlegen und die Teile zuordnen.
            </p>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy === 'load'}
              className="mt-5 rounded-xl bg-gradient-to-r from-amber to-[#ff9f45] px-4 py-2 text-[11px] font-semibold text-ink-950 transition hover:brightness-110 disabled:opacity-40"
            >
              {busy === 'load' ? 'Lädt …' : '3MF / STL öffnen'}
            </button>
            <p className="mt-2 text-[9px] text-white/25">oder Datei hierher ziehen · 3MF, STL, OBJ, PLY</p>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-line/70 bg-ink-900/50 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-[11px] font-medium text-white/80">{model.name}</div>
              <div className="text-[9px] text-white/30">
                {model.objects.length} Teil(e) · {model.analysis.triangles.toLocaleString('de-DE')} Dreiecke
              </div>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <span className="text-[9px] text-white/30">Platten</span>
              {[1, 2, 3, 4].map((count) => (
                <button
                  key={count}
                  type="button"
                  onClick={() => void changePlateCount(count)}
                  className={`rounded-lg border px-2 py-1 text-[10px] transition ${
                    plateCount === count
                      ? 'border-amber/60 bg-amber/12 text-amber'
                      : 'border-line/70 text-white/45 hover:border-white/25'
                  }`}
                >
                  {count}
                </button>
              ))}
              <button
                type="button"
                onClick={() => void distributeParts()}
                disabled={busy === 'assign'}
                className="ml-1 rounded-lg border border-mint/35 bg-mint/8 px-2 py-1 text-[10px] font-semibold text-mint/90 transition hover:bg-mint/15 disabled:opacity-40"
              >
                Teile verteilen
              </button>
              <button
                type="button"
                onClick={() => void prepareAll()}
                disabled={busy === 'slice' || printers.length === 0}
                className="rounded-lg bg-gradient-to-r from-amber to-[#ffcf7a] px-2.5 py-1 text-[10px] font-semibold text-ink-950 transition hover:brightness-110 disabled:opacity-40"
              >
                {busy === 'slice' ? 'Rechne …' : 'Alle Platten slicen'}
              </button>
              <button
                type="button"
                onClick={() => void enqueueAll()}
                disabled={
                  busy === 'queue' ||
                  !Object.values(jobs).some((job) => job.status === 'ready' && job.gcode)
                }
                className="rounded-lg border border-mint/35 bg-mint/8 px-2.5 py-1 text-[10px] font-semibold text-mint/90 transition hover:bg-mint/15 disabled:opacity-30"
                title="Reiht alle fertigen Platten ein; pro Drucker nacheinander, verschiedene Drucker parallel."
              >
                {busy === 'queue' ? 'Reiht ein …' : 'Alle einreihen'}
              </button>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <section className="rounded-2xl border border-line/70 bg-ink-900/45 p-3">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h2 className="text-[10px] font-semibold tracking-[0.16em] text-white/40 uppercase">Teile</h2>
                <span className="text-[9px] text-white/25">Platte wählen</span>
              </div>
              <ul className="space-y-1.5">
                {model.objects.map((object) => {
                  const plate = object.plate ?? 0
                  return (
                    <li key={object.id} className="flex items-center gap-2 rounded-xl border border-line/60 bg-ink-950/35 px-2 py-1.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[11px] text-white/75">{object.name}</div>
                        <div className="tabular text-[9px] text-white/30">
                          {object.size.x.toFixed(0)}×{object.size.y.toFixed(0)}×{object.size.z.toFixed(0)} mm
                          {object.excluded ? ' · ausgeschlossen' : ''}
                        </div>
                      </div>
                      <select
                        value={plate}
                        onChange={(e) => void assignObject(object.id, Number(e.target.value))}
                        disabled={busy === 'assign'}
                        className="rounded-lg border border-line/80 bg-ink-900/80 px-1.5 py-1 text-[10px] text-white/70 outline-none focus:border-amber/60 disabled:opacity-40"
                        aria-label={`${object.name} auf Platte`}
                      >
                        {Array.from({ length: plateCount }, (_, index) => (
                          <option key={index} value={index}>
                            Platte {index + 1}
                          </option>
                        ))}
                      </select>
                    </li>
                  )
                })}
              </ul>
              {model.objects.length === 0 && (
                <p className="text-[10px] text-white/30">Die Datei enthält keine sichtbaren Teile.</p>
              )}
            </section>

            <section className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-[10px] font-semibold tracking-[0.16em] text-white/40 uppercase">Platten &amp; Drucker</h2>
                <span className="text-[9px] text-white/25">Start erfolgt pro Platte</span>
              </div>
              {Array.from({ length: plateCount }, (_, plate) => {
                const parts = plateObjects(model, plate)
                const printer = printerForPlate(plate)
                const job = jobs[plate]
                const printerStatus = printer ? statuses[printer.id] : undefined
                return (
                  <div key={plate} className="rounded-2xl border border-line/70 bg-ink-900/45 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-lg bg-amber/15 px-2 py-1 text-[10px] font-semibold text-amber">
                        Platte {plate + 1}
                      </span>
                      <span className="text-[10px] text-white/35">
                        {parts.length} Teil(e)
                      </span>
                      <select
                        value={platePrinters[plate] ?? ''}
                        onChange={(e) => assignPrinter(plate, e.target.value)}
                        className="ml-auto min-w-[160px] rounded-lg border border-line/80 bg-ink-900/80 px-2 py-1 text-[10px] text-white/75 outline-none focus:border-amber/60"
                        aria-label={`Drucker für Platte ${plate + 1}`}
                      >
                        <option value="">Drucker wählen …</option>
                        {printers.map((printerOption) => (
                          <option key={printerOption.id} value={printerOption.id}>
                            {printerOption.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {parts.length > 0 ? (
                        parts.map((part) => (
                          <span key={part.id} className="max-w-full truncate rounded-md border border-line/60 bg-ink-950/40 px-1.5 py-0.5 text-[9px] text-white/45">
                            {part.name}
                          </span>
                        ))
                      ) : (
                        <span className="text-[9px] text-white/25">Leer — oben ein Teil dieser Platte zuordnen.</span>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line/50 pt-2">
                      <span className="text-[9px] text-white/30">
                        {printer ? `${printer.name} · ${statusLabel(printerStatus)}` : 'Kein Drucker im Arbeitsplatz'}
                      </span>
                      {job?.status === 'ready' && job.stats && (
                        <span className="tabular text-[9px] text-mint/80">
                          {formatDuration(job.stats.estimatedSeconds)} · {formatWeight(job.stats.filamentGrams)} · {job.stats.layerCount} Schichten
                        </span>
                      )}
                      {job?.message && (
                        <span className={`text-[9px] ${job.status === 'error' ? 'text-rose/80' : 'text-white/40'}`}>
                          {job.message}
                        </span>
                      )}
                      <div className="ml-auto flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => void preparePlate(plate)}
                          disabled={!printer || parts.length === 0 || job?.status === 'slicing' || job?.status === 'starting'}
                          className="rounded-lg border border-line/80 px-2 py-1 text-[10px] text-white/55 transition hover:border-amber/45 hover:text-amber disabled:opacity-30"
                        >
                          {job?.status === 'slicing' ? 'Rechne …' : job?.status === 'ready' ? 'Neu slicen' : 'Slicen'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void enqueuePlate(plate)}
                          disabled={job?.status !== 'ready' || !printer}
                          className="rounded-lg border border-mint/35 bg-mint/8 px-2 py-1 text-[10px] font-semibold text-mint/90 transition hover:bg-mint/15 disabled:opacity-30"
                          title="Reiht den Auftrag ein; der nächste startet automatisch nach dem vorherigen Auftrag dieses Druckers."
                        >
                          Einreihen
                        </button>
                        <button
                          type="button"
                          onClick={() => void startPlate(plate)}
                          disabled={job?.status !== 'ready' || !printer}
                          className="rounded-lg bg-gradient-to-r from-mint to-[#8ef0c8] px-2 py-1 text-[10px] font-semibold text-ink-950 transition hover:brightness-110 disabled:opacity-30"
                          title="Öffnet eine Sicherheitsabfrage; der Druck startet erst nach Bestätigung."
                        >
                          Sofort starten
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </section>
          </div>

          {queue.length > 0 && (
            <section className="mt-3 rounded-2xl border border-line/70 bg-ink-900/45 p-3">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h2 className="text-[10px] font-semibold tracking-[0.16em] text-white/40 uppercase">Warteschlange</h2>
                <span className="text-[9px] text-white/25">
                  {queue.filter((job) => job.status === 'running').length} läuft ·{' '}
                  {queue.filter((job) => job.status === 'queued').length} wartet
                </span>
              </div>
              <ul className="space-y-1.5">
                {[...queue].reverse().slice(0, 10).map((job) => {
                  const printer =
                    catalog?.printers.find((entry) => entry.id === job.printerId) ??
                    printers.find((entry) => entry.id === job.printerId)
                  return (
                    <li
                      key={job.id}
                      className="flex flex-wrap items-center gap-2 rounded-xl border border-line/60 bg-ink-950/35 px-2 py-1.5"
                    >
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          job.status === 'running'
                            ? 'animate-pulse bg-amber'
                            : job.status === 'queued'
                              ? 'bg-white/35'
                              : job.status === 'done'
                                ? 'bg-mint'
                                : 'bg-rose/70'
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[10px] text-white/75">{job.name}</div>
                        <div className="truncate text-[9px] text-white/30">
                          {printer?.name ?? job.printerId} · {queueStatusLabel(job, statuses[job.printerId])}
                          {job.message ? ` · ${job.message}` : ''}
                        </div>
                      </div>
                      {job.status === 'queued' && (
                        <button
                          type="button"
                          onClick={() => void removeQueued(job.id)}
                          className="rounded-lg border border-line/70 px-2 py-0.5 text-[9px] text-white/40 transition hover:border-rose/40 hover:text-rose/80"
                        >
                          Entfernen
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          <p className="mt-3 text-[9px] leading-relaxed text-white/25">
            Hinweis: Die Drucker müssen im Tab „Drucker“ verbunden sein. Die Warteschlange startet pro Drucker immer
            nur einen Auftrag und rückt nach dessen Ende automatisch nach; verschiedene Drucker laufen parallel. Sie
            bleibt nach einem Neustart erhalten; ein beim Neustart laufender Auftrag wird nicht automatisch wiederholt.
          </p>
        </>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".3mf,.stl,.obj,.ply,model/3mf,model/stl"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void loadFile(file)
          e.target.value = ''
        }}
      />
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0"
        onDragOver={(event) => event.preventDefault()}
      />
    </div>
  )
}
