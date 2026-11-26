import type {
  BedMesh,
  BedMeshRecord,
  BuildPlate,
  CalibrationOptions,
  CustomGcode,
  DeepPartial,
  CalibrationTool,
  ConsoleLine,
  DetectedDevice,
  FilamentProfile,
  FilamentSlot,
  GcodeFlavor,
  KlipperMeshProfiles,
  ModelAnalysis,
  ModelObjectInfo,
  PaintMark,
  PostProcessingScript,
  PrintSettings,
  PrinterOverrides,
  PrinterProfile,
  PrinterStatus,
  SliceResult,
  ZMeasurement,
} from '../shared/types.ts'
import type { GcodeAnalysis, GcodeConversion } from '../shared/gcode-import.ts'
import type { PrinterLimits } from '../shared/limits.ts'

async function json<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`)
  return data as T
}

export type Catalog = {
  printers: PrinterProfile[]
  filaments: FilamentProfile[]
  plates: BuildPlate[]
  nozzles: number[]
  defaults: PrintSettings
}

export async function fetchCatalog(): Promise<Catalog> {
  return json(await fetch('/api/catalog'))
}

export type UploadedModel = {
  id: string
  /** Nur bei Lithophanen vom Server gesetzt */
  name?: string
  analysis: ModelAnalysis
  bytes: number
  format: 'stl' | '3mf' | 'obj' | 'ply' | 'glb'
  objects: ModelObjectInfo[]
  settings: DeepPartial<PrintSettings>
  warnings: string[]
  printerHint: string | null
  filamentHint: string | null
  /** Anzahl der Platten (3MF); 1 bei allen anderen Formaten */
  plates?: number
  /** Ergebnis der Meshprüfung beim Import (V-13) */
  repair?: MeshRepairInfo
}

export type MeshRepairInfo = {
  /** Entfernte doppelte oder entartete Dreiecke */
  removed: number
  openBefore: number
  openAfter: number
  applied: boolean
}

export async function uploadModel(
  buf: ArrayBuffer,
  name: string,
  printerId?: string,
  options?: { nozzle?: number; maxVolumetricFlow?: number },
): Promise<UploadedModel> {
  const nozzle = options?.nozzle
  const maxFlow = options?.maxVolumetricFlow
  const query =
    `name=${encodeURIComponent(name)}` +
    (printerId ? `&printerId=${encodeURIComponent(printerId)}` : '') +
    (typeof nozzle === 'number' && Number.isFinite(nozzle) ? `&nozzle=${nozzle}` : '') +
    (typeof maxFlow === 'number' && Number.isFinite(maxFlow) ? `&maxFlow=${maxFlow}` : '')
  const res = await fetch(`/api/models?${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: buf,
  })
  return json(res)
}

export type ModelEditResult = {
  objects: ModelObjectInfo[]
  analysis: ModelAnalysis
  parts?: number
  /** Letztes Teil gelöscht — der Server hat das Modell verworfen. */
  cleared?: boolean
  /** Mesh-Reparatur: offene Kanten vor und nach dem Schließen. */
  repair?: { openBefore: number; openAfter: number; applied: boolean }
  /** Name des Schritts für Rückgängig/Vorwärts (V-11) */
  label?: string
  /** Meshprüfung beim Anhängen eines Objekts (V-13) */
  importRepair?: MeshRepairInfo
  /** Zähler der Server-Geometrie; steigt nur bei echter Geometrieänderung. */
  revision?: number
  /** false = Zuordnung geändert (Slot, Ausschluss), STL und Viewer bleiben. */
  geometryChanged?: boolean
  /** Trennen: Anzahl der Objekte und der entstandenen Einzelteile. */
  separate?: { objects: number; parts: number }
}

/**
 * Ein-Klick-Maßstab (V-25): skaliert die Geometrie aller Objekte gleichmäßig,
 * sodass die größte Kante `targetMm` misst. Gedacht für GLB/Scan-Ausgaben in
 * Metern; der Platzierungsmaßstab (0,05–10) käme dafür nicht aus.
 */
