/**
 * Scan im MeshScan-Server starten (A-154).
 *
 * Der MeshScan-Server rechnet Fotos oder ein Video lokal zu einem Mesh
 * (Meshroom, COLMAP, MacMac, openMVS). Diese Datei beschreibt nur die
 * Schnittstelle und die Grenzen der Oberfläche — gerechnet wird dort, nicht
 * im Slicer. Der Slicer übernimmt am Ende das fertige `mesh.glb` als
 * Werkstück (der Import rechnet es in ein STL um).
 */

/** Rechenprogramme, die der Scan-Server anbietet. */
export type ScanGeneratorId = 'auto' | 'meshroom' | 'colmap' | 'micmac' | 'openmvs'

export const SCAN_GENERATOR_LABEL: Record<ScanGeneratorId, string> = {
  auto: 'Automatisch',
  meshroom: 'Meshroom (AliceVision)',
  colmap: 'COLMAP',
  micmac: 'MicMac',
  openmvs: 'openMVS',
}

/** Grenzen der Oberfläche: mehr nimmt ein einzelner Scan nicht an. */
export const SCAN_MAX_PHOTOS = 80
export const SCAN_MAX_VIDEO_SECONDS = 60

/** Antwort von `GET /api/mesh/ping`. */
export type ScanPing = {
  ok: boolean
  server: string
  message: string
  engine: string
  wahl: string
  verfuegbar: Record<string, boolean>
  time: string
}

/** Aufnahme-Situation, die der Scan-Server je Auftrag kennt. */
export type ScanPreset = {
  wert: string
  name: string
  hinweis: string
  maske: boolean
  frames: number
}

/** Antwort von `GET /api/mesh/engines`. */
export type ScanEnginesInfo = {
  wahl: string
  wahl_gemerkt: boolean
  startdatei: string
  aktiv: string
  verfuegbar: Record<string, boolean>
  pfade: Record<string, string>
  presets: ScanPreset[]
  mock: boolean
}

/** Was die Oberfläche vom Slicer-Server über den Scan-Server erfährt. */
export type ScanServerInfo = {
  /** Adresse, die der Slicer benutzt — änderbar über `MESHSCAN_URL`. */
  url: string
  ping: ScanPing
  engines: ScanEnginesInfo
}

export type ScanJobStatus = 'created' | 'uploading' | 'processing' | 'ready' | 'failed' | 'cancelled'

/** Ein Auftrag im MeshScan-Server (`job.json`). */
export type ScanJob = {
  id: string
  name: string
  status: string
  progress: number
  photo_count: number
  engine: string
  preset?: string
  log: string[]
  mesh_size_bytes: number | null
  vertex_count: number | null
  face_count: number | null
  error: string | null
  created_at?: string
  updated_at?: string
}

export const SCAN_JOB_STATUS_LABEL: Record<string, string> = {
  created: 'angelegt — wartet auf Dateien',
  uploading: 'Dateien werden übertragen',
  processing: 'rechnet gerade',
  ready: 'fertig',
  failed: 'fehlgeschlagen',
  cancelled: 'abgebrochen',
}

export function scanJobStatusLabel(status: string): string {
  return SCAN_JOB_STATUS_LABEL[status] ?? `unbekannter Status „${status}“`
}

/** Läuft der Auftrag noch? Dann darf der Dialog nicht einfach schließen. */
export function scanJobIsRunning(job: ScanJob | null): boolean {
  return Boolean(job && (job.status === 'created' || job.status === 'uploading' || job.status === 'processing'))
}

/**
 * Dateiname für das geladene Werkstück. Der Jobname kann Zeichen enthalten, die
 * in Dateinamen nicht vorkommen dürfen — der Import zeigt diesen Namen an.
 */
export function scanMeshFileName(jobName: string, fallback: string): string {
  const cleaned = jobName
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
  return `${cleaned || fallback}.glb`
}
