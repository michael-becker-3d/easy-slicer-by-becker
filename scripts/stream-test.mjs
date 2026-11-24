// Prüft den gestreamten Druckstart über den seriellen Pfad:
// Fortschritt + Zeilenzähler + ETA, Pause friert den Vorlauf ein, Weiter läuft,
// Abbruch endet als "cancelled", ein zweiter Job läuft bis 100 % durch.
const API = 'http://127.0.0.1:8787'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url)
      if (r.ok) return r
    } catch {
      /* noch nicht bereit */
    }
    await wait(250)
  }
  throw new Error(`${url} nicht erreichbar`)
}

const j = async (res) => {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
  return data
}
const post = async (path, body) =>
  j(await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
const status = async () => (await j(await fetch(API + '/api/printer/status'))).status

const job = (n) => `${Array.from({ length: n }, (_, i) => `G1 X${(i % 100) + 10} Y${(i % 80) + 10} F3000`).join('\n')}\nM104 S0`

await waitFor(API + '/api/health')
const conn = await post('/api/printer/connect', { mode: 'simulation', profileId: 'anycubic-vyper' })
console.log('Verbunden:', conn.status.connection, '|', conn.status.firmware)

// ---- Job 1: 240 Zeilen ----
await post('/api/printer/print', { gcode: job(240), name: 'stream-240.gcode' })

let s = await status()
for (let i = 0; i < 80 && !(s.print.progress > 0.08); i++) {
  await wait(200)
  s = await status()
}
const running = { progress: s.print.progress, sent: s.print.lines?.sent ?? 0, total: s.print.lines?.total ?? 0, eta: s.print.etaSeconds, state: s.print.state }
console.log('Läuft:', running.state, '|', running.sent, '/', running.total, 'Zeilen |', Math.round(running.progress * 100) + '% | ETA', running.eta, 's')

// ---- Pause ----
await post('/api/printer/print/pause', {})
let afterPause = await status()
const pausedState = afterPause.print.state
await wait(1400)
const frozenA = (await status()).print.lines?.sent ?? 0
await wait(900)
const frozenB = (await status()).print.lines?.sent ?? 0
console.log('Pause:', pausedState, '| Zeilen', frozenA, '→', frozenB, frozenA === frozenB ? '(eingefroren)' : '(läuft weiter!)')

// ---- Weiter ----
await post('/api/printer/print/resume', {})
for (let i = 0; i < 60 && (await status()).print.progress <= running.progress + 0.02; i++) await wait(200)
const resumed = await status()
console.log('Weiter:', resumed.print.state, '|', resumed.print.lines?.sent, 'Zeilen |', Math.round(resumed.print.progress * 100) + '%')

// ---- Abbruch ----
await post('/api/printer/print/cancel', {})
const cancelled = await status()
await wait(900)
const afterCancel = await status()
console.log('Abbruch:', cancelled.print.state, '| Zeilen danach', afterCancel.print.lines?.sent ?? 0)

// ---- Job 2: kurzer Lauf bis fertig ----
await post('/api/printer/print', { gcode: job(40), name: 'stream-40.gcode' })
let done = await status()
for (let i = 0; i < 80 && done.print.state !== 'complete'; i++) {
  await wait(200)
  done = await status()
}
console.log('Job 2:', done.print.state, '|', Math.round(done.print.progress * 100) + '% |', done.print.lines?.sent, '/', done.print.lines?.total)

const ok =
  running.state === 'printing' &&
  running.total === 241 &&
  running.sent > 4 &&
  running.progress > 0.05 &&
  typeof running.eta === 'number' &&
  pausedState === 'paused' &&
  frozenA === frozenB &&
  resumed.print.state === 'printing' &&
  (resumed.print.lines?.sent ?? 0) > frozenB &&
  cancelled.print.state === 'cancelled' &&
  done.print.state === 'complete' &&
  Math.round(done.print.progress * 100) === 100

console.log(ok ? 'ERGEBNIS: ok' : 'ERGEBNIS: FEHLER')
process.exit(ok ? 0 : 1)
