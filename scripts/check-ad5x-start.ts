import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { KlipperClient, colorStartCommand, toolsUsedInGcode } from '../server/printer/klipper.ts'
import { PrinterManager } from '../server/printer/manager.ts'

// Der Wechsel holt seinen Slot aus mod_data/file.json; nur PRINT_ZCOLOR schreibt
// die Zuordnung. Werkzeug n gehört zu Slot n+1, weil der Slicer den Slot-Index
// als Werkzeugnummer ausgibt.
const sample = [
  '; T0 ist nur ein Kommentar',
  'M104 S215 T0 ; Parameter, kein Werkzeugwechsel',
  '_A_CHANGE_FILAMENT CHANNEL=0',
  'T2',
].join('\n')
assert.deepEqual(toolsUsedInGcode(sample), [0, 2], 'Werkzeuge aus Wechselbefehlen und T-Codes')
assert.deepEqual(
  toolsUsedInGcode(['; T0', 'M104 S215 T1'].join('\n')),
  [],
  'Kommentare und Parameter zählen nicht',
)
assert.equal(colorStartCommand('teil.gcode', []), null, 'ohne Wechsel kein PRINT_ZCOLOR')
assert.equal(
  colorStartCommand('teil.gcode', [3, 1, 1]),
  'PRINT_ZCOLOR FILENAME="teil.gcode" PLATE=1 ALLOWED_TOOL_COUNT=2 T1=2 T3=4',
  'doppelte Werkzeuge fallen weg, Lücken bleiben',
)

