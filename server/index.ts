import express from 'express'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { existsSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { isSea } from 'node:sea'
import { embeddedAssetHandler } from './sea.ts'
import type {
  CalibrationOptions,
  CustomGcode,
  FilamentSlot,
  GcodeFlavor,
  ModelAnalysis,
  PostProcessingScript,
  PreviewFeatureKind,
  PrintSettings,
  PrinterOverrides,
  PrinterStatus,
  SliceResult,
  TextPart,
} from '../shared/types.ts'
import { applyPrinterOverrides, describeSettingsOverrides } from '../shared/types.ts'
import {
  featureRows,
  gcodeLineBreaks,
  gcodeLineOffsetBefore,
  planSliceBands,
  shiftPreviewLines,
} from './slicer/index.ts'
import { DEFAULT_SETTINGS, machineOffset, mergeSettings, plateOffsetX } from '../shared/types.ts'
import { FEATURES } from '../shared/release.ts'
import { adaptImportedObjectSettings, applyPrinterLimits, effectivePrinterLimits, type PrinterLimits } from '../shared/limits.ts'
import { isGcodeFlavor, isKlipperFlavor } from '../shared/gcode-flavors.ts'
import { analyzeGcode, convertGcode } from '../shared/gcode-import.ts'
import { describeSequentialPlan, planSequentialOrder } from '../shared/sequential.ts'
import { filamentChangeGcode, normalizeMultiMaterial, planPurgeLine } from '../shared/multiMaterial.ts'
import { planPurgeTowers, purgeTowerPatch, type PurgeTowerPlan } from '../shared/purgeTower.ts'
import { assembleLayerwise, splitGcodeSections } from './multicolor.ts'
import { runPostProcessing } from './postprocess.ts'
import { FILAMENTS, NOZZLE_SIZES, PLATES, PRINTERS, customPrinterProfile, filamentById, plateById, printerById } from '../shared/catalog.ts'
import { listPorts, type ConnectOptions } from './printer/manager.ts'
import { PrinterHub } from './printer/hub.ts'
import { PrintJobQueue } from './printer/jobs.ts'
import { scanDevices } from './printer/detect.ts'
import { discoverMoonraker } from './printer/discoverMoonraker.ts'
import { inspectWebUi } from './webui.ts'
import { initFileLog, logPath } from './applog.ts'
import { ensureSerialBinding } from './sea.ts'
import { deleteCustomPrinter, listCustomPrinters, loadCustomPrinters, saveCustomPrinter } from './customPrinters.ts'
import { mergeUserStore, readUserStore, userStorePath } from './userStore.ts'
import { inspectScanFolder, readScanMeshFile } from './scanFolder.ts'
import {
  cancelScanJob,
  createScanJob,
  fetchScanJobMesh,
  scanJobStatus,
  scanServerInfo,
  ScanServerError,
  startScanProcessing,
  uploadScanFile,
} from './scanJobs.ts'
import { SCAN_GENERATOR_LABEL, scanMeshFileName, type ScanGeneratorId } from '../shared/scanJobs.ts'

// Muss vor dem ersten Zugriff auf serialport laufen: entpackt in der EXE das
// native Binding aus den SEA-Assets.
ensureSerialBinding()
// Die Windows-EXE läuft ohne Konsolenfenster — Meldungen zusätzlich in eine Datei.
const logFile = initFileLog()
// Eigene Drucker aus dem Datenordner in den Katalog übernehmen.
loadCustomPrinters()
// V-15: CSG-WASM im Hintergrund vorladen, damit der erste Schnitt nicht auf
// die Initialisierung wartet. Fehler dürfen den Serverstart nicht blockieren.
void loadManifold().catch((err) =>
  console.warn('[csg] manifold konnte nicht vorgeladen werden:', err instanceof Error ? err.message : err),
)
import { makeMesh, parseSTL, transformMesh, type Mesh } from './slicer/stl.ts'
import { withGcodeMetadata, type GcodeFilamentMetadata, type LayerOverride } from './slicer/gcode.ts'
import { analyzeMesh } from './analyze.ts'
import { sliceMesh } from './slicer/index.ts'
import { demoSTL } from './demo.ts'
import { buildCalibration } from './calibration.ts'
import { footprintOnBed, areaSize } from './footprint.ts'
import { parseModelFile, build3MF, meshToBinarySTL } from './formats.ts'
import {
  composeObjects,
  defaultPlacement,
  describeObjects,
  keepBedHeight,
  placeMesh,
  type ModelObject,
} from './objects.ts'
import {
  arrangeObjects,
  autoOrient,
  buildTextMesh,
  centerOnBed,
  cutIntoPieces,
  cutMesh,
  dropToBed,
  duplicateObject,
  lithophaneMesh,
  mergeMeshes,
  newObject,
  packParts,
  rescaleFactor,
  scaleMesh,
  type ToolAction,
} from './edit.ts'
import {
  countComponents,
  countOpenEdges,
  fillHoles,
  hollowSolid,
  loadManifold,
  meshComponents,
  orientMesh,
  repairMesh,
  suggestSeam,
  splitSolid,
  unionMeshes,
  unionOverlappingComponents,
} from './csg.ts'
import { planHollow } from '../shared/scanPrep.ts'
import { clearHistory, historyFor } from './history.ts'
import { meshJobWarning } from '../shared/meshTrend.ts'
import { openAppWindow } from './desktop.ts'
import { clearMesh, loadMesh, saveMesh } from './meshStore.ts'

// Number('') ist 0 — eine leere PORT-Variable darf nicht Port 0 (zufällig)
// bedeuten, sonst öffnet die EXE den Browser auf 127.0.0.1:0.
const PORT = Math.round(Number(process.env.PORT)) || 8787

const app = express()

/**
 * Der Slicer ist eine lokale Desktop-Anwendung. API und WebSocket dürfen
 * deshalb ausschließlich über Loopback erreichbar sein. Zusätzlich werden
 * Host und Origin geprüft: Das blockiert DNS-Rebinding und Cross-Site-
 * Anfragen aus einem fremden Browser-Tab, auch wenn der Server lokal läuft.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

function hostnameFromHeader(header: string | undefined): string {
  if (!header) return ''
  const value = header.trim().toLowerCase()
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    return end > 0 ? value.slice(1, end) : ''
  }
  return value.split(':')[0]
}

function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function isAllowedHost(hostHeader: string | undefined): boolean {
  return LOOPBACK_HOSTS.has(hostnameFromHeader(hostHeader))
}

function isAllowedOrigin(origin: string | undefined, localPort: number | undefined): boolean {
  // Lokale Werkzeuge und Tests senden keinen Origin-Header.
  if (!origin) return true
  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:') return false
    if (!LOOPBACK_HOSTS.has(url.hostname) && url.hostname !== '[::1]') return false
    const port = url.port ? Number(url.port) : 80
    // 3000 ist der feste Vite-Entwicklungsport; im Betrieb ist es der eigene.
    return port === 3000 || port === localPort
  } catch {
    return false
  }
}

app.use('/api', (req, res, next) => {
  if (!isLoopbackAddress(req.socket.remoteAddress) || !isAllowedHost(req.headers.host)) {
    res.status(403).json({ error: 'Zugriff nur vom lokalen Rechner erlaubt.' })
    return
  }
  if (!isAllowedOrigin(req.headers.origin, req.socket.localPort)) {
    res.status(403).json({ error: 'Anfrage von einer fremden Seite blockiert.' })
    return
  }
  next()
})

// Normale JSON-Anfragen bleiben klein (16 MB). Die beiden Druck-Routen
// transportieren aber den kompletten G-Code (bei großen Modellen > 20 MB)
// zusammen mit ihren Metadaten; für sie gilt ein eigenes, höheres Limit.
const jsonSmall = express.json({ limit: '16mb' })
const jsonGcode = express.json({ limit: '200mb' })
const GCODE_JSON_ROUTES = new Set(['/api/printer/upload', '/api/printer/print', '/api/jobs'])
app.use((req, res, next) => {
  if (GCODE_JSON_ROUTES.has(req.path)) return next()
  return jsonSmall(req, res, next)
})

// G-Code-Dateien können deutlich größer als JSON-Modelle sein. Der Text wird
// roh übertragen und erst in der Route analysiert; so entsteht kein doppelter
// JSON-Overhead.
const gcodeBody = express.text({
  type: ['text/plain', 'application/octet-stream'],
  limit: '200mb',
})

type StoredModel = {
  id: string
  name: string
  mesh: Mesh
  objects: ModelObject[]
  analysis: ModelAnalysis
  stl: Buffer
  /** Zählt hoch, sobald sich die Geometrie (nicht die Zuordnung) ändert. */
  revision: number
  /** Fingerabdruck der zuletzt gebauten Geometrie — siehe commitModel. */
  geometrySignature: string
  overrides: LayerOverride[]
  /** V-16: letzter Zugriff für die Freigabe alter Modelle */
  lastAccess?: number
}
const models = new Map<string, StoredModel>()

/** Ohne Zugriff verfallen Modelle nach zwei Stunden; der Verlauf verschwindet mit. */
const MODEL_TTL_MS = 2 * 60 * 60 * 1000

// ---------- Rückgängig / Vorwärts ----------

type Snapshot = { objects: StoredModel['objects']; analysis: StoredModel['analysis']; label?: string }
type History = { states: Snapshot[]; index: number }
const history = new Map<string, History>()

// Erst nach dem Verlauf deklariert: der Timer greift auf beide Maps zu.
setInterval(() => {
  const now = Date.now()
  for (const [id, model] of models) {
    if (now - (model.lastAccess ?? now) <= MODEL_TTL_MS) continue
    models.delete(id)
    history.delete(id)
  }
}, 10 * 60 * 1000).unref()

function snapshotOf(model: StoredModel): Snapshot {
  return {
    objects: model.objects.map((o) => ({ ...o, placement: { ...o.placement } })),
    analysis: model.analysis,
  }
}

/** Klartext für den Verlauf: „Teilen rückgängig“ statt nur ein Pfeil. */
function historyLabel(sub: string, body: unknown): string {
  const data = (body ?? {}) as Record<string, unknown>
  if (sub === '/split') return 'Teilen'
  if (sub === '/cut') return 'Zuschneiden'
  if (sub === '/text') return 'Text aufbringen'
  if (sub === '/paint') return 'Stützmarkierung'
  if (sub === '/objects/import') return 'Objekt hinzufügen'
  if (sub === '/objects') return 'Objekt ändern'
  if (sub === '/rescale') return 'Maßstab'
  if (sub === '/scan') return 'Scan aushöhlen'
  if (sub === '/tools') {
    const tool = String(data.tool ?? '')
    const names: Record<string, string> = {
      duplicate: 'Duplizieren',
      delete: 'Löschen',
      clear: 'Platte leeren',
      merge: 'Zusammenbauen',
      arrange: 'Anordnen',
      orient: 'Ausrichten',
      center: 'Zentrieren',
      bed: 'Auf Platte legen',
      repair: 'Mesh reparieren',
      removeplate: 'Platte löschen',
    }
    return names[tool] ?? 'Objektwerkzeug'
  }
  return 'Objekt ändern'
}

// Jeder Zugriff hält ein Modell am Leben, auch während eines laufenden Schnitts.
app.use('/api/models/:id', (req, _res, next) => {
  const model = models.get(req.params.id)
  if (model) model.lastAccess = Date.now()
  next()
})

function restoreSnapshot(model: StoredModel, state: Snapshot): boolean {
  model.objects = state.objects.map((o) => ({ ...o, placement: { ...o.placement } }))
  return commitModel(model)
}

/**
 * Kurzsignatur eines Zustands. Anfragen ohne echte Änderung (z. B. „dünnste
 * Stelle suchen“ oder ein Vorschau-Update) dürfen keinen Verlaufseintrag
 * anlegen — sonst macht „Rückgängig“ scheinbar nichts. Die Netz-Identität
 * gehört dazu: Ein Maßstab (Faktor 500) ändert weder Dreieckszahl noch Länge
 * der Positionsliste, aber sehr wohl die Geometrie.
 */
function stateSignature(state: Snapshot): string {
  return state.objects
    .map(
      (o) =>
        `${o.id}:${o.placement.visible ? 1 : 0}:${o.placement.offsetX},${o.placement.offsetY},${o.placement.offsetZ}:` +
        `${o.placement.rotationX},${o.placement.rotationY},${o.placement.rotationZ}:` +
        `${o.placement.scaleX},${o.placement.scaleY},${o.placement.scaleZ}:${o.mesh.triangles}:${o.mesh.positions.length}:${meshId(o.mesh)}`,
    )
    .join('|')
}

/**
 * Merkt sich vor jedem ändernden Aufruf den Zustand davor und danach.
 * So gilt Rückgängig für alle Werkzeuge — Teilen, Löschen, Anordnen, Text.
 */
app.use((req, res, next) => {
  if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH' && req.method !== 'DELETE') {
    next()
    return
  }
  const match = /^\/api\/models\/([^/]+)(\/.*)?$/.exec(req.path)
  if (!match) {
    next()
    return
  }
  const id = match[1]
  const sub = match[2] ?? ''
  if (sub === '/undo' || sub === '/redo') {
    next()
    return
  }
  const model = models.get(id)
  if (!model) {
    next()
    return
  }
  const before = snapshotOf(model)
  res.on('finish', () => {
    if (res.statusCode >= 400) return
    const after = { ...snapshotOf(model), label: historyLabel(sub, req.body) }
    if (stateSignature(before) === stateSignature(after)) return
    const entry = history.get(id) ?? { states: [before], index: 0 }
    entry.states = entry.states.slice(0, entry.index + 1)
    entry.states.push(after)
    entry.index = entry.states.length - 1
    if (entry.states.length > 40) {
      entry.states.shift()
      entry.index--
    }
    history.set(id, entry)
  })
  next()
})

let observePrintJob: ((printerId: string, status: PrinterStatus) => void) | null = null
const hub: PrinterHub = new PrinterHub({
  defaultId: 'anycubic-vyper',
  onCreate: (printerId, manager) => {
    manager.on('status', (status) => {
      broadcast({ type: 'status', printerId, status })
      observePrintJob?.(printerId, status)
    })
    manager.on('log', (line) => broadcast({ type: 'log', printerId, line }))
    manager.on('mesh', (mesh) => broadcast({ type: 'mesh', printerId, mesh }))
    manager.on('probe-progress', (p) => broadcast({ type: 'probe', printerId, ...p }))
  },
})
// Den Standarddrucker sofort anlegen, damit die Verbindung im Hintergrund läuft.
hub.ensure('anycubic-vyper')
const server = createServer(app)
const wss = new WebSocketServer({
  server,
  path: '/ws',
  verifyClient: (info, done) => {
    const req = info.req
    const allowed =
      isLoopbackAddress(req.socket.remoteAddress) &&
      isAllowedHost(req.headers.host) &&
      (!info.origin || isAllowedOrigin(info.origin, req.socket.localPort))
    done(allowed, allowed ? undefined : 403, allowed ? undefined : 'Forbidden')
  },
})

function broadcast(msg: unknown) {
  const data = JSON.stringify(msg)
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(data)
  }
}

// Die Warteschlange lebt im Server, damit sie einen Ansichtswechsel übersteht.
// Gestartet wird nur, was zuvor im Multiprint-Tab ausdrücklich bestätigt wurde.
const jobQueue = new PrintJobQueue(hub, () => broadcast({ type: 'jobs', jobs: jobQueue.list() }))
observePrintJob = (printerId, status) => jobQueue.observe(printerId, status)
// Gespeicherte, wartende Aufträge bleiben nach einem Neustart erhalten. Sie
// starten erst, wenn ihr Drucker wieder verbunden und frei ist.
jobQueue.resumeAll()

wss.on('connection', (socket) => {
  const selected = hub.selected
  socket.send(
    JSON.stringify({
      type: 'init',
      printerId: hub.selectedId,
      status: selected.status,
      mesh: selected.mesh,
      log: selected.log.slice(-120),
      printers: hub.snapshot(),
      jobs: jobQueue.list(),
    }),
  )
})

app.get('/api/health', (_req, res) => {
  // Die Kennung erlaubt einer neuen Instanz, eine alte sauber zu beenden.
  res.json({ ok: true, app: 'easy-slicer', pid: process.pid, models: models.size })
})

// ---------- G-Code-Import ----------

function queryNumber(value: unknown): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  const number = Number(raw)
  return Number.isFinite(number) && number > 0 ? number : undefined
}

app.post('/api/gcode/analyze', gcodeBody, (req, res) => {
  const text = typeof req.body === 'string' ? req.body : ''
  if (!text.trim()) {
    res.status(400).json({ error: 'Die G-Code-Datei ist leer.' })
    return
  }
  try {
    const bedX = queryNumber(req.query.bedX)
    const bedY = queryNumber(req.query.bedY)
    const bedZ = queryNumber(req.query.bedZ)
    const bed =
      bedX !== undefined && bedY !== undefined && bedZ !== undefined
        ? {
            x: bedX,
            y: bedY,
            z: bedZ,
            origin: req.query.origin === 'center' ? ('center' as const) : ('corner' as const),
          }
        : undefined
    res.json(analyzeGcode(text, bed))
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'G-Code konnte nicht analysiert werden.' })
  }
})

app.post('/api/gcode/convert', gcodeBody, (req, res) => {
  const text = typeof req.body === 'string' ? req.body : ''
  const target = String(req.query.to ?? '')
  if (!text.trim()) {
    res.status(400).json({ error: 'Die G-Code-Datei ist leer.' })
    return
  }
  if (!isGcodeFlavor(target)) {
    res.status(400).json({ error: 'Unbekanntes Zielformat.' })
    return
  }
  try {
    res.json(convertGcode(text, target))
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'G-Code konnte nicht konvertiert werden.' })
  }
})

// ---------- Katalog ----------

/** Letzte Logzeilen für die Ansicht in der App (die EXE hat kein Konsolenfenster). */
app.get('/api/logs', (_req, res) => {
  const file = logPath()
  if (!file) {
    res.json({ path: null, text: '' })
    return
  }
  try {
    const lines = readFileSync(file, 'utf8').split('\n')
    res.json({ path: file, text: lines.slice(-400).join('\n') })
  } catch {
    res.json({ path: file, text: '' })
  }
})

