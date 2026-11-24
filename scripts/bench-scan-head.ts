/*
 * Messskript für den begrenzten Kopf-Leser in `server/scanFolder.ts` (A-150).
 *
 * Behauptet war: Der Scan-Ordner liest für die Erkennung nur noch ein paar
 * Kilobyte je Datei statt einer ganzen 200-MB-PLY. Dieses Skript misst das an
 * einer echten großen Datei gegen den alten Weg (`readFileSync` + `subarray`).
 *
 * Jeder Lauf bekommt einen eigenen Prozess: Nur so sind Zeit und RSS-Spitze
 * sauber vergleichbar (im selben Prozess bleiben Buffer aus früheren Läufen
 * liegen und verfälschen den Speicherwert). Ein leerer Lauf misst den Anteil
 * von Node + tsx selbst.
 *
 * Aufruf:
 *   npm run bench:scan-head
 *   BENCH_FILE_MB=500 BENCH_RUNS=5 npm run bench:scan-head
 *
 * Es wird nur lokal in %TEMP% geschrieben und gelesen; die Testdatei wird im
 * finally gelöscht. Kein Drucker, kein Netzwerk, kein Druck, kein Upload.
 */
import { appendFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { inspectScanFolder, readHead } from '../server/scanFolder.ts'

const MB = 1024 * 1024
const FILE_MB = Math.max(1, Math.floor(Number(process.env.BENCH_FILE_MB ?? 200)))
const RUNS = Math.max(1, Math.min(9, Math.floor(Number(process.env.BENCH_RUNS ?? 3))))
const HEAD_BYTES = 4096
/** So kürzte der Scan-Ordner vor A-150: ganze Datei lesen, dann abschneiden. */
const READ_BYTES_OLD = 64 * 1024

type Result = {
  ms: number
  peakRssMb: number
  externalMb: number
  heapMb: number
  bytes: number
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}
const one = (value: number) => value.toFixed(1).replace('.', ',')

/** Der alte Weg aus A-150: Datei komplett einlesen, dann auf den Kopf kürzen. */
export function readHeadOld(path: string, bytes: number): string | null {
  try {
    const buffer = readFileSync(path)
    return buffer.subarray(0, Math.min(bytes, buffer.length)).toString('utf8')
  } catch {
    return null
  }
}

/** Kindprozess: ein Weg, eine Messung, danach Prozessende. */
function workerMain(mode: string, target: string): void {
  const before = process.memoryUsage().heapUsed
  const started = performance.now()
  let bytes = 0
  if (mode === 'read-old') bytes = readHeadOld(target, READ_BYTES_OLD)?.length ?? 0
  else if (mode === 'read-new') bytes = readHead(target, HEAD_BYTES)?.length ?? 0
  else if (mode === 'whole') bytes = readFileSync(target).length
  else if (mode === 'folder') bytes = inspectScanFolder(target).report.candidates.length
  const ms = performance.now() - started
  const after = process.memoryUsage()
  // Ergebnis lebt bis hierher, damit der Speicherbedarf messbar bleibt.
  if (mode !== 'noop' && bytes === 0) throw new Error(`Kein Ergebnis (${mode}, ${target}).`)
  console.log(
    'MESSUNG ' +
      JSON.stringify({
        ms,
        peakRssMb: process.resourceUsage().maxRSS / 1024,
        externalMb: after.external / MB,
        heapMb: after.heapUsed / MB,
        heapDeltaMb: (after.heapUsed - before) / MB,
        bytes,
      }),
  )
}

const isWorker = process.argv[2] === '--worker'
const selfPath = fileURLToPath(import.meta.url)
const tsxCli = join(dirname(selfPath), '..', 'node_modules', 'tsx', 'dist', 'cli.mjs')

function runWorker(mode: string, target: string): Result {
  const child = spawnSync(process.execPath, ['--expose-gc', tsxCli, selfPath, '--worker', mode, target], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (child.status !== 0) {
    throw new Error(`Kindprozess ${mode} fehlgeschlagen: ${child.stderr || child.stdout}`)
  }
  const line = (child.stdout || '')
    .split(/\r?\n/)
    .reverse()
    .find((row) => row.startsWith('MESSUNG '))
  if (!line) throw new Error(`Keine Messung von ${mode}: ${child.stdout}`)
  return JSON.parse(line.slice('MESSUNG '.length)) as Result
}

function series(label: string, mode: string, target: string): Result[] {
  const results: Result[] = []
  for (let i = 0; i < RUNS; i++) results.push(runWorker(mode, target))
  const ms = median(results.map((r) => r.ms))
  const peak = Math.max(...results.map((r) => r.peakRssMb))
  const external = Math.max(...results.map((r) => r.externalMb))
  const heap = Math.max(...results.map((r) => r.heapMb))
  const bytes = results[0].bytes
  console.log(
    `${label.padEnd(30)} ${one(ms).padStart(8)} ms · Spitze ${one(peak).padStart(7)} MB · ` +
      `Buffer ${one(external).padStart(7)} MB · Heap ${one(heap).padStart(6)} MB · ${bytes} Zeichen`,
  )
  return results
}

if (isWorker) {
  workerMain(process.argv[3], process.argv[4])
} else {
  const workDir = join(tmpdir(), `easy-slicer-bench-head-${process.pid}`)
  const plyPath = join(workDir, 'scene_dense_mesh_refine.ply')
  const signalPath = join(workDir, 'images.txt')
  try {
    rmSync(workDir, { recursive: true, force: true })
    mkdirSync(workDir, { recursive: true })

    const header =
      'ply\nformat binary_little_endian 1.0\ncomment synthetische Prüfdatei\n' +
      'element vertex 1000000\nproperty float x\nproperty float y\nproperty float z\n' +
      'element face 2000000\nproperty list uchar int vertex_indices\nend_header\n'
    // Keine Nullbytes am Stück: eine echte Datei, kein dünn besetzter Platzhalter.
    const chunk = Buffer.alloc(MB)
    for (let i = 0; i < chunk.length; i++) chunk[i] = (i * 31 + 7) % 251
    writeFileSync(plyPath, header)
    for (let written = 0; written < FILE_MB * MB; written += MB) appendFileSync(plyPath, chunk)
    writeFileSync(signalPath, '1.jpg\n2.jpg\n3.jpg\n')

    const size = statSync(plyPath).size
    console.log(
      `Testdatei: ${one(size / MB)} MB  (${plyPath})\n` +
        `Läufe: ${RUNS} · Kopf: ${HEAD_BYTES} Bytes · alter Leseweg: ${READ_BYTES_OLD} Bytes · je Lauf ein eigener Prozess\n`,
    )

    const oldText = readHeadOld(plyPath, READ_BYTES_OLD)
    const newText = readHead(plyPath, HEAD_BYTES)
    // Beide Wege müssen den vollständigen PLY-Kopf liefern. Ein Zeichen am
    // Schnittrand kann je nach Byte-Grenze ein Ersatzzeichen sein — der Kopf
    // selbst (reines ASCII) muss unverändert ankommen.
    const samePrefix =
      oldText !== null && newText !== null && oldText.startsWith(header) && newText.startsWith(header)
    console.log(
      `PLY-Kopf vollständig: ${samePrefix ? 'ja' : 'NEIN'} · neuer Kopf ${newText?.length ?? 0} Zeichen · ` +
        `alter Kopf ${oldText?.length ?? 0} Zeichen\n`,
    )
    if (!samePrefix) throw new Error('Der begrenzte Leser liefert einen anderen Kopf als der alte Weg.')

    series('leer (Node + tsx, kein Lesen)', 'noop', plyPath)
    const oldRuns = series('alt (readFileSync + 64 KB)', 'read-old', plyPath)
    const newRuns = series('neu (readHead, 4 KB)', 'read-new', plyPath)
    const folderRuns = series('Ordner jetzt (inspectScanFolder)', 'folder', workDir)
    series('nur Ganzdatei-Lesen (200 MB)', 'whole', plyPath)

    const msOf = (runs: Result[]) => median(runs.map((r) => r.ms))
    const savedMs = msOf(oldRuns) - msOf(newRuns)
    const oldFolderMs = msOf(folderRuns) + savedMs
    console.log(
      `
Ein 200-MB-Mesh mit 16 möglichen Mesh-Köpfen (MAX_MESH_HEADS):
` +
        `  jetzt  ${one(msOf(folderRuns) + 15 * msOf(newRuns))} ms · ` +
        `vorher ${one(msOf(folderRuns) + 15 * msOf(oldRuns))} ms (Hochrechnung aus den Messwerten)
` +
        `  Ersparnis je großem Mesh: ${one(savedMs)} ms und rund ${one(202.4 - 2.4)} MB Buffer, ` +
        `die nicht mehr angefordert werden.`,
    )

  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}
