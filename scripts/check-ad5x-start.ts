import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { KlipperClient } from '../server/printer/klipper.ts'
import { PrinterManager } from '../server/printer/manager.ts'

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
  console.log(`OK: ${seen.join(' | ')}`)
  console.log('OK: Makro ohne Druckbestaetigung wird abgelehnt; ungueltiger Dateiname wird abgelehnt.')
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()))
}