/** Beendet das Programm — nötig, weil die Windows-EXE kein Konsolenfenster mehr hat. */
app.post('/api/app/quit', (_req, res) => {
  res.json({ ok: true })
  shutdown()
})

app.post('/api/printers/custom', (req, res) => {
  const body = req.body as { id?: string; name?: string; bed?: { x?: number; y?: number; z?: number }; baud?: number; control?: 'marlin-serial' | 'klipper-moonraker' | 'manual'; hasBedLeveling?: boolean }
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'Profil fehlt.' })
    return
  }
  const profile = saveCustomPrinter(
    customPrinterProfile({
      id: body.id,
      name: body.name ?? '',
      bed: { x: Number(body.bed?.x), y: Number(body.bed?.y), z: Number(body.bed?.z) },
      baud: Number.isFinite(Number(body.baud)) ? Number(body.baud) : 0,
      control: body.control,
      hasBedLeveling: !!body.hasBedLeveling,
    }),
  )
  res.json({ printer: profile })
})

app.delete('/api/printers/custom/:id', (req, res) => {
  const ok = deleteCustomPrinter(String(req.params.id))
  if (!ok) {
    res.status(404).json({ error: 'Drucker nicht gefunden.' })
    return
  }
  res.json({ ok: true })
})

app.get('/api/catalog', (_req, res) => {
  res.json({
    printers: [...PRINTERS, ...listCustomPrinters()],
    filaments: FILAMENTS,
    plates: PLATES,
    nozzles: NOZZLE_SIZES,
    defaults: DEFAULT_SETTINGS,
  })
})

app.get('/api/profiles', (_req, res) => {
  res.json({ profiles: PRINTERS, defaults: DEFAULT_SETTINGS })
})

// ---------- Profilstand ----------

/**
 * Eigene Profile und Einstellungen als Datei im Datenordner. Die Oberfläche
 * liest sie vor dem ersten Rendern ein — dadurch bleiben Profile erhalten,
 * auch wenn ein neuer Build auf einem anderen Port startet.
 */
app.get('/api/user-store', (_req, res) => {
  res.json({ ...readUserStore(), file: userStorePath() })
})

app.post('/api/user-store', (req, res) => {
  const body = req.body as { entries?: unknown } | undefined
  if (!body || typeof body !== 'object' || !Array.isArray(body.entries)) {
    res.status(400).json({ error: 'entries fehlt.' })
    return
  }
  res.json({ ok: true, entries: mergeUserStore(body.entries).entries })
})

// ---------- Modelle ----------

/**
 * 3MF mit mehreren Platten: jede Platte bekommt einen eigenen Bettplatz
 * nebeneinander, die Objekte einer Platte bleiben in ihrer Lage zueinander.
 */
function layoutPlates(objects: ModelObject[], bed: { x: number; y: number }): void {
  const groups = new Map<number, { minX: number; maxX: number; minY: number; maxY: number; minZ: number }>()
  for (const object of objects) {
    const box = placeMesh(object.mesh, object.placement).bbox
    const plate = object.plate ?? 0
    const group = groups.get(plate)
    if (!group) {
      groups.set(plate, { minX: box.min.x, maxX: box.max.x, minY: box.min.y, maxY: box.max.y, minZ: box.min.z })
      continue
    }
    group.minX = Math.min(group.minX, box.min.x)
    group.maxX = Math.max(group.maxX, box.max.x)
    group.minY = Math.min(group.minY, box.min.y)
    group.maxY = Math.max(group.maxY, box.max.y)
    group.minZ = Math.min(group.minZ, box.min.z)
  }

  for (const object of objects) {
    const group = groups.get(object.plate ?? 0)
    if (!group) continue
    object.placement.offsetX +=
      plateOffsetX(object.plate ?? 0, bed.x) + bed.x / 2 - (group.minX + group.maxX) / 2
    object.placement.offsetY += bed.y / 2 - (group.minY + group.maxY) / 2
    object.placement.offsetZ += -group.minZ
  }
}

app.post('/api/models', express.raw({ type: () => true, limit: '150mb' }), (req, res) => {
  const body = req.body as Buffer
  if (!Buffer.isBuffer(body) || body.length < 16) {
    res.status(400).json({ error: 'Keine Modelldaten empfangen.' })
    return
  }
  try {
    const name = String(req.query.name ?? 'modell.stl').slice(0, 120)
    const parsed = parseModelFile(body, name)
    const objects = parsed.objects
    // Objektwerte aus einer 3MF gelten beim Slicen nach den Projektwerten.
    // Deshalb müssen auch sie an die aktive Düse und das aktive Filament
    // angepasst werden, sonst überschreibt z. B. eine objektindividuelle
    // 0,6-mm-Linienbreite die Umrechnung auf 0,4 mm wieder.
    const importPrinter = printerById(String(req.query.printerId ?? ''))
    const requestedNozzle = Number(req.query.nozzle)
    const activeNozzle = Number.isFinite(requestedNozzle) && requestedNozzle > 0
      ? requestedNozzle
      : importPrinter.nozzle
    const requestedMaxFlow = Number(req.query.maxFlow)
    const activeMaxFlow = Number.isFinite(requestedMaxFlow) && requestedMaxFlow > 0
      ? requestedMaxFlow
      : undefined
    for (const object of objects) {
      if (!object.settings) continue
      object.settings = adaptImportedObjectSettings(object.settings, {
        activeNozzle,
        sourceNozzle: object.settings.nozzle ?? parsed.settings?.nozzle,
        maxVolumetricFlow: activeMaxFlow,
      })
      const prefix = `3MF: „${object.name}“ bringt eigene Objektwerte mit (`
      const warningIndex = parsed.warnings.findIndex((warning) => warning.startsWith(prefix))
      if (warningIndex >= 0) {
        parsed.warnings[warningIndex] =
          `${prefix}${describeSettingsOverrides(object.settings)}) — sie gelten nur für dieses Objekt.`
      }
    }
    // V-13: Schon beim Import prüfen, reparieren und melden, was das Netz
    // gekostet hätte. Nur übernehmen, wenn es dadurch wirklich geschlossener wird.
    let removed = 0
    let openBefore = 0
    let openAfter = 0
    let applied = false
    for (const object of objects) {
      const before = countOpenEdges(object.mesh)
      openBefore += before
      // Geschlossene Netze kann die Reparatur nicht verbessern — das Ergebnis
      // würde ohnehin verworfen. Übersprungen spart das je Objekt vier weitere
      // volle Netz-Durchläufe und war bei vielen Teilen der Großteil der
      // Ladezeit einer 3MF. Ein geschlossenes Netz trägt zu `openAfter` 0 bei.
      if (!before) continue
      const fixed = orientMesh(fillHoles(repairMesh(object.mesh)))
      const after = countOpenEdges(fixed)
      openAfter += after
      removed += Math.max(0, object.mesh.triangles - fixed.triangles)
      if (after < before) {
        object.mesh = fixed
        applied = true
      }
    }
    if (parsed.plates > 1) layoutPlates(objects, printerById(String(req.query.printerId ?? '')).bed)
    // Ohne Reparatur und ohne Plattenverschiebung ist `parsed.mesh` bereits
    // genau die Zusammenfassung dieser Objekte — kein zweiter Durchlauf nötig.
    const mesh = applied || parsed.plates > 1 ? (composeObjects(objects) ?? parsed.mesh) : parsed.mesh
    const analysis = analyzeMesh(mesh, name)
    const id = randomUUID()
    models.set(id, {
      id,
      name,
      mesh,
      objects,
      analysis,
      // Nur ein unverändertes Einzelplatten-STL darf durchgereicht werden;
      // sonst (Reparatur, Plattenverschiebung, 3MF) neu aus `mesh` schreiben.
      stl: parsed.binary && !applied && parsed.plates === 1 ? parsed.binary : meshToBinarySTL(mesh),
      revision: 0,
      geometrySignature: geometrySignatureOf(objects),
      overrides: [],
      lastAccess: Date.now(),
    })
    res.json({
      id,
      analysis,
      objects: describeObjects(objects),
      bytes: body.length,
      format: parsed.format,
      settings: parsed.settings,
      warnings: parsed.warnings,
      printerHint: parsed.printerHint,
      filamentHint: parsed.filamentHint,
      plates: parsed.plates,
      repair: { removed, openBefore, openAfter, applied },
    })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Modell konnte nicht gelesen werden.' })
  }
})

app.get('/api/models/:id/stl', (req, res) => {
  const model = models.get(req.params.id)
  if (!model) {
    res.status(404).json({ error: 'Modell nicht gefunden.' })
    return
  }
  res.setHeader('Content-Type', 'model/stl')
  res.send(model.stl)
})

/** Einzelobjekt als STL — für die Vorschau von eingelassenem Text. */
app.get('/api/models/:id/objects/:objectId/stl', (req, res) => {
  const model = models.get(req.params.id)
  const object = model?.objects.find((o) => o.id === req.params.objectId)
  if (!model || !object) {
    res.status(404).json({ error: 'Objekt nicht gefunden.' })
    return
  }
  res.setHeader('Content-Type', 'model/stl')
  res.send(meshToBinarySTL(placeMesh(object.mesh, object.placement)))
})

const clampNum = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 0))

/** Fortlaufende Kennung je Netz: Ein ersetztes Mesh (Reparatur, Schnitt, Text)
 *  bekommt automatisch eine neue Nummer, ein unverändertes behält seine. */
let meshSequence = 0
const meshIds = new WeakMap<Mesh, number>()
function meshId(mesh: Mesh): number {
  let id = meshIds.get(mesh)
  if (id === undefined) {
    id = ++meshSequence
    meshIds.set(mesh, id)
  }
  return id
}

/** Fingerabdruck der Geometrie, die im STL landet. Bleibt er gleich, hat sich
 *  für den Viewer nichts geändert — dann werden Netz, Analyse und STL nicht
 *  neu gebaut (z. B. beim Zuweisen eines Filament-Slots). */
function geometrySignatureOf(objects: ModelObject[]): string {
  return objects
    .map((o) => {
      const p = o.placement
      return [
        o.id,
        meshId(o.mesh),
        o.mesh.triangles,
        o.placement.visible ? 1 : 0,
        o.excluded ? 1 : 0,
        o.negative ? 1 : 0,
        p.offsetX,
        p.offsetY,
        p.offsetZ,
        p.rotationX,
        p.rotationY,
        p.rotationZ,
        p.scaleX,
        p.scaleY,
        p.scaleZ,
      ].join(':')
    })
    .join('|')
}

/** Antwort nach einem Objektwerkzeug: `geometryChanged` sagt der Oberfläche,
 *  ob sie das STL überhaupt neu holen muss. */
function editResponse(model: StoredModel, revisionBefore: number) {
  return {
    objects: describeObjects(model.objects),
    analysis: model.analysis,
    revision: model.revision,
    geometryChanged: model.revision !== revisionBefore,
  }
}

/** Übernimmt die Objektliste ins Modell und berechnet Mesh, Analyse und STL neu. */
function commitModel(model: StoredModel): boolean {
  const signature = geometrySignatureOf(model.objects)
  // Gleiche Geometrie: Der vorhandene Stand ist bereits richtig. Vorher lief
  // hier bei jeder Slot-/Farbänderung ein voller Modelldurchlauf.
  if (signature === model.geometrySignature) return true
  const composed = composeObjects(model.objects)
  if (!composed) return false
  model.mesh = composed
  model.analysis = analyzeMesh(composed, model.name)
  model.stl = meshToBinarySTL(composed)
  model.geometrySignature = signature
  model.revision += 1
  return true
}

const visibleObject = (model: StoredModel, id?: string): ModelObject | null =>
  (id
    ? model.objects.find((o) => o.id === id)
    : model.objects.find((o) => o.placement.visible && !o.excluded)) ?? null

app.post('/api/models/:id/objects', (req, res) => {
  const model = models.get(req.params.id)
  if (!model) {
    res.status(404).json({ error: 'Modell nicht gefunden.' })
    return
  }
  const { objects: incoming } = req.body as {
    objects?: {
      id: string
      visible?: boolean
      offsetX?: number
      offsetY?: number
      offsetZ?: number
      rotationX?: number
      rotationY?: number
      rotationZ?: number
      scaleX?: number
      scaleY?: number
      scaleZ?: number
      filamentId?: string | null
      slotId?: string | null
      excluded?: boolean
      /** 0-basierte Platte im Multiprint-Planer */
      plate?: number
    }[]
  }
  if (!Array.isArray(incoming)) {
    res.status(400).json({ error: 'Keine Objektliste übergeben.' })
    return
  }

  const byId = new Map(incoming.map((o) => [o.id, o]))
  for (const object of model.objects) {
    const patch = byId.get(object.id)
    if (!patch) continue
    const before = object.placement
    const rotationChanged =
      (patch.rotationX !== undefined && Math.abs(patch.rotationX - before.rotationX) > 1e-6) ||
      (patch.rotationY !== undefined && Math.abs(patch.rotationY - before.rotationY) > 1e-6) ||
      (patch.rotationZ !== undefined && Math.abs(patch.rotationZ - before.rotationZ) > 1e-6)
    const zExplicit =
      patch.offsetZ !== undefined && Math.abs(patch.offsetZ - before.offsetZ) > 1e-6
    object.placement = {
      visible: patch.visible !== false,
      offsetX: clampNum(patch.offsetX ?? before.offsetX, -400, 400),
      offsetY: clampNum(patch.offsetY ?? before.offsetY, -400, 400),
      offsetZ: clampNum(patch.offsetZ ?? before.offsetZ, -400, 400),
      rotationX: clampNum(patch.rotationX ?? before.rotationX, -360, 360),
      rotationY: clampNum(patch.rotationY ?? before.rotationY, -360, 360),
      rotationZ: clampNum(patch.rotationZ ?? before.rotationZ, -360, 360),
      scaleX: clampNum(patch.scaleX ?? before.scaleX, 0.05, 10) || 1,
      scaleY: clampNum(patch.scaleY ?? before.scaleY, 0.05, 10) || 1,
      scaleZ: clampNum(patch.scaleZ ?? before.scaleZ, 0.05, 10) || 1,
      filamentId:
        patch.filamentId === null
          ? undefined
          : typeof patch.filamentId === 'string'
            ? patch.filamentId
            : before.filamentId,
      slotId:
        patch.slotId === null
          ? undefined
          : typeof patch.slotId === 'string'
            ? patch.slotId
            : before.slotId,
    }
    // Eine reine Drehung soll ein aufliegendes Objekt nicht unter das Bett
    // schieben. Wird Z gleichzeitig ausdrücklich geändert, gewinnt die Eingabe.
    if (rotationChanged && !zExplicit) {
      object.placement.offsetZ = clampNum(
        keepBedHeight(object.mesh, before, object.placement).offsetZ ?? object.placement.offsetZ,
        -400,
        400,
      )
    }
    if (typeof patch.excluded === 'boolean') object.excluded = patch.excluded
    if (typeof patch.plate === 'number' && Number.isFinite(patch.plate)) {
      object.plate = Math.max(0, Math.min(31, Math.floor(patch.plate)))
    }
  }

  const revisionBefore = model.revision
  if (!commitModel(model)) {
    res.status(400).json({ error: 'Mindestens ein Objekt muss sichtbar sein.' })
    return
  }

  res.json(editResponse(model, revisionBefore))
})

/** Weiteres Objekt aus einer Datei an das bestehende Werkstück anhängen. */
app.post(
  '/api/models/:id/objects/import',
  express.raw({ type: () => true, limit: '150mb' }),
  (req, res) => {
    const model = models.get(req.params.id)
    if (!model) {
      res.status(404).json({ error: 'Modell nicht gefunden.' })
      return
    }
    const body = req.body as Buffer
    if (!Buffer.isBuffer(body) || body.length < 16) {
      res.status(400).json({ error: 'Keine Objektdaten empfangen.' })
      return
    }
    try {
      const name = String(req.query.name ?? 'objekt.stl').slice(0, 120)
      const parsed = parseModelFile(body, name)
      const plate = Math.max(0, Math.min(31, Math.floor(Number(req.query.plate ?? 0))))
      const added = parsed.objects.map((o) => newObject(o.name, placeMesh(o.mesh, o.placement)))
      const importRepair = { removed: 0, openBefore: 0, openAfter: 0, applied: false }
      for (const object of added) {
        const before = countOpenEdges(object.mesh)
        importRepair.openBefore += before
        importRepair.openAfter += before
        // Geschlossenes Netz: Reparatur würde verworfen — gleich überspringen.
        if (!before) continue
        const fixed = orientMesh(fillHoles(repairMesh(object.mesh)))
        const after = countOpenEdges(fixed)
        importRepair.openAfter += after - before
        importRepair.removed += Math.max(0, object.mesh.triangles - fixed.triangles)
        if (after < before) {
          object.mesh = fixed
          importRepair.applied = true
        }
      }
      const joined = mergeMeshes(added.map((o) => o.mesh))
      if (!added.length || !joined) throw new Error('Keine Objekte in der Datei gefunden.')

      // Neben das vorhandene Werkstück setzen und auf das Bett stellen.
      const existing = composeObjects(model.objects)
      const dx = existing ? existing.bbox.max.x + 5 - joined.bbox.min.x : 0
      const dz = -joined.bbox.min.z
      for (const object of added) {
        object.plate = plate
        object.placement.offsetX = dx
        object.placement.offsetZ = dz
      }

      model.objects.push(...added)
      // Bei einer anderen Platte die Gruppen wieder auf ihre jeweilige Bettmitte
      // legen; sonst läge die neue Form im Vorschau-Offset der alten Platte.
      if (plate > 0) layoutPlates(model.objects, printerById(String(req.query.printerId ?? '')).bed)
      const revisionBefore = model.revision
      if (!commitModel(model)) {
        res.status(400).json({ error: 'Objekt konnte nicht hinzugefügt werden.' })
        return
      }
      res.json({ ...editResponse(model, revisionBefore), added: added.length, importRepair })
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Objekt konnte nicht gelesen werden.' })
    }
  },
)

