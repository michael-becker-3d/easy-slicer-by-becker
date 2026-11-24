// Prüft die automatische Z-Offset-Messung: G30 im Simulation-Pfad,
// PROBE/last_z_result im Klipper-Pfad und die Driftkorrektur beim Druckstart.
const API = 'http://127.0.0.1:8787'
const FAKE = 'http://127.0.0.1:7126'

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

await waitFor(FAKE + '/printer/info')
await waitFor(API + '/api/health')

const catalog = await j(await fetch(API + '/api/catalog'))
const ad5x = catalog.printers.find((p) => p.id === 'flashforge-ad5x')
console.log(
  'AD5X:',
  ad5x ? `${ad5x.bed.x}×${ad5x.bed.y}×${ad5x.bed.z} mm · ${ad5x.maxPrintSpeed} mm/s · ${ad5x.maxAccel} mm/s² · IFS ${ad5x.ifs?.slots ?? 0}` : 'FEHLT',
)
const ff = catalog.printers.filter((p) => p.brand === 'FlashForge')
console.log('FlashForge-Profile:', ff.map((p) => p.name).join(' | '))
console.log('Filamente:', catalog.filaments.length)

const demo = Buffer.from(await (await fetch(API + '/api/demo/wuerfel')).arrayBuffer())
const uploaded = await j(
  await fetch(API + '/api/models?name=wuerfel.stl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: demo,
  }),
)

// ---- Marlin/Simulation (Vyper, LeviQ) ----
await post('/api/printer/connect', { mode: 'simulation', profileId: 'anycubic-vyper' })
const sim = (await post('/api/printer/z/measure', { samples: 3 })).measurement
console.log('Sim Trigger:', sim.samples, '| Mittel', sim.mean, '| Streuung', sim.spread, '| inherent', sim.inherent)
await post('/api/printer/z/apply', { delta: 0.03 })

// ---- Klipper (AD5X) ----
const conn = await post('/api/printer/connect', { mode: 'klipper', url: FAKE, profileId: 'flashforge-ad5x' })
console.log('AD5X verbunden:', conn.status.connection, '|', conn.status.firmware)
const kl = (await post('/api/printer/z/measure', { samples: 3 })).measurement
console.log('Klipper Trigger:', kl.samples, '| Mittel', kl.mean, '| Streuung', kl.spread, '| inherent', kl.inherent, '|', kl.probe)

// Gegenprobe: Klipper ohne Wägezellen (klassische Probe)
await fetch(FAKE + '/__config?loadcell=0')
const klPlain = (await post('/api/printer/z/measure', { samples: 2 })).measurement
console.log('Ohne Wägezellen:', klPlain.probe, '| inherent', klPlain.inherent)
await fetch(FAKE + '/__config?loadcell=1')

// ---- Druckstart mit Referenz: Drift 0,02 mm ----
const print = await post('/api/printer/print', {
  modelId: uploaded.id,
  name: 'wuerfel.gcode',
  profileId: 'flashforge-ad5x',
  gcode: '; dummy',
  settings: { ...catalog.defaults, adaptiveMesh: { enabled: false, margin: 10, grid: 5 }, autoZ: { enabled: true, samples: 3 } },
  zRef: { mean: 1.4 },
})
console.log('Druck-prep z:', JSON.stringify(print.prep?.z ?? null))

const fake = await j(await fetch(FAKE + '/__state'))
const offsetCmds = fake.scripts.filter((s) => s.startsWith('SET_GCODE_OFFSET'))
console.log('Klipper-Offset-Befehl:', offsetCmds.join(' | ') || 'FEHLT')

const delta = print.prep?.z?.delta ?? 0
const ok =
  sim.samples.length === 3 &&
  sim.inherent === true &&
  kl.samples.length === 3 &&
  kl.mean > 1.3 &&
  kl.inherent === true &&
  kl.probe === 'strain-gauge' &&
  klPlain.inherent === false &&
  klPlain.probe === 'probe' &&
  Math.abs(delta - 0.02) <= 0.008 &&
  offsetCmds.length === 1 &&
  /Z_ADJUST=0\.02\b/.test(offsetCmds[0]) &&
  ad5x?.ifs?.slots === 4 &&
  ff.length === 3

console.log(ok ? 'ERGEBNIS: ok' : 'ERGEBNIS: FEHLER')
process.exit(ok ? 0 : 1)
