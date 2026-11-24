// Prüft das adaptive Bett-Mesh vor dem Druckstart für beide Wege:
// Simulation/Marlin (G30 im Modellbereich) und Klipper (AREA_START/AREA_END).
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
  const data = await res.json()
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
  return data
}

const post = async (path, body) =>
  j(await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))

await waitFor(FAKE + '/printer/info')
await waitFor(API + '/api/health')

const catalog = await j(await fetch(API + '/api/catalog'))

// Modell (Würfel 30 mm) hochladen
const demoRes = await fetch(API + '/api/demo/wuerfel')
if (!demoRes.ok) throw new Error('Demo-Modell fehlt: ' + demoRes.status)
const demo = Buffer.from(await demoRes.arrayBuffer())
console.log('Demo-STL:', demo.length, 'B')
const uploaded = await j(
  await fetch(API + '/api/models?name=wuerfel.stl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: demo,
  }),
)
console.log('Modell:', uploaded.analysis.bbox.size, 'mm')

// ---- Fall A: Marlin/Simulation ----
await post('/api/printer/connect', { mode: 'simulation', profileId: 'anycubic-vyper' })
const a = await post('/api/printer/print', {
  modelId: uploaded.id,
  name: 'wuerfel.gcode',
  profileId: 'anycubic-vyper',
  settings: catalog.defaults,
  gcode: '; dummy',
})
console.log('A prep:', JSON.stringify(a.prep))
let aState
for (let i = 0; i < 60; i++) {
  aState = await j(await fetch(API + '/api/printer/status'))
  if (aState.status.print.state !== 'idle' && aState.status.print.progress > 0) break
  await wait(250)
}
console.log('A Druck:', aState.status.print.state, '| Fortschritt:', aState.status.print.progress.toFixed(3))
const aMesh = await j(await fetch(API + '/api/printer/mesh'))
const aX1 = aMesh.mesh ? aMesh.mesh.x0 + aMesh.mesh.dx * (aMesh.mesh.cols - 1) : 0
console.log(
  'A Mesh:',
  aMesh.mesh ? `${aMesh.mesh.rows}x${aMesh.mesh.cols} Quelle ${aMesh.mesh.source} X ${aMesh.mesh.x0}–${aX1.toFixed(0)}` : 'keins',
)

// ---- Fall B: Klipper ----
const bConn = await post('/api/printer/connect', { mode: 'klipper', url: FAKE, profileId: 'voron-24-350' })
console.log('B verbunden:', bConn.status.connection, '|', bConn.status.firmware)
const b = await post('/api/printer/print', {
  modelId: uploaded.id,
  name: 'wuerfel.gcode',
  profileId: 'voron-24-350',
  settings: catalog.defaults,
  gcode: '; dummy',
})
console.log('B prep:', JSON.stringify(b.prep))

const fake = await j(await fetch(FAKE + '/__state'))
const calib = fake.scripts.filter((s) => s.startsWith('BED_MESH_CALIBRATE'))
const upload = fake.uploads.at(-1)
console.log('B Kalibrier-Skript:', calib.join(' | ') || 'FEHLT')
console.log('B Upload:', upload ? `${upload.len} B` : 'FEHLT', '| startet direkt:', upload?.print ?? 'FEHLT')
console.log('B G-Code lädt Standardprofil:', upload?.text.includes('BED_MESH_PROFILE LOAD') ? 'JA (falsch)' : 'nein')

const ok =
  a.prep?.adaptive === true &&
  a.prep?.compensation === 'software' &&
  a.prep?.size?.w <= 50 &&
  aMesh.mesh?.source === 'manual' &&
  Math.abs(aMesh.mesh.x0 - 102.5) < 1.5 &&
  aState.status.print.state !== 'idle' &&
  aState.status.print.progress > 0 &&
  b.prep?.compensation === 'firmware' &&
  calib.length === 1 &&
  /AREA_START=\d+(\.\d+)?,\d+(\.\d+)? AREA_END=\d+(\.\d+)?,\d+(\.\d+)?/.test(calib[0]) &&
  upload?.print === 'true' &&
  !upload?.text.includes('BED_MESH_PROFILE LOAD') &&
  !upload?.text.includes('M420')

console.log(ok ? 'ERGEBNIS: ok' : 'ERGEBNIS: FEHLER')
process.exit(ok ? 0 : 1)
