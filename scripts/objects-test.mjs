// Prüft, dass ein 3MF in Einzelobjekte zerfällt und Platzierung, Drehung,
// Maßstab und Sichtbarkeit die zusammengesetzte Geometrie verändern.
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'

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

const cube = (ox, oy) => {
  const v = [
    [ox, oy, 0], [ox + 20, oy, 0], [ox + 20, oy + 20, 0], [ox, oy + 20, 0],
    [ox, oy, 20], [ox + 20, oy, 20], [ox + 20, oy + 20, 20], [ox, oy + 20, 20],
  ]
  const f = [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
  ]
  return { v, f }
}

// Zwei Objekte: Würfel A bei 0/0, Würfel B im 3MF um +50 mm verschoben
const a = cube(0, 0)
const b = cube(0, 0)
rmSync('/tmp/kepler-obj', { recursive: true, force: true })
mkdirSync('/tmp/kepler-obj/3D', { recursive: true })
mkdirSync('/tmp/kepler-obj/Metadata', { recursive: true })

const objectXml = (id, name, c) => `<object id="${id}" name="${name}" type="model"><mesh>
 <vertices>${c.v.map((p) => `<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`).join('')}</vertices>
 <triangles>${c.f.map((t) => `<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"/>`).join('')}</triangles>
</mesh></object>`

writeFileSync(
  '/tmp/kepler-obj/3D/3dmodel.model',
  `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <metadata name="Title">Zwei Würfel</metadata>
 <resources>
  ${objectXml(1, 'Würfel A', a)}
  ${objectXml(2, 'Würfel B', b)}
 </resources>
 <build>
  <item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
  <item objectid="2" transform="1 0 0 0 1 0 0 0 1 50 0 0"/>
 </build>
</model>`,
)
writeFileSync('/tmp/kepler-obj/Metadata/project_settings.config', JSON.stringify({ layer_height: '0.2' }))
execFileSync('zip', ['-qr', '/tmp/kepler-two.3mf', '.'], { cwd: '/tmp/kepler-obj' })

await waitFor(API + '/api/health')

const upload = async (path, name) =>
  j(
    await fetch(`${API}/api/models?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: readFileSync(path),
    }),
  )

const model = await upload('/tmp/kepler-two.3mf', 'zwei-wuerfel.3mf')
console.log('Objekte:', model.objects.length, '|', model.objects.map((o) => `${o.name} @x=${o.center.x}`).join(' | '))
console.log('Gesamt-Maß:', model.analysis.bbox.size.x, 'mm')

const stlBytes = async () => (await fetch(`${API}/api/models/${model.id}/stl`)).arrayBuffer().then((b) => b.byteLength)
const before = await stlBytes()

const setObjects = async (objects) =>
  j(
    await fetch(`${API}/api/models/${model.id}/objects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ objects }),
    }),
  )

const placements = (overrides = {}) =>
  model.objects.map((o) => ({ id: o.id, ...o.placement, ...(overrides[o.name] ?? {}) }))

// Objekt B ausblenden
const hidden = await setObjects(placements({ 'Würfel B': { visible: false } }))
console.log('B unsichtbar:', hidden.analysis.bbox.size.x, 'mm | sichtbar:', hidden.objects.filter((o) => o.placement.visible).length)

// B wieder einblenden, A auf doppelte Größe, B um +100 mm verschieben
const scaled = await setObjects(
  placements({
    'Würfel A': { visible: true, scaleX: 2, scaleY: 2, scaleZ: 2 },
    'Würfel B': { visible: true, offsetX: 100 },
  }),
)
console.log('A ×2 / B +100:', scaled.analysis.bbox.size.x, 'mm')

// Drehung um 45° bei A
const rotated = await setObjects(
  placements({
    'Würfel A': { visible: true, scaleX: 2, scaleY: 2, scaleZ: 2, rotationZ: 45 },
    'Würfel B': { visible: true, offsetX: 100 },
  }),
)
console.log('A 45°:', rotated.analysis.bbox.size.x.toFixed(1), '×', rotated.analysis.bbox.size.y.toFixed(1), 'mm')

// alles ausblenden darf nicht erlaubt sein
let blocked = false
try {
  await setObjects(placements({ 'Würfel A': { visible: false }, 'Würfel B': { visible: false } }))
} catch {
  blocked = true
}

const after = await stlBytes()

// Einzelobjekt-3MF (echtes Archiv mit genau einem Build-Item)
rmSync('/tmp/kepler-one', { recursive: true, force: true })
mkdirSync('/tmp/kepler-one/3D', { recursive: true })
writeFileSync(
  '/tmp/kepler-one/3D/3dmodel.model',
  `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>${objectXml(7, 'Allein', cube(0, 0))}</resources>
 <build><item objectid="7"/></build>
</model>`,
)
execFileSync('zip', ['-qr', '/tmp/kepler-one.3mf', '.'], { cwd: '/tmp/kepler-one' })
const single = await upload('/tmp/kepler-one.3mf', 'nur-ein-modell.3mf')

const rotatedSpan = Math.max(rotated.analysis.bbox.size.x, rotated.analysis.bbox.size.y)
const ok =
  model.objects.length === 2 &&
  model.objects.every(
    (o) =>
      o.placement.scaleX === 1 &&
      o.placement.scaleY === 1 &&
      o.placement.scaleZ === 1 &&
      o.placement.visible,
  ) &&
  Math.abs(model.analysis.bbox.size.x - 70) < 0.5 &&
  Math.abs(hidden.analysis.bbox.size.x - 20) < 0.5 &&
  hidden.objects.filter((o) => o.placement.visible).length === 1 &&
  Math.abs(scaled.analysis.bbox.size.x - 170) < 0.5 &&
  rotatedSpan > 50 &&
  blocked &&
  before > 0 &&
  after > 0 &&
  single.objects.length === 1

console.log(ok ? 'ERGEBNIS: ok' : 'ERGEBNIS: FEHLER')
process.exit(ok ? 0 : 1)
