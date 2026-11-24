import type { PrintSettings, PrinterProfile } from '../shared/types.ts'
import type { CalibrationTestState } from './calibrationSettings.ts'
import { readLocal, writeLocal } from './persist.ts'
import type { Setup } from './setup.ts'

export type PrinterSnapshot = {
  setup: Setup
  settings: PrintSettings
  savedAt: number
  /** Marker eines laufenden Kalibriertests, getrennt je Drucker. */
  testStructureActive?: boolean
  /** Vollständiger Testzustand für den Fall, dass der Profilspeicher fehlt. */
  calibrationTest?: CalibrationTestState | null
}

/** Nur die Definition eigener Drucker; die Werte liegen im Snapshot. */
export type CustomPrinterBackup = Pick<
  PrinterProfile,
  'id' | 'name' | 'bed' | 'baud' | 'control' | 'hasBedLeveling'
>

/** Kompletter Stand aller Drucker — inklusive aktivem Drucker und Arbeitsplatz. */
export type PrinterBackup = {
  format: 'easy-slicer-printers'
  version: 1
  exportedAt: string
  activePrinterId: string
  workspace: string[]
  snapshots: Record<string, PrinterSnapshot>
  customPrinters: CustomPrinterBackup[]
}

const SNAPSHOT_KEY = 'kepler.printers.v1'
const WORKSPACE_KEY = 'kepler.workspace.v1'

function readMap<T>(key: string): Record<string, T> {
  try {
    const raw = readLocal(key)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, T>
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function loadSnapshots(): Record<string, PrinterSnapshot> {
  return readMap<PrinterSnapshot>(SNAPSHOT_KEY)
}

export function loadSnapshot(printerId: string): PrinterSnapshot | null {
  const snap = loadSnapshots()[printerId]
  if (!snap?.setup || !snap?.settings) return null
  return snap
}

/** Kompletten Stand eines Druckers sichern (Filament, Platte, Düse, alle Werte). */
export function saveSnapshot(snapshot: PrinterSnapshot, printerId?: string): void {
  try {
    const all = loadSnapshots()
    const id = printerId ?? snapshot.setup.printerId
    const previous = all[id]
    const next: PrinterSnapshot = { ...snapshot }
    // Normale Settings-Snapshots sollen den Testmarker nicht versehentlich
    // löschen. Explizite `false`/`null`-Werte räumen ihn dagegen gezielt ab.
    if (next.testStructureActive === undefined && previous?.testStructureActive !== undefined) {
      next.testStructureActive = previous.testStructureActive
    }
    if (next.calibrationTest === undefined && previous?.calibrationTest !== undefined) {
      next.calibrationTest = previous.calibrationTest
    }
    all[id] = next
    writeLocal(SNAPSHOT_KEY, JSON.stringify(all))
  } catch {
    /* nicht kritisch */
  }
}

/** Drucker des Arbeitsplatzes in Anzeigereihenfolge. */
export function loadWorkspace(): string[] {
  try {
    const raw = readLocal(WORKSPACE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id): id is string => typeof id === 'string' && !!id)
  } catch {
    return []
  }
}

export function saveWorkspace(ids: string[]): void {
  try {
    writeLocal(WORKSPACE_KEY, JSON.stringify([...new Set(ids)]))
  } catch {
    /* nicht kritisch */
  }
}

/**
 * Sichert alle gespeicherten Druckerstände und den aktiven Stand in einer
 * Datei. Die Werksprofile selbst bleiben Teil der App; eigene Drucker werden
 * mit ihren Definitionen zusätzlich mitgenommen.
 */
export function buildPrinterBackup({
  setup,
  settings,
  workspace,
  customPrinters = [],
}: {
  setup: Setup
  settings: PrintSettings
  workspace: string[]
  customPrinters?: PrinterProfile[]
}): PrinterBackup {
  const snapshots = loadSnapshots()
  snapshots[setup.printerId] = { setup, settings, savedAt: Date.now() }
  return {
    format: 'easy-slicer-printers',
    version: 1,
    exportedAt: new Date().toISOString(),
    activePrinterId: setup.printerId,
    workspace: [...new Set(workspace)],
    snapshots,
    customPrinters: customPrinters
      .filter((p) => p.custom)
      .map((p) => ({
        id: p.id,
        name: p.name,
        bed: { ...p.bed },
        baud: p.baud,
        control: p.control,
        hasBedLeveling: p.hasBedLeveling,
      })),
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Liest eine Sicherung ein und prüft die grobe Struktur vor dem Schreiben. */
export function parsePrinterBackup(text: string): PrinterBackup {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Die Datei ist kein gültiges JSON.')
  }
  if (!object(parsed) || parsed.format !== 'easy-slicer-printers' || parsed.version !== 1) {
    throw new Error('Keine Easy-Slicer-Druckersicherung (Format/Version passt nicht).')
  }
  const rawSnapshots = parsed.snapshots
  if (!object(rawSnapshots)) throw new Error('Die Sicherung enthält keine Druckerstände.')

  const snapshots: Record<string, PrinterSnapshot> = {}
  for (const [id, value] of Object.entries(rawSnapshots)) {
    if (!id || !object(value) || !object(value.setup) || !object(value.settings)) continue
    const setup = value.setup as unknown as Setup
    const settings = value.settings as unknown as PrintSettings
    if (!setup.printerId || !setup.filamentId || !setup.plateId) continue
    snapshots[id] = {
      setup: { ...setup, printerId: id },
      settings,
      savedAt: typeof value.savedAt === 'number' ? value.savedAt : Date.now(),
      ...(value.testStructureActive === true ? { testStructureActive: true } : {}),
      ...(value.calibrationTest && object(value.calibrationTest)
        ? { calibrationTest: value.calibrationTest as unknown as PrinterSnapshot['calibrationTest'] }
        : {}),
    }
  }
  if (!Object.keys(snapshots).length) throw new Error('Die Sicherung enthält keine gültigen Druckerstände.')

  const workspace = Array.isArray(parsed.workspace)
    ? parsed.workspace.filter((id): id is string => typeof id === 'string' && !!id)
    : []
  const activePrinterId =
    typeof parsed.activePrinterId === 'string' && parsed.activePrinterId
      ? parsed.activePrinterId
      : Object.keys(snapshots)[0]
  const customPrinters: CustomPrinterBackup[] = Array.isArray(parsed.customPrinters)
    ? parsed.customPrinters.filter(
        (p): p is CustomPrinterBackup =>
          object(p) &&
          typeof p.id === 'string' &&
          typeof p.name === 'string' &&
          object(p.bed) &&
          typeof p.bed.x === 'number' &&
          typeof p.bed.y === 'number' &&
          typeof p.bed.z === 'number',
      )
    : []

  return {
    format: 'easy-slicer-printers',
    version: 1,
    exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : new Date().toISOString(),
    activePrinterId,
    workspace,
    snapshots,
    customPrinters,
  }
}
