import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getAsset, isSea } from 'node:sea'

/**
 * Lädt eine Datei aus dem Projektordner `assets/` (Pfad mit `/`, z. B.
 * `shape-models/skiff.stl`). In der EXE liegen die Dateien als SEA-Assets
 * (siehe `scripts/build-exe.mjs`), im Entwicklungsbetrieb werden sie direkt
 * vom Datenträger gelesen. Fehlt beides, kommt `null` zurück.
 */
export function loadAsset(relativePath: string): Buffer | null {
  if (isSea()) {
    try {
      const data = getAsset(relativePath)
      if (data && data.byteLength > 0) return Buffer.from(data)
    } catch {
      // Kein Asset unter diesem Namen — unten wird die Datei versucht.
    }
  }

  const path = join(process.cwd(), 'assets', ...relativePath.split('/'))
  if (!existsSync(path)) return null
  return readFileSync(path)
}