export async function rescaleModel(modelId: string, targetMm: number): Promise<ModelEditResult> {
  return json(
    await fetch(`/api/models/${modelId}/rescale`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetMm }),
    }),
  )
}

export async function setObjects(
  modelId: string,
  objects: ({ id: string } &
    Partial<Omit<import('../shared/types.ts').ModelPlacement, 'filamentId' | 'slotId'>> & {
      filamentId?: string | null
      slotId?: string | null
      excluded?: boolean
      /** 0-basierte Platte für den Multiprint-Planer */
      plate?: number
    }) [],
): Promise<ModelEditResult> {
  return json(
    await fetch(`/api/models/${modelId}/objects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ objects }),
    }),
  )
}

/** Weiteres Objekt (STL/3MF/OBJ/PLY) an das Werkstück anhängen. */
export async function importObjects(
  modelId: string,
  buf: ArrayBuffer,
  name: string,
  plate = 0,
  printerId?: string,
): Promise<ModelEditResult> {
  const query = new URLSearchParams({ name, plate: String(plate) })
  if (printerId) query.set('printerId', printerId)
  return json(
    await fetch(`/api/models/${modelId}/objects/import?${query.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: buf,
    }),
  )
}

/** Stützen-Markierung setzen oder die des Objekts löschen (Taste L). */
export async function paintMark(
  modelId: string,
  opts: { objectId: string; mark?: PaintMark; clear?: boolean },
): Promise<ModelEditResult> {
  return json(
    await fetch(`/api/models/${modelId}/paint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    }),
  )
}

export type ObjectTool =
  | 'duplicate'
  | 'delete'
  | 'clear'
  | 'merge'
  | 'arrange'
  | 'orient'
  | 'center'
  | 'bed'
  | 'repair'
  | 'separate'
  | 'removeplate'

/** Objektwerkzeuge (Rechtsklick-Menü) — das Modell wird neu zusammengesetzt. */
export async function objectTool(
  modelId: string,
  tool: ObjectTool,
  opts: {
    objectId?: string
    objectIds?: string[]
    count?: number
    bed?: { x: number; y: number }
    /** Plattenwerkzeuge: 0-basierte Platte */
    plate?: number
  } = {},
): Promise<ModelEditResult & { cleared?: boolean }> {
  return json(
    await fetch(`/api/models/${modelId}/tools`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool, ...opts }),
    }),
  )
}

export type ScanMeshInfo = {
  objectId: string
  triangles: number
  size: { x: number; y: number; z: number }
  openEdges: number
  components: number
}

/** Scanprüfung: offene Kanten und Inseln des gewählten Objekts. */
export async function scanInfo(modelId: string, objectId?: string): Promise<{ scan: ScanMeshInfo }> {
  return json(
    await fetch(`/api/models/${modelId}/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'info', objectId }),
    }),
  )
}

export type HollowSummary = {
  wall: number
  drainHoles: number
  openedHoles: number
  drainDiameter: number
  detail: number
  simplifiedTriangles: number
  trianglesBefore: number
  trianglesAfter: number
  cavity: boolean
  opened: boolean
  savingPercent: number
  scale: number
  durationMs: number
}

