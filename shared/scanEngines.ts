/**
 * Herkunft von Fotogrammetrie-Ausgaben (V-23).
 *
 * Meshroom, COLMAP, openMVS und MicMac schreiben ihre Ergebnisse in sehr
 * unterschiedlich benannte Ordner. Diese Datei erkennt aus der Dateiliste und
 * ein paar Kilobyte Dateiinhalt die Engine, den Fortschritt des Laufs und das
 * Mesh, das sich drucken lässt. Sie liest selbst nichts vom Datenträger, damit
 * sie ohne Server und ohne echte Datensätze prüfbar bleibt.
 */

export type ScanEngineId = 'meshroom' | 'colmap' | 'openmvs' | 'micmac' | 'unknown'

export type ScanConfidence = 'hoch' | 'mittel' | 'niedrig'

/** Eine Datei im Ausgabeordner, Pfad relativ zur Wurzel. */
export type ScanFileRef = {
  path: string
  size?: number
}

/** Angelesener Anfang einer Datei (nur Text, wenige Kilobyte). */
export type ScanContent = {
  path: string
  text: string
}

export type ScanMeshFormat = 'stl' | 'obj' | 'ply' | '3mf' | 'glb'

/** Was in der Datei steckt — eine Punktwolke lässt sich nicht slicen. */
export type ScanMeshRole = 'Netz mit Textur' | 'Netz' | 'Punktwolke' | 'unbekannt'

export type ScanMeshCandidate = {
  /** Pfad relativ zur Wurzel, wie er im Ordner liegt. */
  path: string
  file: string
  format: ScanMeshFormat
  role: ScanMeshRole
  /** false: Punktwolke oder zu groß — der Slicer kann sie nicht laden. */
  usable: boolean
  size: number | null
  note: string
}

/**
 * Kandidat mit dem vollständigen Pfad. Der kommt vom Server, nicht aus einer
 * Verkettung in der Oberfläche — dort sind Trennzeichen und Laufwerkspfade
 * eine Fehlerquelle.
 */
export type ScanMeshCandidateFile = ScanMeshCandidate & { absolutePath: string }

/** Antwort der Ordnerprüfung: Erkennung plus ladbare Pfade. */
export type ScanFolderReport = Omit<ScanEngineReport, 'candidates'> & {
  candidates: ScanMeshCandidateFile[]
}

export type ScanEngineReport = {
  engine: ScanEngineId
  confidence: ScanConfidence
  evidence: string[]
  /** Registrierte Bilder, sofern der Lauf sie verrät. */
  images: { count: number; source: string } | null
  candidates: ScanMeshCandidate[]
  warnings: string[]
}

/** Größer lässt der Import-Endpunkt nicht zu (150 MB, wie /api/models). */
export const SCAN_MESH_LIMIT_BYTES = 150 * 1024 * 1024

export const ENGINE_LABEL: Record<ScanEngineId, string> = {
  meshroom: 'Meshroom (AliceVision)',
  colmap: 'COLMAP',
  openmvs: 'openMVS',
  micmac: 'MicMac',
  unknown: 'Unbekannte Herkunft',
}

/** Eine Liste für Erkennung, Ordnerlesen und Ladeprüfung — sie darf nicht auseinanderlaufen. */
export const SCAN_MESH_FORMATS: Record<string, ScanMeshFormat> = {
  '.stl': 'stl',
  '.obj': 'obj',
  '.ply': 'ply',
  '.3mf': '3mf',
  // Die MeshScan-App schreibt am Ende mesh.glb — der Slicer liest GLB jetzt selbst.
  '.glb': 'glb',
}

export const SCAN_MESH_SUFFIXES: string[] = Object.keys(SCAN_MESH_FORMATS)

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.bmp', '.webp'])

export function normalizeScanPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/{2,}/g, '/')
    .replace(/^\//, '')
}

/** Endung → Format, oder null, wenn der Slicer die Datei nicht laden kann. */
export function scanMeshFormat(path: string): ScanMeshFormat | null {
  const lower = path.toLowerCase()
  return SCAN_MESH_FORMATS[lower.slice(lower.lastIndexOf('.'))] ?? null
}

function isImage(path: string): boolean {
  const lower = path.toLowerCase()
  return IMAGE_EXTENSIONS.has(lower.slice(lower.lastIndexOf('.')))
}

/** COLMAP `images.txt`: Bildzeilen haben 10 Felder, Punktzeilen drei. */
export function countColmapImages(text: string): number | null {
  let count = 0
  let sawHeader = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#')) {
      sawHeader = true
      continue
    }
    if (line.split(/\s+/).length >= 10) count += 1
  }
  // Eine leere Datei ohne Kopfzeile ist kein gültiges Projekt — lieber nichts behaupten.
  if (!count && !sawHeader) return null
  return count
}

