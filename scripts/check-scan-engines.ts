/**
 * Prüft die Erkennung von Scan-Ausgabeordnern (V-23).
 *
 * Die Ordnerbäume sind synthetisch, aber die Dateiinhalte entsprechen den
 * echten Formaten (COLMAP images.txt, Meshroom sfm.json, openMVS .mvs,
 * PLY-Kopf). Echte Engine-Ausgaben folgen als Abnahme, sobald sie vorliegen.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { inspectScanFolder, readScanMeshFile } from '../server/scanFolder.ts'
import {
  countColmapImages,
  countMeshroomViews,
  countOpenMvsImages,
  detectScanFolder,
  normalizeScanPath,
  objRole,
  parseScanJob,
  ENGINE_LABEL,
  glbRole,
  plyRole,
} from '../shared/scanEngines.ts'

// --- COLMAP: dichtes Poisson-Netz neben der Punktwolke -----------------------
const colmapImages = [
  '# Image list with two lines of data per image:',
  '#   IMAGE_ID, QW, QX, QY, QZ, TX, TY, TZ, CAMERA_ID, NAME',
  '#   POINTS2D[] as (X, Y, POINT3D_ID)',
  '1 0.5 0.5 0.5 0.5 0 0 0 1 bild-01.jpg',
  '100.5 200.5 -1 300.5 400.5 42',
  '2 0.5 0.5 0.5 0.5 0 0 0 1 bild-02.jpg',
  '10.5 20.5 7',
  '3 0.5 0.5 0.5 0.5 0 0 0 1 bild-03.jpg',
  '',
].join('\n')

const colmap = detectScanFolder(
  [
    { path: 'sparse/0/cameras.txt', size: 120 },
    { path: 'sparse/0/images.txt', size: 900 },
    { path: 'sparse/0/points3D.bin', size: 5_000 },
    { path: 'dense/fused.ply', size: 40_000_000 },
    { path: 'dense/meshed-poisson.ply', size: 20_000_000 },
    { path: 'images/bild-01.jpg', size: 200_000 },
  ],
  [
    { path: 'sparse/0/images.txt', text: colmapImages },
    {
      path: 'dense/fused.ply',
      text: 'ply\nformat binary_little_endian 1.0\nelement vertex 500000\nproperty float x\nproperty float y\nproperty float z\nend_header\n',
    },
    {
      path: 'dense/meshed-poisson.ply',
      text: 'ply\nformat binary_little_endian 1.0\nelement vertex 9000\nproperty float x\nproperty float y\nproperty float z\nelement face 18000\nproperty list uchar int vertex_indices\nend_header\n',
    },
  ],
)
assert.equal(colmap.engine, 'colmap')
assert.equal(colmap.confidence, 'hoch', 'cameras+images, sparse und dense sind drei Belege')
assert.equal(colmap.images?.count, 3, 'drei Bildzeilen mit zehn Feldern')
assert.equal(countColmapImages(colmapImages), 3)
assert.equal(countColmapImages(''), null, 'leere Datei ohne Kopfzeile behauptet nichts')
assert.equal(colmap.candidates[0].path, 'dense/meshed-poisson.ply', 'Poisson-Netz steht vorne')
assert.equal(colmap.candidates[0].role, 'Netz')
assert.equal(colmap.candidates[0].usable, true)
const fused = colmap.candidates.find((entry) => entry.path === 'dense/fused.ply')
assert.equal(fused?.role, 'Punktwolke', 'COLMAP fused.ply ist eine Punktwolke')
assert.equal(fused?.usable, false)
assert.equal(ENGINE_LABEL[colmap.engine], 'COLMAP')
assert.equal(colmap.candidates.filter((entry) => entry.usable).length, 1, 'nur das Poisson-Netz ist ladbar')

// --- COLMAP ohne dichten Schritt: nur Punktwolke ---------------------------
const colmapCloudOnly = detectScanFolder(
  [
    { path: 'sparse/0/cameras.txt' },
    { path: 'sparse/0/images.txt' },
    { path: 'dense/fused.ply' },
  ],
  [
    { path: 'sparse/0/images.txt', text: colmapImages },
    { path: 'dense/fused.ply', text: 'ply\nformat ascii 1.0\nelement vertex 10\nproperty float x\nend_header\n' },
  ],
)
assert.equal(colmapCloudOnly.candidates.every((entry) => !entry.usable), true)
assert.equal(
  colmapCloudOnly.warnings.some((warning) => /Punktwolken/.test(warning) && /dense reconstruction/.test(warning)),
  true,
  'ohne dichten Schritt nennt die Warnung den nächsten Engine-Schritt',
)

// --- Meshroom: texturiertes Mesh ------------------------------------------
const meshroom = detectScanFolder(
  [
    { path: 'MeshroomCache/StructureFromMotion_1a2b/sfm.json' },
    { path: 'MeshroomCache/Meshing_c3d4/mesh.obj' },
    { path: 'MeshroomCache/Texturing_e5f6/texturedMesh.obj', size: 8_000_000 },
    { path: 'MeshroomCache/Texturing_e5f6/texturedMesh.mtl' },
    { path: 'MeshroomCache/Texturing_e5f6/texture_1001.png' },
  ],
  [
    {
      path: 'MeshroomCache/StructureFromMotion_1a2b/sfm.json',
      text: '{"views":[{"viewId":"0","poseId":"0"},{"viewId":"1","poseId":"1"},{"viewId":"2","poseId":"2"}],"intrinsics":[]}',
    },
    { path: 'MeshroomCache/Texturing_e5f6/texturedMesh.obj', text: 'mtllib texturedMesh.mtl\nv 0 0 0\nf 1 2 3\n' },
    { path: 'MeshroomCache/Meshing_c3d4/mesh.obj', text: 'v 0 0 0\nf 1 2 3\n' },
  ],
)
assert.equal(meshroom.engine, 'meshroom')
assert.equal(meshroom.images?.count, 3)
assert.equal(countMeshroomViews('{"poseId":1,"poseId":2}'), 2)
assert.equal(meshroom.candidates[0].file, 'texturedMesh.obj')
assert.equal(meshroom.candidates[0].role, 'Netz mit Textur')

// --- openMVS ---------------------------------------------------------------
const openmvs = detectScanFolder(
  [
    { path: 'scene.mvs', size: 4000 },
    { path: 'scene_dense.ply', size: 60_000_000 },
    { path: 'scene_dense_mesh_refine.ply', size: 12_000_000 },
    { path: 'scene_dense_mesh_refine_texture_0.png' },
  ],
  [
    { path: 'scene.mvs', text: '<?xml version="1.0"?>\n<map>\n<Image id="0" name="a.jpg" />\n<Image id="1" name="b.jpg" />\n<Image id="2" name="c.jpg" />\n</map>' },
    { path: 'scene_dense.ply', text: 'ply\nformat binary_little_endian 1.0\nelement vertex 900000\nend_header\n' },
    {
      path: 'scene_dense_mesh_refine.ply',
      text: 'ply\nformat binary_little_endian 1.0\nelement vertex 20000\nelement face 40000\nend_header\n',
    },
  ],
)
assert.equal(openmvs.engine, 'openmvs')
assert.equal(openmvs.images?.count, 3)
assert.equal(countOpenMvsImages('<Image id="7">'), 1)
assert.equal(openmvs.candidates[0].file, 'scene_dense_mesh_refine.ply')
assert.equal(openmvs.candidates[0].role, 'Netz mit Textur', 'Texturdatei daneben zählt')

// --- MicMac ---------------------------------------------------------------
const micmac = detectScanFolder([
  { path: 'Chantier.cfg' },
  { path: 'Ori-Ter/Camera.xml' },
  { path: 'Homol/Test2' },
  { path: 'MEC-Malt/Mesh.ply', size: 3_000_000 },
])
assert.equal(micmac.engine, 'micmac')
assert.equal(micmac.candidates[0].file, 'Mesh.ply')

// --- Unbekannter Ordner mit STL -------------------------------------------
const plain = detectScanFolder([{ path: 'export/model.stl', size: 900_000 }])
assert.equal(plain.engine, 'unknown')
assert.equal(plain.candidates[0].format, 'stl')
assert.equal(plain.candidates[0].usable, true)
assert.equal(
  plain.warnings.some((warning) => /Herkunft nicht erkannt/.test(warning)),
  true,
)

// --- Leerer Ordner: konkreter nächster Schritt ----------------------------
const empty = detectScanFolder([])
assert.equal(empty.candidates.length, 0)
assert.equal(empty.warnings.length > 0, true)

// --- Windows-Pfade und Hilfsfunktionen ------------------------------------
assert.equal(normalizeScanPath('.\\sparse\\0\\images.txt'), 'sparse/0/images.txt')
assert.equal(plyRole('ply\nformat ascii 1.0\nelement vertex 4\nelement face 2\nend_header'), 'Netz')
assert.equal(plyRole('ply\nformat ascii 1.0\nelement vertex 4\nend_header'), 'Punktwolke')
assert.equal(plyRole('kein ply'), 'unbekannt')
assert.equal(objRole('v 0 0 0\nv 1 0 0\nf 1 2 3'), 'Netz')
assert.equal(objRole('v 0 0 0\nv 1 0 0'), 'Punktwolke')

console.log('Scan-Engines: COLMAP/Meshroom/openMVS/MicMac erkannt, Punktwolken abgelehnt, nächster Schritt genannt.')

// --- Echte Arbeitsordner des MeshScan-Servers (openMVS rechnet in colmap/dense)
const openmvsInColmap = detectScanFolder(
  [
    { path: 'colmap/sparse/0/cameras.txt' },
    { path: 'colmap/sparse/0/images.txt' },
    { path: 'colmap/dense/scene.mvs' },
    { path: 'colmap/dense/scene_dense.mvs' },
    { path: 'colmap/dense/scene_dense.ply', size: 90_000_000 },
    { path: 'colmap/dense/scene_dense_mesh.ply', size: 9_000_000 },
    { path: 'colmap/dense/openmvs.obj', size: 9_500_000 },
    { path: 'colmap/dense/openmvs.mtl' },
    { path: 'colmap/dense/images/IMG_0001.jpg' },
  ],
  [
    { path: 'colmap/sparse/0/images.txt', text: colmapImages },
    { path: 'colmap/dense/scene.mvs', text: '<map><Image id="0"/><Image id="1"/><Image id="2"/></map>' },
    { path: 'colmap/dense/scene_dense.ply', text: 'ply\nformat binary_little_endian 1.0\nelement vertex 900000\nend_header\n' },
    {
      path: 'colmap/dense/scene_dense_mesh.ply',
      text: 'ply\nformat binary_little_endian 1.0\nelement vertex 20000\nelement face 40000\nend_header\n',
    },
    { path: 'colmap/dense/openmvs.obj', text: 'mtllib openmvs.mtl\nv 0 0 0\nf 1 2 3\n' },
  ],
)
assert.equal(openmvsInColmap.engine, 'openmvs', 'openMVS-Ausgabe im COLMAP-dense-Ordner zählt als openMVS')
assert.equal(openmvsInColmap.images?.count, 3)
assert.equal(openmvsInColmap.candidates[0].role, 'Netz mit Textur')
assert.equal(
  openmvsInColmap.candidates.every((entry) => !entry.path.endsWith('scene_dense.ply') || !entry.usable),
  true,
  'scene_dense.ply ist die Punktwolke',
)

// --- MicMac-Arbeitsordner: C3DC-Punktwolke, mesh.ply, mesh_textured.ply ------
const micmacWork = detectScanFolder(
  [
    { path: 'C3DC_MicMac.ply', size: 40_000_000 },
    { path: 'mesh.ply', size: 5_000_000 },
    { path: 'mesh_textured.ply', size: 6_000_000 },
  ],
  [
    { path: 'C3DC_MicMac.ply', text: 'ply\nformat ascii 1.0\nelement vertex 500000\nproperty float x\nend_header\n' },
    { path: 'mesh.ply', text: 'ply\nformat ascii 1.0\nelement vertex 30000\nelement face 60000\nend_header\n' },
    { path: 'mesh_textured.ply', text: 'ply\nformat ascii 1.0\nelement vertex 30000\nelement face 60000\nend_header\n' },
  ],
)
assert.equal(micmacWork.engine, 'micmac', 'C3DC_MicMac.ply verrät MicMac auch ohne Ori-/Homol-Ordner')
assert.equal(micmacWork.candidates[0].file, 'mesh_textured.ply')
assert.equal(micmacWork.candidates[0].role, 'Netz mit Textur')
assert.equal(micmacWork.candidates.find((entry) => entry.file === 'C3DC_MicMac.ply')?.usable, false)

// --- Nur GLB: jetzt ein ladbarer Kandidat ---------------------------------
const onlyGlb = detectScanFolder([{ path: 'scan.glb', size: 4_000_000 }])
assert.equal(onlyGlb.candidates.length, 1)
assert.equal(onlyGlb.candidates[0].format, 'glb')
assert.equal(onlyGlb.candidates[0].usable, true)
assert.match(onlyGlb.candidates[0].note, /Texturen/)
assert.equal(
  onlyGlb.warnings.some((warning) => /kann GLB nicht laden/.test(warning)),
  false,
  'die alte GLB-Warnung ist weg',
)

// --- Echte job.json des MeshScan-Servers (C:\meshscan3D\data\jobs\66b7844efaf4)
const realJobJson = `{
  "id": "66b7844efaf4",
  "name": "Scan 19.11.2026, 10:24:39",
  "status": "created",
  "progress": 0,
  "photo_count": 0,
  "log": ["Scan angelegt \u2013 warte auf Fotos"],
  "mesh_size_bytes": null,
  "vertex_count": null,
  "face_count": null,
  "error": null,
  "created_at": "2026-11-19T09:24:42.714109+00:00",
  "updated_at": "2026-11-19T09:24:42.715284+00:00"
}`
const job = parseScanJob(realJobJson)
assert.equal(job?.id, '66b7844efaf4')
assert.equal(job?.name, 'Scan 19.11.2026, 10:24:39')
assert.equal(job?.status, 'created')
assert.equal(job?.statusLabel, 'angelegt — wartet auf Fotos')
assert.equal(job?.photos, 0)
assert.equal(job?.meshBytes, null)
assert.equal(parseScanJob('kein json'), null)
assert.equal(parseScanJob('[]'), null)
assert.equal(parseScanJob('{"foo":1}'), null)
assert.equal(parseScanJob('{"status":"ready","mesh_size_bytes":31457280}')?.statusLabel, 'fertig')

// --- Fertiger Meshroom-Job: mesh.glb für die App, OBJ für den Slicer --------
const meshroomJob = detectScanFolder(
  [
    { path: 'job.json' },
    { path: 'mesh.glb', size: 31_457_280 },
    { path: 'photos/IMG_0001.jpg' },
    { path: 'meshroom/MeshroomCache/StructureFromMotion_aa/sfm.json' },
    { path: 'meshroom/MeshroomCache/Meshing_cc/mesh.obj' },
    { path: 'meshroom/MeshroomCache/Texturing_bb/texturedMesh.obj', size: 24_000_000 },
    { path: 'meshroom/MeshroomCache/Texturing_bb/texture_1001.png' },
  ],
  [
    { path: 'meshroom/MeshroomCache/StructureFromMotion_aa/sfm.json', text: '{"views":[{"poseId":"0"},{"poseId":"1"}]}' },
    { path: 'meshroom/MeshroomCache/Texturing_bb/texturedMesh.obj', text: 'mtllib texturedMesh.mtl\nv 0 0 0\nf 1 2 3\n' },
  ],
)
assert.equal(meshroomJob.engine, 'meshroom', 'Job-Ordner wird trotz mesh.glb als Meshroom erkannt')
assert.equal(meshroomJob.candidates[0].file, 'mesh.glb', 'im fertigen Job steht die App-Ausgabe vorne')
assert.equal(meshroomJob.candidates[0].format, 'glb')
assert.equal(meshroomJob.candidates[0].usable, true, 'GLB ist ladbar')
assert.equal(
  meshroomJob.candidates.some((entry) => entry.file === 'texturedMesh.obj' && entry.usable),
  true,
  'das texturierte Engine-Netz bleibt als Alternative in der Liste',
)

// --- Fertiger COLMAP-Job ---------------------------------------------------
const colmapJob = detectScanFolder(
  [
    { path: 'job.json' },
    { path: 'mesh.glb', size: 28_000_000 },
    { path: 'colmap/sparse/0/cameras.txt' },
    { path: 'colmap/sparse/0/images.txt' },
    { path: 'colmap/dense/fused.ply' },
    { path: 'colmap/dense/meshed-poisson.ply' },
  ],
  [
    { path: 'colmap/sparse/0/images.txt', text: colmapImages },
    { path: 'colmap/dense/fused.ply', text: 'ply\nformat binary_little_endian 1.0\nelement vertex 800000\nend_header\n' },
    {
      path: 'colmap/dense/meshed-poisson.ply',
      text: 'ply\nformat binary_little_endian 1.0\nelement vertex 50000\nelement face 100000\nend_header\n',
    },
  ],
)
assert.equal(colmapJob.engine, 'colmap')
assert.equal(colmapJob.candidates[0].file, 'mesh.glb', 'die fertige App-Ausgabe steht vorne')
assert.equal(colmapJob.candidates[0].format, 'glb')
assert.equal(
  colmapJob.candidates.some((entry) => entry.file === 'meshed-poisson.ply' && entry.usable),
  true,
  'das Poisson-Netz bleibt als Alternative in der Liste',
)

// --- Randfälle: GLB-Kopf, Textur-Nachbar, Job-Status -----------------------
assert.equal(glbRole('glTF\u0002\u0000\u0000\u0000'), 'Netz')
assert.equal(glbRole('ply\nformat ascii 1.0'), 'unbekannt')

const brokenGlb = detectScanFolder(
  [{ path: 'scan.glb', size: 4096 }],
  [{ path: 'scan.glb', text: 'ply\nformat ascii 1.0' }],
)
assert.equal(brokenGlb.candidates[0].role, 'unbekannt')
assert.match(brokenGlb.candidates[0].note, /Dateikopf passt nicht/, 'falscher GLB-Kopf wird benannt')

const goodGlb = detectScanFolder(
  [{ path: 'scan.glb', size: 4096 }],
  [{ path: 'scan.glb', text: 'glTF\u0002\u0000\u0000\u0000' }],
)
assert.equal(goodGlb.candidates[0].role, 'Netz')

// Textur neben dem Netz: <name>_texture.png zählt, fremde Texturen nicht.
const objHead = [{ path: 'scan.obj', text: ['v 0 0 0', 'f 1 2 3', ''].join(String.fromCharCode(10)) }]
const ownedTexture = detectScanFolder(
  [{ path: 'scan.obj' }, { path: 'scan_texture.png' }],
  objHead,
)
assert.equal(ownedTexture.candidates[0].role, 'Netz mit Textur')
const foreignTexture = detectScanFolder(
  [{ path: 'scan.obj' }, { path: 'andere_texture.png' }],
  objHead,
)
assert.equal(foreignTexture.candidates[0].role, 'Netz')

// mesh.glb außerhalb eines Jobs bleibt der beste Kandidat, wenn der Kopf passt.
const appMeshAlone = detectScanFolder(
  [
    { path: 'export/model.stl', size: 1000 },
    { path: 'mesh.glb', size: 1000 },
  ],
  [{ path: 'mesh.glb', text: 'glTF' + String.fromCharCode(2) }],
)
assert.equal(appMeshAlone.candidates[0].file, 'mesh.glb')

// Job-Status: unbekannter Status wird benannt statt englisch durchgereicht.
const oddJob = parseScanJob('{"status":" Queued ","photo_count":3}')
assert.equal(oddJob?.status, 'queued', 'Status wird vereinheitlicht')
assert.equal(oddJob?.statusLabel, 'unbekannter Status „queued“')

// Fertiger Job ohne ladbares Netz: eine Meldung, die den Job nennt.
const finishedJob = parseScanJob('{"status":"ready","photo_count":24,"mesh_size_bytes":31457280}')!
const emptyFinished = detectScanFolder([{ path: 'job.json' }, { path: 'photos/a.jpg' }], [], finishedJob)
assert.equal(emptyFinished.warnings.length, 1, 'keine allgemeine Warnung neben der Job-Warnung')
assert.match(emptyFinished.warnings[0], /meldet fertig/)
assert.equal(emptyFinished.warnings.some((warning) => /Herkunft nicht erkannt/.test(warning)), false)

// Laufender Job: nur der Job-Hinweis.
const runningJob = parseScanJob('{"status":"processing","photo_count":3}')!
const running = detectScanFolder([{ path: 'job.json' }], [], runningJob)
assert.equal(running.warnings.length, 1)
assert.match(running.warnings[0], /nicht fertig \(rechnet gerade\)/)

// Job mit mesh.glb: keine Textur-Warnung, das GLB bringt seine Farben selbst mit.
const glbJob = detectScanFolder(
  [{ path: 'job.json' }, { path: 'mesh.glb', size: 4096 }],
  [{ path: 'mesh.glb', text: 'glTF\u0002\u0000\u0000\u0000' }],
  finishedJob,
)
assert.equal(glbJob.warnings.length, 0, 'fertiger Job mit GLB ist ohne Warnung')

// --- Absoluter Pfad kommt vom Server, nicht aus der Oberfläche -------------
// Eigener Ordner mit Leerzeichen und Umlaut: genau da bricht eine eigene
// Verkettung in der Oberfläche gern.
const tmpRoot = mkdtempSync(join(tmpdir(), 'easy-slicer-scan-'))
const workDir = join(tmpRoot, 'Scan Bäume', 'colmap')
mkdirSync(join(workDir, 'sparse', '0'), { recursive: true })
mkdirSync(join(workDir, 'dense'), { recursive: true })
mkdirSync(join(workDir, 'images'), { recursive: true })
writeFileSync(join(workDir, 'sparse', '0', 'images.txt'), colmapImages)
writeFileSync(join(workDir, 'sparse', '0', 'cameras.txt'), '1 PINHOLE 1920 1080 1500 1500 960 540\n')
const meshText =
  'ply\nformat ascii 1.0\nelement vertex 4\nproperty float x\nproperty float y\nproperty float z\n' +
  'element face 4\nproperty list uchar int vertex_indices\nend_header\n' +
  '0 0 0\n10 0 0\n0 10 0\n0 0 10\n3 0 2 1\n3 0 1 3\n3 1 2 3\n3 2 0 3\n'
writeFileSync(join(workDir, 'dense', 'meshed-poisson.ply'), meshText)
writeFileSync(join(workDir, 'dense', 'fused.ply'), 'ply\nformat ascii 1.0\nelement vertex 2\nend_header\n0 0 0\n1 1 1\n')

const inspection = inspectScanFolder(workDir)
assert.equal(inspection.report.engine, 'colmap')
assert.equal(inspection.report.images?.count, 3, 'Bilder werden auch aus dem echten Ordner gezählt')
assert.ok(inspection.report.candidates.length >= 2, 'beide PLY-Dateien tauchen auf')
for (const candidate of inspection.report.candidates) {
  assert.equal(isAbsolute(candidate.absolutePath), true, `${candidate.path} braucht einen absoluten Pfad`)
  assert.equal(candidate.absolutePath, join(workDir, candidate.path), 'Serverpfad = Wurzel + relativer Pfad')
  assert.equal(candidate.absolutePath.includes('Scan Bäume'), true, 'Leerzeichen und Umlaut bleiben erhalten')
  assert.equal(statSync(candidate.absolutePath).isFile(), true, 'der Pfad zeigt auf eine echte Datei')
}
const loadable = inspection.report.candidates.find((candidate) => candidate.usable)
assert.ok(loadable, 'mindestens ein ladbares Netz')
assert.equal(loadable.file, 'meshed-poisson.ply')
const loadedFile = readScanMeshFile(loadable.absolutePath)
assert.equal(loadedFile.name, 'meshed-poisson.ply')
assert.equal(loadedFile.buffer.toString('utf8'), meshText, 'der übergebene Pfad liefert genau diese Datei')
// --- Echter Job-Ordner: job.json erklärt den Ordner, mesh.glb ist ladbar ----
const jobDir = join(tmpRoot, 'jobs', 'glbtest')
mkdirSync(join(jobDir, 'photos'), { recursive: true })
writeFileSync(
  join(jobDir, 'job.json'),
  '{"id":"glbtest","status":"ready","photo_count":24,"mesh_size_bytes":420}',
)
const glbBytes = Buffer.concat([Buffer.from('glTF', 'utf8'), Buffer.alloc(24, 0x2a)])
writeFileSync(join(jobDir, 'mesh.glb'), glbBytes)

const jobInspect = inspectScanFolder(jobDir)
assert.equal(jobInspect.job?.id, 'glbtest')
assert.equal(jobInspect.job?.statusLabel, 'fertig')
assert.equal(jobInspect.report.engine, 'unknown')
assert.equal(jobInspect.report.candidates[0].file, 'mesh.glb')
assert.equal(jobInspect.report.candidates[0].absolutePath, join(jobDir, 'mesh.glb'))
assert.equal(jobInspect.report.warnings.length, 0, 'kein „Herkunft nicht erkannt“ bei job.json')
assert.equal(readScanMeshFile(jobInspect.report.candidates[0].absolutePath).buffer.equals(glbBytes), true)

// --- Eine tief vergrabene job.json wird nicht als Herkunft übernommen ------
const deepDir = join(tmpRoot, 'deep')
mkdirSync(join(deepDir, 'a', 'b'), { recursive: true })
writeFileSync(join(deepDir, 'a', 'b', 'job.json'), '{"status":"ready"}')
assert.equal(inspectScanFolder(deepDir).job, null, 'nur der Ordner selbst oder eine Ebene darüber')

rmSync(tmpRoot, { recursive: true, force: true })
