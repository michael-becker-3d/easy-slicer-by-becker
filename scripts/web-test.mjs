// Prüft die Web-Anbindung: OctoPrint über REST (API-Key, Status, Druck,
// Pause/Abbruch, klare Grenzen) und Moonraker als Gegenprobe.
// Startet dafür einen OctoPrint-Stub auf 127.0.0.1:7127.
import http from 'node:http'

const API = 'http://127.0.0.1:8787'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url)
      if (r.ok) return
    } catch {
      /* noch nicht bereit */
    }
    await wait(250)
  }
  throw new Error(`${url} nicht erreichbar`)
}

const octo = {
  key: 'TESTKEY',
  printing: false,
  paused: false,
  progress: 0,
  file: null,
  commands: [],
  uploads: 0,
  jobs: [],
}

const sendJson = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1:7127')
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    if (url.pathname === '/api/version') {
      sendJson(res, 200, { server: '1.9.3', api: '0.1', text: 'OctoPrint 1.9.3' })
      return
    }
    if (req.headers['x-api-key'] !== octo.key) {
      sendJson(res, 401, { error: 'Unauthorized' })
      return
    }
    if (url.pathname === '/api/printer') {
      sendJson(res, 200, {
        temperature: { tool0: { actual: 201.4, target: 210 }, bed: { actual: 60.2, target: 60 } },
        state: {
          text: octo.paused ? 'Paused' : octo.printing ? 'Printing' : 'Operational',
          flags: {
            printing: octo.printing && !octo.paused,
            paused: octo.paused,
            operational: !octo.printing,
            error: false,
            closedOrError: false,
          },
        },
      })
      return
    }
    if (url.pathname === '/api/job' && req.method === 'GET') {
      sendJson(res, 200, {
        job: { file: octo.file ? { name: octo.file } : null },
        progress: { completion: octo.progress * 100, printTimeLeft: 90 },
      })
      return
    }
    if (url.pathname === '/api/printer/command') {
      const data = JSON.parse(body || '{}')
      const commands = Array.isArray(data.commands) ? data.commands : []
      octo.commands.push(...commands)
      if (commands.some((c) => /M112/i.test(c))) octo.printing = false
      res.writeHead(204)
      res.end()
      return
    }
    if (url.pathname === '/api/files/local') {
      const m = body.match(/filename="([^"]+)"/)
      octo.uploads++
      octo.file = m ? m[1] : 'unbekannt'
      if (/name="print"\r?\n\r?\ntrue/.test(body)) {
        octo.printing = true
        octo.progress = 0.4
      }
      sendJson(res, 201, { files: { local: { name: octo.file } } })
      return
    }
    // Nur der dokumentierte Pfad POST /api/job — so fällt ein falscher Client-Pfad im Test auf
    if (url.pathname === '/api/job' && req.method === 'POST') {
      const data = JSON.parse(body || '{}')
      octo.jobs.push(data)
      if (data.command === 'start') octo.printing = true
      else if (data.command === 'pause' && data.action === 'pause') octo.paused = true
      else if (data.command === 'pause' && data.action === 'resume') octo.paused = false
      else if (data.command === 'cancel') {
        octo.printing = false
        octo.paused = false
        octo.progress = 0
      }
      res.writeHead(204)
      res.end()
      return
    }
    sendJson(res, 404, { error: 'not found' })
  })
})

await new Promise((resolve) => server.listen(7127, '127.0.0.1', resolve))
await waitFor(API + '/api/health')