/** Ersetzt das Objekt durch eine Schale mit Abflusslöchern. Dauert je nach Netz. */
export async function hollowScan(
  modelId: string,
  opts: { objectId: string; wall: number; drainHoles: number; drainDiameter: number; detail: number },
): Promise<ModelEditResult & { hollow: HollowSummary }> {
  return json(
    await fetch(`/api/models/${modelId}/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'hollow', ...opts }),
    }),
  )
}

/** Letzten Schritt zurücknehmen (gilt für alle Objektwerkzeuge). */
export async function undo(modelId: string): Promise<ModelEditResult & { canUndo: boolean; canRedo: boolean; label?: string }> {
  return json(await fetch(`/api/models/${modelId}/undo`, { method: 'POST' }))
}

/** Rückgängig gemachten Schritt wiederherstellen. */
export async function redo(modelId: string): Promise<ModelEditResult & { canUndo: boolean; canRedo: boolean; label?: string }> {
  return json(await fetch(`/api/models/${modelId}/redo`, { method: 'POST' }))
}

/** Schneidet ein Objekt an einer Höhe; Verbinder halten die Teile zusammen. */
export async function cutModel(
  modelId: string,
  opts: {
    objectId?: string
    z: number
    keep: 'top' | 'bottom' | 'both'
    profile: 'flat' | 'zigzag' | 'dovetail' | 'wave' | 'step'
    connectorSize: number
    count: number
  },
): Promise<ModelEditResult> {
  return json(
    await fetch(`/api/models/${modelId}/cut`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    }),
  )
}

export type SplitAxis = 'z' | 'x' | 'y'
export type SplitProfile = 'flat' | 'zigzag' | 'dovetail' | 'wave' | 'step' | 'undercut'

/** Schnittlage mit dem kleinsten Querschnitt — die dünnste Stelle. */
export async function suggestSeam(
  modelId: string,
  opts: { objectId?: string; axis: SplitAxis },
): Promise<{ position: number }> {
  return json(
    await fetch(`/api/models/${modelId}/seam`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    }),
  )
}

/**
 * Teilt ein Objekt in mehrere Stücke mit Verbindern entlang einer Achse.
 * `autoPieces` bestimmt die Teilezahl aus der Bettgröße, `arrange` legt die
 * Teile anschließend nebeneinander aufs Bett.
 */
export async function splitModel(
  modelId: string,
  opts: {
    objectId?: string
    axis: SplitAxis
    pieces: number
    autoPieces?: boolean
    profile: SplitProfile
    connectorSize: number
    count: number
    /** Spalt zwischen den Nahtflächen */
    clearance: number
    /** Luft rund um Zapfen/Schiene; Standard 0,25 mm */
    connectorClearance?: number
    position?: number
    keep?: 'both' | 'low' | 'high'
    arrange?: boolean
    /** Zapfen: Anzahl pro Naht (0 = keine) */
    pinCount?: number
    pinWidth?: number
    pinLength?: number
    pinHeight?: number
    /** Schiene/Puzzle: Überstand über der Naht in mm */
    pinDepth?: number
    /** Konus 0…0,35: unten um diesen Anteil schmaler */
    pinTaper?: number
    /** Zapfen, seitlich eingeschobener Schwalbenschwanz oder Puzzle-T-Nut */
    pinType?: 'pin' | 'dovetail' | 'puzzle' | 'tongue' | 'bayonet' | 'thread' | 'undercut'
    /** Naht und Verbinder ausdrücklich zusammen rechnen */
    combine?: boolean
    bed?: { x: number; y: number; z: number }
  },
): Promise<ModelEditResult> {
  return json(
    await fetch(`/api/models/${modelId}/split`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    }),
  )
}

/** Setzt Text auf ein Objekt — erhaben oder als echte Vertiefung. */
export async function addText(
  modelId: string,
  opts: {
    /** Vorhandenes Textobjekt kalibrieren statt neu anlegen */
    id?: string
    targetId?: string
    text: string
    fontHeight: number
    depth: number
    rotation: number
    mode: 'emboss' | 'engrave'
    offsetX: number
    offsetY: number
  },
): Promise<ModelEditResult> {
  return json(
    await fetch(`/api/models/${modelId}/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    }),
  )
}

/** Erzeugt aus Graustufen (Browser-Canvas) ein Lithophan-Mesh. */
export async function createLithophane(
  opts: import('../shared/types.ts').LithophaneRequest,
): Promise<UploadedModel> {
  return json(
    await fetch('/api/lithophane', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    }),
  )
}

