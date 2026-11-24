/**
 * Hält die Qualitätsmatrix gegen die echten Dateien: SHA-256 aus der JSONL,
 * Fluss und Z-Hop je Eintrag aus matrix.json und ergebnisse.jsonl gegen das
 * Slice-JSON neben der Datei und gegen den im G-code tatsächlich gefahrenen Hub.
 *
 * So fällt auf, bevor gedruckt wird, wenn eine Datei neu geslict wurde, ohne
 * dass Matrix oder Messblatt nachgezogen wurden — und umgekehrt.
 *
 * Aufruf: npm run test:quality-matrix
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join('Testdruck', 'Qualitaetsmatrix_2026-11-16')
/** Messschieber-Auflösung: kleinere Abweichungen gelten als gleich. */
const TOLERANCE = 0.0011

type SliceRecord = {
  id?: string
  settings?: {
    flow?: number
    zHop?: number
    surfaceGuard?: { enabled?: boolean; travelHop?: number }
  }
}

type MatrixVariant = {
  id: string
  gcode: string
  flow?: number
  zHop?: number
}

type Matrix = {
  baseline: { flow: number; zHop: number }
  variantsFlow?: number
  variantsZHop?: number
  variants: MatrixVariant[]
}

type Row = {
  id: string
  status?: string
  file?: string | null
  sha256?: string | null
  soll?: { flow?: number | null; z_hop_mm?: number | null }
}

const errors: string[] = []
const hints: string[] = []

function readText(path: string): string {
  return readFileSync(path, 'utf8')
}

