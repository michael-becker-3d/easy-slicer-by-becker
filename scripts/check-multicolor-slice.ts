import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { demoSTL } from '../server/demo.ts'
import { PREVIEW_STRIDE, type PrintSettings } from '../shared/types.ts'

type ObjectInfo = { id: string; name: string; placement: { offsetX: number; offsetY: number } }
type UploadResponse = { id: string; objects: ObjectInfo[] }
type SliceLayer = { z: number; data: number[]; lines?: number[] }
type SliceResponse = {
  gcode: string
  layers: SliceLayer[]
  warnings: string[]
  stats: { layerCount: number; filamentMm: number; estimatedSeconds: number }
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

/**
 * Größter E-Sprung zwischen zwei Extrusionszeilen. Ohne `G92 E0` je Schicht
 * würde der E-Stand der vorigen Farbe als Sprung gelesen und die Düse massiv
 * überextrudieren — genau dieser Fehler soll hier auffallen.
 */
function maxExtrusionJump(gcode: string): number {
  let last = 0
  let max = 0
  for (const raw of gcode.split('\n')) {
    const line = raw.replace(/^N\d+\s+/, '').split(';')[0].trim()
    if (line.startsWith('G92')) {
      const match = /\bE(-?\d+(?:\.\d+)?)/.exec(line)
      if (match) last = Number(match[1])
      continue
    }
    if (!/^G[123]\b/.test(line)) continue
    const match = /\bE(-?\d+(?:\.\d+)?)/.exec(line)
    if (!match) continue
    const value = Number(match[1])
    const jump = value - last
    if (jump > max) max = jump
    last = value
  }
  return max
}

function count(gcode: string, pattern: RegExp): number {
  return [...gcode.matchAll(pattern)].length
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

    const upload = await requestJson<UploadResponse>('/api/models?name=farbe-a.stl&printerId=flashforge-ad5x', {
      method: 'POST',
      headers: { 'Content-Type': 'model/stl' },
      body: demoSTL('wuerfel'),
    })
    const a = upload.objects[0]
    assert.ok(a)
    const imported = await requestJson<{ objects: ObjectInfo[] }>(
      `/api/models/${upload.id}/objects/import?name=farbe-b.stl&printerId=flashforge-ad5x`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'model/stl' },
        body: demoSTL('wuerfel'),
      },
    )
    const b = imported.objects.find((object) => object.id !== a.id)
    assert.ok(b, 'Das zweite Objekt fehlt')

    const slots = [
      { id: 'slot-a', label: 'Rot', profileId: 'pla', color: '#ff0000' },
      { id: 'slot-b', label: 'Blau', profileId: 'pla', color: '#0000ff' },
    ]
    await requestJson(`/api/models/${upload.id}/objects`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        objects: [
          { id: a.id, visible: true, offsetX: -25, offsetY: 0, slotId: 'slot-a', filamentId: 'pla' },
          { id: b.id, visible: true, offsetX: 25, offsetY: 0, slotId: 'slot-b', filamentId: 'pla' },
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
      // Absichtlich eingeschaltet: Der Mehrfarbdruck muss ihn selbst sperren.
      sequentialPrint: { enabled: true, clearance: 5 },
      multiMaterial: {
        change: 'tool',
        changeGcode: 'M600',
        retract: 1,
        tower: { enabled: true, gap: 3 },
        zLift: 0.6,
        purge: { enabled: true, volume: 20, length: 0, speed: 40, side: 'back' },
      },
      output: { objectLabels: true, excludeObjects: true },
    }
    const sliceBody = {
      modelId: upload.id,
      profileId: 'flashforge-ad5x',
      plate: 0,
      settings,
      modelCenter: { x: 0, y: 0 },
      filamentId: 'pla',
      slots,
      activeSlotId: 'slot-a',
      filaments: { pla: { nozzle: 210, bed: 60, material: 'PLA', name: 'PLA' } },
    }
    const sliced = await requestJson<SliceResponse>('/api/slice', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(sliceBody),
    })

    const gcode = sliced.gcode
    const layers = sliced.layers.length
    assert.ok(layers > 20, `Zu wenige Schichten: ${layers}`)

    // 1) Sicherheit: Der sequenzielle Modus ist für Mehrfarbdruck gesperrt.
    assert.ok(
      sliced.warnings.some((warning) => warning.includes('schichtweise')),
      `Warnung zum schichtweisen Druck fehlt: ${sliced.warnings.join(' | ')}`,
    )
    assert.ok(
      sliced.warnings.some((warning) => warning.includes('abgeschaltet')),
      `Warnung zum abgeschalteten sequenziellen Modus fehlt: ${sliced.warnings.join(' | ')}`,
    )
    assert.equal(
      count(gcode, /^; ---- Objektwechsel ----$/gm),
      0,
      'Mehrfarbdruck darf nicht Objekt für Objekt drucken',
    )

    // 2) Jede Schicht genau einmal, jede Schicht mit E-Nullpunkt.
    const layerMarkers = count(gcode, /^;LAYER:\d+$/gm)
    assert.equal(layerMarkers, layers, `Schichtmarker ${layerMarkers} statt ${layers}`)
    // Je Farbe und Schicht ein eigener Nullpunkt: jeder eingesetzte Block
    // rechnet absolut für sich, sonst würde der E-Stand der anderen Farbe
    // als Sprung gelesen.
    const eReset = count(gcode, /^G92 E0 ; Extruder-Nullpunkt je Schicht$/gm)
    assert.ok(eReset >= layers, `E-Nullpunkt nur ${eReset}× bei ${layers} Schichten`)
    assert.ok(eReset <= layers * 2, `E-Nullpunkt ${eReset}× bei ${layers} Schichten ist zu oft`)

    // 3) Werkzeugwechsel je Schicht und zurück.
    const toolOne = count(gcode, /^T1 ; Werkzeugwechsel$/gm)
    const toolZero = count(gcode, /^T0 ; Werkzeugwechsel$/gm)
    assert.ok(toolOne >= layers - 1, `T1 nur ${toolOne}× bei ${layers} Schichten`)
    assert.ok(Math.abs(toolOne - toolZero) <= 1, `T0 ${toolZero}× / T1 ${toolOne}× passen nicht zusammen`)

    // 4) Purge-Turm je Farbe, mit Spülung und Z-Hub.
    const towerOne = count(gcode, /^; Purge-Turm Werkzeug 1$/gm)
    const towerTwo = count(gcode, /^; Purge-Turm Werkzeug 2$/gm)
    assert.equal(towerOne + towerTwo, toolOne + toolZero, 'Je Wechsel muss genau eine Turmschicht entstehen')
    assert.ok(towerOne > 0 && towerTwo > 0, 'Beide Farben brauchen einen eigenen Turm')
    assert.equal(
      count(gcode, /^G1 Z[\d.]+ F600 ; Z-Hub nach dem Spülen$/gm),
      towerOne + towerTwo,
      'Nach jedem Spülen muss die Düse angehoben werden',
    )

    // 5) Kein E-Sprung (sonst würde die zweite Farbe überextrudieren).
    const jump = maxExtrusionJump(gcode)
    assert.ok(jump < 50, `E-Sprung von ${jump.toFixed(1)} mm — E-Nullpunkt je Schicht prüfen`)

    // 6) Turm steht auf dem Bett und die beiden Türme sind getrennt.
    const bed = 220
    const towerMoves = [...gcode.matchAll(/^; Purge-Turm Werkzeug \d\nG0 Z[\d.]+ F600\nG0 X([\d.]+) Y([\d.]+)/gm)]
    assert.ok(towerMoves.length > 0, 'Turmposition nicht gefunden')
    for (const match of towerMoves) {
      const x = Number(match[1])
      const y = Number(match[2])
      assert.ok(x > 0 && x < bed && y > 0 && y < bed, `Turm außerhalb des Betts: ${x}/${y}`)
    }
    const firstX = new Set(towerMoves.slice(0, 2).map((match) => Number(match[1])))
    assert.equal(firstX.size, 2, 'Die beiden Türme müssen nebeneinander stehen')

    // 7) Objektmarker für ZMOD vor START_PRINT.
    const definitions = count(gcode, /^EXCLUDE_OBJECT_DEFINE NAME=/gm)
    assert.equal(definitions, 2, `Erwartet 2 Objektdefinitionen, gefunden ${definitions}`)
    const firstDefine = gcode.indexOf('EXCLUDE_OBJECT_DEFINE')
    const startPrint = gcode.indexOf('START_PRINT')
    const firstHome = gcode.search(/^G28\b/m)
    const head = gcode.split('\n').slice(0, 24).join(' | ')
    assert.ok(firstDefine >= 0, `Objektdefinition fehlt: ${head}`)
    if (startPrint >= 0) assert.ok(firstDefine < startPrint, `Definition steht nach START_PRINT: ${head}`)
    if (firstHome >= 0) assert.ok(firstDefine < firstHome, `Definition steht nach G28: ${head}`)

    // 8) Vorschau und Statistik enthalten beide Farben.
    const withData = sliced.layers.filter((layer) => layer.data.length > 0)
    assert.ok(withData.length > 20, `Vorschau hat nur ${withData.length} gefüllte Schichten`)
    assert.equal(sliced.stats.layerCount, layers)
    assert.ok(sliced.stats.filamentMm > 0, 'Filamentverbrauch fehlt')
    assert.ok(sliced.stats.estimatedSeconds > 0, 'Druckzeit fehlt')

    // 9) Zeilenkarte der Vorschau zeigt auf echte Bewegungen — auch wenn eine
    // Schicht aus zwei getrennten Farbblöcken zusammengesetzt ist.
    const gcodeLines = gcode.split('\n')
    let mapped = 0
    for (const [index, layer] of sliced.layers.entries()) {
      if (!layer.data.length) continue
      assert.ok(layer.lines, `Schicht ${index + 1} hat keine Zeilenkarte`)
      assert.equal(
        layer.lines.length,
        layer.data.length / PREVIEW_STRIDE,
        `Zeilenkarte in Schicht ${index + 1} passt nicht zu den Segmenten`,
      )
      for (const line of layer.lines) {
        const text = gcodeLines[line - 1] ?? ''
        assert.match(text, /^(?:N\d+\s+)?G[0-3]\b/, `Zeile ${line} ist keine Bewegung: ${text || '<fehlt>'}`)
      }
      mapped += layer.lines.length
    }
    assert.ok(mapped > 0, 'Keine Vorschau-Segmente kartiert')

    // 10) Sicherheit: keine negative Z-Koordinate, auch nicht mit einem
    // gespeicherten Bett-Mesh, das mehrere Millimeter daneben liegt.
    const zValues = [...gcode.matchAll(/^G[01] Z(-?\d+(?:\.\d+)?)/gm)].map((match) => Number(match[1]))
    assert.ok(zValues.length > 0, 'Keine Z-Bewegungen im G-Code')
    assert.ok(Math.min(...zValues) >= 0.1, `Z zu tief: ${Math.min(...zValues)} mm`)

    // Beleg für die Sichtprüfung: der echte G-Code des Zwei-Farben-Drucks.
    writeFileSync(resolve('.tmp/multicolor-2-farben.gcode'), gcode)

    console.log(
      `OK: Mehrfarbdruck je Schicht — ${layers} Schichten, ${toolOne}× T1 / ${toolZero}× T0, ` +
        `${towerOne + towerTwo} Turmschichten, max. E-Sprung ${jump.toFixed(2)} mm, ` +
        'sequenzieller Modus gesperrt, ZMOD-Definitionen vor START_PRINT.',
    )
  } finally {
    await stopChild(child)
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
