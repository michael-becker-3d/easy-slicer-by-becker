import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { isProfileStoreKey, type ProfileStoreKey } from '../shared/persist-keys.ts'
import { dataDir } from './history.ts'

/** Ein gespeicherter Profilstand; `value: null` heißt „bewusst gelöscht“. */
export type StoredProfileEntry = { value: string | null; savedAt: number }

export type StoredProfiles = {
  version: 1
  entries: Partial<Record<ProfileStoreKey, StoredProfileEntry>>
}

/**
 * Der Profilstand liegt als eigene Datei im Datenordner — unabhängig davon, auf
 * welchem Port die Oberfläche läuft und welche Build-Version gestartet wurde.
 * Genau daran scheiterte localStorage: es gilt nur für eine Adresse, und ein
 * neuer Build bekam nach dem Schließen des Fensters den nächsten freien Port.
 */
const FILE = join(dataDir(), 'profiles.json')
// Ein Stand ist wenige Kilobyte groß; 1 MiB je Schlüssel bleibt deutlich unter
// dem 16-MB-Limit des JSON-Bodys und verhindert, dass die Datei unbrauchbar wird.
const MAX_VALUE_BYTES = 1024 * 1024
const MAX_ENTRIES = 60

export function userStorePath(): string {
  return FILE
}

function read(): StoredProfiles {
  const empty: StoredProfiles = { version: 1, entries: {} }
  try {
    if (!existsSync(FILE)) return empty
    const parsed = JSON.parse(readFileSync(FILE, 'utf8')) as Partial<StoredProfiles>
    const raw = parsed?.entries
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty

    const entries: StoredProfiles['entries'] = {}
    for (const [key, item] of Object.entries(raw)) {
      if (!isProfileStoreKey(key) || !item || typeof item !== 'object') continue
      const { value, savedAt } = item as StoredProfileEntry
      if (!Number.isFinite(savedAt) || (value !== null && typeof value !== 'string')) continue
      entries[key] = { value, savedAt }
    }
    return { version: 1, entries }
  } catch {
    // Beschädigte Datei darf den Slicer nicht aufhalten
    return empty
  }
}

function write(store: StoredProfiles): void {
  try {
    mkdirSync(dirname(FILE), { recursive: true })
    const tmp = `${FILE}.tmp`
    writeFileSync(tmp, JSON.stringify(store, null, 2))
    renameSync(tmp, FILE)
  } catch (error) {
    console.error('[easy-slicer] Profilstand konnte nicht geschrieben werden:', error)
  }
}

export function readUserStore(): StoredProfiles {
  return read()
}

/**
 * Übernimmt Änderungen der Oberfläche. Je Schlüssel gewinnt der neuere Stand,
 * damit eine parallel laufende ältere Instanz nichts überschreiben kann.
 */
export function mergeUserStore(input: unknown): StoredProfiles {
  const store = read()
  if (!Array.isArray(input)) return store

  let changed = false
  for (const item of input.slice(0, MAX_ENTRIES)) {
    if (!item || typeof item !== 'object') continue
    const { key, value, savedAt } = item as { key?: unknown; value?: unknown; savedAt?: unknown }
    if (typeof key !== 'string' || !isProfileStoreKey(key)) continue
    if (typeof savedAt !== 'number' || !Number.isFinite(savedAt) || savedAt <= 0) continue
    if (value !== null && typeof value !== 'string') continue
    if (typeof value === 'string' && Buffer.byteLength(value, 'utf8') > MAX_VALUE_BYTES) continue

    const current = store.entries[key]
    if (current && current.savedAt > savedAt) continue
    if (current && current.savedAt === savedAt && current.value === value) continue

    store.entries[key] = { value, savedAt }
    changed = true
  }

  if (changed) write(store)
  return store
}
