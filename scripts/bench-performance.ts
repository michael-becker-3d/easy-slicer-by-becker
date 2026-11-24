/*
 * Messskript für die teuren Serverpfade: Datei lesen, offene Kanten zählen,
 * Reparatur, Einzelteile trennen und Objekte zusammenbauen.
 *
 * Zweck: Änderungen an diesen Pfaden (A-132, A-133, A-134) sollen belegbar
 * schneller oder mindestens gleich schnell sein. Das Skript arbeitet nur mit
 * den Server-Helfern — kein Drucker, kein Netzwerk, kein Druck.
 *
 * Aufruf:
 *   npm run bench
 *   BENCH_CUBES=20000 BENCH_RUNS=5 npm run bench
 *
 * Die Würfel liegen ohne gemeinsame Eckpunkte nebeneinander (wie die Teile
 * einer 3MF) und haben je eine fehlende Fläche, damit Reparatur und
 * Kantenzählung wirklich arbeiten müssen.
 */
import { performance } from 'node:perf_hooks'
import { countOpenEdges, fillHoles, meshComponents, orientMesh, repairMesh } from '../server/csg.ts'
import { composeObjects, defaultPlacement, type ModelObject } from '../server/objects.ts'
import { meshToBinarySTL, parseModelFile } from '../server/formats.ts'
import { makeMesh, type Mesh } from '../server/slicer/stl.ts'
import { box } from '../server/meshlib.ts'

const CUBES = Math.max(1, Math.floor(Number(process.env.BENCH_CUBES ?? 8000)))
const RUNS = Math.max(1, Math.floor(Number(process.env.BENCH_RUNS ?? 3)))

function cubeField(cubes: number): number[][] {
  const tris: number[][] = []
  for (let i = 0; i < cubes; i++) {
    const x = (i % 40) * 12
    const y = (Math.floor(i / 40) % 40) * 12
    const z = Math.floor(i / 1600) * 12
    // Letzte Fläche weglassen: Der Würfel hat dann einen offenen Rand.
    tris.push(...box(10, 10, 10, x, y, z).slice(0, -1))
  }
  return tris
}

function meshOf(tris: number[][]): Mesh {
  const positions = new Float32Array(tris.length * 9)
  for (let i = 0; i < tris.length; i++) {
    const t = tris[i]
    for (let k = 0; k < 9; k++) positions[i * 9 + k] = t[k]
  }
  return makeMesh(positions, false)
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

type Case = { name: string; detail: string; run: () => unknown }

function measure(cases: Case[]) {
  console.log(`Messung: ${CUBES} Körper, ${RUNS} Läufe je Pfad (Median)\n`)
  console.log(`${'Pfad'.padEnd(52)} ${'Median'.padStart(10)} ${'Min'.padStart(10)}  Ergebnis`)
  console.log('-'.repeat(96))
  for (const item of cases) {
    const times: number[] = []
    let result: unknown
    // Ein Aufwärmlauf zählt nicht: Der erste Lauf enthält JIT und Seitenfehler.
    for (let run = 0; run <= RUNS; run++) {
      const started = performance.now()
      result = item.run()
      const elapsed = performance.now() - started
      if (run > 0) times.push(elapsed)
    }
    const shown = typeof result === 'number' ? String(result) : typeof result === 'boolean' ? String(result) : ''
    console.log(
      `${item.name.padEnd(52)} ${`${median(times).toFixed(1)} ms`.padStart(10)} ${`${Math.min(...times).toFixed(1)} ms`.padStart(10)}  ${shown}`,
    )
  }
  console.log(`\n${'-'.repeat(96)}`)
}

const raw = meshOf(cubeField(CUBES))
const triangles = raw.triangles
const stl = meshToBinarySTL(raw)
const objects: ModelObject[] = [
  { id: 'bench', name: 'bench.stl', mesh: raw, placement: defaultPlacement() },
]
let repairedTriangles = 0
let componentCount = 0

measure([
  { name: 'STL lesen (binär)', detail: `${triangles} Dreiecke`, run: () => parseModelFile(stl, 'bench.stl') },
  { name: 'offene Kanten zählen', detail: '', run: () => countOpenEdges(raw) },
  {
    name: 'Reparatur (repairMesh + fillHoles + orientMesh)',
    detail: '',
    run: () => {
      const fixed = orientMesh(fillHoles(repairMesh(raw)))
      repairedTriangles = fixed.triangles
      return fixed.triangles
    },
  },
  {
    name: 'Einzelteile trennen (meshComponents)',
    detail: '',
    run: () => {
      componentCount = meshComponents(raw).length
      return componentCount
    },
  },
  {
    name: 'Zusammenbau (composeObjects)',
    detail: '',
    run: () => composeObjects(objects)?.triangles ?? 0,
  },
])

console.log(`Repariertes Netz: ${repairedTriangles} Dreiecke, Einzelteile: ${componentCount}`)
