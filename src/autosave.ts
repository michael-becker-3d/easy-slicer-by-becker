import { readLocal, removeLocal, writeLocal } from './persist.ts'

/**
 * Autosave für das aktuelle Werkstück.
 *
 * Der Slicer hält Modelle nur im Arbeitsspeicher des Servers. Für die
 * Wiederherstellung nach einem Absturz wird deshalb die aktuelle, kanonische
 * STL-Geometrie in IndexedDB abgelegt. Einstellungen und Druckerstand liegen
 * bereits in der Profilablage; die Geometrie überlebt damit auch einen
 * Serverneustart. Die Datei wird bewusst erst nach einer kurzen Ruhephase
 * geschrieben, nicht bei jedem Mauszug.
 */

const DB_NAME = 'easy-slicer-autosave'
const DB_VERSION = 1
const STORE = 'drafts'
const KEY = 'current'
const META_KEY = 'kepler.autosave.v1'

/** Roh-STL oberhalb dieser Größe würde den lokalen Speicher unnötig belasten. */
export const MAX_DRAFT_BYTES = 48 * 1024 * 1024

export type DraftMeta = {
  savedAt: number
  /** Ein geordnetes Schließen darf beim nächsten Start nicht als Absturz gelten. */
  cleanExit: boolean
  sourceName: string
  fileName: string
  printerId: string
  outputName: string
  size: number
}

export type SavedDraft = DraftMeta & { data: ArrayBuffer }

function meta(): DraftMeta | null {
  try {
    const raw = readLocal(META_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<DraftMeta>
    if (
      typeof parsed.savedAt !== 'number' ||
      typeof parsed.sourceName !== 'string' ||
      typeof parsed.fileName !== 'string' ||
      typeof parsed.printerId !== 'string'
    ) {
      return null
    }
    return {
      savedAt: parsed.savedAt,
      cleanExit: parsed.cleanExit === true,
      sourceName: parsed.sourceName,
      fileName: parsed.fileName,
      printerId: parsed.printerId,
      outputName: typeof parsed.outputName === 'string' ? parsed.outputName : '',
      size: typeof parsed.size === 'number' ? parsed.size : 0,
    }
  } catch {
    return null
  }
}

function writeMeta(next: DraftMeta): void {
  try {
    writeLocal(META_KEY, JSON.stringify(next))
  } catch {
    // IndexedDB bleibt als Datenablage nutzbar; der Startwert ist dann nur
    // nicht als Absturz markiert.
  }
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

function readRecord(db: IDBDatabase): Promise<{ blob?: Blob } | null> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly')
      const request = tx.objectStore(STORE).get(KEY)
      request.onsuccess = () => resolve((request.result as { blob?: Blob } | undefined) ?? null)
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

export async function saveDraft(input: {
  data: ArrayBuffer
  sourceName: string
  fileName: string
  printerId: string
  outputName: string
}): Promise<'saved' | 'too-large' | 'unavailable'> {
  if (input.data.byteLength > MAX_DRAFT_BYTES) return 'too-large'
  const db = await openDb()
  if (!db) return 'unavailable'
  const next: DraftMeta = {
    savedAt: Date.now(),
    cleanExit: false,
    sourceName: input.sourceName,
    fileName: input.fileName,
    printerId: input.printerId,
    outputName: input.outputName,
    size: input.data.byteLength,
  }
  // Zuerst als ungeordnet markieren: Ein Absturz während des Schreibens soll
  // beim nächsten Start als unterbrochener Entwurf erkannt werden.
  writeMeta(next)
  const stored = await new Promise<boolean>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({ blob: new Blob([input.data], { type: 'model/stl' }) }, KEY)
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => resolve(false)
      tx.onabort = () => resolve(false)
    } catch {
      resolve(false)
    }
  })
  db.close()
  if (!stored) return 'unavailable'
  return 'saved'
}

/** Liefert nur einen Entwurf, der nicht geordnet geschlossen wurde. */
export async function loadRecoveryDraft(): Promise<SavedDraft | null> {
  const saved = meta()
  if (!saved || saved.cleanExit) return null
  const db = await openDb()
  if (!db) return null
  const record = await readRecord(db)
  db.close()
  if (!record?.blob) return null
  try {
    return { ...saved, data: await record.blob.arrayBuffer() }
  } catch {
    return null
  }
}

/** Bei einem normalen Schließen wird der Entwurf nicht als Absturz gemeldet. */
export function markDraftCleanExit(): void {
  const saved = meta()
  if (!saved) return
  writeMeta({ ...saved, cleanExit: true })
}

export async function clearDraft(): Promise<void> {
  try {
    removeLocal(META_KEY)
  } catch {
    // nicht kritisch
  }
  const db = await openDb()
  if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
  db.close()
}
