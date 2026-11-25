import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import type { PreviewLayer, SliceResult } from '../shared/types.ts'
import { PREVIEW_STRIDE } from '../shared/types.ts'
import { demoSTL } from '../server/demo.ts'
import { describePreviewSegment } from '../src/viewer/previewDiagnostics.ts'

type ObjectInfo = { id: string; name: string }
type ObjectsResponse = { objects: ObjectInfo[] }
type UploadResponse = ObjectsResponse & { id: string }
type SliceResponse = SliceResult

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const delay = (ms: number) => new Promise<void>((resolveDelay) => setTimeout(resolveDelay, ms))

function coordinate(line: string, axis: 'X' | 'Y'): number | null {
  const match = new RegExp(`(?:^|\\s)${axis}(-?\\d+(?:\\.\\d+)?)`).exec(line)
  return match ? Number(match[1]) : null
}

function samePoint(actual: number | null, expected: number): boolean {
  return actual !== null && Math.abs(actual - expected) <= 0.05
}

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
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  let serverLogs = ''
  const child = spawn(
    process.execPath,
    [resolve('node_modules/tsx/dist/cli.mjs'), 'server/index.ts'],
    {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(port), KEPLER_NO_BROWSER: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  child.stdout?.on('data', (chunk: Buffer) => {
    serverLogs = (serverLogs + chunk.toString()).slice(-12_000)
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    serverLogs = (serverLogs + chunk.toString()).slice(-12_000)
  })

  const postDir = await mkdtemp(join(tmpdir(), 'easy-slicer-lines-'))
  try {
    await waitForHealth(base, child, () => serverLogs)

    const requestJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(`${base}${path}`, init)
      const text = await response.text()
      assert.ok(response.ok, `${path} antwortet ${response.status}: ${text}`)
      return JSON.parse(text) as T
    }

    const upload = await requestJson<UploadResponse>('/api/models?name=zeilenkarte.stl', {
      method: 'POST',
      headers: { 'Content-Type': 'model/stl' },
      body: demoSTL('wuerfel'),
    })
    assert.equal(upload.objects.length, 1)
    const firstId = upload.objects[0]?.id
    assert.ok(firstId)

    const duplicated = await requestJson<ObjectsResponse>(`/api/models/${upload.id}/tools`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ tool: 'duplicate', objectId: firstId }),
    })
    assert.equal(duplicated.objects.length, 2)
    const first = duplicated.objects[0]
    const second = duplicated.objects[1]
    assert.ok(first && second)
    assert.notEqual(first.id, second.id)

    // Zwei Objekte nacheinander drucken (einfarbig): Nur so entstehen zwei
    // getrennte Objektlabel-Blöcke mit eigener Zeilenkarte. Mehrfarbdruck
    // wird immer schichtweise gedruckt und hat keine Objektblöcke mehr.
    await requestJson<ObjectsResponse>(`/api/models/${upload.id}/objects`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        objects: [
          { id: first.id, filamentId: 'pla' },
          { id: second.id, filamentId: 'pla' },
        ],
      }),
    })

    const sliceBody = {
      modelId: upload.id,
      profileId: 'anycubic-vyper',
      settings: {
        layerHeight: 0.2,
        firstLayerHeight: 0.2,
        walls: 1,
        topLayers: 1,
        bottomLayers: 1,
        infillDensity: 10,
        adhesion: 'none',
        primeLine: { enabled: false },
        sequentialPrint: { enabled: true, clearance: 5 },
        output: { objectLabels: true, excludeObjects: false },
      },
      filaments: {
        pla: { nozzle: 215, bed: 60 },
        petg: { nozzle: 240, bed: 80 },
      },
    }
    const sliced = await requestJson<SliceResponse>('/api/slice', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(sliceBody),
    })
    assert.ok(sliced.layers.length > 0, 'Slice muss Vorschau-Schichten liefern')
    assert.ok(sliced.gcode.includes('; OBJECT_START:'), 'Objektlabels fehlen im G-Code')

    const gcodeLines = sliced.gcode.split('\n')
    const starts = gcodeLines
      .map((line, index) => (line.startsWith('; OBJECT_START:') ? index + 1 : 0))
      .filter(Boolean)
    const ends = gcodeLines
      .map((line, index) => (line.startsWith('; OBJECT_END:') ? index + 1 : 0))
      .filter(Boolean)
    assert.equal(starts.length, 2, `Erwartet zwei Objektlabel-Starts, gefunden: ${starts.join(', ')}`)
    assert.equal(ends.length, 2, `Erwartet zwei Objektlabel-Enden, gefunden: ${ends.join(', ')}`)
    assert.ok(starts[0] < ends[0] && starts[1] < ends[1], 'Objektlabel-Blöcke sind nicht geschlossen')
    const labelNames = gcodeLines
      .filter((line) => line.startsWith('; OBJECT_START:'))
      .map((line) => line.slice('; OBJECT_START:'.length).trim())
    assert.equal(new Set(labelNames).size, 2, `Objektlabel-Namen sind nicht eindeutig: ${labelNames.join(', ')}`)

    const blockOf = (line: number): number => {
      if (line > starts[0] && line < ends[0]) return 0
      if (line > starts[1] && line < ends[1]) return 1
      return -1
    }
    const blockLayerCounts = [0, 0]
    let mappedSegments = 0

    for (const [layerIndex, layer] of sliced.layers.entries()) {
      const mapped = layer.lines
      assert.ok(mapped, `Schicht ${layerIndex + 1} hat keine G-Code-Zeilenkarte`)
      assert.equal(
        mapped.length,
        layer.data.length / PREVIEW_STRIDE,
        `Zeilenkarte in Schicht ${layerIndex + 1} passt nicht zu den Segmenten`,
      )
      const blocks = new Set<number>()
      for (const [segmentIndex, line] of mapped.entries()) {
        assert.ok(Number.isInteger(line) && line > 0, `Ungültige G-Code-Zeile: ${line}`)
        const lineText = gcodeLines[line - 1] ?? ''
        assert.match(
          lineText,
          /^(?:N\d+\s+)?G[01]\b/,
          `Zeile ${line} ist keine Bewegung: ${lineText || '<fehlt>'}`,
        )
        const offset = segmentIndex * PREVIEW_STRIDE
        const x = coordinate(lineText, 'X')
        const y = coordinate(lineText, 'Y')
        const startMatches =
          samePoint(x, layer.data[offset + 1]) && samePoint(y, layer.data[offset + 2])
        const endMatches =
          samePoint(x, layer.data[offset + 3]) && samePoint(y, layer.data[offset + 4])
        assert.ok(
          startMatches || endMatches,
          `Zeile ${line} passt nicht zum Segment ${segmentIndex} in Schicht ${layerIndex + 1}: ` +
            `${lineText.trim()} vs. ${layer.data[offset + 1]},${layer.data[offset + 2]} → ` +
            `${layer.data[offset + 3]},${layer.data[offset + 4]}`,
        )
        const block = blockOf(line)
        assert.notEqual(
          block,
          -1,
          `Zeile ${line} liegt außerhalb der beiden Objektlabel-Blöcke (${starts[0]}-${ends[0]}, ${starts[1]}-${ends[1]})`,
        )
        blocks.add(block)
        mappedSegments++
      }
      assert.equal(blocks.size, 1, `Schicht ${layerIndex + 1} mischt G-Code-Zeilen aus mehreren Objekten`)
      blockLayerCounts[[...blocks][0]]++
    }

    assert.ok(mappedSegments > 0, 'Es wurden keine Segmente kartiert')
    assert.ok(blockLayerCounts[0] > 0, 'Das erste Objekt hat keine kartierten Schichten')
    assert.ok(blockLayerCounts[1] > 0, 'Das zweite Objekt hat keine kartierten Schichten')
    const firstMapped = describePreviewSegment(sliced.layers, 0, 0, 10)
    assert.equal(firstMapped?.gcodeLine, sliced.layers[0]?.lines?.[0])

    const postScript = join(postDir, 'zeilenverschiebung.mjs')
    await writeFile(
      postScript,
      [
        "import { readFileSync, writeFileSync } from 'node:fs'",
        'const file = process.argv[2]',
        "const text = readFileSync(file, 'utf8')",
        "writeFileSync(file, '; POSTPROCESSED\\n' + text)",
      ].join('\n'),
      'utf8',
    )

    const postProcessed = await requestJson<SliceResponse>('/api/slice', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ...sliceBody,
        postProcessing: {
          enabled: true,
          path: process.execPath,
          // Windows-Pfade mit Backslashes werden von splitArgs innerhalb von
          // Anführungszeichen als Escape-Zeichen gelesen; Forward-Slashes sind
          // für Node auch unter Windows gültig und halten den Test portabel.
          args: `"${postScript.replaceAll('\\', '/')}" "{gcode}"`,
          workingDirectory: postDir,
          timeoutSeconds: 20,
          required: true,
        },
      }),
    })

    assert.ok(postProcessed.gcode.startsWith('; POSTPROCESSED'), 'Post-Processing wurde nicht angewendet')
    assert.ok(postProcessed.layers.length > 0, 'Post-Processing darf die Vorschau nicht leeren')
    // Ausgeführt wird der konfigurierte Node-Interpreter; das eigentliche
    // Zeilenverschiebe-Skript steht in dessen Argumenten.
    assert.equal(postProcessed.postProcess?.script, basename(process.execPath))
    assert.ok(
      postProcessed.warnings.some((warning) => warning.includes('Post-Processing wurde ausgeführt')),
      'Post-Processing-Warnung fehlt',
    )
    assert.ok(
      postProcessed.layers.every((layer: PreviewLayer) => !Object.hasOwn(layer, 'lines')),
      'Nach dem Post-Processing darf keine alte Zeilenkarte stehen bleiben',
    )

    console.log(
      `OK: ${sliced.layers.length} Vorschau-Schichten, ${mappedSegments} kartierte Segmente, ` +
        `Objektlabel-Blöcke ${starts[0]}-${ends[0]} und ${starts[1]}-${ends[1]}; ` +
        'Post-Processing verwirft die Zeilenkarte.',
    )
  } finally {
    await stopChild(child)
    await rm(postDir, { recursive: true, force: true })
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