/** Objektwerkzeuge: duplizieren, löschen, zusammenbauen, anordnen, ausrichten. */
app.post('/api/models/:id/tools', async (req, res) => {
  const model = models.get(req.params.id)
  if (!model) {
    res.status(404).json({ error: 'Modell nicht gefunden.' })
    return
  }
  const { tool, objectId, objectIds, count, bed, plate } = req.body as {
    tool?: ToolAction
    objectId?: string
    /** Zusammenbauen, Duplizieren, Trennen: die markierten Teile. */
    objectIds?: string[]
    /** Duplizieren: so viele Kopien je Teil (1–64). */
    count?: number
    bed?: { x?: number; y?: number }
    /** Plattenwerkzeuge: 0-basierte Platte. */
    plate?: number
  }
  const target = visibleObject(model, objectId)
  const bedSize = {
    x: clampNum(bed?.x ?? 220, 20, 1000),
    y: clampNum(bed?.y ?? 220, 20, 1000),
  }

  /** Ergebnis der Mesh-Reparatur für die Rückmeldung an die Oberfläche. */
  let repair: { openBefore: number; openAfter: number; applied: boolean } | undefined
  /** Trennen: wie viele Objekte wurden in wie viele Einzelteile zerlegt. */
  let separate: { objects: number; parts: number } | undefined
  const revisionBefore = model.revision

  switch (tool) {
    case 'duplicate': {
      // Mehrfachauswahl und Stückzahl in einer Anfrage. Vorher lief je Teil eine
      // eigene Anfrage mit vollem Modellaufbau und STL-Nachladen im Viewer.
      const chosen =
        Array.isArray(objectIds) && objectIds.length
          ? model.objects.filter((o) => objectIds.includes(o.id))
          : target
            ? [target]
            : []
      if (!chosen.length) {
        res.status(400).json({ error: 'Kein Objekt zum Duplizieren ausgewählt.' })
        return
      }
      const copies = Math.max(1, Math.min(64, Math.floor(Number(count ?? 1)) || 1))
      for (const source of chosen) {
        // Jede Kopie setzt sich an der vorigen aus — so entsteht eine Reihe.
        let latest: ModelObject = source
        for (let i = 0; i < copies; i++) {
          latest = duplicateObject(latest)
          model.objects.push(latest)
        }
      }
      break
    }
    case 'delete': {
      // Mehrfachauswahl: alle markierten Teile in einer Anfrage entfernen.
      // Vorher lief je Teil eine eigene Anfrage; jede baute das ganze Modell
      // neu zusammen und lud im Viewer das komplette STL nachmal.
      const requested = Array.isArray(objectIds) && objectIds.length ? objectIds : target ? [target.id] : []
      const doomed = new Set(requested.filter((id) => typeof id === 'string'))
      if (!doomed.size) {
        res.status(400).json({ error: 'Kein Objekt ausgewählt.' })
        return
      }
      const kept = model.objects.filter((o) => !doomed.has(o.id))
      // Letztes Teil gelöscht: die Platte ist leer, das Modell kann weg.
      if (!kept.length) {
        models.delete(model.id)
        res.json({ cleared: true, objects: [], analysis: model.analysis })
        return
      }
      // Erst prüfen, dann übernehmen — sonst bliebe ein Modell ohne sichtbares
      // Teil zurück, obwohl die Anfrage mit einem Fehler endet.
      if (!kept.some((o) => o.placement.visible)) {
        res.status(400).json({ error: 'Mindestens ein Objekt muss sichtbar bleiben.' })
        return
      }
      model.objects = kept
      break
    }
    case 'clear': {
      models.delete(model.id)
      res.json({ cleared: true, objects: [], analysis: model.analysis })
      return
    }
    case 'removeplate': {
      // Eine Platte samt ihrer Objekte entfernen. Höhere Platten rücken eine
      // Nummer nach unten, damit die Plattenreiter lückenlos bleiben; eine
      // leere Platte lässt sich damit ebenfalls löschen. Ohne Obergrenze, weil
      // eine geladene 3MF mehr als 32 Platten mitbringen kann.
      const plateNo = Math.max(0, Math.floor(Number(plate ?? 0)) || 0)
      // Höhere Platten rücken nicht nur in der Nummer nach, sondern auch um
      // eine Bettbreite nach links — sonst stünde ihr Inhalt nach dem Löschen
      // außerhalb des verbleibenden Bettes.
      const pitch = plateOffsetX(1, bedSize.x)
      const kept = model.objects
        .filter((o) => (o.plate ?? 0) !== plateNo)
        .map((o) => {
          const current = o.plate ?? 0
          if (current <= plateNo) return o
          return {
            ...o,
            plate: current - 1,
            placement: { ...o.placement, offsetX: o.placement.offsetX - pitch },
          }
        })
      if (!kept.length) {
        models.delete(model.id)
        res.json({ cleared: true, objects: [], analysis: model.analysis })
        return
      }
      if (!kept.some((o) => o.placement.visible)) {
        res.status(400).json({ error: 'Mindestens ein Objekt muss sichtbar bleiben.' })
        return
      }
      model.objects = kept
      break
    }
    case 'repair': {
      const chosen =
        Array.isArray(objectIds) && objectIds.length
          ? model.objects.filter((o) => objectIds.includes(o.id))
          : model.objects
      if (!chosen.length) {
        res.status(400).json({ error: 'Kein Objekt zum Reparieren gefunden.' })
        return
      }
      // Offene Kanten je Netz nur einmal zählen und die Werte weiterverwenden.
      // Vorher lief die Zählung bis zu viermal über dasselbe Netz, obwohl sich
      // das Ergebnis nicht ändert.
      let openBefore = 0
      let openAfter = 0
      for (const o of chosen) {
        const before = countOpenEdges(o.mesh)
        openBefore += before
        // Geschlossenes Netz: Die Reparatur könnte es nur verschlechtern, das
        // Ergebnis würde ohnehin verworfen.
        if (!before) continue
        // Erst aufräumen, dann Ränder schließen. Nur übernehmen, wenn es die
        // offenen Kanten wirklich verringert — sonst bleibt das Netz unberührt.
        const fixed = orientMesh(fillHoles(repairMesh(o.mesh)))
        const after = countOpenEdges(fixed)
        if (after < before) {
          o.mesh = fixed
          openAfter += after
        } else {
          openAfter += before
        }
      }
      repair = { openBefore, openAfter, applied: openAfter < openBefore }
      break
    }
    case 'separate': {
      // Eine STL aus CAD/Download enthält oft mehrere Körper, wird beim Import
      // aber als ein Objekt geladen — dann bewegt man immer alles. meshComponents
      // trennt an fehlenden gemeinsamen Eckpunkten, die Platzierung bleibt.
      const chosen =
        Array.isArray(objectIds) && objectIds.length
          ? model.objects.filter((o) => objectIds.includes(o.id))
          : target
            ? [target]
            : []
      if (!chosen.length) {
        res.status(400).json({ error: 'Kein Objekt zum Trennen ausgewählt.' })
        return
      }
      const painted = chosen.find((o) => o.paint?.length)
      if (painted) {
        res.status(400).json({
          error: `„${painted.name}“ hat gemalte Stützen — bitte zuerst die Markierungen löschen.`,
        })
        return
      }
      const replaced = new Map<string, ModelObject[]>()
      let parts = 0
      for (const source of chosen) {
        const pieces = meshComponents(source.mesh)
        if (pieces.length < 2) {
          replaced.set(source.id, [source])
          continue
        }
        if (pieces.length > 512) {
          res.status(400).json({
            error: `„${source.name}“ besteht aus ${pieces.length} Teilen — das ist zum Trennen zu viel.`,
          })
          return
        }
        const base = source.name.replace(/\.(stl|3mf|obj|ply)$/i, '')
        replaced.set(
          source.id,
          pieces.map((mesh, i) => ({
            ...source,
            id: randomUUID(),
            name: `${base} · Teil ${i + 1}`,
            mesh,
            placement: { ...source.placement },
          })),
        )
        parts += pieces.length
      }
      if (!parts) {
        res.status(400).json({
          error: 'Kein Einzelteil gefunden — das Objekt ist bereits ein zusammenhängender Körper.',
        })
        return
      }
      model.objects = model.objects.flatMap((o) => replaced.get(o.id) ?? [o])
      separate = { objects: chosen.length, parts }
      break
    }
    case 'merge': {
      const chosen = Array.isArray(objectIds) ? model.objects.filter((o) => objectIds.includes(o.id)) : null
      if (chosen && chosen.length < 2) {
        res.status(400).json({ error: 'Zum Zusammenbauen mindestens zwei Teile auswählen.' })
        return
      }
      const group = chosen ?? model.objects.filter((o) => o.placement.visible)
      // Teile eines Schnitts tragen ihre Lage von vor dem Schnitt — dort werden
      // sie zusammengesetzt, unabhängig davon, wo sie zum Drucken liegen.
      const parts = group.map((o) =>
        placeMesh(
          o.mesh,
          o.splitBase
            ? { ...o.placement, offsetX: o.splitBase.x, offsetY: o.splitBase.y, offsetZ: o.splitBase.z }
            : o.placement,
        ),
      )
      // Echte Vereinigung: Überlappungen verschwinden, statt als Innenwände zu bleiben.
      let merged: ReturnType<typeof mergeMeshes> = null
      try {
        merged = await unionMeshes(parts)
      } catch (err) {
        console.warn('[verbinden] CSG nicht möglich, nutze Zusammenbau:', err instanceof Error ? err.message : err)
        merged = mergeMeshes(parts)
      }
      if (!merged) {
        res.status(400).json({ error: 'Keine sichtbaren Objekte zum Zusammenbauen.' })
        return
      }
      const name = group[0]?.name ?? 'Objekt'
      // Nur die ausgewählten Teile ersetzen — der Rest bleibt auf der Platte.
      const asMesh = new Set(group.map((o) => o.id))
      model.objects = [
        ...model.objects.filter((o) => !asMesh.has(o.id)),
        newObject(`${name} (zusammengebaut)`, merged),
      ]
      break
    }
    case 'arrange': {
      const result = arrangeObjects(model.objects, bedSize)
      if (!result.placed) {
        res.status(400).json({ error: 'Kein Objekt passt auf das Druckbett.' })
        return
      }
      break
    }
    case 'orient': {
      if (!target) {
        res.status(400).json({ error: 'Kein Objekt ausgewählt.' })
        return
      }
      target.placement = { ...target.placement, ...autoOrient(target, bedSize) }
      break
    }
    case 'center': {
      if (!target) {
        res.status(400).json({ error: 'Kein Objekt ausgewählt.' })
        return
      }
      target.placement = { ...target.placement, ...centerOnBed(target, bedSize) }
      break
    }
    case 'bed': {
      if (!target) {
        res.status(400).json({ error: 'Kein Objekt ausgewählt.' })
        return
      }
      target.placement = { ...target.placement, ...dropToBed(target) }
      break
    }
    default:
      res.status(400).json({ error: 'Unbekanntes Werkzeug.' })
      return
  }

  if (!commitModel(model)) {
    res.status(400).json({ error: 'Mindestens ein Objekt muss sichtbar sein.' })
    return
  }
  res.json({ ...editResponse(model, revisionBefore), repair, separate })
})

/** Stützen-Malerei (Taste L): Markierung hinzufügen oder Objekt leeren. */
/**
 * Ein-Klick-Maßstab für winzige Importe: GLB aus der Scan-App und
 * Engine-Ausgaben rechnen in Metern, ein 200-mm-Teil kommt dann als 0,2 mm an.
 * Der Platzierungsmaßstab ist auf 0,05–10 begrenzt und reicht für Faktor 500
 * nicht — deshalb wird hier die Geometrie selbst skaliert. Rückgängig läuft
 * über den normalen Verlauf, weil der Schnappschuss an jeder Änderung hängt.
 */
app.post('/api/models/:id/rescale', (req, res) => {
  const model = models.get(req.params.id)
  if (!model) {
    res.status(404).json({ error: 'Modell nicht gefunden.' })
    return
  }
  const { targetMm } = req.body as { targetMm?: number }
  const target = Number(targetMm)
  if (!Number.isFinite(target) || target < 1 || target > 2000) {
    res.status(400).json({ error: 'Bitte ein Soll-Maß zwischen 1 und 2000 mm angeben.' })
    return
  }
  const size = model.analysis.bbox.size
  const factor = rescaleFactor(Math.max(size.x, size.y, size.z), target)
  if (factor === null) {
    res.status(400).json({ error: 'Das Modell hat keine messbare Größe — bitte das Soll-Maß prüfen.' })
    return
  }
  const revisionBefore = model.revision
  for (const object of model.objects) object.mesh = scaleMesh(object.mesh, factor)
  if (!commitModel(model)) {
    res.status(400).json({ error: 'Mindestens ein Objekt muss sichtbar sein.' })
    return
  }
  res.json({ ...editResponse(model, revisionBefore), factor })
})

app.post('/api/models/:id/paint', (req, res) => {
  const model = models.get(req.params.id)
  if (!model) {
    res.status(404).json({ error: 'Modell nicht gefunden.' })
    return
  }
  const { objectId, mark, clear } = req.body as {
    objectId?: string
    mark?: { fx: number; fy: number; fz: number; r: number; block?: boolean }
    clear?: boolean
  }
  const target = model.objects.find((o) => o.id === objectId)
  if (!target) {
    res.status(400).json({ error: 'Objekt nicht gefunden.' })
    return
  }
  if (clear) {
    target.paint = []
  } else if (mark) {
    const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0))
    target.paint = [
      ...(target.paint ?? []),
      {
        fx: clamp01(mark.fx),
        fy: clamp01(mark.fy),
        fz: clamp01(mark.fz),
        r: Math.max(1, Math.min(20, Number(mark.r) || 4)),
        block: Boolean(mark.block),
      },
    ]
  } else {
    res.status(400).json({ error: 'Markierung fehlt.' })
    return
  }
  const revisionBefore = model.revision
  if (!commitModel(model)) {
    res.status(400).json({ error: 'Mindestens ein Objekt muss sichtbar sein.' })
    return
  }
  res.json(editResponse(model, revisionBefore))
})

/**
 * Scan-zu-Druck: Netz prüfen und aushöhlen.
 *
 * `info` verändert nichts; `hollow` ersetzt das Mesh des gewählten Objekts
 * durch eine Schale mit Abflusslöchern. Der Maßstab läuft über `/objects`,
 * damit ein und derselbe Rückgängig-Verlauf gilt.
 */
/** V-23: Ausgabeordner einer Scan-Engine (Meshroom, COLMAP, openMVS, MicMac)
 *  lesen. Es wird ausschließlich gelesen — kein Job, kein Upload, kein Schreiben. */
app.post('/api/scan/folder', (req, res) => {
  const body = req.body as { folder?: unknown } | undefined
  const folder = typeof body?.folder === 'string' ? body.folder.trim() : ''
  if (!folder) {
    res.status(400).json({ error: 'Kein Ordner angegeben.' })
    return
  }
  try {
    res.json(inspectScanFolder(folder))
  } catch (err) {
    res.status(400).json({
      error:
        err instanceof Error
          ? err.message
          : 'Ordner konnte nicht gelesen werden. Bitte den vollständigen Pfad prüfen.',
    })
  }
})

/** Liefert ein Mesh aus dem Ausgabeordner an die Oberfläche. */
app.get('/api/scan/file', (req, res) => {
  const path = typeof req.query.path === 'string' ? req.query.path : ''
  if (!path) {
    res.status(400).json({ error: 'Kein Pfad angegeben.' })
    return
  }
  try {
    const { buffer, name } = readScanMeshFile(path)
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('X-Scan-Name', Buffer.from(name, 'utf8').toString('base64'))
    res.send(buffer)
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Datei konnte nicht gelesen werden.',
    })
  }
})

/**
 * A-154: Scan im lokalen MeshScan-Server starten.
 *
 * Der Slicer rechnet nicht selbst: er legt den Auftrag an, reicht Fotos oder
 * ein Video durch, startet das Rechnen und holt am Ende `mesh.glb` ab. Der
 * Import macht daraus das kanonische STL — derselbe Weg wie beim GLB-Import.
 */
function scanFail(res: import('express').Response, err: unknown) {
  const status = err instanceof ScanServerError ? err.status : 502
  res
    .status(status)
    .json({ error: err instanceof Error ? err.message : 'Der Scan-Server ist nicht erreichbar.' })
}

app.get('/api/scan/engines', async (_req, res) => {
  try {
    res.json(await scanServerInfo())
  } catch (err) {
    scanFail(res, err)
  }
})

app.post('/api/scan/jobs', async (req, res) => {
  const body = req.body as { engine?: unknown; name?: unknown } | undefined
  const engine = typeof body?.engine === 'string' ? body.engine.trim().toLowerCase() : ''
  const name = typeof body?.name === 'string' ? body.name.trim() || undefined : undefined
  if (engine && !(engine in SCAN_GENERATOR_LABEL)) {
    res.status(400).json({ error: 'Unbekanntes Rechenprogramm.' })
    return
  }
  try {
    res.json(await createScanJob({ name, engine: engine ? (engine as ScanGeneratorId) : undefined }))
  } catch (err) {
    scanFail(res, err)
  }
})

app.post(
  '/api/scan/jobs/:id/photos',
  express.raw({ type: () => true, limit: '200mb' }),
  async (req, res) => {
    const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
    const name = typeof req.query.name === 'string' ? req.query.name : ''
    const index = typeof req.query.index === 'string' ? Number(req.query.index) : NaN
    if (!data.length) {
      res.status(400).json({ error: 'Die Datei ist leer.' })
      return
    }
    if (!name) {
      res.status(400).json({ error: 'Kein Dateiname angegeben.' })
      return
    }
    try {
      res.json(
        await uploadScanFile(req.params.id, {
          name,
          data,
          index: Number.isFinite(index) ? index : undefined,
        }),
      )
    } catch (err) {
      scanFail(res, err)
    }
  },
)

app.post('/api/scan/jobs/:id/process', async (req, res) => {
  try {
    res.json(await startScanProcessing(req.params.id))
  } catch (err) {
    scanFail(res, err)
  }
})

app.get('/api/scan/jobs/:id', async (req, res) => {
  try {
    res.json(await scanJobStatus(req.params.id))
  } catch (err) {
    scanFail(res, err)
  }
})