function readJson<T>(path: string): T {
  return JSON.parse(readText(path)) as T
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function near(a: number | null | undefined, b: number | null | undefined): boolean {
  return typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= TOLERANCE
}

/**
 * Häufigster Hub über alle Schichten (Oberkante der Layer minus Layer-Z).
 * Der Modus statt des Maximums, weil Start-/Endblock und der
 * Oberflächenschutz einzelne Ausreißer einstreuen.
 */
function hopFromGcode(text: string): number | null {
  const hops: number[] = []
  let layerZ: number | null = null
  let maxZ: number | null = null
  const flush = (): void => {
    if (layerZ != null && maxZ != null && maxZ > layerZ + 0.0001) {
      hops.push(Math.round((maxZ - layerZ) * 100) / 100)
    }
  }
  for (const line of text.split('\n')) {
    const zComment = line.match(/^; Z:([\d.]+)/)
    if (zComment) {
      flush()
      layerZ = parseFloat(zComment[1])
      maxZ = null
      continue
    }
    if (line.startsWith(';LAYER:')) {
      flush()
      layerZ = null
      maxZ = null
      continue
    }
    if (layerZ == null) continue
    const zMove = line.match(/^G[01] .*Z(-?\d+(?:\.\d+)?)/)
    if (!zMove) continue
    const z = parseFloat(zMove[1])
    if (maxZ == null || z > maxZ) maxZ = z
  }
  flush()
  if (hops.length === 0) return null
  const counts = new Map<number, number>()
  for (const hop of hops) counts.set(hop, (counts.get(hop) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

function sliceRecordOf(gcodePath: string): SliceRecord | null {
  const recordPath = gcodePath.replace(/\.gcode$/, '.json')
  return existsSync(recordPath) ? readJson<SliceRecord>(recordPath) : null
}

const matrix = readJson<Matrix>(join(DIR, 'matrix.json'))
for (const variant of matrix.variants) {
  const gcodePath = join(DIR, variant.gcode)
  if (!existsSync(gcodePath)) {
    errors.push(`${variant.id}: in matrix.json genannt, Datei ${variant.gcode} fehlt`)
    continue
  }
  const expectedFlow = variant.flow ?? matrix.variantsFlow ?? matrix.baseline.flow
  const expectedZHop = variant.zHop ?? matrix.variantsZHop ?? matrix.baseline.zHop
  const record = sliceRecordOf(gcodePath)
  if (!record?.settings) {
    errors.push(`${variant.id}: Slice-JSON neben ${variant.gcode} fehlt, Fluss/Z-Hop nicht prüfbar`)
  } else {
    if (!near(record.settings.flow, expectedFlow)) {
      errors.push(
        `${variant.id}: Datei wurde mit Fluss ${record.settings.flow} geslict, matrix.json nennt ${expectedFlow}`,
      )
    }
    if (!near(record.settings.zHop, expectedZHop)) {
      errors.push(
        `${variant.id}: Datei wurde mit Z-Hop ${record.settings.zHop} mm geslict, matrix.json nennt ${expectedZHop} mm`,
      )
    }
  }
  const hop = hopFromGcode(readText(gcodePath))
  if (hop == null) {
    hints.push(`${variant.id}: kein Hub im G-code gefunden`)
  } else if (!near(hop, expectedZHop)) {
    errors.push(`${variant.id}: G-code fährt Hub ${hop} mm, matrix.json nennt ${expectedZHop} mm`)
  }
}

const rows = readText(join(DIR, 'ergebnisse.jsonl'))
  .split(/\r?\n/)
  .filter((line) => line.trim().length > 0)
  .map((line) => JSON.parse(line) as Row)

for (const row of rows) {
  if (!row.file) continue
  const gcodePath = join(DIR, row.file)
  if (!existsSync(gcodePath)) {
    errors.push(`${row.id}: Datei ${row.file} fehlt`)
    continue
  }
  if (row.sha256) {
    const actual = sha256(gcodePath)
    if (actual !== row.sha256) {
      errors.push(
        `${row.id}: SHA-256 der Datei ${actual.slice(0, 16)}… weicht von der JSONL ${row.sha256.slice(0, 16)}… ab`,
      )
    }
  } else if (row.status === 'planned') {
    hints.push(`${row.id}: geplant, noch kein SHA-256 hinterlegt`)
  } else {
    errors.push(`${row.id}: Status ${row.status ?? '—'}, aber kein SHA-256 eingetragen`)
  }
  const record = sliceRecordOf(gcodePath)
  if (!record?.settings) {
    hints.push(`${row.id}: kein Slice-JSON, Fluss/Z-Hop nur aus der JSONL`)
  } else {
    if (row.soll?.flow != null && !near(record.settings.flow, row.soll.flow)) {
      errors.push(
        `${row.id}: Datei wurde mit Fluss ${record.settings.flow} geslict, JSONL nennt ${row.soll.flow}`,
      )
    }
    if (row.soll?.z_hop_mm != null && !near(record.settings.zHop, row.soll.z_hop_mm)) {
      errors.push(
        `${row.id}: Datei wurde mit Z-Hop ${record.settings.zHop} mm geslict, JSONL nennt ${row.soll.z_hop_mm} mm`,
      )
    }
  }
  if (row.soll?.z_hop_mm != null) {
    const hop = hopFromGcode(readText(gcodePath))
    if (hop != null && !near(hop, row.soll.z_hop_mm)) {
      errors.push(
        `${row.id}: G-code fährt Hub ${hop} mm, JSONL nennt ${row.soll.z_hop_mm} mm`,
      )
    }
  }
}

const matrixFileById = new Map(matrix.variants.map((variant) => [variant.id, variant.gcode]))
for (const row of rows) {
  if (!row.file) continue
  const listed = matrixFileById.get(row.id)
  if (listed && listed !== row.file) {
    hints.push(`${row.id}: matrix.json nennt ${listed}, die JSONL misst ${row.file}`)
  }
}

for (const hint of hints) console.log(`   Hinweis: ${hint}`)
for (const error of errors) console.log(`   FEHLER: ${error}`)

const checkedFiles = rows.filter((row) => row.file).length
if (errors.length > 0) {
  console.log(`\nQualitätsmatrix: ${errors.length} Fehler bei ${matrix.variants.length} Matrix- und ${checkedFiles} JSONL-Einträgen.`)
  process.exit(1)
}
console.log(
  `Qualitätsmatrix: ${matrix.variants.length} Matrix-Einträge und ${checkedFiles} JSONL-Dateien stimmig (SHA-256, Fluss, Z-Hop).`,
)
