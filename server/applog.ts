import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir } from './history.ts'

const MAX_BYTES = 2 * 1024 * 1024
let target: string | null = null
let started = false

/** Pfad der Logdatei (null, solange das Dateilogging nicht aktiv ist). */
export function logPath(): string | null {
  return target
}

function toLine(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * Die EXE läuft ohne Konsolenfenster (Windows-GUI-Subsystem). Damit Meldungen
 * und Fehler nicht verloren gehen, wird stdout/stderr zusätzlich in eine Datei
 * im Datenordner geschrieben. Bei 2 MB wird die alte Datei zu .old.log.
 */
export function initFileLog(): string | null {
  if (started) return target
  started = true
  try {
    const dir = join(dataDir(), 'logs')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'easy-slicer.log')
    try {
      if (statSync(file).size > MAX_BYTES) renameSync(file, join(dir, 'easy-slicer.old.log'))
    } catch {
      /* Datei gibt es noch nicht */
    }
    target = file

    const write = (level: string, args: unknown[]) => {
      try {
        const line = args.map(toLine).join(' ')
        appendFileSync(file, `${new Date().toISOString()} ${level} ${line}\n`)
      } catch {
        /* Schreibfehler dürfen den Druck nicht stoppen */
      }
    }

    const out = console.log.bind(console)
    const err = console.error.bind(console)
    console.log = (...args: unknown[]) => {
      write('INFO', args)
      out(...args)
    }
    console.error = (...args: unknown[]) => {
      write('FEHL', args)
      err(...args)
    }
    process.on('uncaughtException', (e) => write('ABST', [e]))
    process.on('unhandledRejection', (e) => write('ABST', [e]))
    return file
  } catch {
    target = null
    return null
  }
}