app.post('/api/scan/jobs/:id/cancel', async (req, res) => {
  try {
    res.json(await cancelScanJob(req.params.id))
  } catch (err) {
    scanFail(res, err)
  }
})

/** Fertiges `mesh.glb` an die Oberfläche — der Name kommt aus dem Job. */
app.get('/api/scan/jobs/:id/mesh', async (req, res) => {
  const jobName = typeof req.query.name === 'string' ? req.query.name : ''
  try {
    const buffer = await fetchScanJobMesh(req.params.id)
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader(
      'X-Scan-Name',
      Buffer.from(scanMeshFileName(jobName, `scan-${req.params.id}`), 'utf8').toString('base64'),
    )
    res.send(buffer)
  } catch (err) {
    scanFail(res, err)
  }
})

app.post('/api/models/:id/scan', async (req, res) => {
  const model = models.get(req.params.id)
  if (!model) {
    res.status(404).json({ error: 'Modell nicht gefunden.' })
    return
  }
  const { action, objectId, wall, drainHoles, drainDiameter, detail } = req.body as {
    action?: 'info' | 'hollow'
    objectId?: string
    wall?: number
    drainHoles?: number
    drainDiameter?: number
    detail?: number
  }
  const target =
    (typeof objectId === 'string' ? model.objects.find((o) => o.id === objectId) : undefined) ??
    model.objects.find((o) => o.placement.visible && !o.excluded) ??
    model.objects[0]
  if (!target) {
    res.status(400).json({ error: 'Kein Objekt im Modell.' })
    return
  }

  if (action === 'info') {
    try {
      res.json({
        scan: {
          objectId: target.id,
          triangles: target.mesh.triangles,
          size: target.mesh.bbox.size,
          openEdges: countOpenEdges(target.mesh),
          components: countComponents(target.mesh),
        },
      })
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Scanprüfung fehlgeschlagen.' })
    }
    return
  }

  if (action !== 'hollow') {
    res.status(400).json({ error: 'Unbekannte Scan-Aktion.' })
    return
  }
  if (target.paint?.length) {
    res.status(400).json({
      error: `„${target.name}“ hat gemalte Stützen — bitte zuerst die Markierungen löschen.`,
    })
    return
  }
  try {
    const plan = planHollow(
      target.mesh.bbox.size,
      { wall, drainHoles, drainDiameter, detail },
      target.mesh.triangles,
    )
    // Ein nicht gleichmäßiger Maßstab verzerrt die Wandstärke; der Mittelwert
    // hält sie im Druck zumindest in der Größenordnung der Eingabe.
    const scale =
      (target.placement.scaleX + target.placement.scaleY + target.placement.scaleZ) / 3
    const result = await hollowSolid(target.mesh, plan, { scale })
    target.mesh = result.mesh
    const revisionBefore = model.revision
    if (!commitModel(model)) {
      res.status(400).json({ error: 'Mindestens ein Objekt muss sichtbar sein.' })
      return
    }
    const summary = { ...result } as Record<string, unknown>
    delete summary.mesh
    res.json({ ...editResponse(model, revisionBefore), hollow: summary, scanPlan: plan })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Aushöhlen fehlgeschlagen.'
    res.status(400).json({ error: message.includes('Aushöhlen') ? message : `Aushöhlen fehlgeschlagen: ${message}` })
  }
})

/** Einen Schritt zurück — für alle Objektwerkzeuge und das Teilen. */
app.post('/api/models/:id/undo', (req, res) => {
  const model = models.get(req.params.id)
  if (!model) {
    res.status(404).json({ error: 'Modell nicht gefunden.' })
    return
  }
  const entry = history.get(model.id)
  if (!entry || entry.index <= 0) {
    res.status(400).json({ error: 'Es gibt nichts zum Rückgängigmachen.' })
    return
  }
  const revisionBefore = model.revision
  entry.index--
  if (!restoreSnapshot(model, entry.states[entry.index])) {
    entry.index++
    res.status(400).json({ error: 'Der Schritt lässt sich nicht wiederherstellen.' })
    return
  }
  res.json({
    ...editResponse(model, revisionBefore),
    canUndo: entry.index > 0,
    canRedo: entry.index < entry.states.length - 1,
    label: entry.states[entry.index + 1]?.label ?? 'Schritt',
  })
})

/** Einen Schritt vor — nach einem Rückgängig. */
app.post('/api/models/:id/redo', (req, res) => {
  const model = models.get(req.params.id)
  if (!model) {
    res.status(404).json({ error: 'Modell nicht gefunden.' })
    return
  }
  const entry = history.get(model.id)
  if (!entry || entry.index >= entry.states.length - 1) {
    res.status(400).json({ error: 'Es gibt nichts zum Wiederherstellen.' })
    return
  }
  const revisionBefore = model.revision
  entry.index++
  if (!restoreSnapshot(model, entry.states[entry.index])) {
    entry.index--
    res.status(400).json({ error: 'Der Schritt lässt sich nicht wiederherstellen.' })
    return
  }
  res.json({
    ...editResponse(model, revisionBefore),
    canUndo: entry.index > 0,
    canRedo: entry.index < entry.states.length - 1,
    label: entry.states[entry.index]?.label ?? 'Schritt',
  })
})

/** Zuschneiden mit gerader, Zickzack-, Keil-, Wellen-, Treppen- oder Zapfen-Schnittfläche. */
app.post('/api/models/:id/cut', (req, res) => {
  const model = models.get(req.params.id)
  if (!model) {
    res.status(404).json({ error: 'Modell nicht gefunden.' })
    return
  }
  const body = req.body as {
    objectId?: string
    z?: number
    keep?: 'top' | 'bottom' | 'both'
    profile?: 'flat' | 'zigzag' | 'dovetail' | 'wave' | 'step' | 'undercut'
    connectorSize?: number
    count?: number
  }
  const target = visibleObject(model, body.objectId)
  if (!target) {
    res.status(400).json({ error: 'Kein Objekt zum Zuschneiden ausgewählt.' })
    return
  }

  const placed = placeMesh(target.mesh, target.placement)
  const { min, max } = placed.bbox
  const z = clampNum(body.z ?? (min.z + max.z) / 2, min.z + 0.01, max.z - 0.01)
  const keep = body.keep ?? 'both'
  const profile = body.profile ?? 'flat'
  const halves = cutMesh(placed, {
    z,
    keep,
    profile,
    connectorSize: clampNum(body.connectorSize ?? 2, 0.4, 10),
    count: clampNum(body.count ?? 2, 1, 12),
  })

  const added: ModelObject[] = []
  if ((keep === 'bottom' || keep === 'both') && halves.bottom) {
    added.push(newObject(`${target.name} · unten`, halves.bottom))
  }
  if ((keep === 'top' || keep === 'both') && halves.top) {
    added.push(newObject(`${target.name} · oben`, halves.top))
  }
  if (!added.length) {
    res.status(400).json({ error: 'Der Schnitt hat kein Teil ergeben — bitte eine andere Höhe wählen.' })
    return
  }

  model.objects = model.objects.flatMap((o) => (o.id === target.id ? added : [o]))
  const revisionBefore = model.revision
  if (!commitModel(model)) {
    res.status(400).json({ error: 'Nach dem Schnitt ist kein Teil sichtbar.' })
    return
  }
  res.json({ ...editResponse(model, revisionBefore), parts: added.length })
})

/** Sucht die Schnittlage mit dem kleinsten Querschnitt (dünnste Stelle). */
app.post('/api/models/:id/seam', (req, res) => {
  const model = models.get(req.params.id)
  if (!model) {
    res.status(404).json({ error: 'Modell nicht gefunden.' })
    return
  }
  const body = req.body as { objectId?: string; axis?: 'z' | 'x' | 'y' }
  const target = visibleObject(model, body.objectId)
  if (!target) {
    res.status(400).json({ error: 'Kein Objekt ausgewählt.' })
    return
  }
  const axis: 'z' | 'x' | 'y' = body.axis === 'x' || body.axis === 'y' ? body.axis : 'z'
  const placed = placeMesh(target.mesh, target.placement)
  const position = suggestSeam(placed, axis)
  res.json({ position: Math.round(position * 100) / 100 })
})

/**
 * Teilt ein Objekt in mehrere gleich große Stücke mit Verbindern.
 * Die Teilezahl ergibt sich auf Wunsch aus der Bettgröße, danach werden die
 * Teile auf Wunsch nebeneinander aufs Bett gelegt.
 */
app.post('/api/models/:id/split', async (req, res) => {
  const model = models.get(req.params.id)
  if (!model) {
    res.status(404).json({ error: 'Modell nicht gefunden.' })
    return
  }
  const body = req.body as {
    objectId?: string
    axis?: 'z' | 'x' | 'y'
    pieces?: number
    autoPieces?: boolean
    profile?: 'flat' | 'zigzag' | 'dovetail' | 'wave' | 'step' | 'undercut'
    connectorSize?: number
    count?: number
    clearance?: number
    connectorClearance?: number
    position?: number
    keep?: 'both' | 'low' | 'high'
    arrange?: boolean
    pinCount?: number
    pinWidth?: number
    pinLength?: number
    pinHeight?: number
    pinDepth?: number
    pinTaper?: number
    pinType?: 'pin' | 'dovetail' | 'puzzle' | 'tongue' | 'bayonet' | 'thread' | 'undercut'
    /** Nur mit true dürfen Naht und Verbinder gleichzeitig gerechnet werden. */
    combine?: boolean
    bed?: { x?: number; y?: number; z?: number }
  }
  const target = visibleObject(model, body.objectId)
  if (!target) {
    res.status(400).json({ error: 'Kein Objekt zum Teilen ausgewählt.' })
    return
  }

  const bed = {
    x: clampNum(body.bed?.x ?? 220, 20, 1000),
    y: clampNum(body.bed?.y ?? 220, 20, 1000),
    z: clampNum(body.bed?.z ?? 250, 20, 1000),
  }
  const placed = placeMesh(target.mesh, target.placement)
  const axis: 'z' | 'x' | 'y' = body.axis === 'x' || body.axis === 'y' ? body.axis : 'z'
  const extent =
    axis === 'z' ? placed.bbox.size.z : axis === 'x' ? placed.bbox.size.x : placed.bbox.size.y
  // Wenig Rand lassen: Naht und Messungen brauchen ein paar Millimeter.
  const room = Math.max(20, (axis === 'z' ? bed.z : axis === 'x' ? bed.x : bed.y) - (axis === 'z' ? 2 : 8))
  const pieces = body.autoPieces
    ? Math.max(2, Math.min(12, Math.ceil(extent / room)))
    : clampNum(body.pieces ?? 2, 2, 12)

  // Nur eine Verbinderart: Liegt ein Verbinder vor, bleibt die Naht gerade.
  // Sonst entstehen Treppe + Schiene gleichzeitig — das lässt sich nicht fügen.
  // „Hinterschnitt“ ist eine eigene Nahtwahl, braucht aber echte Geometrie:
  // ein Riegel mit breitem Kopf hinter schmalem Hals, nicht nur eine Welle.
  const wantsUndercut = body.profile === 'undercut'
  const pinCount = wantsUndercut ? Math.max(1, clampNum(body.pinCount ?? 1, 1, 8)) : clampNum(body.pinCount ?? 0, 0, 8)
  const pinType: 'pin' | 'dovetail' | 'puzzle' | 'tongue' | 'bayonet' | 'thread' | 'undercut' = wantsUndercut
    ? 'undercut'
    : body.pinType === 'dovetail' ||
        body.pinType === 'puzzle' ||
        body.pinType === 'tongue' ||
        body.pinType === 'bayonet' ||
        body.pinType === 'thread'
      ? body.pinType
      : 'pin'
  const request = {
    axis,
    pieces,
    profile: wantsUndercut || (pinCount > 0 && !body.combine) ? ('flat' as const) : (body.profile ?? 'wave'),
    connectorSize: clampNum(body.connectorSize ?? 1.6, 0.4, 10),
    count: clampNum(body.count ?? 2, 1, 12),
    clearance: clampNum(body.clearance ?? 0.05, -1, 2),
    connectorClearance: clampNum(body.connectorClearance ?? 0.25, 0, 1),
    position: body.position === undefined ? undefined : clampNum(body.position, placed.bbox.min.z - 10000, placed.bbox.max.z + 10000),
    keep: body.keep ?? 'both',
    pinCount,
    pinWidth: clampNum(body.pinWidth ?? 6, 1, 40),
    pinLength: clampNum(body.pinLength ?? 8, 1, 40),
    pinHeight: clampNum(body.pinHeight ?? 4, 1, 30),
    pinDepth: clampNum(body.pinDepth ?? 4, 1, 30),
    pinTaper: clampNum(body.pinTaper ?? 0.08, 0, 0.35),
    pinType,
  }
  // CSG zuerst: liefert geschlossene Nahtflächen. Klappt das nicht (z. B. bei
  // einem offenen Netz), fällt der Schnitt auf die Flächenmethode zurück.
  let parts: ReturnType<typeof cutIntoPieces>
  try {
    parts = await splitSolid(placed, request)
  } catch (err) {
    console.warn('[teilen] CSG nicht möglich, nutze Flächenschnitt:', err instanceof Error ? err.message : err)
    parts = cutIntoPieces(placed, request)
  }
  if (!parts.length) {
    res.status(400).json({ error: 'Der Schnitt hat kein Teil ergeben — bitte andere Richtung wählen.' })
    return
  }

  // Lage vor dem Schnitt merken: „Zusammenbauen“ setzt die Teile damit wieder
  // exakt an ihren ursprünglichen Platz zurück.
  const splitBase = {
    x: target.placement.offsetX,
    y: target.placement.offsetY,
    z: target.placement.offsetZ,
  }
  const added: ModelObject[] = parts.map((mesh, i) => {
    const object = newObject(`${target.name} · ${i + 1}/${parts.length}`, mesh)
    // V-04: Die Naht kommt nach unten aufs Bett — unabhängig davon, ob die
    // Teile danach verteilt werden. Bei „nur oben“ ist das erste gelieferte
    // Teil das obere, deshalb zählt der ursprüngliche Index.
    const pieceIndex = body.keep === 'high' ? pieces - 1 : i
    if (axis === 'z' && pieceIndex === 0) object.placement.rotationX = 180
    if (axis === 'x') object.placement.rotationY = pieceIndex === 0 ? 90 : -90
    if (axis === 'y') object.placement.rotationX = pieceIndex === 0 ? -90 : 90
    object.placement = { ...object.placement, ...dropToBed(object) }
    object.splitBase = splitBase
    return object
  })
  model.objects = model.objects.flatMap((o) => (o.id === target.id ? added : [o]))
  if (body.arrange) {
    arrangeObjects(model.objects, bed)
    // Teile, die nicht aufs Bett passen, würden sonst übereinander liegen.
    packParts(added, bed)
  }

  const revisionBefore = model.revision
  if (!commitModel(model)) {
    res.status(400).json({ error: 'Nach dem Teilen ist kein Teil sichtbar.' })
    return
  }
  res.json({ ...editResponse(model, revisionBefore), parts: added.length })
})

/**
 * Text auf ein gewähltes Objekt setzen. Erhaben wird der Text aufaddiert,
 * eingelassen als eigener Negativkörper beim Slicen ausgeschnitten.
 */
app.post('/api/models/:id/text', (req, res) => {
  const model = models.get(req.params.id)
  if (!model) {
    res.status(404).json({ error: 'Modell nicht gefunden.' })
    return
  }
  const body = req.body as {
    id?: string
    targetId?: string
    text?: string
    fontHeight?: number
    depth?: number
    rotation?: number
    mode?: 'emboss' | 'engrave'
    offsetX?: number
    offsetY?: number
  }
  const editing = body.id ? model.objects.find((o) => o.id === body.id && o.text) : undefined
  const text = String(body.text ?? '').trim()
  if (!text) {
    res.status(400).json({ error: 'Bitte einen Text eingeben.' })
    return
  }
  const targetId = body.targetId ?? editing?.text?.targetId
  const target =
    (targetId ? model.objects.find((o) => o.id === targetId && !o.text) : undefined) ??
    model.objects.find((o) => o.placement.visible && !o.negative && !o.text)
  if (!target) {
    res.status(400).json({ error: 'Kein Objekt gefunden, auf das der Text gesetzt werden kann.' })
    return
  }

  const mode: 'emboss' | 'engrave' = body.mode === 'engrave' ? 'engrave' : 'emboss'
  const fontHeight = clampNum(body.fontHeight ?? 10, 3, 80)
  const depth = clampNum(body.depth ?? 0.8, 0.2, 5)
  const rotation = clampNum(body.rotation ?? 0, -360, 360)
  // Eingelassen ragt der Körper minimal über die Oberfläche, damit der Schnitt
  // die Deckschicht sicher öffnet.
  const built = buildTextMesh({ text, fontHeight, depth: mode === 'engrave' ? depth + 0.1 : depth, rotation: 0 })
  const placedTarget = placeMesh(target.mesh, target.placement)
  const box = placedTarget.bbox
  const cx = (box.min.x + box.max.x) / 2
  const cy = (box.min.y + box.max.y) / 2
  const halfX = Math.max(1, box.size.x / 2)
  const halfY = Math.max(1, box.size.y / 2)
  const offsetX = clampNum(body.offsetX ?? 0, -halfX, halfX)
  const offsetY = clampNum(body.offsetY ?? 0, -halfY, halfY)
  const meta: TextPart = {
    text,
    fontHeight,
    depth,
    rotation,
    mode,
    offsetX,
    offsetY,
    targetId: target.id,
  }
  const object = newObject(
    `Text „${text.slice(0, 24)}“ ${mode === 'engrave' ? '(eingelassen)' : '(erhaben)'}`,
    built.mesh,
    {
      offsetX: cx + offsetX,
      offsetY: cy + offsetY,
      offsetZ: mode === 'engrave' ? box.max.z - depth : box.max.z - 0.2,
      rotationZ: rotation,
    },
  )
  object.negative = mode === 'engrave'
  object.text = meta
  if (editing) {
    object.id = editing.id
    model.objects = model.objects.map((o) => (o.id === editing.id ? object : o))
  } else {
    model.objects.push(object)
  }

  const revisionBefore = model.revision
  if (!commitModel(model)) {
    res.status(400).json({ error: 'Text konnte nicht hinzugefügt werden.' })
    return
  }
  res.json(editResponse(model, revisionBefore))
})

