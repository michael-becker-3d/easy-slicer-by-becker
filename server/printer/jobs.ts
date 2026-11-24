import type { PrinterStatus } from '../../shared/types.ts'
import type { PrinterHub } from './hub.ts'
import { createFileJobStore, type JobStore, type PersistedJob } from './jobStore.ts'

export type PrintJobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

export type PrintJobInfo = {
  id: string
  printerId: string
  name: string
  target: 'usb' | 'network'
  status: PrintJobStatus
  createdAt: number
  startedAt?: number
  finishedAt?: number
  message?: string
}

type StoredJob = PrintJobInfo & {
  gcode: string
  seenPrinting: boolean
  detach?: () => void
  timeout?: ReturnType<typeof setTimeout>
}

export type EnqueueJobInput = {
  printerId: string
  name: string
  gcode: string
  target?: 'usb' | 'network'
}

export type PrintJobQueueOptions = {
  /** Für Tests; im Betrieb liegt die Queue im Datenordner. */
  store?: JobStore
}

/**
 * Aufträge liegen im Server, nicht in der gerade sichtbaren Ansicht. Pro
 * Drucker läuft genau einer; weitere warten in Reihenfolge. Verschiedene
 * Drucker starten unabhängig voneinander.
 *
 * Die Metadaten und der G-Code werden gespeichert. Ein laufender Auftrag wird
 * nach einem Serverneustart bewusst nicht automatisch wiederholt; wartende
 * Aufträge bleiben dagegen erhalten und starten, sobald ihr Drucker wieder
 * verbunden und frei ist.
 */
export class PrintJobQueue {
  private readonly jobs: StoredJob[] = []
  private readonly active = new Map<string, string>()
  private readonly retryTimers = new Set<ReturnType<typeof setTimeout>>()
  private readonly onChange: () => void
  private readonly store: JobStore

  constructor(hub: PrinterHub, onChange: () => void, options: PrintJobQueueOptions = {}) {
    this.hub = hub
    this.onChange = onChange
    this.store = options.store ?? createFileJobStore()
    this.restore()
  }

  private readonly hub: PrinterHub

  list(): PrintJobInfo[] {
    return this.jobs.map((job) => this.publicJob(job))
  }

