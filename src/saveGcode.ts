export type SaveFileResult =
  | { status: 'saved'; name: string }
  | { status: 'cancelled' }
  | { status: 'downloaded'; name: string }
  | { status: 'error'; message: string }

/** Rückwärtskompatibler Name für bestehende Aufrufer. */
export type SaveGcodeResult = SaveFileResult

type SaveFileHandle = {
  name: string
  createWritable: () => Promise<{
    write: (data: Blob) => Promise<void>
    close: () => Promise<void>
  }>
}

type SaveFilePicker = (options: {
  suggestedName: string
  types: { description: string; accept: Record<string, string[]> }[]
}) => Promise<SaveFileHandle>

type FileKind = 'gcode' | 'stl' | '3mf' | 'json'

const FILE_TYPES: Record<
  FileKind,
  { description: string; accept: Record<string, string[]>; type: string }
> = {
  gcode: {
    description: 'G-Code',
    accept: { 'text/plain': ['.gcode', '.gco'] },
    type: 'text/plain;charset=utf-8',
  },
  stl: {
    description: 'STL-Modell',
    accept: { 'model/stl': ['.stl'] },
    type: 'model/stl',
  },
  '3mf': {
    description: '3MF-Projekt',
    accept: { 'model/3mf': ['.3mf'] },
    type: 'model/3mf',
  },
  json: {
    description: 'JSON-Profil',
    accept: { 'application/json': ['.json'] },
    type: 'application/json',
  },
}

function fileKind(name: string): FileKind {
  if (/\.stl$/i.test(name)) return 'stl'
  if (/\.3mf$/i.test(name)) return '3mf'
  if (/\.json$/i.test(name)) return 'json'
  return 'gcode'
}

/** Klassischer Download als Fallback für Browser ohne File System Access API. */
function downloadFallback(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Öffnet „Speichern unter“ und schreibt eine Datei an den gewählten Ort.
 * Der Dialog gehört zu einem echten Klick, deshalb darf diese Funktion nicht
 * aus einem Effekt oder einer verzögerten Aktion aufgerufen werden.
 */
export async function saveFileAs(blob: Blob, suggestedName: string): Promise<SaveFileResult> {
  const picker = (
    window as unknown as { showSaveFilePicker?: SaveFilePicker }
  ).showSaveFilePicker

  if (typeof picker !== 'function') {
    downloadFallback(blob, suggestedName)
    return { status: 'downloaded', name: suggestedName }
  }

  const kind = fileKind(suggestedName)
  const spec = FILE_TYPES[kind]
  try {
    const handle = await picker({
      suggestedName,
      types: [{ description: spec.description, accept: spec.accept }],
    })
    const writable = await handle.createWritable()
    await writable.write(blob)
    await writable.close()
    return { status: 'saved', name: handle.name }
  } catch (err) {
    const errorName = err instanceof DOMException ? err.name : ''
    if (errorName === 'AbortError') return { status: 'cancelled' }
    if (errorName === 'NotAllowedError' || errorName === 'SecurityError') {
      return {
        status: 'error',
        message: 'Der Speicherort-Dialog wurde blockiert. Bitte öffne die App im eigenen Fenster und versuche es erneut.',
      }
    }
    return {
      status: 'error',
      message: err instanceof Error ? err.message : 'Die Datei konnte nicht gespeichert werden.',
    }
  }
}

/** G-Code als Textblob speichern — gemeinsamer Dialog für alle Exporte. */
export async function saveGcodeAs(gcode: string, suggestedName: string): Promise<SaveFileResult> {
  const blob = new Blob([gcode], { type: FILE_TYPES.gcode.type })
  return saveFileAs(blob, suggestedName)
}