/** Lithophan-Lampe aus einem Graustufenbild (PNG/JPEG im Browser dekodiert). */
app.post('/api/lithophane', (req, res) => {
  const body = req.body as {
    name?: string
    gray?: number[]
    cols?: number
    rows?: number
    widthMm?: number
    heightMm?: number
    minThickness?: number
    maxThickness?: number
    contrast?: number
    invert?: boolean
    shape?: 'flat' | 'cylinder'
  }
  try {
    const mesh = lithophaneMesh({
      gray: Array.isArray(body.gray) ? body.gray : [],
      cols: clampNum(body.cols ?? 0, 0, 2000),
      rows: clampNum(body.rows ?? 0, 0, 2000),
      widthMm: clampNum(body.widthMm ?? 100, 10, 400),
      heightMm: clampNum(body.heightMm ?? 100, 10, 400),
      minThickness: clampNum(body.minThickness ?? 0.8, 0.3, 8),
      maxThickness: clampNum(body.maxThickness ?? 3, 0.4, 12),
      contrast: clampNum(body.contrast ?? 1, 0.1, 4),
      invert: body.invert === true,
      shape: body.shape === 'cylinder' ? 'cylinder' : 'flat',
    })
    const id = randomUUID()
    const name = `${(body.name ?? 'Lithophane').replace(/\.(png|jpe?g)$/i, '').slice(0, 60) || 'Lithophane'}.stl`
    const object = newObject('Lithophane', mesh)
    const stored: StoredModel = {
      id,
      name,
      mesh,
      objects: [object],
      analysis: analyzeMesh(mesh, name),
      stl: meshToBinarySTL(mesh),
      revision: 0,
      geometrySignature: geometrySignatureOf([object]),
      overrides: [],
      lastAccess: Date.now(),
    }
    models.set(id, stored)
    res.json({
      id,
      name,
      analysis: stored.analysis,
      objects: describeObjects(stored.objects),
      format: 'stl',
      bytes: stored.stl.length,
      settings: {},
      warnings: [],
      printerHint: null,
      filamentHint: null,
    })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Lithophane konnte nicht erzeugt werden.' })
  }
})

app.post('/api/export/3mf', (req, res) => {
  const { modelId, settings, printerId, filamentId, plateId, plate, slots } = req.body as {
    modelId?: string
    settings?: PrintSettings
    printerId?: string
    filamentId?: string
    plateId?: string
    /** Nur diese Platte exportieren (0-basiert) */
    plate?: number
    slots?: FilamentSlot[]
  }
  const model = modelId ? models.get(modelId) : null
  if (!model) {
    res.status(404).json({ error: 'Modell nicht gefunden.' })
    return
  }
  try {
    const merged = mergeSettings(DEFAULT_SETTINGS, settings ?? {})
    const profile = printerById(printerId ?? hub.selected.profileId)
    // Mehrplatten-3MF: auf Wunsch nur die gewählte Platte, ohne Versatz der
    // Plattenansicht — das Bett beginnt wieder bei 0.
    const plateNo = Math.max(0, Math.floor(Number(plate ?? 0)))
    const onPlate = model.objects.filter(
      (o) => (o.plate ?? 0) === plateNo && o.placement.visible && !o.excluded,
    )
    let exportMesh = model.mesh
    if (model.objects.length > 0 && onPlate.length > 0) {
      const composed = composeObjects(onPlate)
      if (composed) {
        const shift = plateOffsetX(plateNo, profile.bed.x)
        exportMesh = transformMesh(composed, { x: -shift, y: 0, z: 0 })
      }
    }
    const assignments = onPlate.map((o) => ({
      name: o.name,
      filamentId: o.placement.filamentId,
      slotId: o.placement.slotId,
    }))
    const buf = build3MF(
      exportMesh,
      merged,
      profile,
      filamentById(filamentId ?? 'pla'),
      plateById(plateId ?? 'textured-pei'),
      Array.isArray(slots) ? slots : [],
      assignments,
    )
    res.setHeader('Content-Type', 'model/3mf')
    res.setHeader('Content-Disposition', 'attachment; filename="kepler-modell.3mf"')
    res.send(buf)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '3MF-Export fehlgeschlagen.' })
  }
})

let shuttingDown = false

function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  // Offene UI-/WebSocket-Verbindungen halten server.close() sonst beliebig
  // lange am Leben. Erst die Clients trennen, dann den Server schließen und
  // nach kurzer Frist hart beenden — so bleibt kein Prozess im Task-Manager
  // zurück und der Port wird sicher frei.
  for (const client of wss.clients) {
    try {
      client.terminate()
    } catch {
      /* schon geschlossen */
    }
  }
  try {
    wss.close()
  } catch {
    /* schon geschlossen */
  }
  jobQueue.stop()
  void hub.disconnectAll().catch(() => undefined)
  try {
    ;(server as unknown as { closeIdleConnections?: () => void }).closeIdleConnections?.()
    ;(server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.()
  } catch {
    /* ältere Node-Version */
  }
  server.close(() => process.exit(0))
  // Referenzierter Timer: unref() konnte dazu führen, dass der Prozess zwar
  // weiterlief, aber kein Fenster mehr öffnete.
  setTimeout(() => process.exit(0), 800)
}

/** Beendet die laufende Instanz — der Port wird sofort frei. */
app.post('/api/shutdown', (_req, res) => {
  res.json({ ok: true })
  shutdown()
})

app.get('/api/demo/:shape', (req, res) => {
  const stl = demoSTL(req.params.shape)
  if (!stl) {
    res.status(404).json({ error: 'Unbekanntes Demo-Modell.' })
    return
  }
  res.setHeader('Content-Type', 'model/stl')
  res.send(stl)
})

// ---------- Kalibrierung ----------

app.post('/api/calibration', (req, res) => {
  const { toolId, printerId, filamentId, plateId, settings, flavor, options } = req.body as {
    toolId: string
    printerId: string
    filamentId: string
    plateId: string
    settings: PrintSettings
    flavor?: GcodeFlavor
    options?: CalibrationOptions
  }
  try {
    const baseProfile = printerById(printerId)
    const profile = {
      ...baseProfile,
      flavor: isGcodeFlavor(flavor) ? flavor : baseProfile.flavor,
    }
    const filament = filamentById(filamentId)
    const plate = plateById(plateId)
    const merged: PrintSettings = mergeSettings(DEFAULT_SETTINGS, settings ?? {})
    const bundle = buildCalibration(toolId, profile, filament, merged, options)
    if (!bundle) {
      res.status(404).json({ error: 'Unbekanntes Kalibrier-Werkzeug.' })
      return
    }
    const mesh = parseSTL(bundle.stl)
    const analysis = analyzeMesh(mesh, bundle.tool.label)
    const id = randomUUID()
    const object: ModelObject = { id: `${id}-0`, name: bundle.tool.label, mesh, placement: defaultPlacement() }
    // Die Kalibrier-Modelle sind um ihren eigenen Ursprung gebaut. Zentriert
    // auf dem Bett und auf Z=0 gesetzt kollidieren sie mit keinem Rand.
    object.placement = { ...object.placement, ...centerOnBed(object, profile.bed) }
    object.placement = { ...object.placement, ...dropToBed(object) }
    const objects: ModelObject[] = [object]
    models.set(id, {
      id,
      name: `${bundle.tool.id}.stl`,
      mesh,
      objects,
      analysis,
      stl: bundle.stl,
      revision: 0,
      geometrySignature: geometrySignatureOf(objects),
      overrides: bundle.overrides,
      lastAccess: Date.now(),
    })
    res.json({ modelId: id, analysis, tool: bundle.tool, plate: plate.name })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Kalibrierung fehlgeschlagen.' })
  }
})

/**
 * Gemalte Stützen-Bereiche in Weltkoordinaten. Der Punkt ist als Anteil der
 * Objekt-Bounding-Box gespeichert und wandert so beim Verschieben mit.
 */
function paintMarks(objects: ModelObject[], shift: { x: number; y: number } = { x: 0, y: 0 }): {
  force: { x: number; y: number; z: number; r: number }[]
  block: { x: number; y: number; r: number }[]
} {
  const out: { force: { x: number; y: number; z: number; r: number }[]; block: { x: number; y: number; r: number }[] } = {
    force: [],
    block: [],
  }
  for (const o of objects) {
    if (!o.paint?.length) continue
    const placed = placeMesh(o.mesh, o.placement)
    const { min, size } = placed.bbox
    for (const m of o.paint) {
      const point = {
        x: min.x + m.fx * size.x + shift.x,
        y: min.y + m.fy * size.y + shift.y,
        z: min.z + m.fz * size.z,
        r: m.r,
      }
      if (m.block) out.block.push(point)
      else out.force.push(point)
    }
  }
  return out
}

// ---------- Slicen ----------

