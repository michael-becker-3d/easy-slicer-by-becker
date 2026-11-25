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

    // 4) EIN Purge-Turm für alle Farben, je Farbe ein eigenes Band.
    const towerFills = count(gcode, /^; Purge-Turm Werkzeug \d+ · Band \d+$/gm)
    assert.equal(towerFills, toolOne + toolZero, 'Je Wechsel muss genau eine Turmschicht entstehen')
    const bandOne = count(gcode, /^; Purge-Turm Werkzeug 1 · Band 1$/gm)
    const bandTwo = count(gcode, /^; Purge-Turm Werkzeug 2 · Band 2$/gm)
    assert.ok(bandOne > 0 && bandTwo > 0, 'Jede Farbe spült in ihr eigenes Band')
    assert.equal(
      count(gcode, /^G1 Z[\d.]+ F600 ; Z-Hub nach dem Spülen$/gm),
      towerFills,
      'Nach jedem Spülen muss die Düse angehoben werden',
    )

    // 4b) Der Rückzug nach dem Spülen wird im nächsten Block übernommen.
    // Ohne das fehlt jeder Farbe am Blockanfang genau der Rückzugsweg.
    assert.equal(
      count(gcode, /^G1 E-[\d.]+ F1800 ; Rückzug nach dem Spülen übernehmen$/gm),
      towerFills,
      'Nach jedem Farbwechsel muss der Rückzug übernommen werden',
    )

    // 5) Kein E-Sprung (sonst würde die zweite Farbe überextrudieren).
    const jump = maxExtrusionJump(gcode)
    assert.ok(jump < 50, `E-Sprung von ${jump.toFixed(1)} mm — E-Nullpunkt je Schicht prüfen`)

    // 6) Ein Turm auf dem Bett, die Farbbänder liegen übereinander.
    const bed = 220
    const towerMoves = [
      ...gcode.matchAll(/^; Purge-Turm Werkzeug \d+ · Band \d+\nG0 Z[\d.]+ F600\nG0 X([\d.]+) Y([\d.]+)/gm),
    ]
    assert.ok(towerMoves.length > 0, 'Turmposition nicht gefunden')
    for (const match of towerMoves) {
      const x = Number(match[1])
      const y = Number(match[2])
      assert.ok(x > 0 && x < bed && y > 0 && y < bed, `Turm außerhalb des Betts: ${x}/${y}`)
    }
    const towerX = new Set(towerMoves.map((match) => Number(match[1])))
    assert.equal(towerX.size, 1, 'Alle Farben müssen im selben Turm spülen (gleiche linke Kante)')
    const towerY = new Set(towerMoves.map((match) => Number(match[2])))
    assert.equal(towerY.size, 2, 'Zwei Farben = zwei Bänder im Turm')
    const bandSpread = Math.max(...towerY) - Math.min(...towerY)
    assert.ok(bandSpread > 2 && bandSpread < 20, `Bänder liegen nicht sauber übereinander: ${bandSpread} mm`)

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

    // ---- Vier Farben: ein Turm mit vier Bändern, echte Wechsel T0…T3 ----
    const fourObjects: ObjectInfo[] = [a, b]
    while (fourObjects.length < 4) {
      const more = await requestJson<{ objects: ObjectInfo[] }>(
        `/api/models/${upload.id}/objects/import?name=farbe-${fourObjects.length + 1}.stl&printerId=flashforge-ad5x`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'model/stl' },
          body: demoSTL('wuerfel'),
        },
      )
      const added = more.objects.find((object) => !fourObjects.some((known) => known.id === object.id))
      assert.ok(added, 'Das zusätzliche Objekt fehlt')
      fourObjects.push(added)
    }
    const fourSlots = [
      { id: 'slot-a', label: 'Rot', profileId: 'pla', color: '#ff0000' },
      { id: 'slot-b', label: 'Blau', profileId: 'pla', color: '#0000ff' },
      { id: 'slot-c', label: 'Gelb', profileId: 'pla', color: '#ffff00' },
      { id: 'slot-d', label: 'Grün', profileId: 'pla', color: '#00ff00' },
    ]
    const fourPositions = [
      { x: -30, y: -30 },
      { x: 30, y: -30 },
      { x: -30, y: 30 },
      { x: 30, y: 30 },
    ]
    await requestJson(`/api/models/${upload.id}/objects`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        objects: fourObjects.map((object, index) => ({
          id: object.id,
          visible: true,
          offsetX: fourPositions[index].x,
          offsetY: fourPositions[index].y,
          slotId: fourSlots[index].id,
          filamentId: 'pla',
        })),
      }),
    })
    const fourSliced = await requestJson<SliceResponse>('/api/slice', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ ...sliceBody, slots: fourSlots, activeSlotId: 'slot-a' }),
    })
    const four = fourSliced.gcode
    const fourLayers = fourSliced.layers.length
    assert.ok(fourLayers > 20, `Vierfarbdruck hat nur ${fourLayers} Schichten`)
    assert.equal(count(four, /^;LAYER:\d+$/gm), fourLayers, 'Vierfarbdruck: ein Schichtmarker je Schicht')
    assert.equal(
      count(four, /^; ---- Objektwechsel ----$/gm),
      0,
      'Auch vier Farben dürfen nicht Objekt für Objekt drucken',
    )
    const fourFills = count(four, /^; Purge-Turm Werkzeug \d+ · Band \d+$/gm)
    assert.ok(fourFills > 0, 'Vierfarbdruck ohne Turmspülung')
    const fourBands = new Set([...four.matchAll(/^; Purge-Turm Werkzeug \d+ · Band (\d+)$/gm)].map((m) => m[1]))
    assert.equal(fourBands.size, 4, `Vierfarbdruck: ${fourBands.size} Bänder statt 4`)
    const fourMoves = [
      ...four.matchAll(/^; Purge-Turm Werkzeug \d+ · Band \d+\nG0 Z[\d.]+ F600\nG0 X([\d.]+) Y([\d.]+)/gm),
    ]
    assert.equal(new Set(fourMoves.map((m) => Number(m[1]))).size, 1, 'Vier Farben müssen einen Turm teilen')
    assert.equal(new Set(fourMoves.map((m) => Number(m[2]))).size, 4, 'Vier Farben brauchen vier Bänder')
    for (const match of fourMoves) {
      assert.ok(
        Number(match[1]) > 0 && Number(match[1]) < 220 && Number(match[2]) > 0 && Number(match[2]) < 220,
        `Vierfarbdruck: Turm außerhalb des Betts (${match[1]}/${match[2]})`,
      )
    }
    const fourTools = [0, 1, 2, 3].map((tool) => count(four, new RegExp(`^T${tool} ; Werkzeugwechsel$`, 'gm')))
    assert.ok(fourTools.every((value) => value > 0), `Nicht alle Werkzeuge wurden gewechselt: ${fourTools.join('/')}`)
    assert.ok(
      Math.abs(Math.max(...fourTools) - Math.min(...fourTools)) <= 1,
      `Werkzeugwechsel ungleich verteilt: ${fourTools.join('/')}`,
    )
    assert.equal(count(four, /^EXCLUDE_OBJECT_DEFINE NAME=/gm), 4, 'Vierfarbdruck: vier Objektdefinitionen')
    const fourJump = maxExtrusionJump(four)
    assert.ok(fourJump < 50, `Vierfarbdruck: E-Sprung von ${fourJump.toFixed(1)} mm`)
    const fourZ = [...four.matchAll(/^G[01] Z(-?\d+(?:\.\d+)?)/gm)].map((match) => Number(match[1]))
    assert.ok(Math.min(...fourZ) >= 0.1, `Vierfarbdruck: Z zu tief (${Math.min(...fourZ)} mm)`)
    writeFileSync(resolve('.tmp/multicolor-4-farben.gcode'), four)

    // Beleg für die Sichtprüfung: der echte G-Code des Zwei-Farben-Drucks.
    writeFileSync(resolve('.tmp/multicolor-2-farben.gcode'), gcode)

    console.log(
      `OK: Mehrfarbdruck je Schicht — ${layers} Schichten, ${toolOne}× T1 / ${toolZero}× T0, ` +
        `${towerFills} Turmschichten in einem Turm, max. E-Sprung ${jump.toFixed(2)} mm, ` +
        `4 Farben: ${fourLayers} Schichten mit ${fourBands.size} Bändern und T0…T3, ` +
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