const seen: string[] = []
const printStarts: string[] = []
let printState = 'printing'
let reportedFile = 'ui-test.gcode'
// Firmware-Antworten des Fake-Moonrakers: Z-Mod-Objekte, -Makros und -Info.
let zmod = true
let firmwareReachable = true
const server = createServer((req, res) => {
  seen.push(`${req.method} ${req.url}`)
  res.setHeader('Content-Type', 'application/json')
  const url = req.url ?? ''
  if (url.startsWith('/printer/info')) {
    res.end(JSON.stringify({ result: { klippy_state: 'ready' } }))
    return
  }
  if (!firmwareReachable && /^\/(printer\/objects\/list|printer\/gcode\/help|server\/info)/.test(url)) {
    res.statusCode = 404
    res.end(JSON.stringify({ error: { message: 'unbekannter Endpunkt' } }))
    return
  }
  if (url.startsWith('/printer/objects/list')) {
    res.end(JSON.stringify({ result: { objects: zmod ? ['zmod_color', 'extruder'] : ['extruder'] } }))
    return
  }
  if (url.startsWith('/printer/gcode/help')) {
    res.end(
      JSON.stringify({
        result: zmod ? { SDCARD_PRINT_FILE: 'start', PRINT_ZCOLOR: 'color' } : { PRINT_START: 'start' },
      }),
    )
    return
  }
  if (url.startsWith('/server/info')) {
    res.end(
      JSON.stringify({ result: zmod ? { zmod: { features: ['print_start_tools'] } } : { klippy_connected: true } }),
    )
    return
  }
  if (url.startsWith('/printer/print/start')) {
    printStarts.push(url)
    res.end(JSON.stringify({ result: 'ok' }))
    return
  }
  if (req.method === 'POST' && url.startsWith('/server/files/upload')) {
    res.end(JSON.stringify({ result: 'ok' }))
    return
  }
  if (url.includes('/printer/objects/query')) {
    res.end(JSON.stringify({ result: { status: { print_stats: { state: printState, filename: reportedFile } } } }))
    return
  }
  res.end(JSON.stringify({ result: 'ok' }))
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert.ok(address && typeof address === 'object')
const base = `http://127.0.0.1:${address.port}`

try {
  const manager = new PrinterManager('flashforge-ad5x')
  ;(manager as unknown as { klipper: KlipperClient }).klipper = new KlipperClient(base)
  await manager.print('; test\nG28\n', 'ui-test.gcode')

  assert.ok(
    seen.some((request) => request.startsWith('POST /server/files/upload?print=false')),
    `Upload ohne Auto-Start fehlt: ${seen.join(' | ')}`,
  )
  assert.ok(
    seen.some((request) => request.includes('/printer/gcode/script?script=')),
    `SDCARD_PRINT_FILE-Aufruf fehlt: ${seen.join(' | ')}`,
  )
  const scriptRequest = seen.find((request) => request.includes('/printer/gcode/script?script=')) ?? ''
  const script = decodeURIComponent(scriptRequest.split('script=')[1] ?? '')
  assert.match(script, /SDCARD_PRINT_FILE FILENAME=ui-test\.gcode/)

  // Eine Datei mit Werkzeugwechseln startet über PRINT_ZCOLOR: nur dieses Makro
  // schreibt die Werkzeug-Slot-Zuordnung, sonst bricht der erste Wechsel ab.
  reportedFile = 'farbig.gcode'
  const colorManager = new PrinterManager('flashforge-ad5x')
  ;(colorManager as unknown as { klipper: KlipperClient }).klipper = new KlipperClient(base)
  await colorManager.print(
    ['; zwei Farben', '_A_CHANGE_FILAMENT CHANNEL=0', '_A_CHANGE_FILAMENT CHANNEL=1', ''].join('\n'),
    'farbig.gcode',
  )
  const colorRequest = seen.filter((request) => request.includes('/printer/gcode/script?script=')).pop() ?? ''
  assert.equal(
    decodeURIComponent(colorRequest.split('script=')[1] ?? ''),
    'PRINT_ZCOLOR FILENAME="farbig.gcode" PLATE=1 ALLOWED_TOOL_COUNT=2 T0=1 T1=2',
    'PRINT_ZCOLOR mit Werkzeugzuordnung fehlt',
  )
  reportedFile = 'ui-test.gcode'

  // Ein zweiter Start darf nicht am bereits laufenden Druck vorbeigehen.
  await assert.rejects(manager.print('; second\n', 'second.gcode'), /bereits ein Druck/)

  // Das Makro darf HTTP-Erfolg melden, ohne dass der Druck läuft. Der Start
  // gilt erst als erfolgreich, wenn print_stats den Dateinamen bestätigt.
  printState = 'standby'
  reportedFile = ''
  const client = new KlipperClient(base)
  await assert.rejects(
    client.startFileViaMacro('ui-test.gcode', { timeoutMs: 1000, pollMs: 100 }),
    /AD5X-Start nicht bestätigt/,
  )
  await assert.rejects(
    client.startFileViaMacro('../bad name.gcode'),
    /Ungültiger Dateiname/,
  )
  await assert.rejects(
    client.startFileViaColorMacro('../bad name.gcode', [0]),
    /Ungültiger Dateiname/,
  )
  // --- Firmware-Art erkennen ---
  const detectClient = new KlipperClient(base)
  zmod = true
  const zmodReport = await detectClient.detectFirmware()
  assert.equal(zmodReport?.kind, 'zmod', 'Z-Mod wird an Objekten und Makros erkannt')
  assert.deepEqual(zmodReport?.features, ['print_start_tools'], 'Z-Mod-Funktionen aus der Moonraker-Info')
  assert.ok((zmodReport?.evidence.length ?? 0) >= 2, 'Belege werden mitgeliefert')

  zmod = false
  const plainReport = await detectClient.detectFirmware()
  assert.equal(plainReport?.kind, 'original', 'Antwort ohne Z-Mod-Merkmale gilt als Original-Firmware')

  firmwareReachable = false
  assert.equal(await detectClient.detectFirmware(), null, 'ohne Antwort keine Erkennung, kein Fehlschluss')
  firmwareReachable = true
  zmod = true

  // Original-Firmware startet über Moonrakers print/start, nicht über ein Makro.
  printState = 'printing'
  reportedFile = 'original.gcode'
  const originalManager = new PrinterManager('flashforge-ad5x')
  ;(originalManager as unknown as { klipper: KlipperClient }).klipper = new KlipperClient(base)
  originalManager.setFirmwareMode('original')
  await originalManager.print('; test\nG28\n', 'original.gcode')
  assert.ok(
    printStarts.some((request) => request.includes('filename=original.gcode')),
    `print/start fehlt: ${printStarts.join(' | ')}`,
  )
  const macroForOriginal = seen
    .filter((request) => request.includes('/printer/gcode/script?script='))
    .map((request) => decodeURIComponent(request.split('script=')[1] ?? ''))
  assert.ok(
    !macroForOriginal.some((script) => /SDCARD_PRINT_FILE|PRINT_ZCOLOR/.test(script) && script.includes('original')),
    'Original-Firmware darf kein Z-Mod-Makro bekommen',
  )

  // Erkennung schlägt die Profilannahme: derselbe flashforge-ad5x meldet hier
  // keine Z-Mod-Merkmale und wird deshalb über print/start gestartet.
  zmod = false
  const detectedManager = new PrinterManager('flashforge-ad5x')
  await detectedManager.connect({ mode: 'klipper', url: base, profileId: 'flashforge-ad5x' })
  assert.equal(detectedManager.status.firmwareKind, 'original', 'erkannte Original-Firmware im Status')
  assert.equal(detectedManager.status.firmwareSource, 'detected', 'Herkunft der Erkennung')
  reportedFile = 'erkannt.gcode'
  await detectedManager.print('; test\n', 'erkannt.gcode')
  assert.ok(
    printStarts.some((request) => request.includes('filename=erkannt.gcode')),
    'erkannte Original-Firmware startet über print/start',
  )
  await detectedManager.disconnect()

  // Manuelle Wahl schlägt die Erkennung — der Rückfall-Schalter.
  zmod = true
  const manualManager = new PrinterManager('flashforge-ad5x')
  await manualManager.connect({ mode: 'klipper', url: base, profileId: 'flashforge-ad5x', firmware: 'original' })
  assert.equal(manualManager.status.firmwareKind, 'original', 'manuelle Wahl gewinnt gegen die Erkennung')
  assert.equal(manualManager.status.firmwareSource, 'manual', 'Herkunft manuell')
  await manualManager.disconnect()

  console.log(`OK: ${seen.join(' | ')}`)
  console.log('OK: Z-Mod erkannt (Objekte/Makros/Info); ohne Z-Mod-Merkmale Original; ohne Antwort keine Erkennung.')
  console.log('OK: Original-Firmware und manuelle Wahl starten ueber print/start, ohne Z-Mod-Makro.')
  console.log('OK: Makro ohne Druckbestaetigung wird abgelehnt; ungueltiger Dateiname wird abgelehnt.')
  console.log('OK: Werkzeugwechsel startet ueber PRINT_ZCOLOR mit T0=1 T1=2; einfarbig weiter SDCARD_PRINT_FILE.')
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()))
}