app.post('/api/slice', async (req, res) => {
  const { modelId, settings, profileId, plate, filamentId, slots, activeSlotId, filaments, customGcode, postProcessing, limits, flavor, printerOverrides, modelCenter } = req.body as {
    modelId: string
    settings: PrintSettings
    profileId: string
    /** Abweichender Firmware-Geschmack aus den Druckereinstellungen */
    flavor?: GcodeFlavor
    /** Eigener Start-/End-/Schicht-/Pause-G-code des gewählten Druckers */
    customGcode?: CustomGcode
    /** Externes Post-Processing-Skript (EXE, BAT/CMD, PS1) */
    postProcessing?: PostProcessingScript
    /** Vom Benutzer gesetzte Grenzen aus dem Druckerstand */
    limits?: Partial<PrinterLimits>
    /** 0-basierte Platte aus einer Mehrplatten-3MF */
    plate?: number
    /** Aktives Filamentprofil und physische Slots für Farbe/Material. */
    filamentId?: string
    slots?: FilamentSlot[]
    activeSlotId?: string
    /** Eigene Bauraum-, Kinematik- und Materialwerte; nur für diesen Slice-Auftrag. */
    printerOverrides?: PrinterOverrides
    /** Fester Bezugspunkt der Oberfläche; ohne ihn bleibt das alte Zentrieren. */
    modelCenter?: { x: number; y: number }
    /** Filamentwerte je zugewiesener ID (Temperatur, Fluss, Lüfter, Metadaten) */
    filaments?: Record<
      string,
      {
        nozzle?: number
        bed?: number
        flow?: number
        fanSpeed?: number
        maxVolumetricFlow?: number
        material?: string
        name?: string
        density?: number
      }
    >
  }
  const model = models.get(modelId)
  if (!model) {
    res.status(404).json({ error: 'Modell nicht gefunden — bitte erneut hochladen.' })
    return
  }
  const profile = applyPrinterOverrides(printerById(profileId), printerOverrides)
  // Die selbst gesetzten Grenzen ersetzen die Werkswerte, auch nach oben.
  const machine = {
    ...profile,
    flavor: isGcodeFlavor(flavor) ? flavor : profile.flavor,
    ...effectivePrinterLimits(profile, limits),
  }
  const merged: PrintSettings = applyPrinterLimits(machine, mergeSettings(DEFAULT_SETTINGS, settings ?? {}))
  // Veröffentlichte Testversion: Die „Kratzerfreie Oberfläche“ ist nicht Teil
  // des Funktionsumfangs. Alte Profile oder direkte API-Aufrufe dürfen sie
  // deshalb nicht stillschweigend wieder einschalten.
  if (!FEATURES.surfaceGuard) merged.surfaceGuard = { ...merged.surfaceGuard, enabled: false }
  // Nur das Mesh, das zu diesem Profil gespeichert wurde — nie das eines anderen Druckers
  const mesh = merged.meshCompensation === 'software' ? loadMesh(profile.id) : null

  // Mehrplatten-3MF: nur die gewählte Platte wird geslict. Der Plattenversatz
  // wird aus den G-Code-Koordinaten herausgerechnet; mit modelCenter bleibt
  // zusätzlich die im Viewer gewählte Lage erhalten.
  const plateNo = Math.max(0, Math.floor(Number(plate ?? 0)))
  const plateShift = plateOffsetX(plateNo, profile.bed.x)
  const viewCenter =
    modelCenter && Number.isFinite(modelCenter.x) && Number.isFinite(modelCenter.y)
      ? modelCenter
      : undefined
  const plateObjects = model.objects.filter((o) => (o.plate ?? 0) === plateNo)
  if (model.objects.length > 0 && plateObjects.length === 0) {
    res.status(400).json({ error: `Auf Platte ${plateNo + 1} liegt kein Objekt.` })
    return
  }
  const printableOnPlate = plateObjects.filter((o) => !o.excluded)
  if (plateObjects.length > 0 && printableOnPlate.length === 0) {
    res.status(400).json({ error: 'Alle Objekte auf dieser Platte sind ausgeschlossen.' })
    return
  }
  const source =
    plateObjects.length > 0 ? (composeObjects(printableOnPlate) ?? model.mesh) : model.mesh
  if (!source) {
    res.status(400).json({ error: 'Kein druckbares Objekt vorhanden.' })
    return
  }
  // Die Objektkoordinaten der Oberfläche sind relativ zum festgehaltenen
  // Modellanker. Bettkoordinaten = Objektkoordinaten + Bettmitte - Anker,
  // bei Mehrplatten zusätzlich minus dem Versatz der gewählten Platte.
  const placementShift = viewCenter
    ? {
        x: profile.bed.x / 2 - viewCenter.x - plateShift,
        y: profile.bed.y / 2 - viewCenter.y,
      }
    : undefined
  const fallbackObjectShift = { x: -plateShift, y: 0 }
  // Eingelassener Text wird nicht mitgedruckt, sondern aus jeder Schicht entfernt.
  const engraving = plateObjects
    .filter((o) => o.placement.visible && o.negative && !o.excluded)
    .map((o) => placeMesh(o.mesh, o.placement))
  // Taste L: gemalte Stützen und Blocker dieser Platte.
  const paint = paintMarks(printableOnPlate, placementShift)

  // Mehrfarbdruck: Objekte mit unterschiedlichen Filamenten werden nacheinander
  // gedruckt (wie „sequenzielles Drucken“). Zwischen den Filamenten steht M600.
  const visibleOnPlate = plateObjects.filter((o) => o.placement.visible && !o.negative && !o.excluded)
  const sequentialSetting = merged.sequentialPrint?.enabled === true
  // Ein zusammengebautes Einzelobjekt kann aus mehreren Hüllen bestehen, die
  // sich überlappen (z.B. Orca-Zusammenbau). Ohne Vereinigung slict der
  // Drucker sie als getrennte Teile — genau das passierte beim vorderen Teil.
  const singleObjectSource =
    visibleOnPlate.length === 1 ? await unionOverlappingComponents(source) : source
  const activeFilamentId = filamentId ?? 'pla'
  const slotFor = (slotId?: string) =>
    slots?.find((s) => s.id === slotId) ?? (slotId ? undefined : slots?.find((s) => s.id === activeSlotId)) ?? slots?.[0]
  /** Werkzeugnummer für T0…Tn: Position des Slots in der Zuführung. */
  const slotIndexFor = (slotId?: string) => {
    const index = slots?.findIndex((entry) => entry.id === slotId)
    return typeof index === 'number' && index >= 0 ? index : 0
  }
  const filamentMeta = (profileId?: string, slotId?: string): GcodeFilamentMetadata => {
    const id = profileId ?? activeFilamentId
    const values = filaments?.[id]
    const fallback = filamentById(id)
    return {
      type: values?.material ?? fallback.material,
      name: values?.name ?? fallback.name,
      density: values?.density ?? fallback.density,
      color: slotFor(slotId)?.color,
    }
  }
  // Mehrfarbdruck: gruppiert nach Filament-Zuordnung, nicht nur nach
  // Werkzeugnummer. Zwei Filamentprofile können denselben Slot nutzen (z. B.
  // PLA und PETG an einem Extruder mit M600) — das ist trotzdem mehrfarbig.
  const colorGroups = new Map<string, ModelObject[]>()
  for (const object of visibleOnPlate) {
    const key = `${object.placement.filamentId ?? activeFilamentId}|${object.placement.slotId ?? ''}`
    const list = colorGroups.get(key)
    if (list) list.push(object)
    else colorGroups.set(key, [object])
  }
  const colorKeys = [...colorGroups.keys()]
  /**
   * Mehrfarbdruck wird immer schichtweise gedruckt. Nur so kann in jeder
   * Schicht die Farbe gewechselt und in einen Turm gespült werden; beim
   * Objekt-für-Objekt-Druck würde der Turm bei jedem Wechsel auf Z0 neu
   * beginnen und der Kopf über fertige Teile fahren.
   */
  const layerwiseMultiColor = colorKeys.length > 1
  const sequentialRequested = sequentialSetting && !layerwiseMultiColor
  const assigned = new Set(visibleOnPlate.map((o) => o.placement.filamentId ?? ''))
  const safeLabel = (name: string) => name.replace(/[\r\n;]/g, ' ').trim() || 'Objekt'
  const safeObject = (name: string) =>
    name.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'Objekt'
  /**
   * Klipper verlangt für `EXCLUDE_OBJECT_DEFINE` ein Polygon, sobald ein
   * Drucker-Makro die Objektliste auswertet. Der AD5X ruft in START_PRINT
   * `_SMART_PARK` auf und liest `printer.exclude_object.objects[*].polygon`;
   * ohne Polygon bricht der Start mit „dict object has no attribute polygon“
   * ab. Die Bounding-Box aller G0/G1/G2/G3-Punkte reicht: `_SMART_PARK` nutzt
   * nur die kleinste X-/Y-Koordinate als Parkposition.
   */
  const klipperObjectPolygon = (gcode: string): string | null => {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    const moves = /^(?:N\d+\s+)?G(?:0|1|2|3)\b([^\n;]*)/gim
    let match: RegExpExecArray | null
    while ((match = moves.exec(gcode))) {
      const params = match[1]
      const x = /(?:^|\s)X(-?\d+(?:\.\d+)?)/i.exec(params)
      const y = /(?:^|\s)Y(-?\d+(?:\.\d+)?)/i.exec(params)
      if (x) {
        const value = Number(x[1])
        if (Number.isFinite(value)) {
          minX = Math.min(minX, value)
          maxX = Math.max(maxX, value)
        }
      }
      if (y) {
        const value = Number(y[1])
        if (Number.isFinite(value)) {
          minY = Math.min(minY, value)
          maxY = Math.max(maxY, value)
        }
      }
    }
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null
    // 0,5 mm Rand: Die Düsenmitte liegt sonst genau auf der Objektkante.
    const pad = 0.5
    const fmt = (value: number) => String(Math.round(value * 100) / 100)
    const x0 = fmt(minX - pad)
    const y0 = fmt(minY - pad)
    const x1 = fmt(maxX + pad)
    const y1 = fmt(maxY + pad)
    return `[[${x0},${y0}],[${x1},${y0}],[${x1},${y1}],[${x0},${y1}]]`
  }
  const labelPart = (gcode: string, name: string, index = 0, count = 1) => {
    const output = merged.output
    // ZMOD-Drucker (z. B. AD5X) lesen im Startmakro die Objektliste: Ohne
    // EXCLUDE_OBJECT_DEFINE fällt die Düsen-Reinigungslinie auf _CLEAR2
    // zurück — eine Bahn quer über die vordere Bettkante bei 0,2 mm, die bei
    // knappem Bett-Mesh die Düse ins Bett drückt (Kollisionsschutz → Shutdown).
    // Deshalb dort unabhängig vom Schalter schreiben.
    const exclude = output?.excludeObjects === true || machine.zmodMesh === true
    if (!output?.objectLabels && !exclude) return gcode
    const label = safeLabel(name)
    const objectName = safeObject(name)
    const lines: string[] = []
    let excludeDefined = false
    if (output?.objectLabels) lines.push(`; OBJECT_START: ${label}`)
    if (exclude) {
      if (isKlipperFlavor(machine.flavor)) {
        const polygon = klipperObjectPolygon(gcode)
        if (polygon) {
          lines.push(`EXCLUDE_OBJECT_DEFINE NAME=${objectName} POLYGON=${polygon}`)
          lines.push(`EXCLUDE_OBJECT_START NAME=${objectName}`)
          excludeDefined = true
        }
        // Ohne Polygon lieber gar keine Objektmarkierung als ein Abbruch in
        // _SMART_PARK: Klipper verträgt ein leeres exclude_object.
      } else {
        if (index === 0) lines.push(`M486 T${Math.max(1, count)} ; Objektanzahl`)
        lines.push(`M486 S${index} ; ${label}`)
        excludeDefined = true
      }
    }
    lines.push(gcode)
    if (excludeDefined) {
      lines.push(isKlipperFlavor(machine.flavor) ? `EXCLUDE_OBJECT_END NAME=${objectName}` : 'M486 S-1')
    }
    if (output?.objectLabels) lines.push(`; OBJECT_END: ${label}`)
    return `${lines.join('\n')}\n`
  }
  const finalize = async (result: SliceResult): Promise<SliceResult> => {
    const processed = await runPostProcessing(result.gcode, postProcessing, {
      modelName: model.name,
      printerName: machine.name,
    })
    if (processed.warning) result.warnings.push(processed.warning)
    if (processed.info) {
      result.postProcess = processed.info
      result.warnings.push(
        'Post-Processing wurde ausgeführt — Vorschau und Statistik beschreiben den G-Code davor.',
      )
      // Ein Post-Processing darf Zeilen einfügen oder entfernen. Die
      // Vorschau-Zeilennummern würden dann auf die falsche Stelle zeigen.
      for (const layer of result.layers) delete layer.lines
    }
    result.gcode = processed.gcode
    return result
  }
  // ---- Mehrfarbdruck: immer schichtweise ----
  if (layerwiseMultiColor) {
    const started = Date.now()
    try {
      const warnings: string[] = []
      if (sequentialSetting) {
        warnings.push(
          'Mehrfarbdruck wird immer schichtweise gedruckt — der sequenzielle Modus ist dafür abgeschaltet.',
        )
      }
      if (merged.adaptiveLayerHeight?.enabled) {
        warnings.push(
          'Mehrfarbdruck rechnet mit fester Schichthöhe; die adaptive Schichthöhe ist dafür ausgeschaltet.',
        )
      }
      if (merged.adhesion !== 'none') {
        warnings.push(
          'Mehrfarbdruck: Saum/Brim wird ausgelassen — jede Farbe würde sonst ihren eigenen Rand um dieselben Objekte ziehen. Erste Schicht am Drucker prüfen.',
        )
      }
      const baseSettings = applyPrinterLimits(
        machine,
        mergeSettings(merged, {
          adaptiveLayerHeight: { ...merged.adaptiveLayerHeight, enabled: false },
          adhesion: 'none',
          sequentialPrint: { enabled: false, clearance: merged.sequentialPrint?.clearance ?? 5 },
        }),
      )
      const multi = normalizeMultiMaterial(baseSettings.multiMaterial)
      if (multi.change === 'm600') {
        warnings.push(
          'Farbwechsel je Schicht mit M600: Der Drucker pausiert bei jedem Wechsel. Für IFS/AMS/MMU das passende Makro oder T0…Tn wählen.',
        )
      }
      const objectShift = placementShift ?? fallbackObjectShift
      const objectBoxes = visibleOnPlate.map((object, index) => {
        const box = transformMesh(placeMesh(object.mesh, object.placement), {
          x: objectShift.x,
          y: objectShift.y,
          z: 0,
        }).bbox
        return {
          id: object.id,
          name: `${object.name} ${index + 1}`,
          minX: box.min.x,
          minY: box.min.y,
          maxX: box.max.x,
          maxY: box.max.y,
          maxZ: box.max.z,
        }
      })
      const footprint = objectBoxes.reduce(
        (box, entry) => ({
          min: { x: Math.min(box.min.x, entry.minX), y: Math.min(box.min.y, entry.minY) },
          max: { x: Math.max(box.max.x, entry.maxX), y: Math.max(box.max.y, entry.maxY) },
        }),
        { min: { x: Infinity, y: Infinity }, max: { x: -Infinity, y: -Infinity } },
      )
      const groups = colorKeys.map((key, id) => {
        const objects = colorGroups.get(key) ?? []
        const parts = objects.map((object) => placeMesh(object.mesh, object.placement))
        const total = parts.reduce((sum, part) => sum + part.positions.length, 0)
        const positions = new Float32Array(total)
        let offset = 0
        for (const part of parts) {
          positions.set(part.positions, offset)
          offset += part.positions.length
        }
        const fid =
          objects.map((object) => object.placement.filamentId).find((id): id is string => !!id) ?? activeFilamentId
        const f = filaments?.[fid]
        // 3MF-Objektwerte gelten je Objekt; innerhalb einer Farbe müssen sie
        // gleich sein, sonst wäre der gemeinsame Durchlauf nicht eindeutig.
        const objectDefaults = objects.map((object) => object.settings).find((value) => !!value) ?? {}
        const settings = applyPrinterLimits(
          machine,
          mergeSettings(baseSettings, {
            ...(f
              ? {
                  flow: f.flow ?? baseSettings.flow,
                  fanSpeed: f.fanSpeed ?? baseSettings.fanSpeed,
                  maxVolumetricFlow: f.maxVolumetricFlow ?? baseSettings.maxVolumetricFlow,
                  temps: {
                    nozzle: f.nozzle ?? baseSettings.temps.nozzle,
                    firstLayerNozzle: f.nozzle ?? baseSettings.temps.firstLayerNozzle,
                    bed: f.bed ?? baseSettings.temps.bed,
                    firstLayerBed: f.bed ?? baseSettings.temps.firstLayerBed,
                  },
                }
              : {}),
            ...objectDefaults,
          }),
        )
        const boxes = objectBoxes.filter((entry) => objects.some((object) => object.id === entry.id))
        const center = {
          x: boxes.reduce((sum, entry) => sum + (entry.minX + entry.maxX) / 2, 0) / Math.max(1, boxes.length),
          y: boxes.reduce((sum, entry) => sum + (entry.minY + entry.maxY) / 2, 0) / Math.max(1, boxes.length),
        }
        return {
          id,
          tool: slotIndexFor(objects[0]?.placement.slotId),
          objects,
          mesh: makeMesh(positions, false),
          settings,
          center,
          filament: filamentMeta(fid, objects[0]?.placement.slotId),
        }
      })
      for (const group of groups) {
        const first = JSON.stringify(group.objects[0]?.settings ?? {})
        if (group.objects.some((object) => JSON.stringify(object.settings ?? {}) !== first)) {
          warnings.push(
            'Mehrfarbdruck: Objekte einer Farbe mit unterschiedlichen 3MF-Objektwerten werden mit den Werten des ersten Objekts gedruckt.',
          )
          break
        }
      }

      // Schichtplanung einmal für alle Farben — sonst läge jede Farbe auf
      // einem eigenen Raster und die Schichten würden auseinanderlaufen.
      const bands = planSliceBands(source, baseSettings, machine, {
        center: false,
        offset: objectShift,
      }).bands
      if (!bands.length) {
        res.status(400).json({ error: 'Keine Schichten berechnet — Modell und Einstellungen prüfen.' })
        return
      }

      // Purge-Turm: je Farbe ein eigener Querschnitt neben den Objekten.
      let towerPlan: PurgeTowerPlan | null = null
      if (multi.tower.enabled && multi.purge.enabled && multi.purge.volume > 0) {
        towerPlan = planPurgeTowers({
          bed: { x: machine.bed.x, y: machine.bed.y },
          objects: objectBoxes,
          tools: groups.map((group) => group.id),
          volume: multi.purge.volume,
          layerHeight: baseSettings.layerHeight,
          gap: multi.tower.gap,
        })
        if (!towerPlan.ok) {
          res.status(400).json({ error: towerPlan.error })
          return
        }
      } else {
        warnings.push(
          'Mehrfarbdruck ohne Purge-Turm: Die alte Farbe kann in das Bauteil ziehen. Turm und Spülen unter „Filamentwechsel & Spülen“ einschalten.',
        )
      }

      // Jede Farbe als eigener Durchlauf, aber auf derselben Schichtliste und
      // mit E0 am Schichtanfang — damit lassen sich die Blöcke einsetzen.
      const sliced = groups.map((group, index) => {
        const cuts = group.objects.flatMap((object) =>
          plateObjects
            .filter((o) => o.placement.visible && o.negative && !o.excluded && o.text?.targetId === object.id)
            .map((o) => placeMesh(o.mesh, o.placement)),
        )
        return {
          group,
          result: sliceMesh(group.mesh, group.settings, machine, mesh, model.overrides, {
            start: index === 0,
            end: index === 0,
            center: false,
            offset: objectShift,
            bands,
            resetExtruderEachLayer: true,
            subtract: cuts,
            customGcode,
            metadata: false,
            paint: paintMarks(group.objects, objectShift),
            footprint,
          }),
        }
      })
      for (const { result } of sliced) warnings.push(...result.warnings)

      const assembled = assembleLayerwise({
        groups: sliced.map(({ group, result }) => ({
          id: group.id,
          tool: group.tool,
          sections: splitGcodeSections(result.gcode),
          layers: result.layers,
          center: group.center,
          nozzle: group.settings.temps.nozzle,
          bed: group.settings.temps.bed,
          nozzleDiameter: group.settings.nozzle,
          filamentDiameter: group.settings.filamentDiameter,
        })),
        bands,
        onToolChange: (group, z, height) => {
          const lines: string[] = ['; ---- Farbwechsel ----']
          lines.push('G92 E0', `G1 E-${Math.max(0, multi.retract).toFixed(2)} F1800`)
          lines.push(`G1 Z${(z + multi.zLift + 1).toFixed(2)} F600`)
          const cell = towerPlan?.ok ? towerPlan.cells.find((entry) => entry.tool === group.tool) : undefined
          const parkX = cell ? cell.x + cell.size / 2 : group.center.x
          const parkY = cell ? cell.y + cell.size / 2 : group.center.y
          lines.push(`G0 X${parkX.toFixed(2)} Y${parkY.toFixed(2)} F9000`)
          lines.push(
            ...filamentChangeGcode({
              multi,
              tool: group.tool,
              nozzle: group.nozzle,
              bed: group.bed,
            }),
          )
          let filamentMm = 0
          let seconds = 0
          let volumeMm3 = 0
          if (cell) {
            const patch = purgeTowerPatch({
              cell,
              z,
              height,
              volume: multi.purge.volume,
              speed: multi.purge.speed,
              nozzle: group.nozzleDiameter,
              filamentDiameter: group.filamentDiameter,
              retract: multi.retract,
              zLift: multi.zLift,
            })
            lines.push(...patch.lines)
            filamentMm = patch.filamentMm
            seconds = patch.seconds
            volumeMm3 = patch.volumeMm3
          }
          lines.push(`G0 X${group.center.x.toFixed(2)} Y${group.center.y.toFixed(2)} F9000`)
          return { lines, filamentMm, seconds, volumeMm3 }
        },
      })

      let seconds = assembled.stats.towerSeconds
      let filamentMm = assembled.stats.towerFilamentMm
      let grams = (assembled.stats.towerFilamentMm * Math.PI * (1.75 / 2) ** 2 * 1.24) / 1000
      let volume = assembled.stats.towerVolumeMm3 / 1000
      let maxFlow = 0
      const featureTotals = new Map<PreviewFeatureKind, { seconds: number; volumeMm3: number }>()
      for (const { result } of sliced) {
        seconds += result.stats.estimatedSeconds
        filamentMm += result.stats.filamentMm
        grams += result.stats.filamentGrams
        volume += result.stats.volumeCm3
        maxFlow = Math.max(maxFlow, result.stats.maxFlowMm3s)
        for (const feature of result.features) {
          const entry = featureTotals.get(feature.kind) ?? { seconds: 0, volumeMm3: 0 }
          entry.seconds += feature.seconds
          entry.volumeMm3 += (feature.grams / 1.24) * 1000
          featureTotals.set(feature.kind, entry)
        }
      }

      // Objektmarker: ZMOD-Drucker brauchen die Definitionen vor START_PRINT
      // (A-176). Start/Ende je Objekt geht im schichtweisen Druck nicht, weil
      // sich die Objekte jeder Schicht abwechseln — die Definitionen bleiben.
      const definitions: string[] = []
      if (merged.output?.excludeObjects === true || machine.zmodMesh === true) {
        if (isKlipperFlavor(machine.flavor)) {
          const pad = 0.5
          objectBoxes.forEach((box, index) => {
            const x0 = (box.minX - pad).toFixed(2)
            const y0 = (box.minY - pad).toFixed(2)
            const x1 = (box.maxX + pad).toFixed(2)
            const y1 = (box.maxY + pad).toFixed(2)
            definitions.push(
              `EXCLUDE_OBJECT_DEFINE NAME=${safeObject(box.name)}_${index + 1} POLYGON=[[${x0},${y0}],[${x1},${y0}],[${x1},${y1}],[${x0},${y1}]]`,
            )
          })
        } else {
          definitions.push(`M486 T${objectBoxes.length} ; Objektanzahl`)
        }
      }

      const marker = '; ---- Mehrfarbdruck je Schicht ----'
      const raw = [marker, ...definitions, assembled.gcode].join('\n')
      const usedFilaments: GcodeFilamentMetadata[] = []
      const usedKeys = new Set<string>()
      for (const group of groups) {
        const key = `${group.filament.name}|${group.filament.color ?? ''}`
        if (usedKeys.has(key)) continue
        usedKeys.add(key)
        usedFilaments.push(group.filament)
      }
      const combined = withGcodeMetadata(raw, {
        profile: machine,
        settings: baseSettings,
        filaments: usedFilaments,
        seconds,
        filamentMm,
        filamentGrams: grams,
        layerCount: assembled.layers.length,
        maxZ: assembled.layers.reduce((max, layer) => Math.max(max, layer.z), 0),
        toolChanges: assembled.stats.toolChanges,
      })
      // Zeilenkarte: Metadatenblock + Markierung + Objektdefinitionen stehen vor
      // dem zusammengesetzten G-Code; jede Vorschauzeile wandert um diese Zahl.
      shiftPreviewLines(
        assembled.layers,
        gcodeLineOffsetBefore(combined, marker) + definitions.length + 1,
      )
      const stats = {
        estimatedSeconds: seconds,
        filamentMm: Math.round(filamentMm),
        filamentGrams: Math.round(grams * 10) / 10,
        layerCount: assembled.layers.length,
        volumeCm3: Math.round(volume * 10) / 10,
        maxFlowMm3s: Math.round(maxFlow * 10) / 10,
      }
      const finalized = await finalize({
        gcode: combined,
        layers: assembled.layers,
        features: featureRows(featureTotals),
        stats,
        warnings: [...new Set(warnings)],
      })
      res.json({ ...finalized, sliceMs: Date.now() - started, preview: finalized.layers })
      return
    } catch (err) {
      console.error('Slice-Fehler (Mehrfarbdruck je Schicht):', err)
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Mehrfarbdruck je Schicht fehlgeschlagen.',
      })
      return
    }
  }

  if (visibleOnPlate.length > 1 && sequentialRequested) {
    const started = Date.now()
    try {
      const { dx, dy } = machineOffset(machine)
      const parts: string[] = []
      const layers: SliceResult['layers'] = []
      const warnings: string[] = []
      let seconds = 0
      let filamentMm = 0
      let grams = 0
      let volume = 0
      let maxFlow = 0
      const featureTotals = new Map<PreviewFeatureKind, { seconds: number; volumeMm3: number }>()
      const usedFilaments: GcodeFilamentMetadata[] = []
      const usedFilamentKeys = new Set<string>()
      let previousFilamentKey: string | undefined
      let toolChanges = 0
      let previousObjectMaxZ = 0
      // Spüllinien je Wechsel: eigenes Material und eigene Zeit, sonst würde
      // die Statistik den Verbrauch zu niedrig anzeigen.
      let purgeMillimeters = 0
      let purgeSeconds = 0
      let purgeVolumeMm3 = 0

      // Die Reihenfolge wird vor dem ersten Slice festgelegt. Bei sequenziellem
      // Druck kommt das niedrigste Objekt zuerst; dadurch kann der Kopf später
      // über bereits fertige Teile fahren. Der Abstand wird an den tatsächlich
      // platzierten Bounding-Boxen geprüft, inklusive Saum/Brim-Rand.
      const lineWidth = merged.lineWidth > 0 ? merged.lineWidth : merged.nozzle
      const adhesionMargin =
        merged.adhesion === 'brim'
          ? Math.max(0, merged.brim.width + merged.brim.gap)
          : merged.adhesion === 'skirt'
            ? Math.max(0, merged.skirt.distance + lineWidth * Math.max(1, Math.round(merged.skirt.loops)))
            : 0
      const objectShift = placementShift ?? fallbackObjectShift
      const layoutBoxes = visibleOnPlate.map((object) => {
        const placed = transformMesh(placeMesh(object.mesh, object.placement), {
          x: objectShift.x,
          y: objectShift.y,
          z: 0,
        })
        const box = placed.bbox
        return {
          id: object.id,
          name: object.name,
          minX: box.min.x - adhesionMargin,
          minY: box.min.y - adhesionMargin,
          maxX: box.max.x + adhesionMargin,
          maxY: box.max.y + adhesionMargin,
          maxZ: box.max.z,
        }
      })
      const orderPlan = sequentialRequested
        ? planSequentialOrder(layoutBoxes, merged.sequentialPrint?.clearance ?? 5)
        : null
      if (orderPlan?.violations.length) {
        const pairs = orderPlan.violations
          .map((violation) => `${violation.a} ↔ ${violation.b} (${violation.gap.toFixed(1)} mm)`)
          .join(', ')
        res.status(400).json({
          error:
            `Sequenzieller Druck: Mindestabstand ${orderPlan.clearance.toFixed(1)} mm nicht eingehalten — ${pairs}. ` +
            'Objekte weiter auseinanderstellen oder den Abstand in den Einstellungen reduzieren.',
        })
        return
      }
      const sequenceObjects = orderPlan
        ? orderPlan.order.map((index) => visibleOnPlate[index])
        : visibleOnPlate

      for (const [index, object] of sequenceObjects.entries()) {
        const fid = object.placement.filamentId
        const f = fid ? filaments?.[fid] : undefined
        const objectFilament = filamentMeta(fid, object.placement.slotId)
        const filamentKey = `${fid ?? ''}|${object.placement.slotId ?? ''}|${objectFilament.color ?? ''}`
        const changedFilament = index > 0 && filamentKey !== previousFilamentKey
        if (changedFilament) toolChanges++
        if (!usedFilamentKeys.has(filamentKey)) {
          usedFilamentKeys.add(filamentKey)
          usedFilaments.push(objectFilament)
        }
        // Objektwerte aus einer 3MF-Datei gelten nur für dieses Objekt. Das
        // Filamentprofil darf sie danach bei Flow/Temperatur/Lüfter ergänzen.
        const objectBase = object.settings ? mergeSettings(merged, object.settings) : merged
        const objectSettings = applyPrinterLimits(
          machine,
          f
            ? mergeSettings(objectBase, {
                flow: f.flow ?? objectBase.flow,
                fanSpeed: f.fanSpeed ?? objectBase.fanSpeed,
                maxVolumetricFlow: f.maxVolumetricFlow ?? objectBase.maxVolumetricFlow,
                temps: {
                  nozzle: f.nozzle ?? objectBase.temps.nozzle,
                  firstLayerNozzle: f.nozzle ?? objectBase.temps.firstLayerNozzle,
                  bed: f.bed ?? objectBase.temps.bed,
                  firstLayerBed: f.bed ?? objectBase.temps.firstLayerBed,
                },
              })
            : objectBase,
        )
        // Mit Anker enthält placementShift bereits den Plattenversatz. Ohne
        // Anker bleibt der bisherige plattenlokale Versatz erhalten.
        const objectSource = placeMesh(object.mesh, object.placement)
        const placed = transformMesh(objectSource, { x: objectShift.x, y: objectShift.y, z: 0 })
        const box = placed.bbox

        if (index > 0) {
          // Sicher über dem bisherigen Teil parken, bevor das nächste beginnt.
          parts.push('; ---- Objektwechsel ----', 'G92 E0', 'M107')
          const safeZ = Math.max(10, previousObjectMaxZ + 10, box.max.z + 10).toFixed(1)
          parts.push(`G1 Z${safeZ} F600`)
          if (changedFilament) {
            for (const l of String(customGcode?.pause ?? '').split('\n')) {
              if (l.trim()) parts.push(l.replaceAll('{nozzle}', String(objectSettings.temps.nozzle)).replaceAll('{bed}', String(objectSettings.temps.bed)))
            }
            // Wechselbefehl aus den Einstellungen: M600, T0…Tn oder ein eigenes
            // Makro. Danach wird gespült, sonst zieht die alte Farbe ins neue Teil.
            const multi = normalizeMultiMaterial(objectSettings.multiMaterial)
            for (const line of filamentChangeGcode({
              multi,
              tool: slotIndexFor(object.placement.slotId),
              nozzle: objectSettings.temps.nozzle,
              bed: objectSettings.temps.bed,
            })) {
              parts.push(line)
            }
            const purge = planPurgeLine({
              bed: { x: machine.bed.x, y: machine.bed.y },
              objects: layoutBoxes.map((box) => ({
                minX: box.minX,
                minY: box.minY,
                maxX: box.maxX,
                maxY: box.maxY,
              })),
              multi,
              index: Math.max(0, toolChanges - 1),
              nozzle: objectSettings.nozzle,
              filamentDiameter: objectSettings.filamentDiameter,
              z: Math.max(0.2, objectSettings.firstLayerHeight),
              layerHeight: Math.max(0.05, objectSettings.firstLayerHeight),
            })
            if (purge.lines.length) {
              parts.push(...purge.lines)
              purgeMillimeters += purge.filamentMm
              purgeSeconds += purge.seconds
              purgeVolumeMm3 += purge.volumeMm3
            }
            if (purge.skipped) warnings.push(`Spülen nach dem Wechsel: ${purge.skipped}`)
          }
          const cx = ((box.min.x + box.max.x) / 2 + dx).toFixed(2)
          const cy = ((box.min.y + box.max.y) / 2 + dy).toFixed(2)
          parts.push(`G0 X${cx} Y${cy} F${Math.round(objectSettings.speeds.travel * 60)}`)
        }

        const cuts = plateObjects
          .filter((o) => o.placement.visible && o.negative && !o.excluded && o.text?.targetId === object.id)
          .map((o) => placeMesh(o.mesh, o.placement))
        const part = sliceMesh(objectSource, objectSettings, machine, mesh, model.overrides, {
          start: index === 0,
          end: index === sequenceObjects.length - 1,
          center: false,
          offset: objectShift,
          subtract: cuts,
          customGcode,
          metadata: false,
          paint: paintMarks([object], objectShift),
        })
        const labeled = labelPart(part.gcode, object.name, index, sequenceObjects.length)
        const partLineOffset = parts.length ? gcodeLineBreaks(parts.join('\n')) + 1 : 0
        shiftPreviewLines(
          part.layers,
          partLineOffset + gcodeLineOffsetBefore(labeled, part.gcode.slice(0, 200)),
        )
        parts.push(labeled)
        layers.push(...part.layers)
        warnings.push(...part.warnings)
        seconds += part.stats.estimatedSeconds
        filamentMm += part.stats.filamentMm
        grams += part.stats.filamentGrams
        volume += part.stats.volumeCm3
        maxFlow = Math.max(maxFlow, part.stats.maxFlowMm3s)
        for (const feature of part.features) {
          const entry = featureTotals.get(feature.kind) ?? { seconds: 0, volumeMm3: 0 }
          entry.seconds += feature.seconds
          entry.volumeMm3 += (feature.grams / 1.24) * 1000
          featureTotals.set(feature.kind, entry)
        }
        previousObjectMaxZ = Math.max(previousObjectMaxZ, box.max.z)
        previousFilamentKey = filamentKey
      }

      if (purgeMillimeters > 0) {
        seconds += purgeSeconds
        filamentMm += purgeMillimeters
        grams += (purgeMillimeters * Math.PI * (1.75 / 2) ** 2 * 1.24) / 1000
        volume += purgeVolumeMm3 / 1000
      }

      if (orderPlan) {
        warnings.push(describeSequentialPlan(orderPlan, sequenceObjects.length))
        if (assigned.size > 1 && [...assigned].some((id) => id !== '')) {
          warnings.push('Mehrfarbdruck im sequenziellen Modus: Der Drucker muss M600 (Filamentwechsel) unterstützen.')
        }
      } else {
        warnings.push(
          'Mehrfarbdruck: Die Objekte werden nacheinander gedruckt. Der Drucker muss M600 (Filamentwechsel) unterstützen; Objekte brauchen Abstand, damit der Kopf nicht anfährt.',
        )
      }

      // V-19: Ein altes oder stark gewölbtes Mesh darf nicht unbemerkt in den
      // G-Code wandern. Die Bewertung kommt aus dem Messverlauf dieses Druckers.
      if (mesh) {
        const meshHint = meshJobWarning(historyFor(profile.id))
        if (meshHint) warnings.push(meshHint)
      }

      const stats = {
        estimatedSeconds: seconds,
        filamentMm: Math.round(filamentMm),
        filamentGrams: Math.round(grams * 10) / 10,
        layerCount: layers.length,
        volumeCm3: Math.round(volume * 10) / 10,
        maxFlowMm3s: Math.round(maxFlow * 10) / 10,
      }
      const rawCombined = parts.join('\n') + '\n'
      const combined = withGcodeMetadata(rawCombined, {
        profile: machine,
        settings: merged,
        filaments: usedFilaments,
        seconds,
        filamentMm,
        filamentGrams: grams,
        layerCount: layers.length,
        maxZ: layers.reduce((max, layer) => Math.max(max, layer.z), 0),
        toolChanges,
      })
      shiftPreviewLines(layers, gcodeLineOffsetBefore(combined, rawCombined.slice(0, 200)))
      const finalized = await finalize({
        gcode: combined,
        layers,
        features: featureRows(featureTotals),
        stats,
        warnings: [...new Set(warnings)],
      })
      res.json({ ...finalized, sliceMs: Date.now() - started, preview: finalized.layers })
      return
    } catch (err) {
      console.error('Slice-Fehler (Objekt-für-Objekt):', err)
      res.status(500).json({ error: err instanceof Error ? err.message : 'Objekt-für-Objekt-Druck fehlgeschlagen.' })
      return
    }
  }

  const started = Date.now()
  try {
    // Bei genau einem Objekt dürfen dessen 3MF-Objektwerte das Projektprofil
    // vollständig überschreiben; bei mehreren Objekten geschieht das je Objekt
    // im Mehrfarb-/Sequenzpfad oben.
    const activeObject = visibleOnPlate[0]
    const firstObjectSettings = activeObject?.settings
    // Ein zusammengesetztes 3MF-Objekt kann aus mehreren Hüllen bestehen. Wenn
    // alle dieselben Objektwerte geerbt haben, dürfen sie gemeinsam geslict
    // werden; unterschiedliche Werte brauchen den Objekt-für-Objekt-Pfad.
    const sharedObjectSettings = firstObjectSettings &&
      visibleOnPlate.every((object) => JSON.stringify(object.settings ?? {}) === JSON.stringify(firstObjectSettings))
      ? firstObjectSettings
      : undefined
    const effectiveObjectSettings = visibleOnPlate.length === 1 ? firstObjectSettings : sharedObjectSettings
    const useObjectSettings = !!effectiveObjectSettings
    const singleSettings = applyPrinterLimits(
      machine,
      effectiveObjectSettings ? mergeSettings(merged, effectiveObjectSettings) : merged,
    )
    const result: SliceResult = sliceMesh(singleObjectSource, singleSettings, machine, mesh, model.overrides, {
      // Mit festem Oberflächen-Anker bleibt die gewählte Objektlage erhalten;
      // ohne Anker (z. B. Multiprint) wird wie bisher auf die Bettmitte gesetzt.
      center: placementShift ? false : undefined,
      offset: placementShift,
      subtract: engraving,
      customGcode,
      filament: filamentMeta(filamentId, activeObject?.placement.slotId),
      paint,
    })
    if (!useObjectSettings && visibleOnPlate.some((object) => object.settings)) {
      result.warnings.push(
        'Mehrere Objekte mit unterschiedlichen 3MF-Objektwerten werden gemeinsam geslict — bitte die Objekte einzeln slicen oder unterschiedlichen Filamenten zuweisen.',
      )
    }
    const labeled = labelPart(result.gcode, model.name, 0, 1)
    shiftPreviewLines(result.layers, gcodeLineOffsetBefore(labeled, result.gcode.slice(0, 200)))
    result.gcode = labeled
    if (mesh) {
      const meshHint = meshJobWarning(historyFor(profile.id))
      if (meshHint) result.warnings.push(meshHint)
    }
    if (singleSettings.meshCompensation === 'software' && !mesh) {
      result.warnings.unshift(
        `Für ${profile.name} ist kein Bett-Mesh hinterlegt — geschnitten ohne Bettkorrektur.` +
          (profile.control === 'manual'
            ? ' Dieses Modell gibt keine Messwerte über USB zurück: Bett am Gerät nivellieren.'
            : ' Drucker verbinden und einmal messen, damit die Werte im G-Code landen.'),
      )
    }
    const finalized = await finalize(result)
    res.json({ ...finalized, sliceMs: Date.now() - started, preview: finalized.layers })
  } catch (err) {
    console.error('Slice-Fehler:', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Slicen fehlgeschlagen.' })
  }
})

