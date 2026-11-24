/**
 * Fotogrammetrie-Ausgabeordner lesen (V-23).
 *
 * Meshroom, COLMAP, openMVS und MicMac laufen auf dem Rechner des Nutzers oder
 * auf einem Server; der Slicer liest nur das Ergebnis. Hier wird ausschließlich
 * gelesen: kein Schreiben, kein Löschen, kein Starten von Jobs. Große Ordner
 * werden begrenzt, damit die Oberfläche nicht an einem Datenberg hängt.
 */
import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import {
  detectScanFolder,
  parseScanJob,
  scanMeshFormat,
  SCAN_MESH_LIMIT_BYTES,
  SCAN_MESH_SUFFIXES,
  type ScanContent,
  type ScanFileRef,
  type ScanFolderReport,
  type ScanJobInfo,
} from '../shared/scanEngines.ts'

export const SCAN_FOLDER_MAX_ENTRIES = 40_000
export const SCAN_FOLDER_MAX_DEPTH = 6
/** So viel Text wird je Signalgruppe gelesen — reicht für Bildlisten und Mesh-Köpfe. */
const SIGNAL_READ_BYTES = 512 * 1024
const MESH_HEAD_BYTES = 4096
const MAX_MESH_HEADS = 16
const MAX_SIGNAL_FILES = 8
/** `job.json` zählt im geprüften Ordner selbst oder eine Ebene darüber (`<id>/job.json`). */
const MAX_JOB_JSON_DEPTH = 2

const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '__pycache__', 'system volume information'])

const MESH_SUFFIXES = new Set(SCAN_MESH_SUFFIXES)
const SIGNAL_PATTERNS = [/(^|\/)images\.txt$/, /\/(sfm\.json|cameras\.sfm)$/, /\.mvs$/]

/**
 * Sammelt die Dateiliste relativ zur Wurzel. Symbolische Verknüpfungen werden
 * nicht verfolgt, damit ein Lauf nicht in eine Endlosschleife gerät. Größen
 * werden nur für Mesh-Dateien geholt — das spart bei 40.000 Dateien 40.000
 * zusätzliche Abfragen.
 */
