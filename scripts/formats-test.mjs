// Prüft alle Importformate (STL, 3MF mit Einstellungen, OBJ, PLY) und den 3MF-Export.
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'

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

// ---- Würfel 20 mm als OBJ / PLY / 3MF ----
const V = [
  [0, 0, 0], [20, 0, 0], [20, 20, 0], [0, 20, 0],
  [0, 0, 20], [20, 0, 20], [20, 20, 20], [0, 20, 20],
]
const F = [
  [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
  [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5],
  [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
]

const obj = [...V.map((v) => `v ${v.join(' ')}`), ...F.map((f) => `f ${f.map((i) => i + 1).join(' ')}`)].join('\n')
writeFileSync('/tmp/kepler-cube.obj', obj)

const ply = [
  'ply',
  'format ascii 1.0',
  `element vertex ${V.length}`,
  'property float x',
  'property float y',
  'property float z',
  `element face ${F.length}`,
  'property list uchar int vertex_indices',
  'end_header',
  ...V.map((v) => v.join(' ')),
  ...F.map((f) => `3 ${f.join(' ')}`),
].join('\n')
writeFileSync('/tmp/kepler-cube.ply', ply)

// 3MF als ZIP mit Modell + Orca-artiger Konfiguration
rmSync('/tmp/kepler-3mf', { recursive: true, force: true })
mkdirSync('/tmp/kepler-3mf/3D', { recursive: true })
mkdirSync('/tmp/kepler-3mf/Metadata', { recursive: true })
const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <metadata name="Application">TestSlicer</metadata>
 <metadata name="printer_model">FlashForge Adventurer 5X</metadata>
 <resources><object id="1" type="model"><mesh>
  <vertices>${V.map((v) => `<vertex x="${v[0]}" y="${v[1]}" z="${v[2]}"/>`).join('')}</vertices>
  <triangles>${F.map((f) => `<triangle v1="${f[0]}" v2="${f[1]}" v3="${f[2]}"/>`).join('')}</triangles>
 </mesh></object></resources>
 <build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/></build>
</model>`
writeFileSync('/tmp/kepler-3mf/3D/3dmodel.model', modelXml)
writeFileSync(
  '/tmp/kepler-3mf/Metadata/project_settings.config',
  JSON.stringify({
    printer_model: 'FlashForge Adventurer 5X',
    filament_settings_id: ['FlashForge PLA'],
    layer_height: '0.28',
    initial_layer_print_height: '0.3',
    wall_loops: '2',
    sparse_infill_density: '15%',
    sparse_infill_pattern: 'lines',
    nozzle_diameter: ['0.6'],
    nozzle_temperature: ['225'],
    bed_temperature: ['65'],
    outer_wall_speed: ['120'],
    travel_speed: ['400'],
    enable_ironing: true,
  }),
)
execFileSync('zip', ['-qr', '/tmp/kepler-cube.3mf', '.'], { cwd: '/tmp/kepler-3mf' })

await waitFor(API + '/api/health')

const upload = async (path, name) =>
  j(
    await fetch(`${API}/api/models?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: readFileSync(path),
    }),
  )

const stlRes = await fetch(API + '/api/demo/wuerfel')
const stl = Buffer.from(await stlRes.arrayBuffer())
const stlModel = await j(
  await fetch(`${API}/api/models?name=wuerfel.stl`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: stl,
  }),
)
console.log('STL:', stlModel.format, '|', stlModel.analysis.bbox.size.x, 'mm')

const objModel = await upload('/tmp/kepler-cube.obj', 'cube.obj')
console.log('OBJ:', objModel.format, '|', objModel.analysis.bbox.size.x, 'mm |', objModel.analysis.triangles, 'Dreiecke')

const plyModel = await upload('/tmp/kepler-cube.ply', 'cube.ply')
console.log('PLY:', plyModel.format, '|', plyModel.analysis.bbox.size.x, 'mm |', plyModel.analysis.triangles, 'Dreiecke')

const mfModel = await upload('/tmp/kepler-cube.3mf', 'project.3mf')
console.log('3MF:', mfModel.format, '|', mfModel.analysis.bbox.size.x, 'mm | Drucker:', mfModel.printerHint)
console.log('3MF-Einstellungen:', JSON.stringify(mfModel.settings))

// ---- 3MF-Export ----
const catalog = await j(await fetch(API + '/api/catalog'))
const exportRes = await fetch(API + '/api/export/3mf', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    modelId: stlModel.id,
    settings: { ...catalog.defaults, layerHeight: 0.16, walls: 4 },
    printerId: 'flashforge-ad5x',
    filamentId: 'pla',
    plateId: 'textured-pei',
  }),
})
if (!exportRes.ok) throw new Error('Export fehlgeschlagen: ' + exportRes.status)
const exported = Buffer.from(await exportRes.arrayBuffer())
writeFileSync('/tmp/kepler-export.3mf', exported)
console.log('Export:', exported.length, 'B | ZIP-Inhalt:')
const listing = execFileSync('unzip', ['-l', '/tmp/kepler-export.3mf']).toString()
for (const line of listing.split('\n').filter((l) => l.includes('Metadata') || l.includes('3dmodel'))) {
  console.log('  ', line.trim())
}
execFileSync('unzip', ['-t', '/tmp/kepler-export.3mf'])

const roundtrip = await upload('/tmp/kepler-export.3mf', 'zurueck.3mf')
console.log('Rückimport:', roundtrip.format, '|', roundtrip.analysis.bbox.size.x, 'mm | layerHeight', roundtrip.settings.layerHeight, '| walls', roundtrip.settings.walls)

const s = mfModel.settings
const ok =
  stlModel.format === 'stl' &&
  objModel.format === 'obj' &&
  plyModel.format === 'ply' &&
  mfModel.format === '3mf' &&
  [objModel, plyModel, mfModel, roundtrip].every((m) => Math.abs(m.analysis.bbox.size.x - 20) < 0.01) &&
  s.layerHeight === 0.28 &&
  s.walls === 2 &&
  s.infillDensity === 15 &&
  s.nozzle === 0.6 &&
  s.temps?.nozzle === 225 &&
  s.speeds?.outerWall === 120 &&
  s.ironing?.enabled === true &&
  mfModel.printerHint === 'FlashForge Adventurer 5X' &&
  exported.length > 500 &&
  listing.includes('Metadata/project_settings.config') &&
  roundtrip.settings.layerHeight === 0.16 &&
  roundtrip.settings.walls === 4 &&
  existsSync('/tmp/kepler-export.3mf')

console.log(ok ? 'ERGEBNIS: ok' : 'ERGEBNIS: FEHLER')
process.exit(ok ? 0 : 1)