// ---------- Drucker ----------

app.get('/api/printer/ports', async (_req, res) => {
  res.json({ ports: await listPorts(), profile: printerById(hub.selected.profileId) })
})

app.get('/api/printer/scan', async (_req, res) => {
  res.json({ devices: await scanDevices(), connected: hub.selected.status.connection === 'connected' })
})

/**
 * Sucht Moonraker im lokalen Netz — für Klipper-Mods an Vyper/Ender-3.
 * ?port= für andere Moonraker-Ports als 7125.
 */
app.get('/api/printer/discover/moonraker', async (req, res) => {
  const port = Number(req.query.port ?? 0)
  const started = Date.now()
  try {
    const hosts = await discoverMoonraker(port > 0 ? { port } : {})
    res.json({ hosts, ms: Date.now() - started })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Suche fehlgeschlagen.' })
  }
})

/** Mainsail/Fluidd auf dem Drucker-Host finden und Einbettbarkeit prüfen. */
app.get('/api/webui', async (req, res) => {
  const host = String(req.query.host ?? '').trim()
  if (!host) {
    res.status(400).json({ error: 'Host fehlt.' })
    return
  }
  const port = Number(req.query.port ?? 0) || undefined
  const secure = String(req.query.secure ?? '') === '1'
  const url = String(req.query.url ?? '').trim() || undefined
  try {
    const info = await inspectWebUi({ host, port, secure, url })
    res.json({ info })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Web-Oberfläche nicht erreichbar.' })
  }
})

app.post('/api/printer/connect', async (req, res) => {
  try {
    const opts = req.body as ConnectOptions & { printerId?: string }
    // Verbinden wählt den Drucker auch aus; die andere Verbindung bleibt bestehen.
    const manager = hub.select(opts.printerId ?? opts.profileId)
    const status = await manager.connect(opts)
    broadcast({ type: 'selected', printerId: hub.selectedId })
    res.json({ status })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Verbindung fehlgeschlagen.' })
  }
})

/** Nur die Ansicht umschalten — ohne die bestehende Druckerverbindung zu trennen. */
app.post('/api/printer/select', (req, res) => {
  const { printerId } = req.body as { printerId?: string }
  if (!printerId || typeof printerId !== 'string') {
    res.status(400).json({ error: 'Drucker-ID fehlt.' })
    return
  }
  try {
    const manager = hub.select(printerId)
    broadcast({ type: 'selected', printerId: hub.selectedId })
    res.json({ printerId: hub.selectedId, status: manager.status, mesh: manager.mesh })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Drucker nicht wählbar.' })
  }
})

app.post('/api/printer/disconnect', async (_req, res) => {
  const manager = hub.selected
  await manager.disconnect()
  res.json({ status: manager.status })
})

app.get('/api/printer/status', (_req, res) => {
  const mesh = hub.selected.mesh?.printerId === hub.selected.profileId ? hub.selected.mesh : loadMesh(hub.selected.profileId)
  res.json({ status: hub.selected.status, mesh })
})

app.post('/api/printer/command', async (req, res) => {
  const { line, live } = req.body as { line: string; live?: boolean }
  if (!line || typeof line !== 'string') {
    res.status(400).json({ error: 'Kein Kommando übergeben.' })
    return
  }
  try {
    if (live) {
      hub.selected.sendNow(line)
      res.json({ ok: true, lines: [] })
      return
    }
    const lines = await hub.selected.command(line)
    res.json({ ok: true, lines })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Kommando fehlgeschlagen.' })
  }
})

app.post('/api/printer/jog', async (req, res) => {
  const { axis, delta, feed } = req.body as { axis: 'X' | 'Y' | 'Z'; delta: number; feed?: number }
  try {
    await hub.selected.jog(axis, delta, feed)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Fahren fehlgeschlagen.' })
  }
})

app.post('/api/printer/temp', async (req, res) => {
  const { heater, value } = req.body as { heater: 'nozzle' | 'bed'; value: number }
  try {
    await hub.selected.setTemp(heater, value)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Temperatur fehlgeschlagen.' })
  }
})

app.post('/api/printer/home', async (_req, res) => {
  try {
    await hub.selected.home()
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Homen fehlgeschlagen.' })
  }
})

app.post('/api/printer/motors-off', async (_req, res) => {
  try {
    await hub.selected.motorsOff()
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Motoren konnten nicht abgeschaltet werden.' })
  }
})

app.post('/api/printer/z/measure', async (req, res) => {
  const { samples } = req.body as { samples?: number }
  try {
    const measurement = await hub.selected.measureZ(samples ?? 3)
    res.json({ measurement })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Messung fehlgeschlagen.' })
  }
})

