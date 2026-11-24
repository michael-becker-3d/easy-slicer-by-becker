import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { demoSTL } from '../server/demo.ts'
import { PREVIEW_KIND_CODE } from '../shared/preview.ts'
import { PREVIEW_STRIDE, type PreviewLayer, type PrintSettings } from '../shared/types.ts'

type UploadResponse = {
  id: string
  objects: { id: string }[]
}
type SliceResponse = {
  layers: PreviewLayer[]
  warnings: string[]
}

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

/** Mitte aller Extrusionsbahnen der ersten Schicht in Bettkoordinaten. */
function firstLayerCenter(layer: PreviewLayer): { x: number; y: number } {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i + PREVIEW_STRIDE <= layer.data.length; i += PREVIEW_STRIDE) {
    if (layer.data[i] === PREVIEW_KIND_CODE.travel) continue
    minX = Math.min(minX, layer.data[i + 1], layer.data[i + 3])
    maxX = Math.max(maxX, layer.data[i + 1], layer.data[i + 3])
    minY = Math.min(minY, layer.data[i + 2], layer.data[i + 4])
    maxY = Math.max(maxY, layer.data[i + 2], layer.data[i + 4])
  }
  assert.ok(Number.isFinite(minX), 'Erste Schicht enthält keine Extrusion')
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
}

function near(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) <= 0.6, `Erwartet ${expected}, erhalten ${actual}`)
}

async function main(): Promise<void> {
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

    const upload = await requestJson<UploadResponse>('/api/models?name=platzierung.stl&printerId=anycubic-vyper', {
      method: 'POST',
      headers: { 'Content-Type': 'model/stl' },
      body: demoSTL('wuerfel'),
    })
    assert.equal(upload.objects.length, 1)
    const objectId = upload.objects[0]?.id
    assert.ok(objectId)

    const settings: Partial<PrintSettings> = {
      layerHeight: 0.2,
      firstLayerHeight: 0.2,
      walls: 1,
      topLayers: 1,
      bottomLayers: 1,
      infillDensity: 10,
      adhesion: 'none',
      primeLine: { enabled: false },
      output: { objectLabels: false, excludeObjects: false },
    }
    const slice = () =>
      requestJson<SliceResponse>('/api/slice', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          modelId: upload.id,
          profileId: 'anycubic-vyper',
          plate: 0,
          settings,
          // Genau dieser Anker wird von der Oberfläche mitgeschickt. Er bleibt
          // beim Verschieben fest, damit die gewählte Bettposition erhalten bleibt.
          modelCenter: { x: 0, y: 0 },
        }),
      })

    // Standardlage: 20-mm-Würfel mittig auf dem 245 × 245 mm Vyper-Bett.
    const centered = await slice()
    const centeredAt = firstLayerCenter(centered.layers[0])
    near(centeredAt.x, 122.5)
    near(centeredAt.y, 122.5)

    // Absichtlich nach rechts und nach vorn verschieben.
    await requestJson(`/api/models/${upload.id}/objects`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        objects: [{ id: objectId, offsetX: 25, offsetY: -15 }],
      }),
    })
    const moved = await slice()
    const movedAt = firstLayerCenter(moved.layers[0])
    near(movedAt.x, 147.5)
    near(movedAt.y, 107.5)

    console.log(
      `OK: Einzelobjekt bleibt an der gewählten Bettposition (Mitte ${centeredAt.x.toFixed(1)}/` +
        `${centeredAt.y.toFixed(1)} mm, verschoben ${movedAt.x.toFixed(1)}/${movedAt.y.toFixed(1)} mm).`,
    )
  } finally {
    await stopChild(child)
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
