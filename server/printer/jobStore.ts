import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dataDir } from '../history.ts'
import type { PrintJobInfo } from './jobs.ts'

export type PersistedJob = PrintJobInfo

/**
 * Kleine, testbare Ablage für die Warteschlange. Die Metadaten liegen in einer
 * JSON-Datei, der G-Code je Auftrag in einer eigenen Datei. So wird die
 * JSON-Datei auch bei großen Druckdateien nicht unbrauchbar groß.
 */
export type JobStore = {
  load(): PersistedJob[]
  save(jobs: PersistedJob[]): void
  readGcode(id: string): string | null
  writeGcode(id: string, gcode: string): void
  deleteGcode(id: string): void
}

const VALID_STATUS = new Set(['queued', 'running', 'done', 'error', 'cancelled'])
const JOB_ID = /^[A-Za-z0-9_-]+$/

function fileGcodePath(directory: string, id: string): string | null {
  return JOB_ID.test(id) ? join(directory, `${id}.gcode`) : null
}

function validJob(value: unknown): value is PersistedJob {
  if (!value || typeof value !== 'object') return false
  const job = value as Partial<PersistedJob>
  return (
    typeof job.id === 'string' &&
    JOB_ID.test(job.id) &&
    typeof job.printerId === 'string' &&
    typeof job.name === 'string' &&
    (job.target === 'usb' || job.target === 'network') &&
    typeof job.status === 'string' &&
    VALID_STATUS.has(job.status) &&
    typeof job.createdAt === 'number' &&
    Number.isFinite(job.createdAt)
  )
}

/** Dateibasierte Queue-Ablage; `directory` ist für Tests injizierbar. */
export function createFileJobStore(directory = join(dataDir(), 'jobs')): JobStore {
  const file = join(directory, 'queue.json')

  return {
    load() {
      try {
        if (!existsSync(file)) return []
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as { jobs?: unknown }
        if (!Array.isArray(parsed.jobs)) return []
        return parsed.jobs.filter(validJob).slice(-80)
      } catch {
        // Eine beschädigte Queue darf den Slicer nicht am Start hindern.
        return []
      }
    },

    save(jobs) {
      mkdirSync(dirname(file), { recursive: true })
      const tmp = `${file}.tmp`
      writeFileSync(tmp, JSON.stringify({ version: 1, jobs }, null, 2))
      renameSync(tmp, file)
    },

    readGcode(id) {
      const path = fileGcodePath(directory, id)
      if (!path || !existsSync(path)) return null
      try {
        return readFileSync(path, 'utf8')
      } catch {
        return null
      }
    },

    writeGcode(id, gcode) {
      const path = fileGcodePath(directory, id)
      if (!path) throw new Error('Ungültige Auftrags-ID.')
      mkdirSync(dirname(path), { recursive: true })
      const tmp = `${path}.tmp`
      writeFileSync(tmp, gcode, 'utf8')
      renameSync(tmp, path)
    },

    deleteGcode(id) {
      const path = fileGcodePath(directory, id)
      if (!path) return
      try {
        unlinkSync(path)
      } catch {
        // Datei kann bereits fehlen; das ist kein Fehler.
      }
    },
  }
}

