import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { registerCustomPrinter, unregisterCustomPrinter } from '../shared/catalog.ts'
import type { PrinterProfile } from '../shared/types.ts'
import { dataDir } from './history.ts'

/** Eigene Drucker (No-Name) — liegen wie der Messverlauf im Datenordner. */
const FILE = join(dataDir(), 'printers.json')

function read(): PrinterProfile[] {
  try {
    if (!existsSync(FILE)) return []
    const parsed = JSON.parse(readFileSync(FILE, 'utf8')) as { printers?: PrinterProfile[] }
    const list = parsed?.printers
    return Array.isArray(list) ? list.filter((p) => p && typeof p.id === 'string' && p.bed) : []
  } catch {
    // Beschädigte Datei darf den Slicer nicht aufhalten
    return []
  }
}

function write(printers: PrinterProfile[]): void {
  try {
    mkdirSync(dirname(FILE), { recursive: true })
    const tmp = `${FILE}.tmp`
    writeFileSync(tmp, JSON.stringify({ printers }, null, 2))
    renameSync(tmp, FILE)
  } catch {
    // Eigene Drucker sind ein Komfort-Feature — Fehler blockieren nichts
  }
}

export function listCustomPrinters(): PrinterProfile[] {
  return read()
}

/** Lädt gespeicherte Drucker in den Katalog (beim Serverstart). */
export function loadCustomPrinters(): PrinterProfile[] {
  const printers = read()
  printers.forEach(registerCustomPrinter)
  return printers
}

export function saveCustomPrinter(profile: PrinterProfile): PrinterProfile {
  const printers = read()
  const i = printers.findIndex((p) => p.id === profile.id)
  if (i >= 0) printers[i] = profile
  else printers.push(profile)
  write(printers)
  registerCustomPrinter(profile)
  return profile
}

export function deleteCustomPrinter(id: string): boolean {
  const printers = read()
  const next = printers.filter((p) => p.id !== id)
  if (next.length === printers.length) return false
  write(next)
  unregisterCustomPrinter(id)
  return true
}
