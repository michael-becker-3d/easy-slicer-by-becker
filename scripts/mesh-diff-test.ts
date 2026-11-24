// Prüft die Differenz zweier Bettmessungen: identische Raster, gleichmäßiger
// Versatz, einzelne Erhöhung, Vorzeichen und bilineare Umrechnung.
import { diffBedMeshes } from '../shared/mesh-diff.ts'
import type { BedMeshRecord } from '../shared/types.ts'

const rec = (z: number[][], at = Date.now()): BedMeshRecord => {
  const flat = z.flat()
  return {
    at,
    rows: z.length,
    cols: z[0].length,
    min: Math.min(...flat),
    max: Math.max(...flat),
    mean: flat.reduce((a, b) => a + b, 0) / Math.max(1, flat.length),
    spread: Math.max(...flat) - Math.min(...flat),
    source: 'manual',
    z,
  }
}

const grid = (rows: number, cols: number, f: (r: number, c: number) => number = () => 0) =>
  Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => f(r, c)))

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps
const checks: [string, boolean][] = []

const same = diffBedMeshes(rec(grid(3, 3)), rec(grid(3, 3)))
checks.push(['identische Messungen → 0', near(same.maxAbs, 0) && near(same.meanAbs, 0) && !same.resampled])

const uniform = diffBedMeshes(rec(grid(3, 3, () => 0.05)), rec(grid(3, 3)))
checks.push([
  '+0,05 mm überall',
  near(uniform.maxRise, 0.05) && near(uniform.maxDrop, 0) && near(uniform.meanAbs, 0.05) && near(uniform.rms, 0.05),
])

const bumpGrid = grid(3, 3)
bumpGrid[1][1] = 0.1
const bump = diffBedMeshes(rec(bumpGrid), rec(grid(3, 3)))
checks.push(['einzelne Erhöhung 0,1 mm', near(bump.maxRise, 0.1) && near(bump.maxDrop, 0) && near(bump.d[1][1], 0.1)])

const lower = diffBedMeshes(rec(grid(3, 3, () => -0.02)), rec(grid(3, 3)))
checks.push(['Absenkung wird negativ', near(lower.maxDrop, -0.02) && near(lower.maxRise, 0)])

const resampled = diffBedMeshes(rec(grid(3, 3)), rec(grid(5, 5)))
checks.push(['Raster 3×3 vs 5×5 erkannt', resampled.resampled && near(resampled.maxAbs, 0)])

// Gleicher Verlauf in unterschiedlich feinen Rastern → bilinear fast deckungsgleich
const gradient = diffBedMeshes(rec(grid(5, 5, (_r, c) => c * 0.025)), rec(grid(3, 3, (_r, c) => c * 0.05)))
checks.push(['bilinear umgerechnet', gradient.resampled && gradient.maxAbs < 0.001])

for (const [name, ok] of checks) console.log(`${ok ? 'ok  ' : 'FEHL'} ${name}`)
const all = checks.every(([, ok]) => ok)
console.log(all ? 'ERGEBNIS: ok' : 'ERGEBNIS: FEHLER')
process.exit(all ? 0 : 1)