app.post('/api/printer/z/apply', async (req, res) => {
  const { delta } = req.body as { delta?: number }
  if (typeof delta !== 'number' || !Number.isFinite(delta)) {
    res.status(400).json({ error: 'Kein gültiger Korrekturwert.' })
    return
  }
  try {
    await hub.selected.applyZDelta(delta)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Korrektur fehlgeschlagen.' })
  }
})

/** Vorhandenes Firmware-Mesh per USB übernehmen (M420 V, Marlin). */
app.post('/api/printer/mesh/import', async (_req, res) => {
  try {
    const mesh = await hub.selected.importFirmwareMesh()
    res.json({ mesh })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Firmware-Mesh konnte nicht gelesen werden.' })
  }
})

app.post('/api/printer/mesh/probe', async (req, res) => {
  const { mode, cols, rows, modelId, margin } = req.body as {
    mode?: 'auto' | 'manual'
    cols?: number
    rows?: number
    modelId?: string
    margin?: number
  }
  try {
    const model = modelId ? models.get(modelId) : null
    const profile = printerById(hub.selected.profileId)
    const area = model ? footprintOnBed(model.mesh, profile, margin ?? 10) : undefined
    const mesh = await hub.selected.probeBed(mode ?? 'auto', { cols: cols ?? 5, rows: rows ?? 5 }, area)
    res.json({ mesh, area })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Messung fehlgeschlagen.' })
  }
})

app.get('/api/printer/mesh', (_req, res) => {
  const mesh = hub.selected.mesh?.printerId === hub.selected.profileId ? hub.selected.mesh : loadMesh(hub.selected.profileId)
  res.json({ mesh })
})

// Rohantworten der letzten Messung (G29/M420 V bzw. G30) zur Diagnose
app.get('/api/printer/mesh/log', (_req, res) => {
  res.json({ log: hub.selected.probeLog })
})

// Gespeicherte Klipper-Meshprofile für die Auswahl im Setup
app.get('/api/printer/mesh/profiles', async (_req, res) => {
  try {
    res.json(await hub.selected.meshProfiles())
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Meshprofile nicht lesbar.' })
  }
})

// ---------- Mesh pro Druckerprofil ----------

app.get('/api/printers/:printerId/mesh', (req, res) => {
  res.json({ printerId: req.params.printerId, mesh: loadMesh(req.params.printerId) })
})

app.delete('/api/printers/:printerId/mesh', (req, res) => {
  clearMesh(req.params.printerId)
  const manager = hub.resolve(req.params.printerId)
  if (manager.profileId === req.params.printerId) manager.mesh = null
  res.json({ ok: true, printerId: req.params.printerId })
})

app.post('/api/printers/:printerId/mesh/probe', async (req, res) => {
  const { printerId } = req.params
  const { cols, rows, modelId, margin } = req.body as {
    cols?: number
    rows?: number
    modelId?: string
    margin?: number
  }
  const manager = hub.resolve(printerId)
  if (!manager.connected || manager.profileId !== printerId) {
    res.status(400).json({
      error: `Zum Messen muss ${printerById(printerId).name} verbunden sein (verbunden: ${printerById(manager.profileId).name}).`,
    })
    return
  }
  try {
    const profile = printerById(printerId)
    const model = modelId ? models.get(modelId) : null
    const area = model ? footprintOnBed(model.mesh, profile, margin ?? 10) : undefined
    const mesh = await manager.probeBed('auto', { cols: cols ?? profile.meshGrid.cols, rows: rows ?? profile.meshGrid.rows }, area)
    res.json({ mesh: saveMesh(printerId, mesh) })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Messung fehlgeschlagen.' })
  }
})

app.get('/api/printer/mesh/history', (req, res) => {
  const printerId = String(req.query.printerId ?? hub.selected.profileId)
  res.json({ printerId, records: historyFor(printerId) })
})

app.delete('/api/printer/mesh/history', (req, res) => {
  const printerId = String(req.query.printerId ?? hub.selected.profileId)
  clearHistory(printerId)
  res.json({ ok: true, printerId })
})

app.post('/api/printer/mesh/enable', async (_req, res) => {
  try {
    await hub.selected.enableMesh()
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Mesh konnte nicht aktiviert werden.' })
  }
})

app.post('/api/printer/babystep', async (req, res) => {
  const { delta } = req.body as { delta: number }
  try {
    const value = await hub.selected.babystep(delta)
    res.json({ babystep: value })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Babystep fehlgeschlagen.' })
  }
})

app.post('/api/printer/babystep/reset', async (_req, res) => {
  try {
    await hub.selected.resetBabystep()
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Reset fehlgeschlagen.' })
  }
})

app.post('/api/printer/zoffset', async (req, res) => {
  const { value, persist } = req.body as { value: number; persist?: boolean }
  try {
    await hub.selected.setZOffset(value, persist ?? false)
    res.json({ ok: true, zOffset: hub.selected.status.zOffset })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Offset fehlgeschlagen.' })
  }
})

app.post('/api/printer/save', async (_req, res) => {
  try {
    await hub.selected.saveToEeprom()
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Speichern fehlgeschlagen.' })
  }
})

/** G-Code an den verbundenen Netzwerkdrucker senden (ohne USB-Streaming). */
app.post('/api/printer/upload', jsonGcode, async (req, res) => {
  const { name, gcode, start, printerId } = req.body as {
    name?: string
    gcode?: string
    start?: boolean
    printerId?: string
  }
  if (!gcode) {
    res.status(400).json({ error: 'Kein G-Code übergeben.' })
    return
  }
  try {
    const manager = hub.resolve(printerId)
    const file = await manager.uploadGcode(name ?? 'easy-slicer.gcode', gcode, start === true)
    res.json({ file })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Übertragung fehlgeschlagen.' })
  }
})

// ---------- Druck-Warteschlange ----------

app.get('/api/jobs', (_req, res) => {
  res.json({ jobs: jobQueue.list() })
})

app.post('/api/jobs', jsonGcode, (req, res) => {
  const body = req.body as {
    printerId?: string
    name?: string
    gcode?: string
    target?: 'usb' | 'network'
  }
  try {
    const job = jobQueue.enqueue({
      printerId: body.printerId ?? '',
      name: body.name ?? 'easy-slicer.gcode',
      gcode: body.gcode ?? '',
      target: body.target,
    })
    res.json({ job })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Auftrag konnte nicht eingereiht werden.' })
  }
})

app.delete('/api/jobs/:id', (req, res) => {
  try {
    res.json({ job: jobQueue.cancel(String(req.params.id)) })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Auftrag konnte nicht entfernt werden.' })
  }
})

app.post('/api/printer/print', jsonGcode, async (req, res) => {
  const { gcode, name, modelId, settings, profileId, zRef, target } = req.body as {
    gcode?: string
    name?: string
    modelId?: string
    settings?: PrintSettings
    profileId?: string
    zRef?: { mean: number }
    /** 'usb' streamt über die serielle Verbindung, 'network' lädt hoch */
    target?: 'usb' | 'network'
  }

  const merged = mergeSettings(DEFAULT_SETTINGS, settings ?? {})
  // Der Auftrag geht an den Drucker aus dem Slice-Auftrag — nicht an den
  // zufällig zuletzt in der Oberfläche ausgewählten.
  const manager = hub.resolve(profileId)
  const profile = printerById(profileId ?? manager.profileId)
  const model = modelId ? models.get(modelId) : null
  // OctoPrint gibt Sensormesswerte nicht zurück — adaptive Messung und
  // Z-Automatik bleiben Moonraker (Klipper) und USB vorbehalten.
  const measurable = manager.status.mode !== 'octoprint'

  // Ziel prüfen: USB-Streaming und WLAN-Upload brauchen die passende Verbindung
  if (target === 'network' && manager.status.mode !== 'klipper' && manager.status.mode !== 'octoprint') {
    res.status(400).json({
      error: 'Kein Netzwerkdrucker verbunden — bitte unter „Drucker“ mit Klipper/Moonraker oder OctoPrint verbinden.',
    })
    return
  }
  if (target === 'usb' && manager.status.mode !== 'serial' && manager.status.mode !== 'simulation') {
    res.status(400).json({ error: 'Für USB bitte zuerst unter „Drucker“ per USB verbinden.' })
    return
  }
  const adaptive = merged.adaptiveMesh.enabled && !!model && measurable

  // Messungen laufen immer am verbundenen Gerät — nie am falschen Modell
  if (manager.connected && manager.profileId !== profile.id && (adaptive || merged.autoZ.enabled)) {
    res.status(400).json({
      error: `Verbunden ist ${printerById(manager.profileId).name}, gewählt ist ${profile.name} — bitte erst umstellen und neu messen.`,
    })
    return
  }

  // Ohne gespeichertes Mesh: für Marlin-Geräte einmal über USB messen und ablegen
  let bedMesh = merged.meshCompensation === 'software' ? loadMesh(profile.id) : null
  const canProbe = profile.control === 'marlin-serial' && measurable && manager.connected && manager.profileId === profile.id
  if (!bedMesh && !adaptive && canProbe) {
    await manager.heatForProbe(merged.temps.firstLayerNozzle, merged.temps.firstLayerBed)
    bedMesh = saveMesh(profile.id, await manager.probeBed('auto', { cols: profile.meshGrid.cols, rows: profile.meshGrid.rows }))
  }
  // Klipper-Geräte (z. B. AD5X): vorhandenes bed_mesh einmal übernehmen und ablegen
  if (!bedMesh && !adaptive && profile.control === 'klipper-moonraker' && manager.connected && manager.profileId === profile.id) {
    await manager.refreshMesh()
    bedMesh = loadMesh(profile.id)
  }

  if (!gcode && !adaptive) {
    res.status(400).json({ error: 'Kein G-Code übergeben.' })
    return
  }
  if (profile.control === 'manual') {
    res.status(400).json({ error: 'Dieses Profil unterstützt keine Steuerung über den Slicer.' })
    return
  }

  try {
    let finalGcode = gcode ?? ''
    let prep: Record<string, unknown> | null = null
    let zInfo: Record<string, unknown> | null = null

    // Automatische Z-Korrektur: Messwert gegen gespeicherte Referenz
    if (merged.autoZ.enabled && zRef && manager.status.connection === 'connected' && measurable) {
      const m = await manager.measureZ(merged.autoZ.samples)
      const delta = Math.round((m.mean - zRef.mean) * 1000) / 1000
      await manager.applyZDelta(delta)
      zInfo = {
        measured: m.mean,
        reference: zRef.mean,
        delta,
        spread: m.spread,
        probe: m.probe,
        inherent: m.inherent,
      }
    }

    if (adaptive && model) {
      const area = footprintOnBed(model.mesh, profile, merged.adaptiveMesh.margin)
      const grid = Math.max(2, Math.round(merged.adaptiveMesh.grid))
      const size = areaSize(area)

      // Genau messen heißt: heiß messen
      await manager.heatForProbe(merged.temps.firstLayerNozzle, merged.temps.firstLayerBed)
      const mesh = await manager.probeBed('auto', { cols: grid, rows: grid }, area)

      // Die Messung steckt jetzt im G-Code — funktioniert damit auch von SD-Karte
      finalGcode = sliceMesh(
        model.mesh,
        { ...merged, meshCompensation: 'software' },
        profile,
        mesh,
        model.overrides,
      ).gcode

      prep = {
        adaptive: true,
        area: {
          x0: Math.round(area.x0 * 10) / 10,
          y0: Math.round(area.y0 * 10) / 10,
          x1: Math.round(area.x1 * 10) / 10,
          y1: Math.round(area.y1 * 10) / 10,
        },
        size: { w: Math.round(size.w), h: Math.round(size.h) },
        grid,
        compensation: 'software',
        meshSource: mesh.source,
      }
    }

    // Vorhandenes, modellgebundenes Mesh beim Slicen berücksichtigen
    if (!adaptive && model && bedMesh) {
      finalGcode = sliceMesh(
        model.mesh,
        { ...merged, meshCompensation: 'software' },
        profile,
        bedMesh,
        model.overrides,
      ).gcode
      prep = {
        ...(prep ?? { adaptive: false }),
        mesh: { printerId: profile.id, source: bedMesh.source, points: bedMesh.cols * bedMesh.rows },
      }
    }

    if (zInfo) prep = { ...(prep ?? { adaptive: false }), z: zInfo }

    await manager.print(finalGcode, name ?? 'kepler-job.gcode')
    res.json({ ok: true, prep })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Druckstart fehlgeschlagen.' })
  }
})

app.post('/api/printer/print/pause', async (_req, res) => {
  try {
    await hub.selected.pausePrint()
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Pause fehlgeschlagen.' })
  }
})

app.post('/api/printer/print/resume', async (_req, res) => {
  try {
    await hub.selected.resumePrint()
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Fortsetzen fehlgeschlagen.' })
  }
})

app.post('/api/printer/print/cancel', async (_req, res) => {
  try {
    await hub.selected.cancelPrint()
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Abbruch fehlgeschlagen.' })
  }
})

app.post('/api/printer/estop', async (_req, res) => {
  try {
    await hub.selected.emergencyStop()
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Not-Aus fehlgeschlagen.' })
  }
})

// Frontend ausliefern: eingebettet (EXE) oder aus dem dist-Ordner
const embedded = embeddedAssetHandler()
if (embedded) {
  app.use(embedded)
} else {
  const distDir = [
    process.env.KEPLER_DIST,
    join(dirname(process.execPath), 'dist'),
    join(process.cwd(), 'dist'),
  ].find((dir): dir is string => !!dir && existsSync(dir))
  if (distDir) app.use(express.static(distDir))
}

/** Öffnet die Oberfläche in einem eigenen Fenster (ohne Browser-Leiste). */
function openBrowser(url: string) {
  openAppWindow(url)
}

/** Prüft mit einer eigenen Sonde, ob ein Port frei ist (ohne den echten Server
 *  in einen Fehlerzustand zu bringen). */
async function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer()
    let settled = false
    let timer: NodeJS.Timeout | undefined
    const finish = (free: boolean) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      try {
        probe.close(() => resolve(free))
      } catch {
        resolve(false)
      }
    }
    timer = setTimeout(() => finish(false), 800)
    probe.once('error', () => finish(false))
    probe.listen(port, '127.0.0.1', () => finish(true))
  })
}

/**
 * fetch mit harter Obergrenze. Ein hängender alter Prozess kann eine Verbindung
 * annehmen, aber nie antworten; ohne diesen Wettlauf bliebe die neue EXE beim
 * Prüfen der Ports ohne Fenster stehen.
 */
async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 800): Promise<Response | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  let timeoutTimer: NodeJS.Timeout | undefined
  const timeout = new Promise<null>((resolve) => {
    timeoutTimer = setTimeout(() => resolve(null), ms)
  })
  try {
    return await Promise.race([fetch(url, { ...init, signal: controller.signal }), timeout])
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    if (timeoutTimer) clearTimeout(timeoutTimer)
  }
}

/**
 * Beendet eine noch laufende alte Instanz von uns, damit die neue den Port
 * übernehmen kann. Es wird nur beendet, was sich über /api/health als
 * Easy-Slicer ausweist — fremde Programme bleiben unangetastet.
 */
async function takeOver(port: number): Promise<boolean> {
  try {
    const probe = await fetchWithTimeout(`http://127.0.0.1:${port}/api/health`)
    if (!probe?.ok) return false
    const info = (await probe.json().catch(() => null)) as { app?: string } | null
    if (info?.app !== 'easy-slicer') return false
    await fetchWithTimeout(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST' }, 600)
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 100))
      if (await portIsFree(port)) return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * Startet den Server und weicht belegten Ports aus. Eine noch laufende alte
 * Instanz wird vorher beendet; fremde Programme auf dem Port werden in Ruhe
 * gelassen, dann rückt die neue EXE einen Port weiter.
 */
async function listenFrom(firstPort: number): Promise<number | null> {
  for (let port = firstPort; port < firstPort + 10; port++) {
    if (!(await portIsFree(port))) {
      if (await takeOver(port)) {
        console.log(`[easy-slicer] Alte Instanz auf Port ${port} beendet — übernehme.`)
      } else {
        console.error(`[easy-slicer] Port ${port} ist belegt — versuche ${port + 1}.`)
        continue
      }
    }
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error) => {
          server.removeListener('listening', onListening)
          reject(err)
        }
        const onListening = () => {
          server.removeListener('error', onError)
          resolve()
        }
        server.once('error', onError)
        server.once('listening', onListening)
        server.listen(port, '127.0.0.1')
      })
      // Immer den tatsächlich belegten Port zurückgeben: Bei 0 (oder einem
      // Ausweichport) weicht er von der Wunschzahl ab.
      const address = server.address()
      return typeof address === 'object' && address ? address.port : port
    } catch (err) {
      console.error(`[easy-slicer] Port ${port} konnte nicht belegt werden:`, err)
    }
  }
  // Wenn alle Wunschports belegt sind (z. B. durch einen hängengebliebenen
  // alten Prozess), trotzdem starten: Windows vergibt einen freien Port und
  // die Oberfläche wird geöffnet. Vorher blieb die EXE ohne Fenster stehen.
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        server.removeListener('listening', onListening)
        reject(err)
      }
      const onListening = () => {
        server.removeListener('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(0, '127.0.0.1')
    })
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    console.error(`[easy-slicer] Alle Wunschports belegt — Ausweichport ${port}.`)
    return port
  } catch (err) {
    console.error('[easy-slicer] Auch der Ausweichport konnte nicht belegt werden:', err)
    return null
  }
}

void (async () => {
  try {
    const port = await listenFrom(PORT)
    if (port == null) {
      console.error('[easy-slicer] Kein freier Port gefunden — bitte alte Instanz beenden.')
      return
    }
    const url = `http://127.0.0.1:${port}`
    console.log(`[easy-slicer] Oberfläche läuft lokal auf ${url}`)
    if (logFile) console.log(`[easy-slicer] Protokoll: ${logFile}`)
    if (isSea() && !process.env.KEPLER_NO_BROWSER) openBrowser(url)
  } catch (err) {
    console.error('[easy-slicer] Start fehlgeschlagen:', err)
  }
})()