/** Meshroom `sfm.json`/`cameras.sfm`: jede registrierte Ansicht hat eine `poseId`. */
export function countMeshroomViews(text: string): number | null {
  const matches = text.match(/"poseId"/g)
  return matches ? matches.length : null
}

/** openMVS `.mvs`: jede Kamera steht als `<Image …>` in der XML-Szene. */
export function countOpenMvsImages(text: string): number | null {
  const matches = text.match(/<Image[\s>]/g)
  return matches ? matches.length : null
}

/** PLY-Kopf: `element face` mit Anzahl > 0 heißt Netz, sonst Punktwolke. */
export function plyRole(text: string): ScanMeshRole {
  if (!/format\s+\w+/i.test(text)) return 'unbekannt'
  if (/element\s+face\s+[1-9]\d*/i.test(text)) return 'Netz'
  if (/element\s+vertex\s+[1-9]\d*/i.test(text)) return 'Punktwolke'
  return 'unbekannt'
}

/** OBJ ohne `f`-Zeilen ist eine Punktwolke, nicht ein Netz. */
export function objRole(text: string): ScanMeshRole {
  if (/^f\s/m.test(text)) return 'Netz'
  if (/^v\s/m.test(text)) return 'Punktwolke'
  return 'unbekannt'
}

/** GLB beginnt mit dem Kopf `glTF` — sonst ist es keine Datei, die wir lesen können. */
export function glbRole(text: string): ScanMeshRole {
  return text.startsWith('glTF') ? 'Netz' : 'unbekannt'
}

/**
 * Liegt eine Textur neben dem Netz? Entweder verweist das OBJ selbst per
 * `mtllib` darauf, oder daneben liegt `<name>.mtl` bzw. ein Bild mit dem
 * Netznamen und „texture“ im Dateinamen (Meshroom: `texture_1001.png` neben
 * `texturedMesh.mtl`, openMVS: `…_texture_0.png`).
 */
function hasTextureCompanion(
  path: string,
  lowerPaths: string[],
  base: string,
  head: string | undefined,
): boolean {
  if (head && /^mtllib\s/m.test(head)) return true
  const dir = path.slice(0, path.lastIndexOf('/') + 1).toLowerCase()
  return lowerPaths.some((other) => {
    if (!other.startsWith(dir)) return false
    const name = other.slice(other.lastIndexOf('/') + 1)
    if (name === `${base}.mtl`) return true
    return isImage(other) && name.includes(base) && name.includes('texture')
  })
}

/** Je Engine: der Dateiname verrät, welcher Schritt das Netz erzeugt hat. Erste Regel gewinnt. */
const ENGINE_BONUS: Record<Exclude<ScanEngineId, 'unknown'>, [RegExp, number][]> = {
  colmap: [
    [/meshed-poisson/, 30],
    [/meshed-delaunay/, 25],
    // fused.ply ist die dichte Punktwolke, kein Netz.
    [/fused\.ply$/, -40],
  ],
  meshroom: [
    [/texturedmesh/, 30],
    [/\/meshing_/, 10],
  ],
  openmvs: [
    [/_refine/, 30],
    [/openmvs\.obj/, 28],
    [/scene_dense_mesh/, 25],
    // scene_dense.ply ist die dichte Punktwolke, kein Netz.
    [/(scene_dense\.ply|scene_dense\.mvs)$/, -20],
    [/scene_dense/, 5],
  ],
  micmac: [
    [/mesh_textured/, 20],
    [/mesh\.ply$/, 12],
    [/mec-/, 10],
  ],
}

const NEXT_STEP: Record<ScanEngineId, string> = {
  colmap:
    'In COLMAP fehlt die dichte Rekonstruktion: „dense reconstruction“ ausführen — danach entsteht dense/meshed-poisson.ply.',
  meshroom:
    'In Meshroom fehlt der Meshing-/Texturing-Schritt: der Graph muss über „Meshing“ bis „Texturing“ laufen.',
  openmvs:
    'In openMVS fehlen ReconstructMesh und TextureMesh — danach liegt scene_dense_mesh_refine.ply im Ordner.',
  micmac: 'In MicMac fehlt der MEC-Schritt, der aus der dichten Punktwolke ein Netz macht.',
  unknown: 'Der Ordner enthält kein STL, OBJ, PLY, 3MF oder GLB. Bitte den Exportordner der Engine wählen.',
}