const post = async (path, payload) => {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}
const get = async (path) => {
  const res = await fetch(`${API}${path}`)
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

const PROFILE = 'flashforge-ad5x'
const URL_OCTO = 'http://127.0.0.1:7127'

// 1) Falscher API-Key muss klar scheitern
const bad = await post('/api/printer/connect', { mode: 'octoprint', url: URL_OCTO, apiKey: 'FALSCH', profileId: PROFILE })
console.log('falscher Key:', bad.status, '|', bad.data.error)
const badOk = !bad.ok && /API-Key/i.test(bad.data.error ?? '')

// 1b) Fehlender API-Key muss ebenfalls klar scheitern
const noKey = await post('/api/printer/connect', { mode: 'octoprint', url: URL_OCTO, profileId: PROFILE })
console.log('ohne Key:', noKey.status, '|', noKey.data.error)
const noKeyOk = !noKey.ok && /API-Key/i.test(noKey.data.error ?? '')

// 2) Richtiger Key
const conn = await post('/api/printer/connect', { mode: 'octoprint', url: URL_OCTO, apiKey: octo.key, profileId: PROFILE })
const st = conn.data.status ?? {}
console.log('verbunden:', st.connection, st.mode, '|', st.firmware, '|', st.port)
const connected =
  conn.ok &&
  st.connection === 'connected' &&
  st.mode === 'octoprint' &&
  /1\.9\.3/.test(st.firmware ?? '') &&
  st.port === URL_OCTO

// 3) G-Code-Kommando über REST
await post('/api/printer/command', { line: 'G28' })
const cmdOk = octo.commands.includes('G28')

// 4) Druck starten (Upload + Start)
const start = await post('/api/printer/print', { gcode: 'G28\nG1 X10 Y10 F3000\n', name: 'test-job.gcode' })
await wait(2600)
const s1 = (await get('/api/printer/status')).data.status
console.log('Druck:', s1.print.state, `${Math.round(s1.print.progress * 100)}%`, s1.print.file, '| Uploads:', octo.uploads)
const printing =
  start.ok &&
  octo.uploads === 1 &&
  s1.print.state === 'printing' &&
  s1.print.file === 'test-job.gcode' &&
  Math.abs(s1.print.progress - 0.4) < 0.01 &&
  Math.abs(s1.temps.nozzle - 201.4) < 0.01

// 5) Pause und Weiter
await post('/api/printer/print/pause')
await wait(2600)
const s2 = (await get('/api/printer/status')).data.status
await post('/api/printer/print/resume')
await wait(2600)
const s3 = (await get('/api/printer/status')).data.status
console.log('Pause/Weiter:', s2.print.state, '→', s3.print.state)
const pausedOk = s2.print.state === 'paused' && s3.print.state === 'printing'

// 6) Abbruch
await post('/api/printer/print/cancel')
const s4 = (await get('/api/printer/status')).data.status
const cancelOk = s4.print.state === 'cancelled' && octo.jobs.some((j) => j.command === 'cancel')

// 7) NOT-AUS
await post('/api/printer/estop')
const estopOk = octo.commands.includes('M112')

// 8) Grenzen: Z-Messung über OctoPrint wird klar abgelehnt
const zm = await post('/api/printer/z/measure', { samples: 1 })
console.log('Z-Messung:', zm.status, '|', zm.data.error)
const zBlocked = !zm.ok && /OctoPrint/i.test(zm.data.error ?? '')

// 9) Trennen
const disc = await post('/api/printer/disconnect')
const discOk = disc.data.status?.connection === 'disconnected'

// 10) Moonraker bleibt unverändert erreichbar
let moonOk = true
try {
  await waitFor('http://127.0.0.1:7126/printer/info')
  const moon = await post('/api/printer/connect', { mode: 'klipper', url: 'http://127.0.0.1:7126', profileId: PROFILE })
  moonOk = moon.ok && moon.data.status?.mode === 'klipper' && moon.data.status?.connection === 'connected'
  console.log('Moonraker:', moon.data.status?.mode, moon.data.status?.connection)
  await post('/api/printer/disconnect')
} catch {
  moonOk = false
  console.log('Moonraker: Stub nicht erreichbar')
}

server.close()

const ok =
  badOk &&
  noKeyOk &&
  connected &&
  cmdOk &&
  printing &&
  pausedOk &&
  cancelOk &&
  estopOk &&
  zBlocked &&
  discOk &&
  moonOk
console.log(ok ? 'ERGEBNIS: ok' : 'ERGEBNIS: FEHLER')
process.exit(ok ? 0 : 1)
