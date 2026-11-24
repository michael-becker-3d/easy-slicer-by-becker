/**
 * Der MeshScan-Server als Rechengegend des Slicers (A-154).
 *
 * Der Scan-Server läuft getrennt (`meshscan-server\start.bat`, Port 8000) und
 * rechnet Fotos oder ein Video zu einem Mesh. Der Slicer spricht ihn
 * nur über HTTP an: Auftrag anlegen, Dateien senden, Rechnen starten, Status
 * lesen, `mesh.glb` holen. Nichts wird hier gerechnet und nichts verlässt den
 * Rechner.
 */
import type {
  ScanEnginesInfo,
  ScanGeneratorId,
  ScanJob,
  ScanPing,
  ScanServerInfo,
} from '../shared/scanJobs.ts'

const DEFAULT_URL = 'http://127.0.0.1:8000'

/** Adresse des Scan-Servers; für einen anderen Rechner über `MESHSCAN_URL` setzen. */
export const MESHSCAN_URL = (process.env.MESHSCAN_URL?.trim() || DEFAULT_URL).replace(/\/+$/, '')

/** Fehler mit HTTP-Status, damit die Route ihn unverändert weitergeben kann. */
export class ScanServerError extends Error {
  readonly status: number

  constructor(message: string, status = 502) {
    super(message)
    this.status = status
  }
}

function unreachable(): ScanServerError {
  return new ScanServerError(
    `Der Scan-Server antwortet nicht (${MESHSCAN_URL}). Bitte im Ordner meshscan-server „start.bat“ starten — das Fenster muss offen bleiben.`,
    503,
  )
}

async function call<T>(path: string, init: RequestInit, timeoutMs: number): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${MESHSCAN_URL}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  } catch {
    throw unreachable()
  }
  if (!res.ok) {
    let detail = ''
    try {
      const data = (await res.json()) as { detail?: unknown }
      if (typeof data.detail === 'string') detail = data.detail
    } catch {
      // Kein JSON — die Statuszeile bleibt die einzige Auskunft.
    }
    throw new ScanServerError(
      detail || `Der Scan-Server meldet einen Fehler (HTTP ${res.status}).`,
      res.status === 404 ? 404 : 502,
    )
  }
  return (await res.json()) as T
}

/** Ist der Scan-Server da, und welche Rechenprogramme hat er? */
export async function scanServerInfo(): Promise<ScanServerInfo> {
  try {
    const [ping, engines] = await Promise.all([
      call<ScanPing>('/api/mesh/ping', {}, 8000),
      call<ScanEnginesInfo>('/api/mesh/engines', {}, 8000),
    ])
    return { url: MESHSCAN_URL, ping, engines }
  } catch (err) {
    if (err instanceof ScanServerError) throw err
    throw unreachable()
  }
}

/**
 * Auftrag anlegen. `engine` bleibt bei „Automatisch“ weg — dann behält der
 * Scan-Server seine gemerkte Wahl, statt sie auf „auto“ zurückzusetzen.
 */
export async function createScanJob(input: {
  name?: string
  engine?: ScanGeneratorId
}): Promise<ScanJob> {
  const payload: Record<string, string> = {}
  if (input.name) payload.name = input.name
  if (input.engine && input.engine !== 'auto') payload.engine = input.engine
  return call<ScanJob>(
    '/api/mesh/jobs',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    20_000,
  )
}

/** Ein Foto oder Video an den Auftrag senden. Der Server erkennt Videos an der Endung. */
export async function uploadScanFile(
  jobId: string,
  file: { name: string; data: Buffer; index?: number },
): Promise<ScanJob> {
  const form = new FormData()
  form.append('photo', new Blob([new Uint8Array(file.data)]), file.name)
  if (typeof file.index === 'number') form.append('index', String(file.index))
  return call<ScanJob>(
    `/api/mesh/jobs/${encodeURIComponent(jobId)}/photos`,
    { method: 'POST', body: form },
    180_000,
  )
}

/** Rechnen starten. Der Aufruf kehrt sofort zurück; der Fortschritt kommt über den Status. */
export async function startScanProcessing(jobId: string): Promise<ScanJob> {
  return call<ScanJob>(
    `/api/mesh/jobs/${encodeURIComponent(jobId)}/process`,
    { method: 'POST' },
    30_000,
  )
}

export async function scanJobStatus(jobId: string): Promise<ScanJob> {
  return call<ScanJob>(`/api/mesh/jobs/${encodeURIComponent(jobId)}`, {}, 15_000)
}

/** Auftrag stoppen — die hochgeladenen Dateien bleiben im Scan-Server liegen. */
export async function cancelScanJob(jobId: string): Promise<ScanJob> {
  return call<ScanJob>(
    `/api/mesh/jobs/${encodeURIComponent(jobId)}/cancel`,
    { method: 'POST' },
    30_000,
  )
}

/**
 * Das fertige `mesh.glb` holen. Der Slicer-Import (`/api/models`) rechnet es
 * beim Laden in sein kanonisches STL um — deshalb wird hier nichts umgewandelt.
 */
export async function fetchScanJobMesh(jobId: string): Promise<Buffer> {
  let res: Response
  try {
    res = await fetch(`${MESHSCAN_URL}/api/mesh/jobs/${encodeURIComponent(jobId)}/mesh.glb`, {
      signal: AbortSignal.timeout(300_000),
    })
  } catch {
    throw unreachable()
  }
  if (!res.ok) {
    throw new ScanServerError(
      res.status === 404
        ? 'Der Scan ist fertig, aber es liegt kein Mesh vor.'
        : `Das Mesh ließ sich nicht laden (HTTP ${res.status}).`,
      res.status === 404 ? 404 : 502,
    )
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  if (!buffer.length) throw new ScanServerError('Der Scan-Server liefert ein leeres Mesh.')
  return buffer
}