  enqueue(input: EnqueueJobInput): PrintJobInfo {
    const printerId = input.printerId?.trim()
    const gcode = input.gcode ?? ''
    if (!printerId) throw new Error('Drucker-ID fehlt.')
    if (!gcode.trim()) throw new Error('Kein G-Code übergeben.')
    const manager = this.hub.resolve(printerId)
    if (!manager.connected) throw new Error('Der Drucker ist nicht verbunden.')
    const target =
      input.target ??
      (manager.status.mode === 'klipper' || manager.status.mode === 'octoprint' ? 'network' : 'usb')
    if (target === 'network' && manager.status.mode !== 'klipper' && manager.status.mode !== 'octoprint') {
      throw new Error('Für die Warteschlange bitte den Drucker per Klipper/Moonraker oder OctoPrint verbinden.')
    }
    if (target === 'usb' && manager.status.mode !== 'serial' && manager.status.mode !== 'simulation') {
      throw new Error('Für USB bitte zuerst eine serielle Verbindung herstellen.')
    }

    const job: StoredJob = {
      id: `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      printerId,
      name: input.name || 'easy-slicer.gcode',
      target,
      status: 'queued',
      createdAt: Date.now(),
      gcode,
      seenPrinting: false,
      message: 'In der Warteschlange.',
    }
    try {
      this.store.writeGcode(job.id, gcode)
    } catch (err) {
      throw new Error(
        `Der Auftrag konnte nicht dauerhaft gespeichert werden: ${err instanceof Error ? err.message : 'Schreibfehler'}`,
      )
    }
    this.jobs.push(job)
    this.trim()
    this.changed()
    // Ein bereits laufender Druck blockiert den Start; die Queue bleibt dann
    // sichtbar und startet automatisch, sobald der Drucker frei ist.
    this.pump(printerId)
    return this.publicJob(job)
  }

  /** Entfernt einen noch wartenden Auftrag. Ein laufender Druck wird nicht abgebrochen. */
  cancel(id: string): PrintJobInfo {
    const job = this.jobs.find((entry) => entry.id === id)
    if (!job) throw new Error('Auftrag nicht gefunden.')
    if (job.status === 'running') {
      throw new Error('Der Auftrag läuft bereits — bitte am Drucker oder über „Druck abbrechen“ beenden.')
    }
    if (job.status !== 'queued') throw new Error('Der Auftrag ist bereits beendet.')
    job.status = 'cancelled'
    job.finishedAt = Date.now()
    job.message = 'Aus der Warteschlange entfernt.'
    job.gcode = ''
    this.store.deleteGcode(job.id)
    this.changed()
    this.pump(job.printerId)
    return this.publicJob(job)
  }

  /**
   * Nach dem Start und nach jeder Verbindungsänderung aufrufen. Ist der
   * Drucker frei, startet der nächste wartende Auftrag; ist er belegt oder
   * getrennt, bleibt der Auftrag mit einer verständlichen Meldung wartend.
   */
  observe(printerId: string, status: PrinterStatus): void {
    const queued = this.jobs.find((entry) => entry.printerId === printerId && entry.status === 'queued')
    if (!queued) return
    if (status.connection !== 'connected') {
      this.setMessage(queued, 'Wartet auf Verbindung zum Drucker.')
      return
    }
    if (status.print.state === 'printing' || status.print.state === 'paused') {
      this.setMessage(queued, 'Drucker ist belegt — wartet.')
      return
    }
    if (status.print.state === 'error') {
      this.setMessage(queued, 'Drucker meldet einen Fehler — wartet.')
      return
    }
    this.pump(printerId)
  }

  /** Nach dem Laden der Warteschlange alle Drucker prüfen. */
  resumeAll(): void {
    for (const printerId of new Set(this.jobs.filter((job) => job.status === 'queued').map((job) => job.printerId))) {
      this.pump(printerId)
    }
  }

  private restore(): void {
    for (const record of this.store.load()) {
      let status = record.status
      let message = record.message
      let gcode = ''
      let finishedAt = record.finishedAt
      if (status === 'running') {
        // Ein laufender Druck darf nach einem Neustart nicht doppelt starten.
        status = 'error'
        message = 'Server wurde neu gestartet — der laufende Auftrag wird nicht automatisch wiederholt.'
        finishedAt = Date.now()
        this.store.deleteGcode(record.id)
      } else if (status === 'queued') {
        gcode = this.store.readGcode(record.id) ?? ''
        if (!gcode.trim()) {
          status = 'error'
          message = 'Die gespeicherte G-Code-Datei fehlt — Auftrag kann nicht wiederhergestellt werden.'
          finishedAt = Date.now()
          this.store.deleteGcode(record.id)
        } else {
          message = 'Wartet auf Verbindung zum Drucker.'
        }
      } else {
        this.store.deleteGcode(record.id)
      }
      this.jobs.push({
        ...record,
        status,
        message,
        finishedAt,
        gcode,
        seenPrinting: false,
      })
    }
    this.trim()
    this.persist()
  }

  private publicJob(job: StoredJob): PrintJobInfo {
    return {
      id: job.id,
      printerId: job.printerId,
      name: job.name,
      target: job.target,
      status: job.status,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      message: job.message,
    }
  }

  private persistJob(job: StoredJob): PersistedJob {
    return {
      id: job.id,
      printerId: job.printerId,
      name: job.name,
      target: job.target,
      status: job.status,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      message: job.message,
    }
  }

  private persist(): void {
    try {
      this.store.save(this.jobs.map((job) => this.persistJob(job)))
    } catch (err) {
      // Ein Schreibfehler darf einen laufenden Druck nicht abbrechen.
      console.error('[easy-slicer] Warteschlange konnte nicht gespeichert werden:', err)
    }
  }

  private changed(): void {
    this.persist()
    try {
      this.onChange()
    } catch {
      // Eine Anzeige darf den Druckbetrieb nicht aufhalten.
    }
  }

  private setMessage(job: StoredJob, message: string): void {
    if (job.message === message) return
    job.message = message
    this.changed()
  }

  private trim(): void {
    while (this.jobs.length > 80) {
      const old = this.jobs.findIndex(
        (entry) => entry.status === 'done' || entry.status === 'error' || entry.status === 'cancelled',
      )
      if (old < 0) break
      const [removed] = this.jobs.splice(old, 1)
      if (removed) this.store.deleteGcode(removed.id)
    }
  }

  private pump(printerId: string): void {
    const job = this.jobs.find((entry) => entry.printerId === printerId && entry.status === 'queued')
    if (!job) return
    if (this.active.has(printerId)) {
      this.setMessage(job, 'Ein Auftrag läuft bereits — wartet.')
      return
    }
    const manager = this.hub.resolve(printerId)
    if (!manager.connected) {
      this.setMessage(job, 'Wartet auf Verbindung zum Drucker.')
      return
    }
    const printState = manager.status.print.state
    if (printState === 'printing' || printState === 'paused') {
      this.setMessage(job, 'Drucker ist belegt — wartet.')
      return
    }
    if (printState === 'error') {
      this.setMessage(job, 'Drucker meldet einen Fehler — wartet.')
      return
    }

    this.active.set(printerId, job.id)
    job.status = 'running'
    job.startedAt = Date.now()
    job.message = job.target === 'network' ? 'Datei wird an den Drucker gesendet …' : 'Übertragung wird gestartet …'
    this.changed()

    const observe = (status: PrinterStatus) => {
      if (status.connection !== 'connected') {
        if (job.status === 'running') this.finish(job, 'error', 'Verbindung während des Auftrags verloren.')
        return
      }
      const state = status.print.state
      if (state === 'printing' || state === 'paused') {
        job.seenPrinting = true
        this.setMessage(job, state === 'paused' ? 'Druck pausiert.' : 'Druck läuft.')
        return
      }
      if (!job.seenPrinting) {
        // Ein alter complete-Status einer vorherigen Datei darf niemals als
        // erfolgreicher Abschluss des neuen Auftrags gelten.
        if (state === 'complete') {
          this.finish(job, 'error', 'Drucker meldet einen Abschluss, aber der Start wurde nicht bestätigt.')
        }
        return
      }
      if (state === 'complete') this.finish(job, 'done', 'Druck fertig — Bett prüfen.')
      else if (state === 'cancelled') this.finish(job, 'cancelled', 'Druck wurde abgebrochen.')
      else if (state === 'error') this.finish(job, 'error', manager.status.message ?? 'Drucker meldet einen Fehler.')
    }

    manager.on('status', observe)
    job.detach = () => manager.off('status', observe)
    // Ein Auftrag darf die Queue nicht für immer blockieren, wenn ein Gerät
    // seinen Status nicht mehr meldet. 24 h sind bewusst großzügig.
    job.timeout = setTimeout(
      () => {
        this.finish(job, 'error', 'Zeitüberschreitung — der Drucker meldet seit 24 h keinen Abschluss.')
      },
      24 * 60 * 60 * 1000,
    )

    manager
      .print(job.gcode, job.name)
      .then(() => {
        if (job.status !== 'running') return
        const state = manager.status.print.state
        if (state === 'printing' || state === 'paused') this.setMessage(job, 'Start bestätigt — Druck läuft.')
        else if (job.target === 'network') this.setMessage(job, 'Datei liegt auf dem Drucker — Start bestätigt.')
        else this.setMessage(job, 'Übertragung gestartet.')
      })
      .catch((err) => {
        this.finish(job, 'error', err instanceof Error ? err.message : 'Druckstart fehlgeschlagen.')
      })
  }

  private finish(job: StoredJob, status: PrintJobStatus, message: string): void {
    if (job.status !== 'running') return
    job.status = status
    job.finishedAt = Date.now()
    job.message = message
    job.gcode = ''
    job.detach?.()
    job.detach = undefined
    if (job.timeout) clearTimeout(job.timeout)
    job.timeout = undefined
    this.active.delete(job.printerId)
    this.store.deleteGcode(job.id)
    this.changed()
    // Kurz warten, damit der Drucker den Abschluss verarbeitet, dann den
    // nächsten Auftrag desselben Druckers starten.
    const retry = setTimeout(() => {
      this.retryTimers.delete(retry)
      this.pump(job.printerId)
    }, 750)
    this.retryTimers.add(retry)
  }

  /** Beendet die Queue beim Herunterfahren, ohne einen Druck abzubrechen. */
  stop(): void {
    for (const job of this.jobs) {
      job.detach?.()
      if (job.timeout) clearTimeout(job.timeout)
      job.timeout = undefined
      job.detach = undefined
    }
    for (const timer of this.retryTimers) clearTimeout(timer)
    this.retryTimers.clear()
    this.active.clear()
  }
}
