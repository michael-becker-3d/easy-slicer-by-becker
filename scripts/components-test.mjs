// Prüft, dass 3MF-Baugruppen (verschachtelte <components>) in Einzelobjekte
// zerlegt werden — inklusive verketteter Transformationen und Ringschutz.
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

const cube = (ox = 0, oy = 0, s = 20) => {
  const v = [
    [ox, oy, 0], [ox + s, oy, 0], [ox + s, oy + s, 0], [ox, oy + s, 0],
    [ox, oy, s], [ox + s, oy, s], [ox + s, oy + s, s], [ox, oy + s, s],
  ]
  const f = [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
  ]
  return { v, f }
}

const meshObj = (id, name, c) => `<object id="${id}" name="${name}" type="model"><mesh>
 <vertices>${c.v.map((p) => `<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`).join('')}</vertices>
 <triangles>${c.f.map((t) => `<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"/>`).join('')}</triangles>
</mesh></object>`

const comp = (objectid, t) => `<component objectid="${objectid}"${t ? ` transform="${t}"` : ''}/>`
const groupObj = (id, name, children) =>
  `<object id="${id}" name="${name}" type="model"><components>${children.join('')}</components></object>`
const tr = (x = 0, y = 0, z = 0) => `1 0 0 0 1 0 0 0 1 ${x} ${y} ${z}`
const rotZ = (deg) => {
  const r = (deg * Math.PI) / 180
  return `${Math.cos(r)} ${-Math.sin(r)} 0 ${Math.sin(r)} ${Math.cos(r)} 0 0 0 1 0 0 0`
}

const modelXml = (resources, items) => `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>${resources.join('')}</resources>
 <build>${items.join('')}</build>
</model>`

function buildZip(path, xml) {
  const dir = path.replace(/\.3mf$/, '')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(`${dir}/3D`, { recursive: true })
  writeFileSync(`${dir}/3D/3dmodel.model`, xml)
  rmSync(path, { force: true })
  execFileSync('zip', ['-qr', path, '.'], { cwd: dir })
}

await waitFor(API + '/api/health')

const upload = async (path, name) =>
  j(
    await fetch(`${API}/api/models?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: readFileSync(path),
    }),
  )

// 1) Baugruppe mit zwei Komponenten desselben Meshes
buildZip(
  '/tmp/kepler-comp-flach.3mf',
  modelXml(
    [meshObj(1, 'Würfel', cube()), groupObj(2, 'Reihe', [comp(1, tr(25, 0, 0)), comp(1, tr(50, 0, 0))])],
    ['<item objectid="2"/>'],
  ),
)
const flat = await upload('/tmp/kepler-comp-flach.3mf', 'baugruppe.3mf')
const flatCenters = flat.objects.map((o) => o.center.x).sort((a, b) => a - b)
console.log('Baugruppe:', flat.objects.length, 'Objekte |', flat.objects.map((o) => o.name).join(' | '))
console.log('  X-Mitten:', flatCenters.map((v) => v.toFixed(1)).join(' / '), '| Breite', flat.analysis.bbox.size.x.toFixed(1), 'mm')
const flatOk =
  flat.objects.length === 2 &&
  Math.abs(flat.analysis.bbox.size.x - 45) < 0.5 &&
  flat.objects.every((o) => /Reihe/.test(o.name)) &&
  Math.abs(flatCenters[0] - 35) < 0.5 &&
  Math.abs(flatCenters[1] - 60) < 0.5

// 2) Zwei Ebenen tief: Gruppe → Reihe → Würfel, mit Build-Transformation
buildZip(
  '/tmp/kepler-comp-nest.3mf',
  modelXml(
    [
      meshObj(1, 'Würfel', cube()),
      groupObj(2, 'Reihe', [comp(1, tr(25, 0, 0)), comp(1, tr(50, 0, 0))]),
      groupObj(3, 'Gruppe', [comp(2, tr(0, 40, 0))]),
    ],
    [`<item objectid="3" transform="${tr(100, 0, 0)}"/>`],
  ),
)
const nest = await upload('/tmp/kepler-comp-nest.3mf', 'verschachtelt.3mf')
const nestCenters = nest.objects.map((o) => o.center.x).sort((a, b) => a - b)
console.log('Verschachtelt:', nest.objects.length, 'Objekte |', nest.objects[0]?.name)
console.log(
  '  X-Mitten:',
  nestCenters.map((v) => v.toFixed(1)).join(' / '),
  '| Y-Mitte',
  (nest.objects[0]?.center.y ?? 0).toFixed(1),
  '| Breite',
  nest.analysis.bbox.size.x.toFixed(1),
  'mm',
)
const nestOk =
  nest.objects.length === 2 &&
  Math.abs(nest.analysis.bbox.size.x - 45) < 0.5 &&
  Math.abs(nest.analysis.bbox.size.y - 20) < 0.5 &&
  nest.objects.every((o) => Math.abs(o.center.y - 50) < 0.5) &&
  /Gruppe/.test(nest.objects[0]?.name ?? '') &&
  Math.abs(nestCenters[0] - 135) < 0.5 &&
  Math.abs(nestCenters[1] - 160) < 0.5

// 3) Drehung in der Komponente
buildZip(
  '/tmp/kepler-comp-dreh.3mf',
  modelXml([meshObj(1, 'Würfel', cube()), groupObj(5, 'Gedreht', [comp(1, rotZ(45))])], ['<item objectid="5"/>']),
)
const rot = await upload('/tmp/kepler-comp-dreh.3mf', 'gedreht.3mf')
console.log('Drehung 45°:', rot.objects.length, 'Objekt |', rot.analysis.bbox.size.x.toFixed(1), '×', rot.analysis.bbox.size.y.toFixed(1), 'mm')
const rotOk =
  rot.objects.length === 1 &&
  Math.abs(rot.analysis.bbox.size.x - 28.28) < 0.5 &&
  Math.abs(rot.analysis.bbox.size.y - 28.28) < 0.5

// 4) Ringschluss darf nicht hängen und nicht als Objekt auftauchen
buildZip('/tmp/kepler-comp-zyklus.3mf', modelXml([groupObj(6, 'Ringschluss', [comp(6)])], ['<item objectid="6"/>']))
let cycleBlocked = false
try {
  await upload('/tmp/kepler-comp-zyklus.3mf', 'zyklus.3mf')
} catch {
  cycleBlocked = true
}
console.log('Ringschluss abgewiesen:', cycleBlocked)

const ok = flatOk && nestOk && rotOk && cycleBlocked
console.log(ok ? 'ERGEBNIS: ok' : 'ERGEBNIS: FEHLER')
process.exit(ok ? 0 : 1)
