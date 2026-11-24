import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import type { PrintSettings } from '../shared/types.ts'
import { parseModelFile } from '../server/formats.ts'

type ObjectInfo = {
  id: string
  name: string
  plate: number
  settings?: Partial<PrintSettings>
}
type UploadResponse = {
  id: string
  objects: ObjectInfo[]
  settings: Partial<PrintSettings>
  warnings: string[]
  plates: number
}
type SliceResponse = {
  gcode: string
  layers: unknown[]
  warnings: string[]
}

const FIXTURE = resolve('testdata/orca-issue-17151-vase-mode.3mf')
// Unveränderte Datei aus dem offiziellen OrcaSlicer-Issue #17151 (Anhang):
// https://github.com/OrcaSlicer/OrcaSlicer/issues/17151
// Die Prüfsumme verhindert, dass der Test später versehentlich mit einem
// synthetischen Nachbau oder einer nachträglich bearbeiteten Datei läuft.
const FIXTURE_SHA256 = '10a7c969b6c97e2c76b717f9f991e1857959d26de023f9c5973a1e375b69ff16'
const JSON_HEADERS = { 'Content-Type': 'application/json' }
const delay = (ms: number) => new Promise<void>((resolveDelay) => setTimeout(resolveDelay, ms))

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = address && typeof address === 'object' ? address.port : 0
      probe.close((error) => (error ? reject(error) : resolvePort(port)))
    })
  })
}

