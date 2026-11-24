import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { BedMesh } from '../shared/types.ts'
import { dataDir } from './history.ts'

/**
 * Ein Bett-Mesh gehört zu genau einem Druckerprofil. Es wird getrennt vom
 * Messverlauf gespeichert, damit beim Modellwechsel nie das Mesh eines
 * anderen Druckers im G-Code landet.
 */
const FILE = join(dataDir(), 'profile-meshes.json')

type Store = Record<string, BedMesh>

const round = (v: number) => Math.round(v * 1000) / 1000

function read(): Store {
  try {
    if (!existsSync(FILE)) return {}
    const parsed = JSON.parse(readFileSync(FILE, 'utf8')) as Store
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    // Beschädigte Datei darf den Slicer nicht blockieren
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
    // Mesh-Speicher ist ein Komfort-Feature
  }
}

export function saveMesh(printerId: string, mesh: BedMesh): BedMesh {
  const stored: BedMesh = {
    ...mesh,
    printerId,
    z: mesh.z.map((row) => row.map(round)),
  }
  const store = read()
  store[printerId] = stored
  write(store)
  return stored
}

export function loadMesh(printerId: string): BedMesh | null {
  const mesh = read()[printerId]
  if (!mesh || !Array.isArray(mesh.z) || !mesh.z.length) return null
  return { ...mesh, printerId }
}

export function clearMesh(printerId: string): void {
  const store = read()
  delete store[printerId]
  write(store)
}

export function meshFile(): string {
  return FILE
}
