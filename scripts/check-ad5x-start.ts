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
let printState = 'printing'
let reportedFile = 'ui-test.gcode'
const server = createServer((req, res) => {
  seen.push(`${req.method} ${req.url}`)
  res.setHeader('Content-Type', 'application/json')
  if (req.url?.startsWith('/printer/objects/query')) {
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
  console.log(`OK: ${seen.join(' | ')}`)
  console.log('OK: Makro ohne Druckbestaetigung wird abgelehnt; ungueltiger Dateiname wird abgelehnt.')
  console.log('OK: Werkzeugwechsel startet ueber PRINT_ZCOLOR mit T0=1 T1=2; einfarbig weiter SDCARD_PRINT_FILE.')
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()))
}