export async function export3mf(payload: {
  modelId: string
  settings: PrintSettings
  printerId: string
  filamentId: string
  plateId: string
  /** Nur diese Platte exportieren (0-basiert) */
  plate?: number
  slots?: import('../shared/types.ts').FilamentSlot[]
}): Promise<Blob> {
  const res = await fetch('/api/export/3mf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(data.error ?? `Export fehlgeschlagen (HTTP ${res.status})`)
  }
  return res.blob()
}

export async function fetchModelStl(id: string): Promise<ArrayBuffer> {
  const res = await fetch(`/api/models/${id}/stl`)
  if (!res.ok) throw new Error('Modell konnte nicht geladen werden.')
  return res.arrayBuffer()
}

/** Einzelnes Objekt (z. B. eingelassenen Text) als STL für die Vorschau. */
export async function fetchObjectStl(id: string, objectId: string): Promise<ArrayBuffer> {
  const res = await fetch(`/api/models/${id}/objects/${objectId}/stl`)
  if (!res.ok) throw new Error('Objekt konnte nicht geladen werden.')
  return res.arrayBuffer()
}

export async function fetchDemo(shape: string): Promise<ArrayBuffer> {
  const res = await fetch(`/api/demo/${shape}`)
  if (!res.ok) throw new Error('Demo-Modell konnte nicht geladen werden.')
  return res.arrayBuffer()
}

export type SliceFilament = {
  nozzle: number
  bed: number
  flow: number
  fanSpeed: number
  maxVolumetricFlow: number
  /** Für den Metadatenblock in Mainsail/Fluidd */
  material?: string
  name?: string
  density?: number
}

export async function sliceModel(
  modelId: string,
  settings: PrintSettings,
  profileId: string,
  plate = 0,
  filaments?: Record<string, SliceFilament>,
  customGcode?: CustomGcode,
  postProcessing?: PostProcessingScript,
  limits?: PrinterLimits,
  flavor?: GcodeFlavor,
  context?: {
    filamentId?: string
    slots?: FilamentSlot[]
    activeSlotId?: string
    printerOverrides?: PrinterOverrides
    /** Fester Bezugspunkt der 3D-Ansicht; erhält die Objektlage beim Slicen. */
    modelCenter?: { x: number; y: number }
  },
): Promise<SliceResult & { sliceMs: number }> {
  const res = await fetch('/api/slice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modelId,
      settings,
      profileId,
      plate,
      filaments,
      customGcode,
      postProcessing,
      limits,
      flavor,
      filamentId: context?.filamentId,
      slots: context?.slots,
      activeSlotId: context?.activeSlotId,
      printerOverrides: context?.printerOverrides,
      modelCenter: context?.modelCenter,
    }),
  })
  return json(res)
}

/** G-Code roh senden — große Dateien laufen nicht durch den JSON-Parser. */
export async function analyzeGcode(
  gcode: string,
  bed?: { x: number; y: number; z: number },
  origin: 'corner' | 'center' = 'corner',
): Promise<GcodeAnalysis> {
  const query = bed
    ? `?${new URLSearchParams({
        bedX: String(bed.x),
        bedY: String(bed.y),
        bedZ: String(bed.z),
        origin,
      }).toString()}`
    : ''
  const res = await fetch(`/api/gcode/analyze${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: gcode,
  })
  return json(res)
}

/** Konservative Umschreibung bekannter Befehle; der Text bleibt sonst unverändert. */
export async function convertGcode(gcode: string, to: GcodeFlavor): Promise<GcodeConversion> {
  const res = await fetch(`/api/gcode/convert?to=${encodeURIComponent(to)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: gcode,
  })
  return json(res)
}

