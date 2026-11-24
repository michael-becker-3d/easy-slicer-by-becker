import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { isSea } from 'node:sea'
import type { BedMesh, BedMeshRecord } from '../shared/types.ts'

/**
 * Schreibbarer Ordner für den Messverlauf: Env-Variable, im EXE-Betrieb das
 * Benutzerprofil (Program Files ist schreibgeschützt), sonst das Projekt.
 */
export function dataDir(): string {
  if (process.env.KEPLER_DATA) return process.env.KEPLER_DATA
  if (!isSea()) return join(process.cwd(), 'data')
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
    const dir = join(base, 'EasySlicerBecker', 'data')
    // Daten des früheren Namens einmalig übernehmen, damit Messungen bleiben
    try {
      const legacy = join(base, 'KeplerSlicerStudio', 'data')
      if (!existsSync(join(dir, 'bedmeshes.json')) && existsSync(legacy)) cpSync(legacy, dir, { recursive: true })
    } catch {
      /* Migration ist optional */
    }
    return dir
  }
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'easy-slicer')
}

const FILE = join(dataDir(), 'bedmeshes.json')
const MAX_PER_PRINTER = 12

type Store = Record<string, BedMeshRecord[]>

const round = (v: number) => Math.round(v * 1000) / 1000

function read(): Store {
  try {
    if (!existsSync(FILE)) return {}
    const parsed = JSON.parse(readFileSync(FILE, 'utf8')) as Store
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    // Beschädigte Datei darf den Slicer nicht aufhalten
    return {}
  }
}

function write(store: Store): void {
  try {
    mkdirSync(dirname(FILE), { recursive: true })
    const tmp = `${FILE}.tmp`
    writeFileSync(tmp, JSON.stringify(store))
    renameSync(tmp, FILE)
  } catch {
    // Verlauf ist ein Komfort-Feature — Fehler hier blockieren nichts
  }
}

export function recordMesh(printerId: string, mesh: BedMesh): BedMeshRecord[] {
  const flat = mesh.z.flat()
  const record: BedMeshRecord = {
    at: Date.now(),
    rows: mesh.rows,
    cols: mesh.cols,
    min: round(Math.min(...flat)),
    max: round(Math.max(...flat)),
    mean: round(flat.reduce((a, b) => a + b, 0) / Math.max(1, flat.length)),
    spread: round(Math.max(...flat) - Math.min(...flat)),
    source: mesh.source,
    z: mesh.z.map((row) => row.map((v) => round(v))),
  }

  const store = read()
  const list = [...(store[printerId] ?? []), record].slice(-MAX_PER_PRINTER)
  store[printerId] = list
  write(store)
  return list
}

export function historyFor(printerId: string): BedMeshRecord[] {
  return read()[printerId] ?? []
}

export function clearHistory(printerId: string): void {
  const store = read()
  delete store[printerId]
  write(store)
}

export function historyFile(): string {
  return FILE
}
