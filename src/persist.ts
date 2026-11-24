import { PROFILE_STORE_KEYS, isProfileStoreKey, type ProfileStoreKey } from '../shared/persist-keys.ts'

/**
 * Profilstände liegen doppelt: sofort lesbar im localStorage der Oberfläche und
 * dauerhaft als Datei im Datenordner (server/userStore.ts). Die Datei überlebt
 * einen neuen Build und einen anderen Port; localStorage gilt nur für genau
 * eine Adresse, weshalb die Profile nach einem Build-Wechsel fehlten.
 *
 * Beim Start wird die Datei vor dem ersten Rendern eingelesen; jede Änderung
 * wird kurz danach nachgeschoben. Ein Zeitstempel je Schlüssel verhindert, dass
 * ein älterer Stand einen neueren überschreibt.
 */

const META_KEY = 'kepler.sync.v1'
const FLUSH_DELAY = 600

type Meta = Record<string, number>
type PendingEntry = { value: string | null; savedAt: number }

const pending = new Map<ProfileStoreKey, PendingEntry>()
let timer: ReturnType<typeof setTimeout> | null = null

function readMeta(): Meta {
  try {
    const raw = localStorage.getItem(META_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const meta: Meta = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) meta[key] = value
    }
    return meta
  } catch {
    return {}
  }
}

function writeMeta(meta: Meta): void {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta))
  } catch {
    /* Speicher voll oder blockiert */
  }
}

/** Liest einen Wert; bei gesperrtem Speicher bleibt nur der Standardwert. */
export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function setLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* Speicher voll oder blockiert — die Datei auf dem Rechner bleibt */
  }
}

function dropLocal(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* nicht kritisch */
  }
}

function queue(key: ProfileStoreKey, value: string | null, savedAt: number): void {
  pending.set(key, { value, savedAt })
  const meta = readMeta()
  meta[key] = savedAt
  writeMeta(meta)
  if (!timer) {
    timer = setTimeout(() => {
      timer = null
      void flushPending(false)
    }, FLUSH_DELAY)
  }
}

/**
 * Schreibt einen Wert in den lokalen Speicher und merkt ihn zum Nachschieben in
 * die Profildatei vor. Nicht-Profil-Schlüssel (z. B. das Design) bleiben rein lokal.
 */
export function writeLocal(key: string, value: string): void {
  setLocal(key, value)
  if (!isProfileStoreKey(key)) return
  queue(key, value, Date.now())
}

export function removeLocal(key: string): void {
  dropLocal(key)
  if (!isProfileStoreKey(key)) return
  queue(key, null, Date.now())
}

/** Schickt vorgemerkte Änderungen sofort weg (`beacon` für das Schließen). */
export function flushPending(beacon: boolean): Promise<void> {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (!pending.size) return Promise.resolve()

  const entries = [...pending.entries()].map(([key, entry]) => ({ key, value: entry.value, savedAt: entry.savedAt }))
  pending.clear()
  const body = JSON.stringify({ entries })

  if (beacon) {
    try {
      const blob = new Blob([body], { type: 'application/json' })
      if (navigator.sendBeacon?.('/api/user-store', blob)) return Promise.resolve()
    } catch {
      /* Fallback unten */
    }
  }

  return fetch('/api/user-store', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  })
    .then(() => undefined)
    .catch(() => {
      // Server weg: der Stand bleibt im localStorage und wird beim nächsten
      // Start erneut übertragen.
    })
}

/**
 * Gleicht den lokalen Speicher mit der Profildatei ab und muss vor dem ersten
 * Rendern laufen, weil die Oberfläche ihre Profile synchron liest.
 */
export async function hydrateLocalProfiles(): Promise<void> {
  let stored: Record<string, unknown> = {}
  try {
    const res = await fetch('/api/user-store', { cache: 'no-store' })
    if (!res.ok) return
    const data = (await res.json()) as { entries?: unknown }
    if (data.entries && typeof data.entries === 'object' && !Array.isArray(data.entries)) {
      stored = data.entries as Record<string, unknown>
    }
  } catch {
    // Server nicht erreichbar — der lokale Stand bleibt unverändert
    return
  }

  const meta = readMeta()
  const now = Date.now()
  const pushes: ProfileStoreKey[] = []

  for (const key of PROFILE_STORE_KEYS) {
    const entry = stored[key] as { value?: unknown; savedAt?: unknown } | undefined
    const serverValue = entry && typeof entry.value === 'string' ? entry.value : null
    const serverAt = entry && typeof entry.savedAt === 'number' ? entry.savedAt : 0
    const local = readLocal(key)
    const localAt = meta[key]

    // Neuer Build, neuer Port: localStorage ist leer, der Stand kommt aus der Datei.
    if (local === null) {
      if (serverValue !== null) {
        setLocal(key, serverValue)
        meta[key] = serverAt
      } else if (serverAt > 0) {
        meta[key] = serverAt
      }
      continue
    }

    // Datei ist neuer als der lokale Stand (z. B. aus einer anderen Instanz).
    if (serverValue !== null && localAt !== undefined && serverAt > localAt) {
      setLocal(key, serverValue)
      meta[key] = serverAt
      continue
    }

    // Lokal ist neuer oder war noch nie in der Datei → nachziehen.
    if (serverValue !== local) {
      pushes.push(key)
      meta[key] = now
    } else if (localAt === undefined) {
      meta[key] = serverAt
    }
  }

  writeMeta(meta)
  for (const key of pushes) {
    const value = readLocal(key)
    if (value !== null) queue(key, value, now)
  }
}