export async function createCalibration(params: {
  toolId: string
  printerId: string
  filamentId: string
  plateId: string
  settings: PrintSettings
  flavor?: GcodeFlavor
  options?: CalibrationOptions
}): Promise<{ modelId: string; analysis: ModelAnalysis; tool: CalibrationTool; plate: string }> {
  const res = await fetch('/api/calibration', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  return json(res)
}

// ---------- Drucker ----------

export async function listPorts(): Promise<{ path: string; label: string }[]> {
  const data = await json<{ ports: { path: string; label: string }[] }>(await fetch('/api/printer/ports'))
  return data.ports
}

export async function scanDevices(): Promise<DetectedDevice[]> {
  const data = await json<{ devices: DetectedDevice[] }>(await fetch('/api/printer/scan'))
  return data.devices
}

/** Legt einen eigenen Drucker (No-Name) an bzw. aktualisiert ihn. */
export async function saveCustomPrinter(input: {
  id?: string
  name: string
  bed: { x: number; y: number; z: number }
  baud?: number
  control?: 'marlin-serial' | 'klipper-moonraker' | 'manual'
  hasBedLeveling?: boolean
}): Promise<PrinterProfile> {
  const data = await json<{ printer: PrinterProfile }>(
    await fetch('/api/printers/custom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  )
  return data.printer
}

export async function deleteCustomPrinter(id: string): Promise<void> {
  await json(await fetch(`/api/printers/custom/${encodeURIComponent(id)}`, { method: 'DELETE' }))
}

/** Sucht Moonraker im lokalen Netz (Klipper-Mod). Port-Vorgabe: 7125. */
export async function discoverMoonrakerHosts(
  port?: number,
): Promise<{ hosts: import('../shared/types.ts').MoonrakerHost[]; ms: number }> {
  const query = port && port > 0 ? `?port=${port}` : ''
  return json(await fetch(`/api/printer/discover/moonraker${query}`))
}

export async function connectPrinter(opts: {
  mode: 'serial' | 'simulation' | 'klipper' | 'octoprint'
  path?: string
  baud?: number
  profileId: string
  /** Firmware-Art dieses Geräts; 'auto' erkennt sie beim Verbinden. */
  firmware?: 'auto' | 'zmod' | 'original'
  url?: string
  apiKey?: string
}): Promise<PrinterStatus> {
  const data = await json<{ status: PrinterStatus }>(
    await fetch('/api/printer/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    }),
  )
  return data.status
}

/** Firmware-Art umstellen; gilt sofort für den nächsten Start. */
export async function setPrinterFirmware(mode: 'auto' | 'zmod' | 'original'): Promise<PrinterStatus> {
  const data = await json<{ status: PrinterStatus }>(
    await fetch('/api/printer/firmware', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    }),
  )
  return data.status
}

export async function disconnectPrinter(): Promise<void> {
  await json(await fetch('/api/printer/disconnect', { method: 'POST' }))
}

/** Nur die aktive Ansicht umschalten; bestehende Verbindungen bleiben offen. */
export async function selectPrinter(
  printerId: string,
): Promise<{ printerId: string; status: PrinterStatus; mesh: import('../shared/types.ts').BedMesh | null }> {
  return json(
    await fetch('/api/printer/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ printerId }),
    }),
  )
}

export async function fetchMeshHistory(printerId: string): Promise<{ printerId: string; records: BedMeshRecord[] }> {
  return json(await fetch(`/api/printer/mesh/history?printerId=${encodeURIComponent(printerId)}`))
}

export async function clearMeshHistory(printerId: string): Promise<void> {
  await json(
    await fetch(`/api/printer/mesh/history?printerId=${encodeURIComponent(printerId)}`, { method: 'DELETE' }),
  )
}

/** Gespeicherte Meshprofilnamen des verbundenen Klipper-Druckers. */
export async function fetchMeshProfiles(): Promise<KlipperMeshProfiles> {
  return json(await fetch('/api/printer/mesh/profiles'))
}

/** Gespeichertes Mesh genau dieses Druckerprofils (nicht das eines anderen). */
export async function fetchPrinterMesh(printerId: string): Promise<BedMesh | null> {
  const data = await json<{ mesh: BedMesh | null }>(
    await fetch(`/api/printers/${encodeURIComponent(printerId)}/mesh`),
  )
  return data.mesh
}

export async function clearPrinterMesh(printerId: string): Promise<void> {
  await json(await fetch(`/api/printers/${encodeURIComponent(printerId)}/mesh`, { method: 'DELETE' }))
}

/** Rohantworten der letzten Bettmessung (G29/M420 V bzw. G30). */
export type ProbeLog = { at: number; mode: string; printerId: string; lines: string[] }

export async function fetchProbeLog(): Promise<ProbeLog | null> {
  const data = await json<{ log: ProbeLog | null }>(await fetch('/api/printer/mesh/log'))
  return data.log
}

/** Einmalige Messung über USB für genau das verbundene Modell. */
/** Vorhandenes Firmware-Mesh per USB übernehmen (M420 V) — ohne neue Messung. */
export async function importPrinterMesh(): Promise<{ mesh: import('../shared/types.ts').BedMesh }> {
  return json(await fetch('/api/printer/mesh/import', { method: 'POST' }))
}

export async function probePrinterMesh(
  printerId: string,
  cols = 5,
  rows = 5,
  modelId?: string | null,
  margin = 10,
): Promise<BedMesh> {
  const data = await json<{ mesh: BedMesh }>(
    await fetch(`/api/printers/${encodeURIComponent(printerId)}/mesh/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cols, rows, modelId: modelId ?? undefined, margin }),
    }),
  )
  return data.mesh
}

export async function measureZ(samples = 3): Promise<ZMeasurement> {
  const data = await json<{ measurement: ZMeasurement }>(
    await fetch('/api/printer/z/measure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ samples }),
    }),
  )
  return data.measurement
}

export async function applyZDelta(delta: number): Promise<void> {
  await json(
    await fetch('/api/printer/z/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta }),
    }),
  )
}

export async function probeBed(
  mode: 'auto' | 'manual',
  cols = 5,
  rows = 5,
  modelId?: string | null,
  margin = 10,
): Promise<BedMesh> {
  const data = await json<{ mesh: BedMesh }>(
    await fetch('/api/printer/mesh/probe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, cols, rows, modelId: modelId ?? undefined, margin }),
    }),
  )
  return data.mesh
}

export async function babystep(delta: number): Promise<void> {
  await json(
    await fetch('/api/printer/babystep', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta }),
    }),
  )
}

export async function resetBabystep(): Promise<void> {
  await json(await fetch('/api/printer/babystep/reset', { method: 'POST' }))
}

export async function setZOffset(value: number, persist: boolean): Promise<void> {
  await json(
    await fetch('/api/printer/zoffset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value, persist }),
    }),
  )
}

export async function sendCommand(line: string, live = false): Promise<string[]> {
  const data = await json<{ lines: string[] }>(
    await fetch('/api/printer/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ line, live }),
    }),
  )
  return data.lines
}

export async function jog(axis: 'X' | 'Y' | 'Z', delta: number, feed = 1800): Promise<void> {
  await json(
    await fetch('/api/printer/jog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ axis, delta, feed }),
    }),
  )
}

export async function setTemp(heater: 'nozzle' | 'bed', value: number): Promise<void> {
  await json(
    await fetch('/api/printer/temp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ heater, value }),
    }),
  )
}

export async function homeAxes(): Promise<void> {
  await json(await fetch('/api/printer/home', { method: 'POST' }))
}

export async function motorsOff(): Promise<void> {
  await json(await fetch('/api/printer/motors-off', { method: 'POST' }))
}

export async function enableMesh(): Promise<void> {
  await json(await fetch('/api/printer/mesh/enable', { method: 'POST' }))
}

export async function saveEeprom(): Promise<void> {
  await json(await fetch('/api/printer/save', { method: 'POST' }))
}

export async function emergencyStop(): Promise<void> {
  await json(await fetch('/api/printer/estop', { method: 'POST' }))
}

export async function startPrint(
  gcode: string,
  name: string,
  prep?: { modelId: string | null; settings: PrintSettings; profileId: string; zRef?: { mean: number } },
  target?: 'usb' | 'network',
): Promise<{ prep: Record<string, unknown> | null }> {
  const data = await json<{ prep: Record<string, unknown> | null }>(
    await fetch('/api/printer/print', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gcode,
        name,
        modelId: prep?.modelId ?? undefined,
        settings: prep?.settings,
        profileId: prep?.profileId,
        zRef: prep?.zRef,
        target,
      }),
    }),
  )
  return data
}

/** G-Code an Moonraker/OctoPrint senden, ohne USB-Streaming. */
export async function uploadToPrinter(
  name: string,
  gcode: string,
  start: boolean,
  printerId?: string,
): Promise<{ file: string }> {
  return json(
    await fetch('/api/printer/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, gcode, start, printerId }),
    }),
  )
}

/** Mainsail/Fluidd auf dem Drucker-Host suchen (Erkennung + Einbettbarkeit). */
export async function inspectWebUi(
  host: string,
  port?: number,
  secure?: boolean,
  url?: string,
): Promise<import('../shared/types.ts').WebUiInfo | null> {
  const query = new URLSearchParams({ host })
  if (port) query.set('port', String(port))
  if (secure) query.set('secure', '1')
  if (url) query.set('url', url)
  const data = await json<{ info: import('../shared/types.ts').WebUiInfo | null }>(
    await fetch(`/api/webui?${query.toString()}`),
  )
  return data.info
}

/** Letzte Zeilen der Logdatei (die EXE startet ohne Konsolenfenster). */
export async function fetchLogs(): Promise<{ path: string | null; text: string }> {
  return json(await fetch('/api/logs'))
}

/** Beendet den Server — Knopf in der Kopfzeile. */
export async function quitApp(): Promise<void> {
  await json(await fetch('/api/app/quit', { method: 'POST' }))
}

export async function pausePrint(): Promise<void> {
  await json(await fetch('/api/printer/print/pause', { method: 'POST' }))
}

export async function resumePrint(): Promise<void> {
  await json(await fetch('/api/printer/print/resume', { method: 'POST' }))
}

export async function cancelPrint(): Promise<void> {
  await json(await fetch('/api/printer/print/cancel', { method: 'POST' }))
}

export type HubPrinterState = {
  id: string
  status: PrinterStatus
  mesh: BedMesh | null
  log: ConsoleLine[]
}

export type PrintJobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

export type PrintJob = {
  id: string
  printerId: string
  name: string
  target: 'usb' | 'network'
  status: PrintJobStatus
  createdAt: number
  startedAt?: number
  finishedAt?: number
  message?: string
}

export async function fetchPrintJobs(): Promise<PrintJob[]> {
  const data = await json<{ jobs: PrintJob[] }>(await fetch('/api/jobs'))
  return data.jobs
}

/** Reiht fertig geslicten G-Code ein; der Aufrufer bestätigt den Start vorher. */
export async function enqueuePrintJob(input: {
  printerId: string
  name: string
  gcode: string
  target: 'usb' | 'network'
}): Promise<PrintJob> {
  const data = await json<{ job: PrintJob }>(
    await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  )
  return data.job
}

export async function cancelPrintJob(id: string): Promise<PrintJob> {
  const data = await json<{ job: PrintJob }>(
    await fetch(`/api/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  )
  return data.job
}

export type WsMessage =
  | {
      type: 'init'
      printerId: string
      status: PrinterStatus
      mesh: BedMesh | null
      log: ConsoleLine[]
      printers?: HubPrinterState[]
      jobs?: PrintJob[]
    }
  | { type: 'status'; printerId?: string; status: PrinterStatus }
  | { type: 'log'; printerId?: string; line: ConsoleLine }
  | { type: 'mesh'; printerId?: string; mesh: BedMesh }
  | { type: 'probe'; printerId?: string; done: number; total: number }
  | { type: 'selected'; printerId: string }
  | { type: 'jobs'; jobs: PrintJob[] }

/** V-23: Ausgabeordner einer Scan-Engine prüfen (nur lesen). */
export type ScanFolderInspection = {
  /** Kandidaten tragen ihren vollständigen Pfad (`absolutePath`). */
  report: import('../shared/scanEngines.ts').ScanFolderReport
  /** `job.json` des MeshScan-Servers, falls der Ordner ein Scan-Job ist. */
  job: import('../shared/scanEngines.ts').ScanJobInfo | null
  root: string
  files: number
  truncated: boolean
}

export async function inspectScanFolder(folder: string): Promise<ScanFolderInspection> {
  return json(
    await fetch('/api/scan/folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder }),
    }),
  )
}

/** A-154: Scan-Server prüfen und seine Rechenprogramme holen. */
export async function scanServerInfo(): Promise<import('../shared/scanJobs.ts').ScanServerInfo> {
  return json(await fetch('/api/scan/engines'))
}

/** A-154: Auftrag im Scan-Server anlegen. `engine` fehlt bei „Automatisch“. */
export async function startScanJob(input: {
  engine?: import('../shared/scanJobs.ts').ScanGeneratorId
  name?: string
}): Promise<import('../shared/scanJobs.ts').ScanJob> {
  return json(
    await fetch('/api/scan/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  )
}

/** Ein Foto oder Video zum Auftrag senden — der Server erkennt Videos an der Endung. */
export async function uploadScanFile(
  jobId: string,
  file: File,
  index: number,
): Promise<import('../shared/scanJobs.ts').ScanJob> {
  const query = `name=${encodeURIComponent(file.name)}&index=${index}`
  return json(
    await fetch(`/api/scan/jobs/${encodeURIComponent(jobId)}/photos?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
    }),
  )
}

export async function processScanJob(jobId: string): Promise<import('../shared/scanJobs.ts').ScanJob> {
  return json(await fetch(`/api/scan/jobs/${encodeURIComponent(jobId)}/process`, { method: 'POST' }))
}

export async function scanJobStatus(jobId: string): Promise<import('../shared/scanJobs.ts').ScanJob> {
  return json(await fetch(`/api/scan/jobs/${encodeURIComponent(jobId)}`))
}

export async function cancelScanJob(jobId: string): Promise<import('../shared/scanJobs.ts').ScanJob> {
  return json(await fetch(`/api/scan/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' }))
}

/** Das fertige Mesh holen — der Import rechnet das GLB in ein STL um. */
export async function fetchScanJobMesh(
  jobId: string,
  jobName: string,
): Promise<{ buffer: ArrayBuffer; name: string }> {
  const res = await fetch(
    `/api/scan/jobs/${encodeURIComponent(jobId)}/mesh?name=${encodeURIComponent(jobName)}`,
  )
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`)
  }
  const encoded = res.headers.get('X-Scan-Name')
  const name = encoded
    ? new TextDecoder().decode(Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)))
    : 'scan.glb'
  return { buffer: await res.arrayBuffer(), name }
}

/** Ein Mesh aus dem geprüften Ordner holen — die Datei bleibt, wo sie ist. */
export async function fetchScanMesh(path: string): Promise<{ buffer: ArrayBuffer; name: string }> {
  const res = await fetch(`/api/scan/file?path=${encodeURIComponent(path)}`)
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`)
  }
  const encoded = res.headers.get('X-Scan-Name')
  const name = encoded
    ? new TextDecoder().decode(Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)))
    : 'scan.stl'
  return { buffer: await res.arrayBuffer(), name }
}