/**
 * Woran eine Engine zu erkennen ist: Beleg-Text und die Muster, die *alle*
 * passen müssen — COLMAP braucht zum Beispiel Kameras *und* Bildliste.
 */
const ENGINE_SIGNALS: Record<Exclude<ScanEngineId, 'unknown'>, [string, RegExp[]][]> = {
  meshroom: [
    ['MeshroomCache-Ordner', [/meshroomcache\//]],
    ['Meshroom-Projektdatei (.mg)', [/\.mg$/]],
    ['Meshroom-Node-Ordner', [/\/(structurefrommotion|featureextraction|imagepairing|depthmap|meshing|texturing)_/]],
    ['SfM-Ausgabe (sfm.json/cameras.sfm)', [/\/(sfm\.json|cameras\.sfm)$/]],
  ],
  colmap: [
    ['COLMAP-Projektdateien (cameras + images)', [/cameras\.(txt|bin)$/, /images\.(txt|bin)$/]],
    ['COLMAP sparse-Ordner', [/(^|\/)sparse\//]],
    ['COLMAP dense-Ordner', [/(^|\/)dense\//]],
    ['COLMAP points3D', [/points3d\.(txt|bin)$/]],
  ],
  openmvs: [
    ['openMVS-Szene (.mvs)', [/\.mvs$/]],
    ['openMVS scene_dense', [/scene_dense/]],
    ['openMVS-Ordner', [/(^|\/)openmvs\//]],
  ],
  micmac: [
    ['MicMac-Orientierungsordner (Ori-*)', [/(^|\/)(ori-|ori_)/]],
    ['MicMac Homol', [/(^|\/)homol\//]],
    ['MicMac MEC', [/(^|\/)(mec-|mec_)/]],
    ['MicMac Chantier.cfg', [/chantier\.cfg$/]],
    ['MicMac-Ausgabedateien (C3DC/MicMac)', [/micmac|c3dc_/]],
  ],
}

/** Reihenfolge = Rangfolge bei gleich vielen Belegen. */
const ENGINE_ORDER: Exclude<ScanEngineId, 'unknown'>[] = ['meshroom', 'colmap', 'openmvs', 'micmac']

function engineEvidence(engine: Exclude<ScanEngineId, 'unknown'>, lowerPaths: string[]): string[] {
  return ENGINE_SIGNALS[engine]
    .filter(([, any]) => any.every((pattern) => lowerPaths.some((path) => pattern.test(path))))
    .map(([evidence]) => evidence)
}

function engineBonus(engine: ScanEngineId, lowerPath: string): number {
  if (engine === 'unknown') return 0
  return ENGINE_BONUS[engine].find(([pattern]) => pattern.test(lowerPath))?.[1] ?? 0
}

/** Ist die Datei im Ordner die fertige Ausgabe der MeshScan-App? */
const isAppMesh = (lowerPath: string) => lowerPath === 'mesh.glb' || lowerPath.endsWith('/mesh.glb')

/**
 * Erkennt die Engine, zählt registrierte Bilder und wählt die Mesh-Kandidaten.
 * `contents` enthält nur die Dateien, die der Server vorher angelesen hat
 * (Bildlisten, SfM-JSON, .mvs und Mesh-Köpfe). `job` ist die `job.json` eines
 * MeshScan-Laufs, falls der Ordner einer ist — sie erklärt fehlende Netze
 * besser als eine allgemeine Warnung.
 */
export function detectScanFolder(
  files: ScanFileRef[],
  contents: ScanContent[] = [],
  job: ScanJobInfo | null = null,
): ScanEngineReport {
  // Ein Durchgang: Pfad normalisieren, Kleinschreibung für Muster, Dateiname für Regeln.
  const entries = files.map((file) => {
    const path = normalizeScanPath(file.path)
    return {
      path,
      lower: path.toLowerCase(),
      base: path.slice(path.lastIndexOf('/') + 1),
      size: typeof file.size === 'number' && Number.isFinite(file.size) ? file.size : undefined,
    }
  })
  const lowerPaths = entries.map((entry) => entry.lower)
  const textByPath = new Map(
    contents.map((entry) => [normalizeScanPath(entry.path).toLowerCase(), entry.text]),
  )
  const head = (path: string) => textByPath.get(path.toLowerCase())

  let engine: ScanEngineId = 'unknown'
  let evidence: string[] = []
  for (const candidate of ENGINE_ORDER) {
    const found = engineEvidence(candidate, lowerPaths)
    if (found.length > evidence.length) {
      engine = candidate
      evidence = found
    }
  }
  // openMVS rechnet im selben dense-Ordner wie COLMAP: InterfaceCOLMAP legt
  // dort scene.mvs, ReconstructMesh scene_dense_mesh.ply und TextureMesh
  // openmvs.obj ab. Dann stammt das Netz von openMVS, auch wenn die Ausrichtung
  // von COLMAP kommt — ein Poisson-Netz daneben gibt es nicht.
  const hasOpenMvsOutput = lowerPaths.some(
    (path) => path.endsWith('.mvs') || path.includes('scene_dense_mesh') || path.includes('openmvs.obj'),
  )
  const hasColmapMesh = lowerPaths.some(
    (path) => path.includes('meshed-poisson') || path.includes('meshed-delaunay'),
  )
  if (engine === 'colmap' && hasOpenMvsOutput && !hasColmapMesh) {
    engine = 'openmvs'
    evidence = [...engineEvidence('openmvs', lowerPaths), 'Ausrichtung durch COLMAP']
  }
  const strength = evidence.length
  const confidence: ScanConfidence = strength >= 3 ? 'hoch' : strength === 2 ? 'mittel' : 'niedrig'

  // In einem fertigen Scan-Job ist mesh.glb die eigentliche App-Ausgabe — sie
  // steht vor den Engine-Zwischendateien, egal wie gut die benannt sind.
  const isJobFolder = lowerPaths.some((path) => path.split('/').pop() === 'job.json')
  const ranked: { candidate: ScanMeshCandidate; score: number; appOutput: boolean }[] = []
  for (const entry of entries) {
    const format = scanMeshFormat(entry.path)
    if (!format) continue
    const headText = head(entry.path)
    let role: ScanMeshRole =
      format === 'ply' ? (headText ? plyRole(headText) : 'unbekannt')
      : format === 'obj' ? (headText ? objRole(headText) : 'unbekannt')
      : format === 'glb' ? (headText ? glbRole(headText) : 'unbekannt')
      : 'Netz'
    // MicMac schreibt das texturierte Netz als mesh_textured.ply — die Textur
    // steckt dann im PLY selbst, es gibt keine Datei daneben.
    const nameTextured = /textur/.test(entry.base)
    const textured =
      role === 'Netz' &&
      (nameTextured ||
        hasTextureCompanion(entry.path, lowerPaths, entry.base.replace(/\.[a-z0-9]+$/, ''), headText))
    if (textured) role = 'Netz mit Textur'

    const tooLarge = entry.size !== undefined && entry.size > SCAN_MESH_LIMIT_BYTES
    const notes: string[] = []
    if (role === 'Punktwolke') notes.push('Punktwolke — kein druckbares Netz')
    if (role === 'unbekannt') {
      notes.push(
        headText
          ? 'Dateikopf passt nicht zum Format — wird beim Laden geprüft'
          : 'Kopf nicht gelesen — wird beim Laden geprüft',
      )
    }
    if (format === 'glb') notes.push('GLB — Texturen werden nicht übernommen')
    if (role === 'Netz mit Textur') notes.push('Textur liegt daneben')
    if (tooLarge) notes.push('größer als die Ladelast von 150 MB')

    const depth = entry.path.split('/').length - 1
    const appMesh = isAppMesh(entry.lower)
    const score =
      (role === 'Netz mit Textur' ? 100 : role === 'Netz' ? 85 : role === 'unbekannt' ? 60 : 15) +
      engineBonus(engine, entry.lower) +
      (appMesh && !isJobFolder ? 12 : 0) -
      depth * 2

    ranked.push({
      appOutput: isJobFolder && appMesh,
      candidate: {
        path: entry.path,
        file: entry.base,
        format,
        role,
        usable: role !== 'Punktwolke' && !tooLarge,
        size: entry.size ?? null,
        note: notes.join(' · '),
      },
      score,
    })
  }
  ranked.sort(
    (a, b) =>
      Number(b.appOutput) - Number(a.appOutput) ||
      b.score - a.score ||
      a.candidate.path.localeCompare(b.candidate.path),
  )
  const candidates = ranked.map((entry) => entry.candidate)
  const usable = candidates.filter((entry) => entry.usable)

  // Registrierte Bilder: die erste Quelle gewinnt, die wirklich Zahlen liefert.
  let images: { count: number; source: string } | null = null
  const countFrom = (pattern: RegExp, counter: (text: string) => number | null, source: string) => {
    const file = entries.find((entry) => pattern.test(entry.lower))
    if (!file) return null
    const count = counter(head(file.path) ?? '')
    return count === null ? null : { count, source }
  }
  images =
    countFrom(/(^|\/)images\.txt$/, countColmapImages, 'COLMAP images.txt') ??
    countFrom(/\/(sfm\.json|cameras\.sfm)$/, countMeshroomViews, 'Meshroom SfM-Ausgabe') ??
    countFrom(/\.mvs$/, countOpenMvsImages, 'openMVS-Szene')
  // Der Bildordner zählt nur bei erkannter Herkunft — in einem beliebigen
  // Ordner mit ein paar Fotos wäre die Zahl nur geraten.
  if (!images && engine !== 'unknown') {
    const inImagesFolder = entries.filter(
      (entry) => isImage(entry.lower) && /\/(images?|fotos?)\//.test(`/${entry.lower}`),
    )
    if (inImagesFolder.length) images = { count: inImagesFolder.length, source: 'Bildordner' }
  }

  const warnings: string[] = []
  if (job) {
    // Eine job.json erklärt Herkunft und fehlende Netze besser als jede
    // allgemeine Warnung — deshalb steht hier nur eine Meldung.
    if (job.status !== null && job.status !== 'ready') {
      warnings.push(
        `Der Scan-Lauf ist nicht fertig (${job.statusLabel}). Im MeshScan-Server starten; danach den Ordner erneut prüfen.`,
      )
    } else if (!usable.length) {
      warnings.push(
        'Der Scan-Lauf meldet fertig, aber im Ordner liegt kein ladbares Netz — bitte im MeshScan-Server prüfen.',
      )
    }
  } else if (!candidates.length) {
    warnings.push(`Kein druckbares Netz im Ordner. ${NEXT_STEP[engine]}`)
  } else if (!usable.length) {
    warnings.push(`Nur Punktwolken gefunden — daraus lässt sich nicht slicen. ${NEXT_STEP[engine]}`)
  } else if (engine === 'unknown') {
    warnings.push(
      'Herkunft nicht erkannt. Das Netz lässt sich trotzdem laden; Maßstab und Herkunft bitte selbst prüfen.',
    )
  }
  if (images && images.count === 0 && (engine === 'colmap' || engine === 'meshroom' || engine === 'openmvs')) {
    warnings.push('Der Lauf nennt keine registrierten Bilder — vermutlich ist er abgebrochen oder unvollständig.')
  }
  // Ein GLB hat seine Farben in sich; wir übernehmen sie nicht — dann ist
  // „keine Textur gefunden“ kein Mangel des Ordners.
  const topIsGlb = candidates[0]?.usable && candidates[0].format === 'glb'
  if (
    candidates.length &&
    !topIsGlb &&
    !candidates.some((entry) => entry.role === 'Netz mit Textur') &&
    engine !== 'unknown'
  ) {
    warnings.push('Keine Textur gefunden. Für den Druck ist das meist egal, für die Vorschau fehlt die Farbe.')
  }

  return { engine, confidence, evidence, images, candidates, warnings }
}

/**
 * `job.json` des MeshScan-Servers (`C:\meshscan3D\data\jobs\<id>\job.json`).
 * Der Server legt dort Name, Status, Fotozahl und die Maße des fertigen
 * `mesh.glb` ab — damit nennt der Slicer den Scan beim Namen statt „Ordner“.
 */
export type ScanJobInfo = {
  id: string | null
  name: string | null
  status: string | null
  statusLabel: string
  photos: number | null
  meshBytes: number | null
  error: string | null
}

export const SCAN_JOB_STATUS_LABEL: Record<string, string> = {
  created: 'angelegt — wartet auf Fotos',
  uploading: 'Fotos werden hochgeladen',
  processing: 'rechnet gerade',
  ready: 'fertig',
  failed: 'fehlgeschlagen',
  cancelled: 'abgebrochen',
}

export function parseScanJob(text: string): ScanJobInfo | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const raw = data as Record<string, unknown>
  const status = typeof raw.status === 'string' ? raw.status.trim().toLowerCase() || null : null
  if (!status && !('photo_count' in raw) && !('mesh_size_bytes' in raw)) return null
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
  return {
    id: typeof raw.id === 'string' ? raw.id : null,
    name: typeof raw.name === 'string' ? raw.name.slice(0, 120) : null,
    status,
    statusLabel: status
      ? (SCAN_JOB_STATUS_LABEL[status] ?? `unbekannter Status „${status}“`)
      : 'unbekannt',
    photos: num(raw.photo_count),
    meshBytes: num(raw.mesh_size_bytes),
    error: typeof raw.error === 'string' ? raw.error.slice(0, 300) : null,
  }
}
