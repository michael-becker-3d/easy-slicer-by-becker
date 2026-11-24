import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { demoSTL } from '../server/demo.ts'
import { planSequentialOrder, type SequentialObjectBox } from '../shared/sequential.ts'
import type { PrintSettings } from '../shared/types.ts'

type ObjectInfo = { id: string; name: string; placement: { offsetX: number; offsetY: number } }
type UploadResponse = { id: string; objects: ObjectInfo[] }
type SliceResponse = { gcode: string; layers: unknown[]; warnings: string[] }

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const delay = (ms: number) => new Promise<void>((resolveDelay) => setTimeout(resolveDelay, ms))

const box = (id: string, name: string, minX: number, minY: number, maxX: number, maxY: number, maxZ: number): SequentialObjectBox => ({
  id,
  name,
  minX,
  minY,
  maxX,
  maxY,
  maxZ,
})

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
    if (child.exitCode !== null) throw new Error(`Testserver wurde mit Code ${child.exitCode} beendet.\n${logs()}`)
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
  // Reine Planung: niedrige Objekte zuerst, bei Gleichstand Y vor X.
  const layout = [
    box('tall', 'Hoch', 0, 0, 10, 10, 30),
    box('short', 'Niedrig', 20, 0, 30, 10, 10),
    box('short2', 'Niedrig 2', 0, 20, 10, 30, 10),
  ]
  const planned = planSequentialOrder(layout, 5)
  assert.deepEqual(planned.order, [1, 2, 0], 'Reihenfolge muss nach Höhe, dann Y/X sortieren')
  assert.equal(planned.violations.length, 0)

  const tooClose = planSequentialOrder([layout[0], box('near', 'Nah', 12, 0, 22, 10, 10)], 5)
  assert.equal(tooClose.violations.length, 1, '2 mm Abstand muss bei 5 mm Mindestabstand auffallen')
  assert.equal(tooClose.violations[0]?.gap, 2)
  assert.equal(planSequentialOrder([layout[0], box('near', 'Nah', 12, 0, 22, 10, 10)], 0).violations.length, 0)

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

    const upload = await requestJson<UploadResponse>('/api/models?name=sequenz-a.stl&printerId=anycubic-vyper', {
      method: 'POST',
      headers: { 'Content-Type': 'model/stl' },
      body: demoSTL('wuerfel'),
    })
    const a = upload.objects[0]
    assert.ok(a)
    const imported = await requestJson<{ objects: ObjectInfo[] }>(
      `/api/models/${upload.id}/objects/import?name=sequenz-b.stl&printerId=anycubic-vyper`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'model/stl' },
        body: demoSTL('wuerfel'),
      },
    )
    const b = imported.objects.find((object) => object.id !== a.id)
    assert.ok(b, 'Das zweite Objekt fehlt')

    // Beide Objekte auf feste, ausreichend getrennte Positionen legen. Der
    // Modellanker bleibt bei 0/0; die tatsächliche Bettmitte kommt aus dem Profil.
    await requestJson(`/api/models/${upload.id}/objects`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        objects: [
          { id: a.id, visible: true, offsetX: -25, offsetY: 0 },
          { id: b.id, visible: true, offsetX: 25, offsetY: 0 },
        ],
      }),
    })

    const settings: Partial<PrintSettings> = {
      layerHeight: 0.2,
      firstLayerHeight: 0.2,
      walls: 1,
      topLayers: 1,
      bottomLayers: 1,
      infillDensity: 0,
      adhesion: 'none',
      primeLine: { enabled: false },
      sequentialPrint: { enabled: true, clearance: 5 },
      output: { objectLabels: true, excludeObjects: false },
    }
    const sliceBody = {
      modelId: upload.id,
      profileId: 'anycubic-vyper',
      plate: 0,
      settings,
      modelCenter: { x: 0, y: 0 },
      filamentId: 'pla',
    }
    const sliced = await requestJson<SliceResponse>('/api/slice', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(sliceBody),
    })

    assert.ok(
      sliced.warnings.some((warning) => warning.includes('Sequenzieller Druck')),
      `Warnung zum sequenziellen Druck fehlt: ${sliced.warnings.join(' | ')}`,
    )
    assert.ok(sliced.gcode.includes('; ---- Objektwechsel ----'), 'Objektwechsel fehlt im G-Code')
    assert.ok(!sliced.gcode.includes('M600'), 'Bei gleichem Filament darf kein M600 entstehen')
    const labels = [...sliced.gcode.matchAll(/^; OBJECT_START: (.+)$/gm)].map((match) => match[1].trim())
    assert.equal(labels.length, 2, `Es müssen zwei Objektblöcke entstehen: ${labels.join(', ')}`)
    assert.equal(labels[0], a.name)
    assert.equal(labels[1], b.name)
    assert.ok(sliced.layers.length > 100, 'Beide Objekte müssen Schichten im Ergebnis haben')

    // Bei zu kleinem Abstand muss der Slice vor dem Schreiben des G-Codes abbrechen.
    await requestJson(`/api/models/${upload.id}/objects`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ objects: [{ id: b.id, visible: true, offsetX: -5, offsetY: 0 }] }),
    })
    const blocked = await fetch(`${base}/api/slice`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(sliceBody),
    })
    const errorText = await blocked.text()
    assert.equal(blocked.status, 400, `Zu kleiner Abstand muss 400 liefern: ${blocked.status} ${errorText}`)
    assert.ok(errorText.includes('Mindestabstand'), `Fehlermeldung nennt den Mindestabstand nicht: ${errorText}`)

    console.log(
      'OK: Sequenzieller Druck; Höhen-/Y-/X-Sortierung, 2 Objektblöcke, kein M600 bei gleichem Filament, ' +
        'Abstandsprüfung mit 400 bei 0 mm statt 5 mm.',
    )
  } finally {
    await stopChild(child)
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})