// Prüft den Messverlauf: Speichern pro Drucker, Drift zwischen Messungen,
// Löschen und Persistenz über einen Serverneustart (zweiter Teil im Shell-Lauf).
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

const j = async (res) => {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
  return data
}
const post = async (path, body) =>
  j(await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
const history = async (printerId = 'anycubic-vyper') =>
  (await j(await fetch(`${API}/api/printer/mesh/history?printerId=${printerId}`))).records

await waitFor(API + '/api/health')

// sauberer Ausgangszustand
await fetch(`${API}/api/printer/mesh/history?printerId=anycubic-vyper`, { method: 'DELETE' })
const empty = await history()
console.log('Start:', empty.length, 'Einträge')

await post('/api/printer/connect', { mode: 'simulation', profileId: 'anycubic-vyper' })

await post('/api/printer/mesh/probe', { mode: 'auto' })
await post('/api/printer/mesh/probe', { mode: 'mode-auto' })
await post('/api/printer/mesh/probe', { mode: 'auto' })

const records = await history()
console.log(
  'Nach 3 Messungen:',
  records.map((r) => `${r.rows}×${r.cols} Mittel ${r.mean.toFixed(3)} (${r.source})`).join(' | '),
)

const means = records.map((r) => r.mean)
const step = Math.max(...means.slice(1).map((m, i) => Math.abs(m - means[i])))
const band = Math.max(...means) - Math.min(...means)
console.log('Drift: größter Sprung', step.toFixed(3), 'mm | Band', band.toFixed(3), 'mm')

// Löschen
await fetch(`${API}/api/printer/mesh/history?printerId=anycubic-vyper`, { method: 'DELETE' })
const cleared = await history()
console.log('Nach Löschen:', cleared.length, 'Einträge')

// eine Messung für den Neustart-Test
await post('/api/printer/mesh/probe', { mode: 'auto' })
const beforeRestart = await history()
console.log('Vor Neustart gespeichert:', beforeRestart.length)

const ok =
  empty.length === 0 &&
  records.length === 3 &&
  records.every((r) => r.rows > 1 && r.cols > 1 && Array.isArray(r.z) && r.z.length === r.rows) &&
  records.every((r) => Number.isFinite(r.mean) && r.spread >= 0) &&
  band < 0.2 &&
  cleared.length === 0 &&
  beforeRestart.length === 1

console.log(ok ? 'ERGEBNIS: ok' : 'ERGEBNIS: FEHLER')
process.exit(ok ? 0 : 1)