async function waitForHealth(base: string, child: ChildProcess, logs: () => string): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Testserver wurde mit Code ${child.exitCode} beendet.\n${logs()}`)
    }
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) })
      if (response.ok) return
    } catch {
      // Server startet noch.
    }
    await delay(200)
  }
  throw new Error(`Testserver wurde nicht rechtzeitig erreichbar.\n${logs()}`)
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  child.kill()
  await Promise.race([
    new Promise<void>((resolveExit) => child.once('exit', () => resolveExit())),
    delay(2000),
  ])
  if (child.exitCode === null) child.kill('SIGKILL')
}

async function main(): Promise<void> {
  const fixture = readFileSync(FIXTURE)
  const sha256 = createHash('sha256').update(fixture).digest('hex')
  assert.equal(
    sha256,
    FIXTURE_SHA256,
    'Die echte Orca-Testdatei wurde verändert — der Test darf nicht mit einem Nachbau laufen.',
  )

  const parsed = parseModelFile(fixture, basename(FIXTURE))
  assert.equal(parsed.format, '3mf')
  assert.equal(parsed.plates, 2, 'Die echte Datei muss beide Orca-Platten liefern')
  assert.equal(parsed.objects.length, 2)

  const mainObject = parsed.objects.find((object) => object.name.includes('Main body.stl'))
  const lipObject = parsed.objects.find((object) => object.name.includes('Upper lip.stl'))
  assert.ok(mainObject, 'Main body.stl fehlt in der Objektliste')
  assert.ok(lipObject, 'Upper lip.stl fehlt in der Objektliste')
  assert.equal(mainObject.plate, 0)
  assert.equal(lipObject.plate, 1)

  // Diese Werte stehen in Metadata/model_settings.config der echten Datei.
  assert.equal(mainObject.settings?.walls, 1)
  assert.equal(mainObject.settings?.topLayers, 0)
  assert.equal(mainObject.settings?.bottomLayers, 5)
  assert.equal(mainObject.settings?.infillDensity, 0)
  assert.equal(mainObject.settings?.lineWidth, 1)
  assert.equal(mainObject.settings?.outerWallLineWidth, 1)
  assert.equal(mainObject.settings?.innerWallLineWidth, 1)
  assert.equal(mainObject.settings?.topSurfaceLineWidth, 1)
  assert.deepEqual(mainObject.settings?.support, { kind: 'none' })
  assert.equal(lipObject.settings?.walls, 2)
  assert.equal(lipObject.settings?.infillDensity, 13)

  // Echte Orca-Dateien schreiben neutral 100 %. Das darf nicht als +100 %
  // Schrumpfkompensation ankommen (sonst wird das Modell doppelt so groß).
  assert.deepEqual(parsed.settings.shrinkage, { x: 0, y: 0, z: 0 })

  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  let serverLogs = ''
  const child = spawn(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), 'server/index.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), KEPLER_NO_BROWSER: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child.stdout?.on('data', (chunk: Buffer) => {
    serverLogs = (serverLogs + chunk.toString()).slice(-12_000)
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    serverLogs = (serverLogs + chunk.toString()).slice(-12_000)
  })

  try {
    await waitForHealth(base, child, () => serverLogs)
    const requestJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(`${base}${path}`, init)
      const text = await response.text()
      assert.ok(response.ok, `${path} antwortet ${response.status}: ${text}`)
      return JSON.parse(text) as T
    }

    const upload = await requestJson<UploadResponse>(
      '/api/models?name=orca-issue-17151.3mf&printerId=anycubic-vyper&nozzle=0.4&maxFlow=10',
      { method: 'POST', headers: { 'Content-Type': 'model/3mf' }, body: fixture },
    )
    assert.equal(upload.plates, 2)
    assert.equal(upload.objects.length, 2)
    assert.deepEqual(upload.settings.shrinkage, { x: 0, y: 0, z: 0 })

    // Genau diese Objektliste zeigt die Oberfläche an.
    const listedMain = upload.objects.find((object) => object.name.includes('Main body.stl'))
    const listedLip = upload.objects.find((object) => object.name.includes('Upper lip.stl'))
    assert.ok(listedMain?.settings)
    assert.ok(listedLip?.settings)
    assert.equal(listedMain.settings.walls, 1)
    assert.equal(listedMain.settings.infillDensity, 0)
    assert.equal(listedMain.settings.bottomLayers, 5)
    assert.equal(listedMain.settings.lineWidth, 1)
    assert.equal(listedLip.settings.walls, 2)
    assert.equal(listedLip.settings.infillDensity, 13)
    assert.ok(
      upload.warnings.some((warning) => warning.includes('eigene Objektwerte')),
      'Der Importhinweis muss die echten Objektwerte nennen',
    )

    // Absichtlich andere Projektwerte als das Objekt: 5 Wände / 30 % Füllung.
    // Nur wenn der Slice die Werte aus model_settings.config anwendet, kommen
    // 2 Wände / 13 % Füllung des „Upper lip“-Objekts heraus.
    const sliceSettings: Partial<PrintSettings> = {
      ...upload.settings,
      layerHeight: 0.28,
      firstLayerHeight: 0.28,
      walls: 5,
      topLayers: 5,
      bottomLayers: 5,
      infillDensity: 30,
      lineWidth: 0.42,
      outerWallLineWidth: 0.42,
      innerWallLineWidth: 0.45,
      topSurfaceLineWidth: 0.42,
      special: { ...(upload.settings.special ?? {}), vase: false },
      adhesion: 'none',
      primeLine: { enabled: false },
      output: { objectLabels: true, verbosePaths: true },
    }
    const sliced = await requestJson<SliceResponse>('/api/slice', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        modelId: upload.id,
        profileId: 'anycubic-vyper',
        plate: 1,
        settings: sliceSettings,
        filamentId: 'pla',
      }),
    })

    const lines = sliced.gcode.split(/\r?\n/)
    const typeCount = (type: string) => lines.filter((line) => line.trim() === `; TYPE: ${type}`).length
    const layerCount = sliced.layers.length
    const innerWalls = typeCount('inner-wall')
    const outerWalls = typeCount('outer-wall')
    const sparseInfill = typeCount('sparse')
    const perLayer: { layer: number; inner: number; outer: number; sparse: number }[] = []
    for (const line of lines) {
      const match = /^;LAYER:(\d+)/.exec(line.trim())
      if (match) perLayer.push({ layer: Number(match[1]), inner: 0, outer: 0, sparse: 0 })
      const kind = /^; TYPE: (inner-wall|outer-wall|sparse)$/.exec(line.trim())?.[1]
      const current = perLayer[perLayer.length - 1]
      if (!kind || !current) continue
      if (kind === 'inner-wall') current.inner++
      else if (kind === 'outer-wall') current.outer++
      else current.sparse++
    }
    assert.ok(layerCount > 20, `Zu wenige Schichten für den Slice: ${layerCount}`)
    assert.ok(outerWalls > 0, 'Außenwand fehlt im G-Code')
    const steadyLayers = perLayer.filter((entry) => entry.layer > 1)
    assert.ok(steadyLayers.length > 20, 'Zu wenige normale Schichten für die Wandprüfung')
    assert.ok(
      steadyLayers.every((entry) => entry.inner >= 1 && entry.inner <= 3),
      `Objektwert „2 Wände“ wurde nicht angewendet: ` +
        steadyLayers.map((entry) => `L${entry.layer}=${entry.inner}`).join(', ') +
        ' (mit den globalen 5 Wänden entstehen deutlich mehr Innenwände).',
    )
    // 13 % erzeugt auf dieser Geometrie rund 3.000 Füllbahnen; mit den globalen
    // 30 % sind es bei gleicher Wandzahl rund 7.000. Beides wird geprüft, damit
    // nicht nur die Wandzahl, sondern auch die Füllungsdichte aus dem Objekt kommt.
    assert.ok(
      sparseInfill > 0 && sparseInfill < 5_000,
      `Objektwert „13 % Füllung“ wurde nicht angewendet: ${sparseInfill} Füllbahnen.`,
    )
    // Die Wandzahl ist der belastbare Unterscheider: mit den globalen 5 Wänden
    // erzeugt dieselbe Geometrie über 1000 Innenwand-Bahnen statt 92.
    assert.ok(
      innerWalls < layerCount * 5,
      `Der Slice hat die globalen 5 Wände statt der Objektwerte verwendet: ${innerWalls} Innenwände.`,
    )

    console.log(
      `OK: echte Orca-3MF mit 2 Objekten/2 Platten; Objektliste zeigt 0 %/1 Wand und 13 %/2 Wände; ` +
        `Slice von Platte 2 trotz global 30 %/5 Wänden mit ${innerWalls} Innenwänden und ` +
        `${sparseInfill} Füllbahnen auf ${layerCount} Schichten.`,
    )
  } finally {
    await stopChild(child)
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})