export function readScanTree(root: string): { files: ScanFileRef[]; truncated: boolean } {
  const files: ScanFileRef[] = []
  let truncated = false
  const stack: { dir: string; relative: string; depth: number }[] = [{ dir: root, relative: '', depth: 0 }]

  while (stack.length) {
    const current = stack.pop()!
    let entries
    try {
      entries = readdirSync(current.dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (files.length >= SCAN_FOLDER_MAX_ENTRIES) {
        truncated = true
        break
      }
      if (entry.isSymbolicLink()) continue
      const relative = current.relative ? `${current.relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (current.depth >= SCAN_FOLDER_MAX_DEPTH) continue
        if (SKIP_DIRS.has(entry.name.toLowerCase())) continue
        stack.push({ dir: join(current.dir, entry.name), relative, depth: current.depth + 1 })
        continue
      }
      if (!entry.isFile()) continue
      if (!scanMeshFormat(entry.name)) {
        files.push({ path: relative })
        continue
      }
      let size: number | undefined
      try {
        size = statSync(join(current.dir, entry.name)).size
      } catch {
        size = undefined
      }
      files.push({ path: relative, size })
    }
    if (truncated) break
  }

  return { files, truncated }
}

/**
 * Liest nur den Anfang einer Datei — nie die ganze Datei für ein paar Kilobyte
 * Kopf. Exportiert, damit `scripts/bench-scan-head.ts` genau diesen Pfad gegen
 * den alten Ganzdatei-Lesesweg messen kann.
 */
export function readHead(path: string, bytes: number): string | null {
  let fd: number | null = null
  try {
    const stat = statSync(path)
    if (!stat.isFile() || stat.size === 0) return null
    const buffer = Buffer.alloc(Math.min(bytes, stat.size))
    fd = openSync(path, 'r')
    const read = readSync(fd, buffer, 0, buffer.length, 0)
    // Nur Text: binäre Formate (STL, 3MF) haben hier nichts zu suchen.
    return buffer.subarray(0, read).toString('utf8')
  } catch {
    return null
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

/** Dateien, deren Inhalt die Erkennung braucht: Bildlisten, SfM, .mvs, Mesh-Köpfe. */
function signalPaths(files: ScanFileRef[]): { signals: string[]; meshes: string[] } {
  const signals: string[] = []
  const meshes: string[] = []
  for (const file of files) {
    const lower = file.path.toLowerCase()
    if (SIGNAL_PATTERNS.some((pattern) => pattern.test(lower))) {
      if (signals.length < MAX_SIGNAL_FILES) signals.push(file.path)
      continue
    }
    const format = scanMeshFormat(lower)
    if ((format === 'ply' || format === 'obj' || format === 'glb') && meshes.length < MAX_MESH_HEADS) {
      meshes.push(file.path)
    }
  }
  // Flache Dateien zuerst: dort liegt in der Regel das fertige Netz.
  const byDepth = (paths: string[]) =>
    paths.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
  return { signals: byDepth(signals), meshes: byDepth(meshes) }
}

/** `job.json` des MeshScan-Servers — die flachste gültige gewinnt. */
function jobInfo(files: ScanFileRef[], root: string): ScanJobInfo | null {
  const candidates = files
    .filter((file) => file.path.split('/').pop()!.toLowerCase() === 'job.json')
    .filter((file) => file.path.split('/').length <= MAX_JOB_JSON_DEPTH)
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length)
  for (const file of candidates) {
    const text = readHead(join(root, file.path), 64 * 1024)
    if (text === null) continue
    const parsed = parseScanJob(text)
    if (parsed) return parsed
  }
  return null
}

export function inspectScanFolder(root: string): {
  report: ScanFolderReport
  job: ScanJobInfo | null
  root: string
  files: number
  truncated: boolean
} {
  const absolute = resolve(root)
  let stat
  try {
    stat = statSync(absolute)
  } catch {
    throw new Error('Ordner nicht gefunden — bitte den vollständigen Pfad prüfen.')
  }
  if (!stat.isDirectory()) throw new Error('Der Pfad ist kein Ordner.')
  const { files, truncated } = readScanTree(absolute)
  const job = jobInfo(files, absolute)
  const { signals, meshes } = signalPaths(files)
  const contents: ScanContent[] = []
  for (const [paths, bytes] of [
    [signals, SIGNAL_READ_BYTES],
    [meshes, MESH_HEAD_BYTES],
  ] as const) {
    for (const path of paths) {
      const text = readHead(join(absolute, path), bytes)
      if (text !== null) contents.push({ path, text })
    }
  }
  const detected = detectScanFolder(files, contents, job)
  // Der absolute Pfad entsteht hier, einmal und mit dem Trennzeichen der
  // Plattform. Die Oberfläche gibt ihn unverändert zurück.
  const report: ScanFolderReport = {
    ...detected,
    candidates: detected.candidates.map((candidate) => ({
      ...candidate,
      absolutePath: join(absolute, candidate.path),
    })),
  }
  if (truncated) {
    report.warnings.push(
      `Der Ordner hat mehr als ${SCAN_FOLDER_MAX_ENTRIES.toLocaleString('de-DE')} Dateien; die Liste wurde beschnitten.`,
    )
  }
  return { report, job, root: absolute, files: files.length, truncated }
}

/** Liest ein Mesh aus dem Ausgabeordner — nur die Endungen, die der Slicer kennt. */
export function readScanMeshFile(path: string): { buffer: Buffer; name: string } {
  if (!isAbsolute(path)) throw new Error('Bitte den vollständigen Pfad angeben.')
  if (!MESH_SUFFIXES.has(extname(path).toLowerCase())) {
    throw new Error('Nur STL, OBJ, PLY, 3MF und GLB lassen sich laden.')
  }
  let stat
  try {
    stat = statSync(path)
  } catch {
    throw new Error('Datei nicht gefunden — bitte den Ordner erneut prüfen.')
  }
  if (!stat.isFile()) throw new Error('Der Pfad ist keine Datei.')
  if (stat.size > SCAN_MESH_LIMIT_BYTES) {
    throw new Error(
      `Die Datei ist ${(stat.size / 1048576).toFixed(0)} MB groß — mehr als die ${SCAN_MESH_LIMIT_BYTES / 1048576} MB Ladegrenze. Bitte in der Engine gröber exportieren.`,
    )
  }
  if (stat.size === 0) throw new Error('Die Datei ist leer.')
  return { buffer: readFileSync(path), name: basename(path) }
}
