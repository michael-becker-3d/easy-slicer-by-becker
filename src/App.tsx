import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ImportScaleOffer } from './components/ImportScaleOffer.tsx'
import { FEATURES } from '../shared/release.ts'
import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import type {
  BedMesh,
  CalibrationOptions,
  CalibrationTool,
  CustomGcode,
  ConsoleLine,
  DeepPartial,
  DetectedDevice,
  FilamentSlot,
  GcodeFlavor,
  ModelAnalysis,
  ModelObjectInfo,
  NozzleMaterial,
  PreviewFeatureKind,
  PrintSettings,
  PrinterProfile,
  PrinterStatus,
  PostProcessingScript,
  PrinterOverrides,
  SliceResult,
  Suggestion,
  WebUiInfo,
} from '../shared/types.ts'
import {
  DEFAULT_SETTINGS,
  EMPTY_CUSTOM_GCODE,
  EMPTY_POST_PROCESSING,
  formatDuration,
  formatGcodeFilename,
  normalizeGcodeFilename,
  applyPlateProfile,
  applyPrinterOverrides,
  mergeSettings,
  plateOffsetX,
} from '../shared/types.ts'
import { INTENTS, suggest, type IntentId } from '../shared/advisor.ts'
import { auditPrint } from '../shared/audit.ts'
import type { AssemblyPlan } from '../shared/assembly.ts'
import { adaptImportedSettings, IMPORTED_LINE_WIDTH_KEYS } from '../shared/limits.ts'
import { injectBedTemperatureMesh, injectMeshName } from '../shared/gcode-templates.ts'
import { isKlipperFlavor } from '../shared/gcode-flavors.ts'
import {
  applyPrinterLimits,
  compatibilityWarnings,
  filamentById,
  plateById,
  qualityBaseline,
  qualityPresetFor,
  qualityPresetsFor,
  settingsForFilament,
  DEFAULT_PRINTER,
  PRINTERS,
  type QualityPreset,
} from '../shared/catalog.ts'
import {
  calibrationSliceSettings,
  calibrationTestStateForNextTest,
  markMeasuredCalibrationValues,
  normalSettingsForTest,
} from './calibrationSettings.ts'
import {
  clearCalibrationTestState,
  readCalibrationTestState,
  writeCalibrationTestState,
} from './calibrationState.ts'
import { applyModelSettingsTakeover } from './modelTransition.ts'
import * as api from './api.ts'
import type { Catalog } from './api.ts'
import { saveFileAs, saveGcodeAs, type SaveFileResult } from './saveGcode.ts'
import {
  effectivePrinterLimits,
  ensureMachineGcode,
  loadSetup,
  loadWebTarget,
  loadZRef,
  normalizeSetup,
  saveSetup,
  webUrlMatchesHost,
  type PrinterLimits,
  type Setup,
} from './setup.ts'
import { applyTheme, loadTheme, saveTheme, type Theme } from './theme.ts'
import {
  clearDraft,
  loadRecoveryDraft,
  markDraftCleanExit,
  MAX_DRAFT_BYTES,
  saveDraft,
  type SavedDraft,
} from './autosave.ts'
import {
  applyUiScale,
  loadUiScaleId,
  resolveUiScale,
  saveUiScaleId,
  type UiScaleId,
} from './uiScale.ts'
import {
  buildPrinterBackup,
  loadSnapshot,
  loadSnapshots,
  loadWorkspace,
  parsePrinterBackup,
  saveSnapshot,
  saveWorkspace,
} from './printers.ts'
import {
  copyFilamentPlateOverride,
  deleteUserFilament,
  loadUserFilaments,
  removeFilamentPlateOverrides,
  saveUserFilament,
  userFilamentProfile,
  type UserFilament,
} from './filaments.ts'
import {
  deleteUserQualityProfile,
  loadUserQualityProfiles,
  renameUserQualityProfile,
  saveUserQualityProfile,
  type UserQualityProfile,
} from './qualityProfiles.ts'
import { TopBar, type StudioLayout } from './components/TopBar.tsx'
import { MultiPrintView } from './components/MultiPrintView.tsx'
import { IntentPanel, ModelPanel, ResultPanel, SuggestionsPanel, WorkflowBar } from './components/StudioPanels.tsx'
import { SettingsSidebar } from './components/SettingsSidebar.tsx'
import { PrinterSettingsDialog } from './components/PrinterSettingsDialog.tsx'
import { PrinterView } from './components/PrinterView.tsx'
import { PrinterHubStrip } from './components/PrinterHubStrip.tsx'
import { SetupDialog } from './components/SetupDialog.tsx'
import { WebConnectDialog } from './components/WebConnectDialog.tsx'
import {
  CalibrationView,
  type CalibrationProfilePatch,
  type CalibrationSaveResult,
} from './components/CalibrationView.tsx'
import { GcodeView } from './components/GcodeView.tsx'
import { WebUiPanel } from './components/WebUiPanel.tsx'
import { Viewport } from './viewer/Viewport.tsx'
import { PreviewLegend } from './components/PreviewLegend.tsx'
import { PreviewLab } from './components/PreviewLab.tsx'
import { FloatingPanel } from './components/FloatingPanel.tsx'
import { CalibrationPlanPanel } from './components/CalibrationPlanPanel.tsx'
import { effectivePreviewFlowLimit, type PreviewColorMode, type PreviewPalette } from './viewer/previewColors.ts'
import { describePreviewSegment } from './viewer/previewDiagnostics.ts'
import { buildPreviewFilterBounds } from './viewer/previewFilters.ts'
import type { MeasureInfo, PreviewSection, PreviewSegmentRef } from './viewer/scene.ts'
import {
  SplitDialog,
  LithophaneDialog,
  ObjectContextMenu,
  SHAPE_LIBRARY,
  TextDialog,
  TransformDialog,
  type MenuAction,
  type SplitMemory,
  type ToolId,
} from './components/ObjectTools.tsx'
import { ShortcutsDialog } from './components/ShortcutsDialog.tsx'
import { PrintAudit } from './components/PrintAudit.tsx'
import { AssemblyAssistant } from './components/AssemblyAssistant.tsx'
import { ScanAssistant } from './components/ScanAssistant.tsx'
import { ScanImportDialog } from './components/ScanImportDialog.tsx'
import { ScanStartDialog } from './components/ScanStartDialog.tsx'
import { loadCalibrationVersions } from './calibrationLoopStore.ts'
import type { UploadedModel } from './api.ts'

type ModelState = {
  id: string
  name: string
  analysis: ModelAnalysis
  geometry: THREE.BufferGeometry
  format: string
  objects: ModelObjectInfo[]
  /** Revisionsnummer der Server-Geometrie — Autosave und Nachladen hängen daran. */
  geometryRev?: number
}

/** Mehr Platten nimmt der Objekt-Import nicht an (0-basiert bis Index 31). */
const MAX_PLATES = 32

/** Erstes druckbares Objekt einer Platte; sonst das erste überhaupt darauf. */
function firstOnPlate(objects: ModelObjectInfo[], plate: number): ModelObjectInfo | undefined {
  const onPlate = objects.filter((o) => (o.plate ?? 0) === plate)
  return onPlate.find((o) => o.placement.visible && !o.negative) ?? onPlate[0]
}

/** Ein Studio gehört zu genau einem Drucker und behält sein eigenes Objekt. */
type StudioSession = {
  setup: Setup
  settings: PrintSettings
  model: ModelState | null
  result: (SliceResult & { sliceMs?: number }) | null
  selectedIds: string[]
  outputName: string
  dirty: boolean
  activePlate: number
  /** Anzahl der Platten inklusive leerer, ausdrücklich angelegter. */
  plateCount: number
  outputInfo: string | null
  layer: number
  showAll: boolean
  previewColorMode: PreviewColorMode
  /** Marker eines laufenden Kalibriertests, getrennt je Studio/Drucker. */
  testStructureActive: boolean
}

type View = 'studio' | 'multiprint' | 'printer' | 'calibration' | 'gcode' | 'webui'

/** Einmaliger Sprung aus der Studio-Vorschau in den G-Code-Editor. */
type GcodeJumpRequest = { gcode: string; name: string; line: number }

type FilamentDiffRow = { label: string; before: string; after: string }

type FilamentDiffState = {
  id: string
  name: string
  nextSetup: Setup
  nextSettings: PrintSettings
  rows: FilamentDiffRow[]
}

type FilamentApplyUndo = { label: string; setup: Setup; settings: PrintSettings }

function diffNumber(value: number, digits = 2): string {
  return value.toFixed(digits).replace('.', ',')
}

/** Nur die Werte, die ein eigenes Filamentprofil tatsächlich übernimmt. */
function withoutFilamentOverride(source: Setup, filamentId: string): Setup {
  const plateProfiles = removeFilamentPlateOverrides(source.plateProfiles, filamentId)
  return plateProfiles === source.plateProfiles ? source : { ...source, plateProfiles }
}

/** Nur die Werte, die ein eigenes Filamentprofil tatsächlich übernimmt. */
function filamentDiffRows(before: PrintSettings, after: PrintSettings): FilamentDiffRow[] {
  const fields: { label: string; value: (settings: PrintSettings) => string }[] = [
    { label: 'Düse', value: (s) => `${diffNumber(s.temps.nozzle, 0)} °C` },
    { label: 'Bett', value: (s) => `${diffNumber(s.temps.bed, 0)} °C` },
    { label: 'Düse erste Schicht', value: (s) => `${diffNumber(s.temps.firstLayerNozzle, 0)} °C` },
    { label: 'Bett erste Schicht', value: (s) => `${diffNumber(s.temps.firstLayerBed, 0)} °C` },
    { label: 'Filamentdurchmesser', value: (s) => `${diffNumber(s.filamentDiameter, 2)} mm` },
    { label: 'Fluss', value: (s) => `${diffNumber(s.flow, 3)} ×` },
    { label: 'Max. Volumenstrom', value: (s) => `${diffNumber(s.maxVolumetricFlow, 1)} mm³/s` },
    { label: 'Lüfter', value: (s) => `${diffNumber(s.fanSpeed, 0)} %` },
    {
      label: 'Retract',
      value: (s) =>
        `${diffNumber(s.retraction.distance, 2)} mm · ${diffNumber(s.retraction.speed, 0)} mm/s · ab ${diffNumber(s.retraction.minTravel, 1)} mm`,
    },
    { label: 'Retract bei Schichtwechsel', value: (s) => (s.retraction.onLayerChange ? 'an' : 'aus') },
    {
      label: 'Pressure Advance',
      value: (s) => (s.pressureAdvance.enabled ? diffNumber(s.pressureAdvance.value, 3) : 'aus'),
    },
    { label: 'Lüfter aus ersten Schichten', value: (s) => `${s.cooling.fanOffLayers}` },
    { label: 'Mindestschichtzeit', value: (s) => `${diffNumber(s.cooling.minLayerTime, 1)} s` },
    {
      label: 'Schrumpfung X/Y/Z',
      value: (s) =>
        `${diffNumber(s.shrinkage.x, 2)} / ${diffNumber(s.shrinkage.y, 2)} / ${diffNumber(s.shrinkage.z, 2)} %`,
    },
  ]
  return fields
    .map((field) => ({ label: field.label, before: field.value(before), after: field.value(after) }))
    .filter((row) => row.before !== row.after)
}

const INITIAL_STATUS: PrinterStatus = {
  connection: 'disconnected',
  mode: 'simulation',
  port: null,
  firmware: null,
  bed: null,
  temps: { nozzle: 0, nozzleTarget: 0, bed: 0, bedTarget: 0 },
  position: { x: 0, y: 0, z: 0 },
  zOffset: 0,
  babystep: 0,
  message: null,
  print: { state: 'idle', file: null, progress: 0, etaSeconds: null },
}

const BAR_TOOLS: {
  key: string
  label: string
  icon: string
  hint: string
  action: MenuAction | 'measure' | 'add'
  /** Trennlinie vor diesem Werkzeug (Gruppen wie im OrcaSlicer) */
  group?: boolean
}[] = [
  { key: 'undo', label: 'Rückgängig', icon: '↶', hint: 'Letzten Schritt zurücknehmen — Teilen, Löschen, Anordnen', action: 'undo' },
  { key: 'redo', label: 'Vorwärts', icon: '↷', hint: 'Rückgängig gemachten Schritt wiederholen', action: 'redo' },
  { key: 'move', label: 'Bewegen', icon: '✥', hint: 'Objekt verschieben', action: 'transform' },
  { key: 'rotate', label: 'Drehen', icon: '⟳', hint: 'Objekt um X/Y/Z drehen', action: 'transform' },
  { key: 'scale', label: 'Skalieren', icon: '⤢', hint: 'Größe ändern — alle Achsen oder einzeln', action: 'transform' },
  { key: 'bed', label: 'Auf Platte', icon: '▭', hint: 'Objekt auf das Bett legen', action: 'bed' },
  { key: 'orient', label: 'Ausrichten', icon: '◳', hint: 'Automatisch ausrichten', action: 'orient' },
  { key: 'arrange', label: 'Anordnen', icon: '▦', hint: 'Alle Objekte auf dem Bett anordnen', action: 'arrange' },
  { key: 'cut', label: 'Teilen', icon: '✂', hint: 'In Stücke teilen, mit Verbindern', action: 'cut', group: true },
  { key: 'text', label: 'Text', icon: 'T', hint: 'Text aufbringen', action: 'text' },
  { key: 'measure', label: 'Messen', icon: '⌖', hint: 'Zwei Punkte auf dem Modell messen', action: 'measure' },
  { key: 'duplicate', label: 'Duplizieren', icon: '⧉', hint: 'Kopie daneben setzen', action: 'duplicate', group: true },
  { key: 'merge', label: 'Verbinden', icon: '⛓', hint: 'Sichtbare Objekte zusammenbauen', action: 'merge' },
  { key: 'delete', label: 'Löschen', icon: '🗑', hint: 'Objekt löschen', action: 'delete' },
  { key: 'clear', label: 'Leeren', icon: '⌫', hint: 'Platte komplett leeren (Strg+D)', action: 'clear' },
  { key: 'add', label: 'Hinzufügen', icon: '＋', hint: 'Weiteres Objekt laden', action: 'add', group: true },
  { key: 'litho', label: 'Lithophan', icon: '☼', hint: 'Lampenschirm aus einem Bild erzeugen', action: 'litho' },
]

const DEFAULT_SETUP: Setup = {
  printerId: DEFAULT_PRINTER.id,
  filamentId: 'pla',
  plateId: DEFAULT_PRINTER.defaultPlate,
  qualityPresetId: 'normal',
  nozzle: 0.4,
  nozzleMaterial: 'unknown',
  customGcode: EMPTY_CUSTOM_GCODE,
  postProcessing: EMPTY_POST_PROCESSING,
}

const SLOT_COLORS = ['#f8fafc', '#fbbf24', '#5eead4', '#f472b6', '#60a5fa', '#a3e635']

/** Kleiner als das gilt als „vermutlich in Metern exportiert“ (GLB/Scan). */
const IMPORT_TINY_MM = 5

/** V-13: kurze, ehrliche Importmeldung — auch wenn nichts repariert wurde. */
function meshRepairNote(info?: api.MeshRepairInfo): string {
  if (!info || (!info.removed && !info.applied && info.openAfter === 0)) return ''
  return ` Mesh-Prüfung: ${info.removed} Dreiecke entfernt, ${info.openBefore} → ${info.openAfter} offene Kanten${info.applied ? ' (geschlossen)' : ' (unverändert)'}.`
}

/**
 * Slots werden pro Drucker aus der Mehrfachzuführung abgeleitet. Ein Wechsel
 * auf ein anderes Gerät erzeugt keine fremden Slots; vorhandene Profile und
 * Farben bleiben nur bei derselben Geräte-ID erhalten.
 */
function slotsForPrinter(
  printer: PrinterProfile,
  existing: FilamentSlot[] | undefined,
  currentFilamentId: string,
  available: { id: string }[],
): FilamentSlot[] {
  if (!printer.ifs) return []
  return Array.from({ length: printer.ifs.slots }, (_, index) => {
    const id = `${printer.id}-slot-${index + 1}`
    const previous = existing?.find((slot) => slot.id === id)
    return {
      id,
      label: previous?.label ?? `Slot ${index + 1}`,
      profileId:
        previous?.profileId ??
        (index === 0 ? currentFilamentId : available[index]?.id ?? currentFilamentId),
      color: previous?.color ?? SLOT_COLORS[index % SLOT_COLORS.length],
      present: previous?.present !== false,
    }
  })
}

function sameSlots(a: FilamentSlot[], b: FilamentSlot[] | undefined): boolean {
  if (!b || a.length !== b.length) return false
  return a.every((slot, index) => {
    const other = b[index]
    return (
      other !== undefined &&
      slot.id === other.id &&
      slot.label === other.label &&
      slot.profileId === other.profileId &&
      slot.color === other.color &&
      slot.present === other.present
    )
  })
}

export default function App() {
  const query = useMemo(() => new URLSearchParams(location.search), [])
  /** In einem Pane läuft dieselbe App, aber ohne Kopfzeile und fest an einen Drucker gebunden. */
  const embedded = query.get('embedded') === '1'
  const forcedPrinterId = query.get('studio')
  const [panesOpen, setPanesOpen] = useState(false)
  const [embeddedPanel, setEmbeddedPanel] = useState<'left' | null>(null)
  const [view, setView] = useState<View>('studio')
  const [gcodeJump, setGcodeJump] = useState<GcodeJumpRequest | null>(null)
  // Beide Varianten nutzen denselben Dom-Baum und unterscheiden sich nur in
  // der Spaltenanordnung. Die alten ?ui=test-Links bleiben als Alias gültig.
  const [studioLayout, setStudioLayout] = useState<StudioLayout>(() => {
    try {
      const forced = new URLSearchParams(location.search).get('ui')
      if (forced === 'test' || forced === 'workshop') return 'workshop'
      if (forced === 'classic') return 'classic'
      const stored = localStorage.getItem('easy-slicer-studio-layout')
      if (stored === 'workshop' || stored === 'classic') return stored
      return localStorage.getItem('easy-slicer-ui-test') === 'test' ? 'workshop' : 'classic'
    } catch {
      return 'classic'
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('easy-slicer-studio-layout', studioLayout)
      // Kompatibilität mit älteren Verknüpfungen und bereits gespeicherten
      // Zuständen; die neue sichtbare Bezeichnung ist Klassisch/Werkstatt.
      localStorage.setItem('easy-slicer-ui-test', studioLayout === 'workshop' ? 'test' : 'classic')
    } catch {
      // Privater Modus o. Ä. — der Zustand funktioniert auch ohne Speicher.
    }
  }, [studioLayout])
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  /** Eigene Filamentprofile (nur Filamentwerte, lokal gespeichert) */
  const [userFilaments, setUserFilaments] = useState<UserFilament[]>(() => loadUserFilaments())
  const [setup, setSetup] = useState<Setup>(DEFAULT_SETUP)
  const [setupOpen, setSetupOpen] = useState(false)
  /** Erst nach dem Laden darf der automatische Gesamtstand geschrieben werden. */
  const hydratedRef = useRef(false)
  const [printerSettingsOpen, setPrinterSettingsOpen] = useState(false)
  const [webOpen, setWebOpen] = useState(false)
  const [settings, setSettings] = useState<PrintSettings>(DEFAULT_SETTINGS)
  const [theme, setTheme] = useState<Theme>(() => loadTheme())
  const [uiScaleId, setUiScaleId] = useState<UiScaleId>(() => loadUiScaleId())
  /** Zuletzt gewähltes Qualitätsprofil — bleibt Reset-Ziel bei eigenen Werten. */
  const [qualityPresetId, setQualityPresetId] = useState('normal')
  /** Eigene Qualitätsprofile, lokal und getrennt je Drucker gespeichert. */
  const [userQualityProfiles, setUserQualityProfiles] = useState<UserQualityProfile[]>(() =>
    loadUserQualityProfiles(),
  )

  const [model, setModel] = useState<ModelState | null>(null)
  // Mehrfachauswahl: Strg-Klick ergänzt Teile, das zuletzt gewählte ist führend.
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const selectedObjectId = selectedIds.length ? selectedIds[selectedIds.length - 1] : null
  /** Einzelauswahl setzen (alle bisherigen Aufrufer bleiben gültig). */
  const setSelectedObjectId = useCallback((id: string | null) => setSelectedIds(id ? [id] : []), [])
  const [rotateMode, setRotateMode] = useState(false)
  const [rotateInfo, setRotateInfo] = useState<{ axis: 'x' | 'y' | 'z'; value: number } | null>(null)
  const [overlayGeometry, setOverlayGeometry] = useState<THREE.BufferGeometry | null>(null)
  const [result, setResult] = useState<(SliceResult & { sliceMs?: number }) | null>(null)
  /** Vom Nutzer vergebener G-Code-Name; leer bedeutet automatisch erzeugen. */
  const [outputName, setOutputName] = useState('')
  const [dirty, setDirty] = useState(false)
  const [layer, setLayer] = useState(0)
  // Die Schichtvorschau zeigt ab dem ersten Slicen das ganze Teil bis zur
  // gewählten Schicht. Mit „nur aktuelle Schicht“ war die 3D-Ansicht direkt
  // nach dem Slicen fast leer und der Schieberegler schien nichts zu tun.
  const [showAll, setShowAll] = useState(true)
  /** Muster nur ansehen: Textur am Modell, unabhängig von der Oberflächenstruktur. */
  const [texturePreviewOn, setTexturePreviewOn] = useState(false)
  const [previewColorMode, setPreviewColorMode] = useState<PreviewColorMode>('kind')
  const [hiddenPreviewFeatures, setHiddenPreviewFeatures] = useState<PreviewFeatureKind[]>([])
  /** Vergleichsstand und Werkzeuge der erweiterten Vorschau (A-82). */
  const [compareResult, setCompareResult] = useState<(SliceResult & { sliceMs?: number }) | null>(null)
  const [previewSection, setPreviewSection] = useState<PreviewSection | null>(null)
  const [previewPick, setPreviewPick] = useState<PreviewSegmentRef | null>(null)
  const [previewInspect, setPreviewInspect] = useState(false)
  const [previewFilterId, setPreviewFilterId] = useState<string | null>(null)
  const [previewPalette, setPreviewPalette] = useState<PreviewPalette>('standard')
  const [intent, setIntent] = useState<IntentId | null>(null)
  const [dismissed, setDismissed] = useState<string[]>([])
  const [calibration, setCalibration] = useState<CalibrationTool | null>(null)
  const [importInfo, setImportInfo] = useState<string | null>(null)
  /** Angebot „auf 100 mm skalieren“ nach einem winzigen Import (V-25). */
  const [scaleOffer, setScaleOffer] = useState<{ largest: number } | null>(null)
  /** Vorschau der Filamentprofil-Änderungen, bevor sie angewendet werden. */
  const [filamentDiff, setFilamentDiff] = useState<FilamentDiffState | null>(null)
  /** Vorheriger Stand für „Rückgängig“ nach dem Anwenden eines Filamentprofils. */
  const [filamentApplyUndo, setFilamentApplyUndo] = useState<FilamentApplyUndo | null>(null)
  /** Ergebnis von „Mesh reparieren“ — fest unten, damit es nicht außerhalb des Bildes liegt. */
  const [toolNotice, setToolNotice] = useState<string | null>(null)
  /** Weggeklickter Mesh-Hinweis; der Meldungstext ist der Schlüssel. */
  const [meshNoticeClosed, setMeshNoticeClosed] = useState<string | null>(null)
  const [warningsClosed, setWarningsClosed] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [outputInfo, setOutputInfo] = useState<string | null>(null)
  /** Lokaler Autosave-Stand der aktuellen Geometrie. */
  const [draftStatus, setDraftStatus] = useState<'idle' | 'saving' | 'saved' | 'too-large' | 'unavailable' | 'error'>('idle')
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null)
  const [recoveryDraft, setRecoveryDraft] = useState<SavedDraft | null>(null)
  const [draftReady, setDraftReady] = useState(false)
  const draftSaveSequence = useRef(0)
  /** Geometriestand des zuletzt gesicherten Entwurfs — spart doppelte Downloads. */
  const lastDraftGeometry = useRef('')
  const pendingRestoreDraft = useRef<SavedDraft | null>(null)
  const [logsOpen, setLogsOpen] = useState(false)
  const [logsText, setLogsText] = useState('')
  const [logsPath, setLogsPath] = useState<string | null>(null)
  const [webUi, setWebUi] = useState<WebUiInfo | null>(null)

  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Live-Stand je Drucker — die Hintergrundverbindung läuft weiter. */
  const [printerStatuses, setPrinterStatuses] = useState<Record<string, PrinterStatus>>({})
  const [printerLogs, setPrinterLogs] = useState<Record<string, ConsoleLine[]>>({})
  const [mesh, setMesh] = useState<BedMesh | null>(null)
  /** Drucker des Arbeitsplatzes (IDs) — Wechsel lädt deren Einstellungen */
  const [workspace, setWorkspace] = useState<string[]>(() => loadWorkspace())
  const [probeProgress, setProbeProgress] = useState<{ done: number; total: number } | null>(null)
  const [devices, setDevices] = useState<DetectedDevice[]>([])
  const [deviceHint, setDeviceHint] = useState<string | null>(null)

  const previewFlowLimit = effectivePreviewFlowLimit(
    settings.maxVolumetricFlow,
    result?.stats.maxFlowMm3s ?? 0,
  )
  const previewSegment = useMemo(
    () =>
      result && previewPick
        ? describePreviewSegment(
            result.layers,
            previewPick.layerIndex,
            previewPick.offset,
            previewFlowLimit,
          )
        : null,
    [result, previewPick, previewFlowLimit],
  )
  const handlePreviewPick = useCallback((ref: PreviewSegmentRef | null) => {
    setPreviewPick(ref)
  }, [])
  const setPreviewInspectMode = useCallback((enabled: boolean) => {
    setPreviewInspect(enabled)
    if (enabled) {
      setMeasureOn(false)
      setMeasure(null)
    }
  }, [])

  useEffect(() => {
    setCompareResult(null)
    setPreviewPick(null)
    setPreviewInspect(false)
    setPreviewSection(null)
    setPreviewFilterId(null)
  }, [model?.id, setup.printerId])

  const fitRef = useRef<(() => void) | null>(null)
  const objectFileRef = useRef<HTMLInputElement>(null)
  const addFileRef = useRef<HTMLInputElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [tool, setTool] = useState<ToolId | null>(null)
  /** V-07: Schnittebene, die im 3D-Fenster gezogen werden kann. */
  const [splitGuide, setSplitGuide] = useState<{
    axis: api.SplitAxis
    position: number
    min: number
    max: number
  } | null>(null)
  const splitMoveRef = useRef<((position: number) => void) | null>(null)
  /** V-20: Vorschlag des Montage-Assistenten für den Teilen-Dialog. */
  const [splitPreset, setSplitPreset] = useState<Partial<SplitMemory> | null>(null)
  /** Taste L: Stützen malen; Shift kehrt Stütze/Blocker um. */
  const [paint, setPaint] = useState({ on: false, radius: 6, block: false })
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const clipboard = useRef<string[]>([])
  const [measureOn, setMeasureOn] = useState(false)
  const [measure, setMeasure] = useState<MeasureInfo | null>(null)
  useEffect(() => {
    if (measureOn) setPreviewInspect(false)
  }, [measureOn])
  /** Gewählte Platte einer Mehrplatten-3MF — nur sie wird geslict */
  const [activePlate, setActivePlate] = useState(0)
  /** Getrennte Studios: Modell, Ergebnis und Auswahl je Drucker. */
  const studioSessions = useRef<Record<string, StudioSession>>({})

  const printerBase =
    catalog?.printers.find((p) => p.id === setup.printerId) ?? DEFAULT_PRINTER
  const printer = useMemo<PrinterProfile>(
    () => {
      const effective = applyPrinterOverrides(printerBase, setup.printerOverrides)
      return setup.gcodeFlavor ? { ...effective, flavor: setup.gcodeFlavor } : effective
    },
    [printerBase, setup.gcodeFlavor, setup.printerOverrides],
  )
  const status = printerStatuses[printer.id] ?? INITIAL_STATUS
  const log = printerLogs[printer.id] ?? []
  const printerLimits = useMemo(
    () => effectivePrinterLimits(printer, setup.limits),
    [printer, setup.limits],
  )
  /** Profil mit den vom Nutzer gesetzten Grenzen — für alle Begrenzungen. */
  const limitedPrinter = useMemo(
    () => ({ ...printer, ...printerLimits }),
    [printer, printerLimits],
  )
  // Katalogfilamente + eigene Profile in einer Liste — Auswahl und Anwendung
  // laufen für beide über denselben Weg.
  const filaments = useMemo(() => {
    const base = catalog?.filaments ?? []
    return [...base, ...userFilaments.map((u) => userFilamentProfile(u, base.find((f) => f.id === u.baseId)))]
  }, [catalog, userFilaments])
  const filament = filaments.find((f) => f.id === setup.filamentId) ?? filamentById(setup.filamentId)
  const activeUserFilament = userFilaments.find((profile) => profile.id === setup.filamentId) ?? null
  /** Eindeutiger Vorschlag für eine neue, sofort auswählbare Profilversion. */
  const calibrationVersionName = useMemo(() => {
    const base = (activeUserFilament?.name ?? filament.name).replace(/ · Kalibriert(?: \d+)?$/i, '').trim()
    const stem = base || filament.name
    const names = new Set(userFilaments.map((profile) => profile.name.trim().toLowerCase()))
    let candidate = `${stem} · Kalibriert`
    let index = 2
    while (names.has(candidate.toLowerCase())) {
      candidate = `${stem} · Kalibriert ${index}`
      index += 1
    }
    return candidate
  }, [activeUserFilament, filament.name, userFilaments])
  const plate = catalog?.plates.find((p) => p.id === setup.plateId) ?? plateById(setup.plateId)
  const slots = setup.slots ?? []
  /** Plattenzahl aus den Objekten plus ausdrücklich angelegte, noch leere
   *  Platten (Rechtsklick → „Platte hinzufügen“). */
  const derivedPlateCount = model ? Math.max(1, ...model.objects.map((o) => (o.plate ?? 0) + 1)) : 1
  const [plateCount, setPlateCount] = useState(1)
  useEffect(() => {
    setPlateCount((prev) => Math.max(prev, derivedPlateCount))
  }, [derivedPlateCount])

  /** Bezugspunkt der Ansicht: Bettmitte bei mehreren Platten, sonst die Mitte
   *  der Objekte beim Laden. Der Punkt wird je Modell festgehalten — sonst
   *  wandert die Bettmitte mit jedem Verschieben mit, das Objekt springt in der
   *  Ansicht zurück und die Positionsanzeige steht immer auf 110/110. */
  const modelAnchor = useRef<{ id: string; x: number; y: number } | null>(null)
  const modelCenter = useMemo(() => {
    if (!model) return { x: 0, y: 0 }
    if (plateCount > 1) return { x: printer.bed.x / 2, y: printer.bed.y / 2 }
    const printable = model.objects.filter((o) => o.placement.visible && !o.negative)
    const list = printable.length ? printable : model.objects
    if (!list.length) return { x: 0, y: 0 }
    if (modelAnchor.current?.id !== model.id) {
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      for (const o of list) {
        minX = Math.min(minX, o.center.x - o.size.x / 2)
        maxX = Math.max(maxX, o.center.x + o.size.x / 2)
        minY = Math.min(minY, o.center.y - o.size.y / 2)
        maxY = Math.max(maxY, o.center.y + o.size.y / 2)
      }
      modelAnchor.current = { id: model.id, x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
    }
    return { x: modelAnchor.current.x, y: modelAnchor.current.y }
  }, [model, plateCount, printer.bed.x, printer.bed.y])

  // Katalogprofile plus eigene, pro Drucker gespeicherte Qualitätsprofile.
  const qualityPresets = useMemo<QualityPreset[]>(() => {
    const own = userQualityProfiles
      .filter((profile) => profile.printerId === printer.id)
      .map((profile) => ({
        id: profile.id,
        label: profile.name,
        layerHeight: profile.settings.layerHeight,
        firstLayerHeight: profile.settings.firstLayerHeight,
        walls: profile.settings.walls,
        topLayers: profile.settings.topLayers,
        bottomLayers: profile.settings.bottomLayers,
        infillDensity: profile.settings.infillDensity,
        speedFactor: 1,
        accelFactor: 1,
        note: 'Eigenes Qualitätsprofil für diesen Drucker.',
        custom: true,
      }))
    return [...qualityPresetsFor(printer), ...own]
  }, [printer, userQualityProfiles])

  const selectedCustomQuality = useMemo(
    () =>
      userQualityProfiles.find(
        (profile) => profile.id === qualityPresetId && profile.printerId === printer.id,
      ) ?? null,
    [printer.id, qualityPresetId, userQualityProfiles],
  )
  const activeQuality = useMemo(
    () => (selectedCustomQuality ? null : qualityPresetFor(printer, settings.layerHeight)),
    [printer, selectedCustomQuality, settings.layerHeight],
  )
  const qualityId = selectedCustomQuality?.id ?? activeQuality?.id ?? 'custom'

  // Erkennt ein gespeichertes oder manuell exakt getroffenes Profil. Bei
  // eigenen Zwischenwerten bleibt das zuletzt gewählte Profil Reset-Ziel.
  useEffect(() => {
    if (selectedCustomQuality) return
    // Ein laufender Kalibriertest ändert Schichthöhe und Struktur. Das darf
    // nicht als neues Qualitätsprofil erkannt werden, sonst verliert der Test
    // das vom Nutzer ausgewählte Profil samt Geschwindigkeit und Beschleunigung.
    if (readCalibrationTestState(printer.id)) return
    if (activeQuality) {
      setQualityPresetId(activeQuality.id)
      return
    }
    // Ein Profil eines anderen Druckers darf nicht als Baseline stehen bleiben.
    if (!qualityPresets.some((preset) => preset.id === qualityPresetId)) setQualityPresetId('normal')
  }, [activeQuality, printer.id, qualityPresetId, qualityPresets, selectedCustomQuality])

  // Das gewählte Qualitätsprofil ist Teil des Gesamtstands und wird im Setup
  // gespeichert, damit es beim nächsten Start exakt wieder da ist.
  useEffect(() => {
    if (!catalog || setup.qualityPresetId === qualityPresetId) return
    setSetup((previous) =>
      previous.qualityPresetId === qualityPresetId ? previous : { ...previous, qualityPresetId },
    )
  }, [catalog, qualityPresetId, setup.qualityPresetId])

  const profileBaseline = useMemo(
    () =>
      selectedCustomQuality
        ? applyPrinterLimits(limitedPrinter, selectedCustomQuality.settings)
        : qualityBaseline(limitedPrinter, filament, plate, setup.nozzle, qualityPresetId),
    [filament, limitedPrinter, plate, qualityPresetId, selectedCustomQuality, setup.nozzle],
  )

  // Mehrfachzuführung in konkrete Slots übersetzen. Das geschieht auch für
  // ältere Druckerstände, die noch keine Slot-Liste kannten.
  useEffect(() => {
    // Beim ersten Start ist der Einrichtungsdialog offen; die IFS-Slots dürfen
    // erst nach der bewussten Auswahl gespeichert werden.
    if (!catalog || !printer.ifs || setupOpen) return
    const nextSlots = slotsForPrinter(printer, setup.slots, setup.filamentId, filaments)
    if (sameSlots(nextSlots, setup.slots)) return
    const nextSetup: Setup = {
      ...setup,
      slots: nextSlots,
      activeSlotId:
        setup.activeSlotId && nextSlots.some((s) => s.id === setup.activeSlotId)
          ? setup.activeSlotId
          : nextSlots[0]?.id,
    }
    setSetup(nextSetup)
    saveSetup(nextSetup)
    saveSnapshot({ setup: nextSetup, settings, savedAt: Date.now() }, nextSetup.printerId)
  }, [catalog, filaments, printer, settings, setup, setupOpen])

  useEffect(() => {
    applyTheme(theme)
    saveTheme(theme)
  }, [theme])

  // Nur ein ungeordnetes Ende wird als Absturz angeboten. Ein bewusstes
  // Schließen markiert der beforeunload-Handler weiter unten.
  useEffect(() => {
    let alive = true
    loadRecoveryDraft()
      .then((draft) => {
        if (!alive) return
        setRecoveryDraft(draft)
        setDraftReady(true)
      })
      .catch(() => {
        if (alive) setDraftReady(true)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    saveUiScaleId(uiScaleId)
    const apply = () => applyUiScale(resolveUiScale(uiScaleId))
    apply()
    if (uiScaleId !== 'auto') return
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [uiScaleId])

  useEffect(() => {
    if (activePlate > plateCount - 1) setActivePlate(plateCount - 1)
  }, [activePlate, plateCount])

  // Für den Live-Kanal: Messungen anderer Drucker dürfen die Anzeige nicht überschreiben
  const printerIdRef = useRef(printer.id)
  useEffect(() => {
    printerIdRef.current = printer.id
  }, [printer.id])

  // Der Server behält alle Verbindungen; nur die aktive Ansicht wechselt.
  useEffect(() => {
    if (!catalog) return
    let alive = true
    api
      .selectPrinter(printer.id)
      .then((res) => {
        if (alive) setPrinterStatuses((prev) => ({ ...prev, [res.printerId]: res.status }))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [catalog, printer.id])

  // Mesh des gewählten Modells laden — beim Wechsel wird nichts übernommen
  useEffect(() => {
    let alive = true
    api
      .fetchPrinterMesh(printer.id)
      .then((m) => {
        if (alive) setMesh(m)
      })
      .catch(() => {
        if (alive) setMesh(null)
      })
    return () => {
      alive = false
    }
  }, [printer.id])

  // Katalog + gespeicherte Auswahl
  useEffect(() => {
    let alive = true
    api
      .fetchCatalog()
      .then((data) => {
        if (!alive) return
        setCatalog(data)
        const saved = loadSetup()
        const initialPrinterId = forcedPrinterId ?? saved?.printerId ?? null
        if (initialPrinterId) {
          const base = data.printers.find((p) => p.id === initialPrinterId) ?? DEFAULT_PRINTER
          const snap = loadSnapshot(base.id)
          // Im Pane gilt ausschließlich der Drucker aus der URL. Sonst würde
          // das zuletzt aktive Studio die andere Seite überschreiben.
          const fallback = {
            ...DEFAULT_SETUP,
            printerId: base.id,
            filamentId: data.filaments[0]?.id ?? DEFAULT_SETUP.filamentId,
            plateId: base.defaultPlate,
            nozzle: base.nozzleOptions[0] ?? DEFAULT_SETUP.nozzle,
          }
          const normalized = normalizeSetup(
            snap?.setup ?? (forcedPrinterId ? fallback : saved ?? fallback),
          )
          // Standard-Start/-Ende für dieses Profil in die editierbaren Felder
          // übernehmen; vorhandene eigene Blöcke bleiben erhalten.
          const nextSetup = ensureMachineGcode(normalized, base)
          setSetup(nextSetup)
          setQualityPresetId(nextSetup.qualityPresetId ?? 'normal')
          setSettings(
            (snap?.settings ? mergeSettings(DEFAULT_SETTINGS, snap.settings) : null) ??
              settingsForFilament(
                data.defaults ?? DEFAULT_SETTINGS,
                data.filaments.find((f) => f.id === nextSetup.filamentId) ?? data.filaments[0],
                data.plates.find((p) => p.id === nextSetup.plateId) ?? data.plates[0],
                nextSetup.nozzle,
              ),
          )
          setWorkspace((prev) => (prev.includes(nextSetup.printerId) ? prev : [...prev, nextSetup.printerId]))
          setSetupOpen(false)
          hydratedRef.current = true
        } else {
          setSettings(mergeSettings(DEFAULT_SETTINGS, data.defaults ?? {}))
          setSetupOpen(true)
          hydratedRef.current = true
        }
      })
      .catch(() => setError('Server nicht erreichbar — läuft `npm run dev`?'))
    return () => {
      alive = false
    }
  }, [])

  // Jede Änderung sofort als Gesamtstand für den nächsten Start sichern.
  // Solange der Einrichtungsdialog offen ist, wird noch nichts festgeschrieben.
  useEffect(() => {
    if (!catalog || !hydratedRef.current || setupOpen) return
    const nextSetup =
      setup.qualityPresetId === qualityPresetId ? setup : { ...setup, qualityPresetId }
    saveSetup(nextSetup)
    saveSnapshot({ setup: nextSetup, settings, savedAt: Date.now() }, nextSetup.printerId)
  }, [catalog, qualityPresetId, settings, setup, setupOpen])

  // Auch beim Schließen/Neuladen den letzten Stand mitschreiben.
  useEffect(() => {
    const persistBeforeClose = () => {
      if (!catalog || !hydratedRef.current || setupOpen) return
      const nextSetup =
        setup.qualityPresetId === qualityPresetId ? setup : { ...setup, qualityPresetId }
      saveSetup(nextSetup)
      saveSnapshot({ setup: nextSetup, settings, savedAt: Date.now() }, nextSetup.printerId)
      markDraftCleanExit()
    }
    window.addEventListener('beforeunload', persistBeforeClose)
    return () => window.removeEventListener('beforeunload', persistBeforeClose)
  }, [catalog, qualityPresetId, settings, setup, setupOpen])

  // Geräteerkennung
  const scan = useCallback(async () => {
    try {
      setDevices(await api.scanDevices())
    } catch {
      setDevices([])
    }
  }, [])

  const reloadCatalog = useCallback(async () => {
    try {
      setCatalog(await api.fetchCatalog())
    } catch {
      /* Katalog bleibt beim alten Stand */
    }
  }, [])

  useEffect(() => {
    void scan()
    const timer = setInterval(() => {
      void scan()
    }, 6000)
    return () => clearInterval(timer)
  }, [scan])

  // Live-Verbindung
  useEffect(() => {
    let socket: WebSocket | null = null
    let stopped = false
    let retry: ReturnType<typeof setTimeout> | undefined

    const open = () => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      socket = new WebSocket(`${proto}//${location.host}/ws`)
      socket.onmessage = (event) => {
        let msg: api.WsMessage
        try {
          msg = JSON.parse(event.data as string) as api.WsMessage
        } catch {
          return
        }
        if (msg.type === 'init') {
          const nextStatuses = Object.fromEntries(
            (msg.printers ?? []).map((entry) => [entry.id, entry.status]),
          ) as Record<string, PrinterStatus>
          nextStatuses[msg.printerId] = msg.status
          setPrinterStatuses(nextStatuses)
          setPrinterLogs(
            Object.fromEntries((msg.printers ?? []).map((entry) => [entry.id, entry.log])) as Record<
              string,
              ConsoleLine[]
            >,
          )
          if (!msg.mesh?.printerId || msg.mesh.printerId === printerIdRef.current) setMesh(msg.mesh)
        } else if (msg.type === 'status') {
          const printerId = msg.printerId ?? printerIdRef.current
          setPrinterStatuses((prev) => ({ ...prev, [printerId]: msg.status }))
        } else if (msg.type === 'log') {
          const printerId = msg.printerId ?? printerIdRef.current
          setPrinterLogs((prev) => ({
            ...prev,
            [printerId]: [...(prev[printerId] ?? []).slice(-400), msg.line],
          }))
        } else if (msg.type === 'mesh') {
          const printerId = msg.printerId ?? msg.mesh.printerId
          if (printerId === printerIdRef.current) setMesh(msg.mesh)
        } else if (msg.type === 'probe') {
          if (msg.printerId && msg.printerId !== printerIdRef.current) return
          setProbeProgress({ done: msg.done, total: msg.total })
          if (msg.done >= msg.total) setTimeout(() => setProbeProgress(null), 1500)
        }
      }
      socket.onclose = () => {
        if (!stopped) retry = setTimeout(open, 2500)
      }
    }
    open()

    return () => {
      stopped = true
      if (retry) clearTimeout(retry)
      socket?.close()
    }
  }, [])

  // Arbeitsplatzliste speichern und den aktuellen Drucker immer enthalten
  useEffect(() => {
    setWorkspace((prev) => (prev.includes(printer.id) ? prev : [...prev, printer.id]))
  }, [printer.id])

  useEffect(() => {
    if (workspace.length > 0) saveWorkspace(workspace)
  }, [workspace])

  /**
   * Den kompletten Studio-Stand festhalten. Beim Wechsel auf einen anderen
   * Drucker wird er dort wieder eingesetzt; der Server behält die Modell-ID.
   */
  const captureStudio = useCallback(
    (): StudioSession => ({
      setup,
      settings,
      model,
      result,
      selectedIds,
      outputName,
      dirty,
      activePlate,
      plateCount,
      outputInfo,
      layer,
      showAll,
      previewColorMode,
      testStructureActive: readCalibrationTestState(setup.printerId) !== null,
    }),
    [
      activePlate,
      dirty,
      layer,
      model,
      plateCount,
      outputInfo,
      outputName,
      previewColorMode,
      result,
      selectedIds,
      settings,
      setup,
      showAll,
    ],
  )

  const restoreStudio = useCallback(
    (session: StudioSession, target: PrinterProfile) => {
      const nextSetup = normalizeSetup(session.setup)
      const effectiveTarget = applyPrinterOverrides(target, nextSetup.printerOverrides)
      const nextWithGcode = ensureMachineGcode(nextSetup, effectiveTarget, {
        profile: printer,
        flavor: setup.gcodeFlavor ?? printer.flavor,
      })
      const nextSettings = applyPrinterLimits(
        { ...effectiveTarget, ...effectivePrinterLimits(effectiveTarget, nextWithGcode.limits) },
        session.settings,
      )
      setSetup(nextWithGcode)
      setQualityPresetId(nextWithGcode.qualityPresetId ?? 'normal')
      setSettings(nextSettings)
      setModel(session.model)
      setResult(session.result)
      setSelectedIds(session.selectedIds)
      setOutputName(session.outputName)
      setDirty(session.dirty)
      setActivePlate(session.activePlate)
      setPlateCount(session.plateCount)
      setOutputInfo(session.outputInfo)
      setLayer(session.layer)
      setShowAll(session.showAll)
      setPreviewColorMode(session.previewColorMode)
      // Werkzeugzustände gehören zum sichtbaren Studio, nicht zum neuen Drucker.
      setTool(null)
      setMenu(null)
      setMeasureOn(false)
      setMeasure(null)
      setRotateMode(false)
      setCalibration(null)
      setImportInfo(null)
      setToolNotice(null)
      saveSetup(nextWithGcode)
      saveSnapshot(
        { setup: nextWithGcode, settings: nextSettings, savedAt: Date.now() },
        nextWithGcode.printerId,
      )
    },
    [printer, setup.gcodeFlavor],
  )

  const updateSettings = useCallback(
    (input: PrintSettings) => {
      const next = applyPrinterLimits(limitedPrinter, input)
      // Nach einem Test: geänderte Kalibrierwerte sind bewusst übernommene
      // Messwerte. Unveränderte Test-Startwerte bleiben als Testwerte markiert
      // und werden beim Alltagsmodell zurückgesetzt.
      const testState = readCalibrationTestState(printer.id)
      if (testState) {
        const marked = markMeasuredCalibrationValues(testState, settings, next)
        if (marked !== testState) writeCalibrationTestState(printer.id, marked)
      }
      setSettings(next)
      setDirty(true)
      // Der Düsendurchmesser steht in den Einstellungen und im Drucker-Setup.
      // Beide zusammenhalten, sonst zeigt die Kopfzeile einen anderen Wert.
      let nextSetup = setup
      if (next.nozzle !== setup.nozzle) {
        nextSetup = { ...setup, nozzle: next.nozzle }
        setSetup(nextSetup)
        saveSetup(nextSetup)
      }
      // Alle Werte gehören zum aktuell gewählten Drucker
      saveSnapshot({ setup: nextSetup, settings: next, savedAt: Date.now() }, nextSetup.printerId)
    },
    [limitedPrinter, printer.id, settings, setup],
  )

  /** Aktuellen Qualitätsstand unter einem Namen sichern und direkt auswählen. */
  const saveQualityProfile = useCallback(
    (name: string) => {
      const result = saveUserQualityProfile(name, printer.id, settings)
      setUserQualityProfiles(result.profiles)
      setQualityPresetId(result.profile.id)
      setDirty(true)
      setIntent(null)
      saveSnapshot({ setup, settings, savedAt: Date.now() }, setup.printerId)
    },
    [printer.id, settings, setup],
  )

  const renameQualityProfile = useCallback((id: string, name: string) => {
    const result = renameUserQualityProfile(id, name)
    if (!result.ok) {
      return result.reason === 'name-exists' ? 'Name ist bereits vergeben.' : 'Profil nicht gefunden.'
    }
    setUserQualityProfiles(result.profiles)
    return null
  }, [])

  const deleteQualityProfile = useCallback((id: string) => {
    setUserQualityProfiles(deleteUserQualityProfile(id))
    setQualityPresetId((current) => (current === id ? 'normal' : current))
  }, [])

  const applyQuality = useCallback(
    (id: string) => {
      const custom = userQualityProfiles.find(
        (profile) => profile.id === id && profile.printerId === printer.id,
      )
      if (!custom && !qualityPresets.some((p) => p.id === id)) return
      const next = custom
        ? applyPrinterLimits(limitedPrinter, custom.settings)
        : qualityBaseline(limitedPrinter, filament, plate, setup.nozzle, id)
      updateSettings(next)
      setQualityPresetId(id)
      setIntent(null)
    },
    [
      filament,
      limitedPrinter,
      plate,
      printer.id,
      qualityPresets,
      setup.nozzle,
      updateSettings,
      userQualityProfiles,
    ],
  )

  const resetSettings = useCallback(() => {
    updateSettings(profileBaseline)
    setIntent(null)
  }, [profileBaseline, updateSettings])

  /** Nach einem Test die Alltagswerte für den aktuellen Drucker zurückholen. */
  const restoreDailySettings = useCallback(() => {
    const testState = readCalibrationTestState(printer.id)
    if (!testState) return false
    const takeover = applyModelSettingsTakeover({
      current: settings,
      testState,
      normalize: (next) => applyPrinterLimits(limitedPrinter, next),
    })
    setSettings(takeover.settings)
    if (takeover.qualityPresetId) setQualityPresetId(takeover.qualityPresetId)
    clearCalibrationTestState(printer.id)
    setResult(null)
    setDirty(true)
    return true
  }, [limitedPrinter, printer.id, settings])

  const applySetup = useCallback(
    (input: Setup) => {
      // Stand des bisherigen Druckers sichern, bevor gewechselt wird
      studioSessions.current[setup.printerId] = captureStudio()
      saveSnapshot({ setup, settings, savedAt: Date.now() }, setup.printerId)
      const next = normalizeSetup(input)
      const previousPrinterId = setup.printerId
      const targetSession =
        next.printerId !== previousPrinterId ? studioSessions.current[next.printerId] : null
      // Eigener G-Code gehört zum Drucker, nicht zum gerade offenen Gerät.
      if (next.printerId !== setup.printerId) {
        const target = loadSnapshot(next.printerId)
        next.customGcode = { ...EMPTY_CUSTOM_GCODE, ...(target?.setup.customGcode ?? {}) }
        next.postProcessing = { ...EMPTY_POST_PROCESSING, ...(target?.setup.postProcessing ?? {}) }
        // Grenzen und Flavor gehören ebenfalls zum Ziel-Drucker, nicht zum alten Gerät.
        next.limits = target?.setup.limits ? { ...target.setup.limits } : undefined
        next.gcodeFlavor = target?.setup.gcodeFlavor
        next.printerOverrides = target?.setup.printerOverrides
        next.plateProfiles = { ...(target?.setup.plateProfiles ?? {}), ...(next.plateProfiles ?? {}) }
      }
      const chosenBase = (catalog?.printers ?? []).find((x) => x.id === next.printerId) ?? printerBase
      const chosen = applyPrinterOverrides(chosenBase, next.printerOverrides)
      const nextWithGcode = ensureMachineGcode(next, chosen, {
        profile: printer,
        flavor: setup.gcodeFlavor ?? printer.flavor,
      })
      setSetup(nextWithGcode)
      setQualityPresetId(nextWithGcode.qualityPresetId ?? 'normal')
      saveSetup(nextWithGcode)
      setSetupOpen(false)
      const f = filaments.find((x) => x.id === nextWithGcode.filamentId)
      const plate = (catalog?.plates ?? []).find((x) => x.id === nextWithGcode.plateId)
      if (f && plate) {
        const nextSettings = applyPrinterLimits(
          { ...chosen, ...effectivePrinterLimits(chosen, nextWithGcode.limits) },
          applyPlateProfile(
            settingsForFilament(settings, f, plate, nextWithGcode.nozzle),
            nextWithGcode.plateProfiles?.[nextWithGcode.plateId],
            nextWithGcode.filamentId,
          ),
        )
        setSettings(nextSettings)
        setDirty(true)
        saveSnapshot({ setup: nextWithGcode, settings: nextSettings, savedAt: Date.now() }, nextWithGcode.printerId)
      }
      setWorkspace((prev) => (prev.includes(next.printerId) ? prev : [...prev, next.printerId]))
      if (next.printerId !== previousPrinterId) {
        // Kein Modell vom alten Studio in das neue schleppen.
        setModel(targetSession?.model ?? null)
        setSelectedIds(targetSession?.selectedIds ?? [])
        setActivePlate(targetSession?.activePlate ?? 0)
        setPlateCount(targetSession?.plateCount ?? 1)
        setOutputName(targetSession?.outputName ?? '')
        setLayer(targetSession?.layer ?? 0)
        setShowAll(targetSession?.showAll ?? true)
        setPreviewColorMode(targetSession?.previewColorMode ?? 'kind')
        setCalibration(null)
        setTool(null)
      }
      setResult(null)
      setOutputInfo(null)
    },
    [catalog, captureStudio, filaments, printer, printerBase, settings, setup],
  )

  /** Zwischen den Druckern des Arbeitsplatzes wechseln (lädt deren Werte). */
  const switchPrinter = useCallback(
    (id: string) => {
      if (id === setup.printerId) return
      // Das bisherige Studio bleibt vollständig erhalten.
      studioSessions.current[setup.printerId] = captureStudio()
      saveSnapshot({ setup, settings, savedAt: Date.now() }, setup.printerId)
      const target = (catalog?.printers ?? PRINTERS).find((p) => p.id === id)
      if (!target) return
      const cached = studioSessions.current[id]
      if (cached) {
        restoreStudio(cached, target)
        return
      }
      const snap = loadSnapshot(id)
      if (snap && snap.setup.printerId === id) {
        const normalized = normalizeSetup(snap.setup)
        const effectiveTarget = applyPrinterOverrides(target, normalized.printerOverrides)
        const nextSetup = ensureMachineGcode(normalized, effectiveTarget, {
          profile: printer,
          flavor: setup.gcodeFlavor ?? printer.flavor,
        })
        const nextLimits = effectivePrinterLimits(effectiveTarget, nextSetup.limits)
        setSetup(nextSetup)
        setQualityPresetId(nextSetup.qualityPresetId ?? 'normal')
        saveSetup(nextSetup)
        // Ältere Stände kennen neue Felder (Stützen, Kühlung) noch nicht
        setSettings(
          applyPrinterLimits(
            { ...effectiveTarget, ...nextLimits },
            mergeSettings(DEFAULT_SETTINGS, snap.settings),
          ),
        )
      } else {
        const f = filaments.find((x) => x.id === setup.filamentId)
        const plate = (catalog?.plates ?? []).find((x) => x.id === target.defaultPlate) ?? catalog?.plates?.[0]
        const nozzle = target.nozzleOptions.includes(setup.nozzle) ? setup.nozzle : target.nozzleOptions[0]
        if (!f || !plate) return
        const nextSetup = ensureMachineGcode(
          {
            printerId: id,
            filamentId: f.id,
            plateId: plate.id,
            qualityPresetId: 'normal',
            nozzle,
            nozzleMaterial: setup.nozzleMaterial ?? 'unknown',
            customGcode: EMPTY_CUSTOM_GCODE,
            postProcessing: EMPTY_POST_PROCESSING,
          },
          target,
        )
        const nextSettings = applyPrinterLimits(
          { ...target, ...effectivePrinterLimits(target) },
          settingsForFilament(settings, f, plate, nozzle),
        )
        setSetup(nextSetup)
        setQualityPresetId('normal')
        saveSetup(nextSetup)
        setSettings(nextSettings)
        saveSnapshot({ setup: nextSetup, settings: nextSettings, savedAt: Date.now() }, id)
      }
      setModel(null)
      setSelectedIds([])
      setOutputName('')
      setResult(null)
      setOutputInfo(null)
      setLayer(0)
      setShowAll(false)
      setActivePlate(0)
      setDirty(false)
      setCalibration(null)
      setTool(null)
    },
    [captureStudio, catalog, restoreStudio, settings, setup],
  )

  /** Post-Processing-Skript für genau diesen Drucker speichern. */
  const updatePostProcessing = useCallback(
    (postProcessing: PostProcessingScript) => {
      const next = { ...setup, postProcessing }
      setSetup(next)
      setDirty(true)
      saveSetup(next)
      saveSnapshot({ setup: next, settings, savedAt: Date.now() }, next.printerId)
    },
    [settings, setup],
  )

  /** Eigenen G-Code für genau diesen Drucker speichern. */
  const updateCustomGcode = useCallback(
    (customGcode: CustomGcode) => {
      const next = { ...setup, customGcode }
      setSetup(next)
      setDirty(true)
      saveSetup(next)
      saveSnapshot({ setup: next, settings, savedAt: Date.now() }, next.printerId)
    },
    [settings, setup],
  )

  /** Firmware-Geschmack wechseln; unveränderte Standardblöcke folgen mit. */
  const updateGcodeFlavor = useCallback(
    (gcodeFlavor: GcodeFlavor) => {
      const base = (catalog?.printers ?? PRINTERS).find((p) => p.id === setup.printerId) ?? printer
      const next = ensureMachineGcode({ ...setup, gcodeFlavor }, base, {
        profile: printer,
        flavor: setup.gcodeFlavor ?? printer.flavor,
      })
      setSetup(next)
      setDirty(true)
      saveSetup(next)
      saveSnapshot({ setup: next, settings, savedAt: Date.now() }, next.printerId)
    },
    [catalog, printer, settings, setup],
  )

  /** Düsenwerkstoff gehört zum Drucker und wird dort gesichert. */
  const updateNozzleMaterial = useCallback(
    (nozzleMaterial: NozzleMaterial) => {
      const next = { ...setup, nozzleMaterial }
      setSetup(next)
      saveSetup(next)
      setDirty(true)
      saveSnapshot({ setup: next, settings, savedAt: Date.now() }, next.printerId)
    },
    [settings, setup],
  )

  /** Eigene Höchstwerte für genau diesen Drucker speichern. */
  const updatePrinterLimits = useCallback(
    (next: PrinterLimits) => {
      const merged = effectivePrinterLimits(printer, next)
      const nextSetup = { ...setup, limits: merged }
      const nextSettings = applyPrinterLimits({ ...printer, ...merged }, settings)
      setSetup(nextSetup)
      setSettings(nextSettings)
      setDirty(true)
      setResult(null)
      setOutputInfo(null)
      saveSetup(nextSetup)
      saveSnapshot({ setup: nextSetup, settings: nextSettings, savedAt: Date.now() }, nextSetup.printerId)
    },
    [printer, settings, setup],
  )

  /** Eigene Gerätewerte für genau diesen Drucker speichern. */
  const updatePrinterOverrides = useCallback(
    (next?: PrinterOverrides) => {
      const nextPrinter = applyPrinterOverrides(printer, next)
      const nextSetup = ensureMachineGcode(
        { ...setup, printerOverrides: next },
        nextPrinter,
        { profile: printer, flavor: setup.gcodeFlavor ?? printer.flavor },
      )
      setSetup(nextSetup)
      setDirty(true)
      setResult(null)
      setOutputInfo(null)
      saveSetup(nextSetup)
      saveSnapshot({ setup: nextSetup, settings, savedAt: Date.now() }, nextSetup.printerId)
    },
    [printer, settings, setup],
  )

  /** Aktuelle Einstellungen im ausgewählten oder in einem neuen Filamentprofil ablegen. */
  const saveMyFilament = useCallback(
    (name: string, targetId?: string): string | null => {
      const result = saveUserFilament(name, settings, setup.filamentId, targetId)
      if (!result.ok) return result.error
      const { profiles, profile } = result
      setUserFilaments(profiles)
      // Das gerade gespeicherte Profil ist ab jetzt das aktive. Die Werte
      // stammen aus genau diesem Stand, deshalb bleiben sie unverändert.
      let nextSetup = { ...setup, filamentId: profile.id }
      // Ein neues Profil erbt den Platten-Override des bisher aktiven
      // Filaments. Beim ausdrücklichen Überschreiben bleibt der vorhandene
      // Override unverändert an der Ziel-ID.
      const plateProfiles = targetId
        ? setup.plateProfiles
        : copyFilamentPlateOverride(setup.plateProfiles, setup.plateId, setup.filamentId, profile.id)
      const copiedPlateOverride = plateProfiles !== setup.plateProfiles
      if (copiedPlateOverride) nextSetup = { ...nextSetup, plateProfiles }
      setSetup(nextSetup)
      saveSetup(nextSetup)
      saveSnapshot({ setup: nextSetup, settings, savedAt: Date.now() }, nextSetup.printerId)
      const copiedText = copiedPlateOverride ? ' Der Platten-Override der aktiven Platte wurde übernommen.' : ''
      setImportInfo(
        targetId
          ? `Filament-Profil „${profile.name}“ aktualisiert und ausgewählt — Temperatur, Kühlung, Retract, Fluss und Schrumpfung sind enthalten.${copiedText}`
          : `Filament-Profil „${profile.name}“ gespeichert und ausgewählt — Temperatur, Kühlung, Retract, Fluss und Schrumpfung sind enthalten.${copiedText}`,
      )
      return null
    },
    [settings, setup],
  )

  /** Kalibriermesswerte in das aktive Profil oder eine neue Version schreiben. */
  const saveCalibrationProfile = useCallback(
    (patch: CalibrationProfilePatch, mode: 'active' | 'new', name?: string): CalibrationSaveResult => {
      const target = mode === 'active' ? activeUserFilament : null
      if (mode === 'active' && !target) {
        return {
          ok: false,
          error: 'Das aktive Profil ist ein Katalogprofil. Bitte die Messwerte als neue Version speichern.',
        }
      }

      const nextSettings = applyPrinterLimits(
        limitedPrinter,
        mergeSettings(settings, {
          ...(patch.flow !== undefined ? { flow: patch.flow } : {}),
          ...(patch.maxVolumetricFlow !== undefined ? { maxVolumetricFlow: patch.maxVolumetricFlow } : {}),
          ...(patch.pressureAdvance !== undefined
            ? {
                pressureAdvance: { enabled: true, value: patch.pressureAdvance },
                // Ein gemessener PA-Wert ersetzt die Testrampe.
                pressureAdvanceRamp: { enabled: false },
              }
            : {}),
          ...(patch.nozzleTemp !== undefined
            ? { temps: { ...settings.temps, nozzle: patch.nozzleTemp } }
            : {}),
        }),
      )

      const result = saveUserFilament(
        name?.trim() || calibrationVersionName,
        nextSettings,
        setup.filamentId,
        target?.id,
      )
      if (!result.ok) return { ok: false, error: result.error }

      const { profiles, profile } = result
      setUserFilaments(profiles)
      let nextSetup = { ...setup, filamentId: profile.id }
      const plateProfiles = target
        ? setup.plateProfiles
        : copyFilamentPlateOverride(setup.plateProfiles, setup.plateId, setup.filamentId, profile.id)
      if (plateProfiles !== setup.plateProfiles) nextSetup = { ...nextSetup, plateProfiles }

      setSetup(nextSetup)
      saveSetup(nextSetup)
      setSettings(nextSettings)
      setDirty(true)
      setResult(null)
      setOutputInfo(null)
      saveSnapshot({ setup: nextSetup, settings: nextSettings, savedAt: Date.now() }, nextSetup.printerId)
      setImportInfo(
        mode === 'active'
          ? `Kalibrierwerte in „${profile.name}“ übernommen — Düse, Fluss, Volumenstrom und PA sind gespeichert.`
          : `Kalibrierwerte als neue Profilversion „${profile.name}“ gespeichert und aktiviert.`,
      )
      return { ok: true, profileName: profile.name }
    },
    [activeUserFilament, calibrationVersionName, limitedPrinter, settings, setup],
  )

  /**
   * Gespeichertes Filamentprofil anwenden. Eigene Profile bringen ihre
   * Filamentwerte mit; Qualität, Struktur und Geschwindigkeit bleiben aus dem
   * laufenden Projekt erhalten. Katalogprofile laufen über den normalen
   * Filamentwechsel.
   */
  const applyFilamentProfile = useCallback(
    (id: string) => {
      const saved = userFilaments.find((f) => f.id === id)
      if (!saved) {
        setFilamentDiff(null)
        setFilamentApplyUndo(null)
        applySetup({ ...setup, filamentId: id })
        return
      }
      const savedSettings = mergeSettings(DEFAULT_SETTINGS, saved.settings)
      const nextSetup = { ...setup, filamentId: id }
      // Derselbe Weg wie beim Katalogprofil: erst die Filamentwerte, danach
      // die aktive Platten-Temperaturübersteuerung. Sonst zeigt die Platte
      // den Override an, während der G-Code noch die Profilwerte nutzt.
      const nextSettings = applyPrinterLimits(
        limitedPrinter,
        applyPlateProfile(
          {
            ...settings,
            filamentDiameter: savedSettings.filamentDiameter,
            flow: savedSettings.flow,
            fanSpeed: savedSettings.fanSpeed,
            maxVolumetricFlow: savedSettings.maxVolumetricFlow,
            temps: { ...settings.temps, ...savedSettings.temps },
            pressureAdvance: savedSettings.pressureAdvance,
            retraction: savedSettings.retraction,
            shrinkage: savedSettings.shrinkage,
            cooling: savedSettings.cooling,
          },
          nextSetup.plateProfiles?.[nextSetup.plateId],
          id,
        ),
      )
      setFilamentDiff({
        id,
        name: saved.name,
        nextSetup,
        nextSettings,
        rows: filamentDiffRows(settings, nextSettings),
      })
    },
    [applySetup, limitedPrinter, settings, setup, userFilaments],
  )

  const confirmFilamentDiff = useCallback(() => {
    if (!filamentDiff) return
    const { name, nextSetup, nextSettings, rows } = filamentDiff
    setFilamentApplyUndo({ label: name, setup, settings })
    setSetup(nextSetup)
    saveSetup(nextSetup)
    setSettings(nextSettings)
    setDirty(true)
    setResult(null)
    setOutputInfo(null)
    saveSnapshot({ setup: nextSetup, settings: nextSettings, savedAt: Date.now() }, nextSetup.printerId)
    setImportInfo(
      rows.length
        ? `Filamentprofil „${name}“ angewendet — ${rows.length} Wert${rows.length === 1 ? '' : 'e'} geändert.`
        : `Filamentprofil „${name}“ ausgewählt — keine Werte geändert.`,
    )
    setFilamentDiff(null)
  }, [filamentDiff, settings, setup])

  const undoFilamentApply = useCallback(() => {
    if (!filamentApplyUndo) return
    const { label, setup: previousSetup, settings: previousSettings } = filamentApplyUndo
    setSetup(previousSetup)
    saveSetup(previousSetup)
    setSettings(previousSettings)
    setDirty(true)
    setResult(null)
    setOutputInfo(null)
    saveSnapshot(
      { setup: previousSetup, settings: previousSettings, savedAt: Date.now() },
      previousSetup.printerId,
    )
    setFilamentApplyUndo(null)
    setImportInfo(`Anwendung von „${label}“ rückgängig gemacht — vorheriger Stand wiederhergestellt.`)
  }, [filamentApplyUndo])

  const removeMyFilament = useCallback(
    (id: string) => {
      const removed = userFilaments.find((profile) => profile.id === id)
      const fallback = catalog?.filaments[0]?.id ?? 'pla'
      const fallbackName = filaments.find((profile) => profile.id === fallback)?.name ?? fallback
      const cleanSetup = (source: Setup): Setup => {
        const stripped = withoutFilamentOverride(source, id)
        return stripped.filamentId === id ? { ...stripped, filamentId: fallback } : stripped
      }

      // Das Profil ist global; alte Overrides können in jedem Druckerstand
      // liegen. Deshalb vor dem Löschen alle Snapshots bereinigen.
      for (const [printerId, snapshot] of Object.entries(loadSnapshots())) {
        const cleaned = cleanSetup(snapshot.setup)
        if (cleaned !== snapshot.setup) saveSnapshot({ ...snapshot, setup: cleaned }, printerId)
      }

      setUserFilaments(deleteUserFilament(id))
      setFilamentDiff((current) => (current?.id === id ? null : current))
      setFilamentApplyUndo(null)

      const nextSetup = cleanSetup(setup)
      setSetup(nextSetup)
      saveSetup(nextSetup)

      let nextSettings = settings
      if (setup.filamentId === id) {
        const nextFilament = filaments.find((profile) => profile.id === fallback)
        const plate = (catalog?.plates ?? []).find((entry) => entry.id === nextSetup.plateId)
        if (nextFilament && plate) {
          nextSettings = applyPrinterLimits(
            { ...printer, ...effectivePrinterLimits(printer, nextSetup.limits) },
            applyPlateProfile(
              settingsForFilament(settings, nextFilament, plate, nextSetup.nozzle),
              nextSetup.plateProfiles?.[nextSetup.plateId],
              fallback,
            ),
          )
          setSettings(nextSettings)
          setDirty(true)
          setResult(null)
          setOutputInfo(null)
        }
      }
      saveSnapshot({ setup: nextSetup, settings: nextSettings, savedAt: Date.now() }, nextSetup.printerId)
      setImportInfo(
        setup.filamentId === id
          ? `Filament-Profil „${removed?.name ?? id}“ gelöscht — „${fallbackName}“ ist jetzt aktiv; zugehörige Platten-Overrides wurden entfernt.`
          : `Filament-Profil „${removed?.name ?? id}“ gelöscht; zugehörige Platten-Overrides wurden entfernt.`,
      )
    },
    [catalog, filaments, printer, settings, setup, userFilaments],
  )

  const workspacePrinters = useMemo(() => {
    const snapshots = loadSnapshots()
    return workspace
      .map((id) => (catalog?.printers ?? PRINTERS).find((p) => p.id === id))
      .filter((p): p is PrinterProfile => !!p)
      .map((p, index) => {
        const snap = snapshots[p.id]
        const session = p.id === setup.printerId ? null : studioSessions.current[p.id]
        const currentModel = p.id === setup.printerId ? model : session?.model
        const filament = snap ? filaments.find((f) => f.id === snap.setup.filamentId) : undefined
        const plate = snap ? (catalog?.plates ?? []).find((x) => x.id === snap.setup.plateId) : undefined
        const detail = snap
          ? `${filament?.name ?? 'Filament'} · ${snap.settings.layerHeight.toFixed(2)} mm · ⌀${snap.setup.nozzle}` +
            (plate ? ` · ${plate.name}` : '')
          : 'noch keine Einstellungen gespeichert'
        return {
          id: p.id,
          name: p.name,
          brand: p.brand,
          control: p.control,
          active: p.id === setup.printerId,
          detail,
          studio: index + 1,
          model: currentModel?.name ?? null,
        }
      })
  }, [catalog, filaments, model, setup.printerId, workspace])

  const adopt = useCallback(
    async (buffer: ArrayBuffer, name: string) => {
      setBusy('load')
      setError(null)
      try {
        const uploaded = await api.uploadModel(buffer, name, printer.id, {
          nozzle: setup.nozzle,
          maxVolumetricFlow: filament.maxVolumetricFlow,
        })
        // Der Server liefert für jedes Format ein kanonisches STL zurück
        const stl = await api.fetchModelStl(uploaded.id)
        const geometry = new STLLoader().parse(stl) as THREE.BufferGeometry
        geometry.computeVertexNormals()
        const testState = readCalibrationTestState(printer.id)
        const imported = uploaded.settings ?? {}
        const takeover = applyModelSettingsTakeover({
          current: settings,
          imported,
          testState,
          normalize: (next) => applyPrinterLimits(limitedPrinter, next),
        })
        const lineWidthKeys = IMPORTED_LINE_WIDTH_KEYS.filter(
          (key) => typeof imported[key] === 'number',
        )
        const adapted = Object.keys(imported).length
          ? adaptImportedSettings(limitedPrinter, takeover.settings, {
              activeNozzle: setup.nozzle,
              sourceNozzle: typeof imported.nozzle === 'number' ? imported.nozzle : undefined,
              lineWidthKeys,
              maxVolumetricFlow: filament.maxVolumetricFlow,
            })
          : { settings: takeover.settings, notes: [] as string[] }
        const resetTestStructure = takeover.resetTestStructure
        setModel({
          id: uploaded.id,
          name,
          analysis: uploaded.analysis,
          geometry,
          format: uploaded.format,
          objects: uploaded.objects ?? [],
        })
        // GLB aus der Scan-App und Engine-Ausgaben rechnen in Metern: Ein
        // 200-mm-Teil kommt dann als 0,2 mm an. Dann gleich die Skalierung anbieten.
        const importedSize = uploaded.analysis.bbox.size
        const importedLargest = Math.max(importedSize.x, importedSize.y, importedSize.z)
        setScaleOffer(
          importedLargest > 0 && importedLargest < IMPORT_TINY_MM ? { largest: importedLargest } : null,
        )
        setResult(null)
        setIntent(null)
        setDismissed([])
        setLayer(0)
        setActivePlate(0)
        // Neues Werkstück: ausdrücklich angelegte Leerplatten gehören zum alten.
        setPlateCount(1)
        setCalibration(null)
        setSettings(adapted.settings)
        if (takeover.qualityPresetId) setQualityPresetId(takeover.qualityPresetId)

        const repairNote = meshRepairNote(uploaded.repair)
        const resetNote = resetTestStructure
          ? ' Kalibrier-Testwerte wurden durch die vor dem Test gesicherten Alltagswerte ersetzt.'
          : ''
        if (Object.keys(imported).length > 0) {
          const adaptationNote = adapted.notes.length
            ? ` Angepasst: ${adapted.notes.join(' · ')}.`
            : ''
          setDirty(true)
          setImportInfo(
            `${uploaded.format.toUpperCase()} brachte Druckeinstellungen mit${uploaded.printerHint ? ` (${uploaded.printerHint})` : ''} — übernommen und auf ${printer.name} begrenzt.${adaptationNote}${repairNote}${resetNote}`,
          )
        } else {
          setDirty(false)
          setImportInfo(
            `${uploaded.warnings.join(' ')}${repairNote}${resetNote}`.trim() || null,
          )
        }
        clearCalibrationTestState(printer.id)
        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Modell konnte nicht geladen werden.')
        return false
      } finally {
        setBusy(null)
      }
    },
    [filament.maxVolumetricFlow, limitedPrinter, printer, settings, setup.nozzle],
  )

  const onFile = useCallback(
    async (file: File) => {
      const buffer = await file.arrayBuffer()
      await adopt(buffer, file.name)
    },
    [adopt],
  )

  const onDemo = useCallback(
    async (shape: string) => {
      setBusy('load')
      try {
        const buffer = await api.fetchDemo(shape)
        await adopt(buffer, `${shape}.stl`)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Demo-Modell fehlgeschlagen.')
        setBusy(null)
      }
    },
    [adopt],
  )

  /**
   * Autosave: Die aktuelle, kanonische STL wird nach kurzer Ruhe lokal
   * abgelegt. Dadurch überlebt der Entwurf auch einen Absturz des Servers;
   * einzelne 3MF-Objekte werden beim Wiederherstellen zu einer Geometrie
   * zusammengeführt, weil der Server nur diese kanonische Form zurückgibt.
   */
  useEffect(() => {
    if (!draftReady || !hydratedRef.current) return
    if (!model) {
      lastDraftGeometry.current = ''
      if (!recoveryDraft) {
        setDraftStatus('idle')
        setDraftSavedAt(null)
        void clearDraft()
      }
      return
    }
    // STL: 84 Byte Kopf plus 50 Byte je Dreieck. Große Modelle würden den
    // lokalen Speicher unnötig belegen; sie bleiben normal slicbar.
    if (84 + model.analysis.triangles * 50 > MAX_DRAFT_BYTES) {
      setDraftStatus('too-large')
      setDraftSavedAt(null)
      void clearDraft()
      return
    }
    // Nur die Geometrie muss gesichert werden. Eine reine Slot-/Farbänderung
    // würde sonst erneut das komplette STL laden und in IndexedDB schreiben.
    const geometryKey = `${model.id}:${model.analysis.triangles}:${model.geometryRev ?? -1}`
    if (lastDraftGeometry.current === geometryKey) return
    const sequence = ++draftSaveSequence.current
    setDraftStatus('saving')
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const data = await api.fetchModelStl(model.id)
          if (sequence !== draftSaveSequence.current) return
          const base = model.name.replace(/\.[^.]+$/, '') || 'entwurf'
          const status = await saveDraft({
            data,
            sourceName: model.name,
            fileName: `${base}.stl`,
            printerId: setup.printerId,
            outputName,
          })
          if (sequence !== draftSaveSequence.current) return
          if (status === 'saved') {
            lastDraftGeometry.current = geometryKey
            setDraftStatus('saved')
            setDraftSavedAt(Date.now())
          } else {
            setDraftStatus(status)
            setDraftSavedAt(null)
            if (status === 'too-large' || status === 'unavailable') void clearDraft()
          }
        } catch {
          if (sequence === draftSaveSequence.current) setDraftStatus('error')
        }
      })()
    }, 1600)
    return () => clearTimeout(timer)
  }, [draftReady, model, outputName, recoveryDraft, setup.printerId])

  const restoreDraftNow = useCallback(
    async (draft: SavedDraft) => {
      const ok = await adopt(draft.data, draft.fileName)
      if (!ok) return
      await clearDraft()
      setRecoveryDraft(null)
      setDraftStatus('saved')
      setDraftSavedAt(draft.savedAt)
      setToolNotice(
        `Entwurf „${draft.sourceName}“ wiederhergestellt — Geometrie und Druckerstand sind zurück. Bitte kurz prüfen und neu slicen.`,
      )
    },
    [adopt],
  )

  const restoreRecovery = useCallback(() => {
    if (!recoveryDraft) return
    if (recoveryDraft.printerId !== setup.printerId) {
      // Der Entwurf gehört zu einem anderen Studio. Erst dorthin wechseln;
      // der Effekt unten setzt den Upload fort, sobald der Stand aktiv ist.
      pendingRestoreDraft.current = recoveryDraft
      switchPrinter(recoveryDraft.printerId)
      return
    }
    void restoreDraftNow(recoveryDraft)
  }, [recoveryDraft, restoreDraftNow, setup.printerId, switchPrinter])

  useEffect(() => {
    const pending = pendingRestoreDraft.current
    if (!pending || pending.printerId !== setup.printerId) return
    pendingRestoreDraft.current = null
    void restoreDraftNow(pending)
  }, [restoreDraftNow, setup.printerId])

  const doSlice = useCallback(async () => {
    if (!model) return
    // Eine frisch angelegte Platte ist leer. Statt die Server-Meldung als
    // Fehler zu zeigen, bleibt der Hinweis hier — und es geht keine Anfrage
    // für eine Platte ohne Objekte hinaus.
    const objectsOnPlate = model.objects.filter((o) => (o.plate ?? 0) === activePlate)
    const printableOnPlate = objectsOnPlate.filter(
      (o) => o.placement.visible && !o.negative && !o.excluded,
    )
    if (model.objects.length > 0 && printableOnPlate.length === 0) {
      setError(null)
      setImportInfo(
        objectsOnPlate.length === 0
          ? `Platte ${activePlate + 1} ist noch leer — bitte ein Objekt hinzufügen oder eine andere Platte wählen.`
          : `Auf Platte ${activePlate + 1} ist kein sichtbares Objekt zum Slicen — bitte Objekte einblenden oder eine andere Platte wählen.`,
      )
      return
    }
    setBusy('slice')
    setError(null)
    try {
      // Ein laufender Kalibriertest bringt seine Pflichtwerte selbst mit. Wenn
      // zwischen Erzeugen und Slicen z. B. ein Qualitätsprofil gewechselt oder
      // ein anderer Stand geladen wurde, darf der Flowwürfel nicht plötzlich
      // ohne Wand geschnitten werden. Der Patch wird deshalb unmittelbar vor
      // dem Slicen erneut angewendet und die Oberfläche damit synchronisiert.
      const sliceSettings = calibrationSliceSettings(settings, calibration)
      if (calibration) setSettings(sliceSettings)
      const sliceFilaments = Object.fromEntries(
        filaments.map((f) => [
          f.id,
          {
            nozzle: f.nozzle,
            bed: f.bed,
            flow: f.flow,
            fanSpeed: f.fanSpeed,
            maxVolumetricFlow: f.maxVolumetricFlow,
            material: f.material,
            name: f.name,
            density: f.density,
          },
        ]),
      )
      const meshProfile = printer.zmodMesh
        ? setup.plateProfiles?.[setup.plateId]?.meshProfile?.trim()
        : undefined
      const customGcode: CustomGcode = {
        ...setup.customGcode,
        start: printer.zmodMesh
          ? meshProfile
            ? injectMeshName(setup.customGcode.start, meshProfile)
            : injectBedTemperatureMesh(setup.customGcode.start, sliceSettings.temps.firstLayerBed)
          : setup.customGcode.start,
      }
      const res = await api.sliceModel(
        model.id,
        sliceSettings,
        setup.printerId,
        activePlate,
        sliceFilaments,
        customGcode,
        setup.postProcessing,
        printerLimits,
        setup.gcodeFlavor,
        {
          filamentId: setup.filamentId,
          slots: setup.slots,
          activeSlotId: setup.activeSlotId,
          printerOverrides: setup.printerOverrides,
          modelCenter,
        },
      )
      setResult(res)
      setPreviewPick(null)
      setOutputName(
        formatGcodeFilename(settings.output.filenameFormat, {
          model: model?.name ?? 'modell',
          layerHeight: sliceSettings.layerHeight,
          filamentType: filament.material,
          printTime: formatDuration(res.stats.estimatedSeconds),
          nozzle: settings.nozzle,
        }),
      )
      setOutputInfo(null)
      setLayer(Math.max(0, res.layers.length - 1))
      setDirty(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Slicen fehlgeschlagen.')
    } finally {
      setBusy(null)
    }
  }, [
    activePlate,
    calibration,
    filament.material,
    filaments,
    model,
    modelCenter,
    printerLimits,
    printer.zmodMesh,
    settings,
    setup.customGcode,
    setup.gcodeFlavor,
    setup.filamentId,
    setup.slots,
    setup.activeSlotId,
    setup.plateId,
    setup.plateProfiles,
    setup.postProcessing,
    setup.printerId,
  ])

  const togglePreviewFeature = useCallback((kind: PreviewFeatureKind) => {
    setHiddenPreviewFeatures((prev) =>
      prev.includes(kind) ? prev.filter((entry) => entry !== kind) : [...prev, kind],
    )
  }, [])

  const generateCalibration = useCallback(
    async (toolId: string, options?: CalibrationOptions) => {
      setBusy('calibration')
      setError(null)
      try {
        const previousTest = readCalibrationTestState(printer.id)
        const testBase = normalSettingsForTest(settings, profileBaseline, previousTest)
        const res = await api.createCalibration({
          toolId,
          printerId: setup.printerId,
          filamentId: setup.filamentId,
          plateId: setup.plateId,
          settings: testBase,
          flavor: setup.gcodeFlavor,
          options,
        })
        const buffer = await api.fetchModelStl(res.modelId)
        const geometry = new STLLoader().parse(buffer) as THREE.BufferGeometry
        geometry.computeVertexNormals()
        setModel({ id: res.modelId, name: `${res.tool.label}.stl`, analysis: res.analysis, geometry, format: 'stl', objects: [] })
        writeCalibrationTestState(
          printer.id,
          calibrationTestStateForNextTest(
            testBase,
            res.tool.settingsPatch,
            qualityPresetId,
            profileBaseline,
          ),
        )
        const patchSpecial = res.tool.settingsPatch.special
        setSettings(mergeSettings(testBase, {
          ...res.tool.settingsPatch,
          // Jeder Test beginnt als geschlossenes Alltagsmodell. Nur der
          // Flowwürfel und der Max-Flow-Turm setzen openShell bewusst.
          special: {
            ...(testBase.special ?? {}),
            vase: false,
            openShell: false,
            ...(patchSpecial ?? {}),
          },
          // Nur der Linientest schaltet die PA-Rampe ein; alle anderen
          // Kalibrierungen dürfen keine alte Rampe mitschleppen.
          ...(toolId === 'pressure-advance-line' ? {} : { pressureAdvanceRamp: { enabled: false } }),
        }))
        setResult(null)
        setDirty(true)
        setCalibration(res.tool)
        setView('studio')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Kalibrierung konnte nicht erzeugt werden.')
      } finally {
        setBusy(null)
      }
    },
    [printer.id, profileBaseline, qualityPresetId, settings, setup],
  )

  const suggestions = useMemo(() => {
    if (!model) return [] as Suggestion[]
    return suggest(model.analysis, settings, printer.bed)
  }, [model, settings, printer.bed])

  /** V-17: Audit aus Modell, Profil und Bett — unabhängig vom Modellberater. */
  const auditFindings = useMemo(() => {
    if (!model) return []
    return auditPrint({ analysis: model.analysis, settings, bed: printer.bed, objectName: model.name })
  }, [model, settings, printer.bed])

  const applyAuditFix = useCallback(
    (patch: DeepPartial<PrintSettings>) => {
      setSettings((prev) => applyPrinterLimits(limitedPrinter, mergeSettings(prev, patch)))
      setDirty(true)
    },
    [limitedPrinter],
  )

  /** V-20: gemessenes Passungsspiel aus der letzten Kalibrier-Version. */
  const assemblyTolerance = useMemo(() => {
    const versions = loadCalibrationVersions().filter((version) => version.printerId === printer.id)
    return versions[0]?.tolerance ?? 0
  }, [printer.id, tool])

  const warnings = useMemo(() => {
    const list = compatibilityWarnings(limitedPrinter, filament, plate, settings, setup.nozzleMaterial)
    if (!model) return list
    const size = model.analysis.bbox.size
    const oversize = [
      size.x > printer.bed.x + 0.01 ? `X ${size.x.toFixed(1)} > ${printer.bed.x}` : null,
      size.y > printer.bed.y + 0.01 ? `Y ${size.y.toFixed(1)} > ${printer.bed.y}` : null,
      size.z > printer.bed.z + 0.01 ? `Z ${size.z.toFixed(1)} > ${printer.bed.z}` : null,
    ].filter((value): value is string => !!value)
    if (oversize.length) {
      list.unshift(
        `Modell passt nicht auf ${printer.name}: ${oversize.join(', ')} mm — vor dem Slicen verkleinern, drehen oder teilen.`,
      )
    }
    return list
  }, [limitedPrinter, filament, plate, settings, setup.nozzleMaterial, model, printer])

  // Vor dem Slicen: ohne Mesh für dieses Modell bleibt der G-Code unkorrigiert
  const meshNotice = useMemo(() => {
    if (settings.meshCompensation !== 'software' || mesh) return null
    if (printer.control === 'manual') {
      return `Kein Bett-Mesh für ${printer.name} hinterlegt — der G-Code wird ohne Bettkorrektur geschnitten. Dieses Modell liefert keine Messwerte über USB; bitte am Gerät nivellieren, dort bleibt das Mesh in der Firmware.`
    }
    if (printer.control === 'klipper-moonraker') {
      return `Kein Bett-Mesh für ${printer.name} hinterlegt — der G-Code wird ohne Bettkorrektur geschnitten. Beim ersten Druck wird das vorhandene bed_mesh einmal übernommen und für dieses Modell gespeichert.`
    }
    return `Kein Bett-Mesh für ${printer.name} hinterlegt — der G-Code wird ohne Bettkorrektur geschnitten. Beim ersten Druck misst das Programm einmal automatisch (G29) und legt die Werte für dieses Modell ab.`
  }, [settings.meshCompensation, mesh, printer])

  const applySuggestion = useCallback(
    (s: Suggestion) => {
      setSettings((prev) => applyPrinterLimits(limitedPrinter, mergeSettings(prev, s.patch)))
      setDirty(true)
      setDismissed((prev) => [...prev, s.id])
    },
    [limitedPrinter],
  )

  const applyAll = useCallback(() => {
    setSettings((prev) =>
      applyPrinterLimits(limitedPrinter, suggestions.reduce((acc, s) => mergeSettings(acc, s.patch), prev)),
    )
    setDirty(true)
    setDismissed(suggestions.map((s) => s.id))
  }, [limitedPrinter, suggestions])

  const chooseIntent = useCallback((id: IntentId) => {
    const preset = INTENTS.find((i) => i.id === id)
    if (!preset) return
    setSettings((prev) => applyPrinterLimits(limitedPrinter, mergeSettings(prev, preset.patch)))
    setDirty(true)
    setIntent(id)
  }, [limitedPrinter])

  const defaultJobName = formatGcodeFilename(
    settings.output?.filenameFormat ?? DEFAULT_SETTINGS.output.filenameFormat,
    {
      model: model?.name ?? 'kepler',
      layerHeight: settings.layerHeight,
      filamentType: filament.material,
      printTime: result ? formatDuration(result.stats.estimatedSeconds) : '0m',
      nozzle: settings.nozzle,
    },
  )
  /** Gilt für Speichern und jeden Weg zum Drucker. */
  const effectiveJobName = normalizeGcodeFilename(outputName, defaultJobName)

  /** Öffnet den geslicten G-Code im Editor und setzt den Cursor auf die Bahn. */
  const openGcodeLine = useCallback(
    (line: number) => {
      if (!result?.gcode) return
      setGcodeJump({ gcode: result.gcode, name: effectiveJobName, line })
      setView('gcode')
    },
    [effectiveJobName, result?.gcode],
  )

  const changeOutputName = useCallback((value: string) => {
    setOutputName(value)
    setOutputInfo(null)
  }, [])

  const downloadGcode = useCallback(async () => {
    if (!result) return
    const outcome = await saveGcodeAs(result.gcode, effectiveJobName)
    if (outcome.status === 'saved') {
      setOutputInfo(`G-Code gespeichert als „${outcome.name}“.`)
    } else if (outcome.status === 'downloaded') {
      setOutputInfo('Dieser Browser fragt keinen Speicherort ab — die Datei liegt im Download-Ordner.')
    } else if (outcome.status === 'cancelled') {
      setOutputInfo('Speichern abgebrochen — es wurde keine Datei abgelegt.')
    } else {
      setError(outcome.message)
    }
  }, [effectiveJobName, result])

  const baseName = (model?.name ?? 'kepler').replace(/\.(stl|3mf|obj|ply)$/i, '')

  const saveBlob = useCallback(async (blob: Blob, name: string): Promise<SaveFileResult> => {
    const outcome = await saveFileAs(blob, name)
    if (outcome.status === 'cancelled') {
      setImportInfo('Export abgebrochen — es wurde keine Datei gespeichert.')
    } else if (outcome.status === 'error') {
      setError(outcome.message)
    }
    return outcome
  }, [])

  /** Nach Objektwerkzeugen: STL neu holen und Viewer/Analyse aktualisieren. */
  const applyObjectEdit = useCallback(
    async (res: api.ModelEditResult) => {
      if (!model) return
      // Nur die Zuordnung hat sich geändert (Filament-Slot, Ausschluss): Der
      // Server hat die Geometrie nicht angefasst — kein STL-Download, kein
      // Neuaufbau im Viewer.
      if (res.geometryChanged === false) {
        setModel((prev) =>
          prev
            ? { ...prev, objects: res.objects, analysis: res.analysis, geometryRev: res.revision ?? prev.geometryRev }
            : prev,
        )
        setResult(null)
        setDirty(false)
        return
      }
      const stl = await api.fetchModelStl(model.id)
      const geometry = new STLLoader().parse(stl) as THREE.BufferGeometry
      geometry.computeVertexNormals()
      setModel((prev) =>
        prev
          ? { ...prev, objects: res.objects, analysis: res.analysis, geometry, geometryRev: res.revision ?? prev.geometryRev }
          : prev,
      )
      setResult(null)
      setDirty(false)
      // Kein fit() hier: Beim Ziehen/Ändern eines Objekts soll die Kamera
      // stehen bleiben. Einpassen gibt es weiterhin über „Ansicht“.
    },
    [model],
  )

  /**
   * Ein-Klick-Maßstab für winzige Importe (V-25). Skaliert die Geometrie auf dem
   * Server — der Platzierungsmaßstab ist auf 0,05–10 begrenzt und reicht für
   * Faktor 500 nicht. Der Schritt landet im normalen Rückgängig-Verlauf.
   */
  const scaleImportedModel = useCallback(
    async (targetMm: number) => {
      if (!model) return
      setBusy('load')
      setError(null)
      try {
        const res = await api.rescaleModel(model.id, targetMm)
        await applyObjectEdit(res)
        setScaleOffer(null)
        setImportInfo(`Auf ${targetMm} mm größte Kante skaliert — rückgängig mit ↶.`)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Skalieren fehlgeschlagen.')
      } finally {
        setBusy(null)
      }
    },
    [applyObjectEdit, model],
  )

  /** Live-Vorschau im Transform-Dialog: Geometrie tauschen, Kamera stehen lassen. */
  /** Standard-/Extraform aus dem Rechtsklick-Menü auf die aktive Platte legen. */
  const addShape = useCallback(
    async (shapeId: string) => {
      const shape = [...SHAPE_LIBRARY.standard, ...SHAPE_LIBRARY.extra].find((item) => item.id === shapeId)
      if (!shape) return
      setBusy('load')
      setError(null)
      try {
        const buffer = await api.fetchDemo(shapeId)
        if (!model) {
          await adopt(buffer, `${shape.label}.stl`)
          setImportInfo(`„${shape.label}“ als neues Werkstück geladen.`)
          return
        }
        const res = await api.importObjects(model.id, buffer, `${shape.label}.stl`, activePlate, printer.id)
        await applyObjectEdit(res)
        const restored = restoreDailySettings()
        setImportInfo(
          `„${shape.label}“ auf Platte ${activePlate + 1} hinzugefügt.${meshRepairNote(res.importRepair)}${restored ? ' Kalibrier-Testwerte wurden durch Alltagswerte ersetzt.' : ''}`,
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Form konnte nicht hinzugefügt werden.')
      } finally {
        setBusy(null)
      }
    },
    [activePlate, adopt, applyObjectEdit, model, printer.id, restoreDailySettings],
  )

  const previewObjectEdit = useCallback(
    async (res: api.ModelEditResult) => {
      if (!model) return
      if (res.geometryChanged === false) {
        setModel((prev) =>
          prev
            ? { ...prev, objects: res.objects, analysis: res.analysis, geometryRev: res.revision ?? prev.geometryRev }
            : prev,
        )
        setResult(null)
        setDirty(true)
        return
      }
      const stl = await api.fetchModelStl(model.id)
      const geometry = new STLLoader().parse(stl) as THREE.BufferGeometry
      geometry.computeVertexNormals()
      setModel((prev) =>
        prev
          ? { ...prev, objects: res.objects, analysis: res.analysis, geometry, geometryRev: res.revision ?? prev.geometryRev }
          : prev,
      )
      setResult(null)
      setDirty(true)
    },
    [model],
  )

  const selectedObject = useMemo(
    () => model?.objects.find((o) => o.id === selectedObjectId) ?? null,
    [model, selectedObjectId],
  )

  /** Auswahl aus Objektliste oder 3D-Ansicht wechselt auf die zugehörige Platte. */
  const selectObject = useCallback(
    (id: string, additive = false) => {
      setSelectedIds((prev) => {
        if (!additive) return [id]
        return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      })
      const target = model?.objects.find((o) => o.id === id)
      if (target?.plate !== undefined) setActivePlate(target.plate)
    },
    [model],
  )

  /** Plattenreiter wählt das erste sichtbare Objekt dieser Platte. */
  const selectPlate = useCallback(
    (index: number) => {
      setActivePlate(index)
      setResult(null)
      const first = model ? firstOnPlate(model.objects, index) : undefined
      // Auf einer leeren Platte darf die Auswahl nicht beim Teil der vorher
      // sichtbaren Platte bleiben — sonst zeigen Positionsanzeige und
      // Werkzeuge ein Objekt, das gar nicht auf diesem Blech liegt.
      setSelectedObjectId(first?.id ?? null)
    },
    [model, setSelectedObjectId],
  )

  /** Die Vorschau-Segmente liegen in Bettkoordinaten. Der Slicer verschiebt
   *  die Objektgruppe um `Bettmitte - modelCenter`; dieselbe Verschiebung
   *  brauchen die Filterflächen, damit sie nach dem Bewegen deckungsgleich
   *  bleiben. */
  const previewFilterObjects = useMemo(
    () =>
      buildPreviewFilterBounds(
        model?.objects ?? [],
        activePlate,
        plateOffsetX(activePlate, printer.bed.x),
        printer.bed.x / 2 - modelCenter.x,
        printer.bed.y / 2 - modelCenter.y,
      ),
    [model?.objects, activePlate, modelCenter.x, modelCenter.y, printer.bed.x, printer.bed.y],
  )
  const previewFilter = useMemo(
    () => previewFilterObjects.find((object) => object.id === previewFilterId) ?? null,
    [previewFilterObjects, previewFilterId],
  )
  useEffect(() => {
    if (previewFilterId && !previewFilterObjects.some((object) => object.id === previewFilterId)) {
      setPreviewFilterId(null)
    }
  }, [previewFilterObjects, previewFilterId])

  /** Anzeige in Bettkoordinaten (0/0 = vordere linke Ecke der aktiven Platte). */
  const selectionInfo = useMemo(() => {
    if (!selectedObject) return null
    const shift = plateOffsetX(activePlate, printer.bed.x)
    return {
      x: selectedObject.center.x - modelCenter.x + printer.bed.x / 2 - shift,
      y: selectedObject.center.y - modelCenter.y + printer.bed.y / 2,
      z: Math.max(0, selectedObject.center.z - selectedObject.size.z / 2),
    }
  }, [selectedObject, modelCenter, activePlate, printer.bed.x, printer.bed.y])

  // Auswahl beibehalten, solange das führende Teil auf der aktiven Platte
  // liegt. Sonst das erste druckbare Objekt dieser Platte wählen — nach dem
  // Leeren, Löschen oder Zurücknehmen einer Platte darf die Anzeige nicht auf
  // einem Teil der vorherigen Platte stehen bleiben.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (!model) return []
      const alive = prev.filter((id) => model.objects.some((o) => o.id === id))
      const leading = alive[alive.length - 1]
      const leadingPlate = leading
        ? (model.objects.find((o) => o.id === leading)?.plate ?? 0)
        : null
      if (leadingPlate === activePlate) return alive
      const first = firstOnPlate(model.objects, activePlate)
      return first ? [first.id] : []
    })
  }, [model, activePlate])

  // Eingelassenen Text rot einblenden, damit die Vertiefung sichtbar ist.
  useEffect(() => {
    let alive = true
    if (!model || !selectedObject?.negative) {
      setOverlayGeometry(null)
      return
    }
    void (async () => {
      try {
        const stl = await api.fetchObjectStl(model.id, selectedObject.id)
        const geometry = new STLLoader().parse(stl) as THREE.BufferGeometry
        geometry.computeVertexNormals()
        if (alive) setOverlayGeometry(geometry)
      } catch {
        if (alive) setOverlayGeometry(null)
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model?.id, selectedObject?.id, selectedObject?.negative, model?.objects])

  // Live-Drehung: erst lokal sofort anzeigen, dann gebündelt zum Server —
  // pro Bild nur eine Anfrage gleichzeitig, die jeweils neueste Lage zählt.
  const rotatePending = useRef<{ id: string; x: number; y: number; z: number } | null>(null)
  const rotateBusy = useRef(false)
  const flushRotate = useCallback(
    async function flush() {
      if (rotateBusy.current) return
      const pending = rotatePending.current
      if (!pending || !model) return
      rotatePending.current = null
      rotateBusy.current = true
      try {
        const res = await api.setObjects(model.id, [
          {
            id: pending.id,
            rotationX: pending.x,
            rotationY: pending.y,
            rotationZ: pending.z,
          },
        ])
        await previewObjectEdit(res)
      } catch {
        /* Die nächste Bewegung schickt die aktuelle Lage erneut */
      } finally {
        rotateBusy.current = false
        if (rotatePending.current) void flush()
      }
    },
    [model, previewObjectEdit],
  )

  const rotateSelected = useCallback(
    (rot: { x: number; y: number; z: number }, axis: 'x' | 'y' | 'z') => {
      const id = selectedObjectId
      if (!id) return
      setModel((prev) =>
        prev
          ? {
              ...prev,
              objects: prev.objects.map((o) =>
                o.id === id ? { ...o, placement: { ...o.placement, rotationX: rot.x, rotationY: rot.y, rotationZ: rot.z } } : o,
              ),
            }
          : prev,
      )
      setRotateInfo({ axis, value: rot[axis] })
      rotatePending.current = { id, x: rot.x, y: rot.y, z: rot.z }
      void flushRotate()
    },
    [selectedObjectId, flushRotate],
  )

  const finishRotate = useCallback(() => {
    void flushRotate()
  }, [flushRotate])

  const updateObjects = useCallback(
    async (next: ModelObjectInfo[]) => {
      if (!model) return
      setModel((prev) => (prev ? { ...prev, objects: next } : prev))
      try {
        const res = await api.setObjects(
          model.id,
          next.map((o) => ({
            id: o.id,
            ...o.placement,
            excluded: o.excluded ?? false,
            // Explizit null sendet ein „Zuordnung entfernen“; undefined würde
            // von JSON ausgelassen und der alte Slot bliebe serverseitig stehen.
            slotId: o.placement.slotId ?? null,
            filamentId: o.placement.filamentId ?? null,
          })),
        )
        await applyObjectEdit(res)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Objekte konnten nicht übernommen werden.')
      }
    },
    [model, applyObjectEdit],
  )

  /** Ausgewähltes Objekt mit der Maus verschieben — Betrag in Bettkoordinaten. */
  const moveSelected = useCallback(
    async (id: string, dx: number, dy: number) => {
      if (!model) return
      if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) return
      const next = model.objects.map((o) =>
        o.id === id
          ? {
              ...o,
              placement: {
                ...o.placement,
                offsetX: o.placement.offsetX + dx,
                offsetY: o.placement.offsetY + dy,
              },
            }
          : o,
      )
      await updateObjects(next)
    },
    [model, updateObjects],
  )

  /** Objekt einem physischen Slot zuweisen; die Profil-ID geht an den Slicer. */
  const assignObjectSlot = useCallback(
    (objectId: string, slot: FilamentSlot | null) => {
      if (!model) return
      const next = model.objects.map((o) =>
        o.id === objectId
          ? {
              ...o,
              placement: {
                ...o.placement,
                slotId: slot?.id,
                filamentId: slot?.profileId,
              },
            }
          : o,
      )
      void updateObjects(next)
    },
    [model, updateObjects],
  )

  /** Slot-Profile/Farben gehören zum Drucker und werden mit ihm gesichert. */
  const updateSlots = useCallback(
    (nextSlots: FilamentSlot[]) => {
      const previous = new Map((setup.slots ?? []).map((slot) => [slot.id, slot] as const))
      const changedProfiles = new Map(
        nextSlots
          .filter((slot) => previous.get(slot.id)?.profileId !== slot.profileId)
          .map((slot) => [slot.id, slot.profileId] as const),
      )
      const nextSetup: Setup = {
        ...setup,
        slots: nextSlots,
        activeSlotId:
          setup.activeSlotId && nextSlots.some((s) => s.id === setup.activeSlotId)
            ? setup.activeSlotId
            : nextSlots[0]?.id,
      }
      setSetup(nextSetup)
      saveSetup(nextSetup)
      setDirty(true)
      saveSnapshot({ setup: nextSetup, settings, savedAt: Date.now() }, nextSetup.printerId)

      // Objekte, die an einem Slot hängen, müssen das geänderte Profil
      // übernehmen — sonst würde weiter das alte Filament geslict.
      if (model && changedProfiles.size > 0) {
        let touched = false
        const nextObjects = model.objects.map((o) => {
          if (!o.placement.slotId) return o
          const profileId = changedProfiles.get(o.placement.slotId)
          if (!profileId || profileId === o.placement.filamentId) return o
          touched = true
          return { ...o, placement: { ...o.placement, filamentId: profileId } }
        })
        if (touched) void updateObjects(nextObjects)
      }
    },
    [model, settings, setup, updateObjects],
  )

  /** Platte leeren: Werkstück auch serverseitig verwerfen. */
  const resetWorkspace = useCallback(() => {
    // Auch im Studio-Cache leeren, sonst käme das alte Objekt beim
    // Zurückschalten wieder auf die Platte.
    const cached = studioSessions.current[setup.printerId]
    if (cached) {
      studioSessions.current[setup.printerId] = {
        ...cached,
        model: null,
        result: null,
        selectedIds: [],
        outputName: '',
        dirty: false,
        activePlate: 0,
        plateCount: 1,
        outputInfo: null,
        layer: 0,
      }
    }
    setModel(null)
    setPlateCount(1)
    setSelectedIds([])
    setResult(null)
    setDirty(false)
    setCalibration(null)
    setImportInfo(null)
    setToolNotice(null)
  }, [setup.printerId])

  /** Malpunkt liegt als Anteil der Objekt-Box — so wandert er beim Verschieben mit. */
  const applyPaint = useCallback(
    async (id: string, point: { x: number; y: number; z: number }, block: boolean) => {
      if (!model) return
      const object = model.objects.find((o) => o.id === id)
      if (!object) return
      const fx = (point.x - (object.center.x - object.size.x / 2)) / Math.max(0.01, object.size.x)
      const fy = (point.y - (object.center.y - object.size.y / 2)) / Math.max(0.01, object.size.y)
      const fz = (point.z - (object.center.z - object.size.z / 2)) / Math.max(0.01, object.size.z)
      try {
        await applyObjectEdit(
          await api.paintMark(model.id, {
            objectId: id,
            mark: { fx, fy, fz, r: paint.radius, block },
          }),
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Markierung konnte nicht gespeichert werden.')
      }
    },
    [applyObjectEdit, model, paint.radius],
  )

  const clearPaint = useCallback(async () => {
    if (!model || !selectedObjectId) return
    try {
      await applyObjectEdit(await api.paintMark(model.id, { objectId: selectedObjectId, clear: true }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Markierungen konnten nicht gelöscht werden.')
    }
  }, [applyObjectEdit, model, selectedObjectId])

  const runObjectTool = useCallback(
    async (action: api.ObjectTool, label: string) => {
      if (!model) return
      setToolNotice(null)
      try {
        const active =
          model.objects.find((o) => o.id === selectedObjectId) ??
          model.objects.find((o) => o.placement.visible) ??
          model.objects[0]
        const before = new Set(model.objects.map((o) => o.id))
        const res = await api.objectTool(model.id, action, {
          objectId: active?.id,
          // Zusammenbauen wirkt auf die Auswahl, sonst auf alle sichtbaren Teile.
          objectIds: selectedIds.length ? selectedIds : undefined,
          bed: { x: printer.bed.x, y: printer.bed.y },
        })
        if (res.cleared) {
          resetWorkspace()
          setImportInfo(label)
          return
        }
        await applyObjectEdit(res)
        // Nach dem Duplizieren die Kopie auswählen. Sonst würde der nächste
        // Klick auf „Duplizieren“ wieder das alte Objekt kopieren und die
        // Kopien lägen exakt übereinander.
        if (action === 'duplicate') {
          const copy = res.objects.find((o) => !before.has(o.id))
          if (copy) setSelectedObjectId(copy.id)
        }
        if (action === 'repair' && res.repair) {
          setToolNotice(
            res.repair.applied
              ? `Mesh repariert: ${res.repair.openBefore} → ${res.repair.openAfter} offene Kanten. Bitte neu slicen.`
              : res.repair.openBefore === 0
                ? 'Mesh ist bereits geschlossen — keine offenen Kanten gefunden.'
                : `Keine Verbesserung möglich — ${res.repair.openBefore} offene Kanten bleiben.`,
          )
          setError(null)
        } else if (action === 'separate' && res.separate) {
          setToolNotice(
            `${res.separate.objects} Objekt(e) in ${res.separate.parts} Einzelteile getrennt — jetzt lässt sich jedes Teil einzeln bewegen.`,
          )
        } else {
          setImportInfo(label)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Objektwerkzeug fehlgeschlagen.')
      }
    },
    [applyObjectEdit, model, printer.bed.x, printer.bed.y, resetWorkspace, selectedObjectId, selectedIds],
  )

  /** Aktive Platte samt ihrer Objekte löschen; höhere Platten rücken nach. */
  const removeActivePlate = useCallback(async () => {
    if (!model) return
    if (plateCount <= 1) {
      setImportInfo('Die letzte Platte lässt sich nicht löschen.')
      return
    }
    const removed = activePlate
    setError(null)
    try {
      const res = await api.objectTool(model.id, 'removeplate', {
        plate: removed,
        bed: { x: printer.bed.x, y: printer.bed.y },
      })
      if (res.cleared) {
        resetWorkspace()
        setImportInfo(`Platte ${removed + 1} gelöscht — keine Objekte mehr vorhanden.`)
        return
      }
      await applyObjectEdit(res)
      // Die Plattenzahl ist geprüft (> 1); nach dem Löschen rückt die nächste
      // Platte auf den freien Platz, sonst bleibt die vorherige aktiv.
      const nextCount = plateCount - 1
      const nextActive = Math.min(removed, nextCount - 1)
      setPlateCount(nextCount)
      setActivePlate(nextActive)
      setSelectedObjectId(firstOnPlate(res.objects, nextActive)?.id ?? null)
      setImportInfo(`Platte ${removed + 1} gelöscht — die Objekte darauf wurden entfernt.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Platte konnte nicht gelöscht werden.')
    }
  }, [
    activePlate,
    applyObjectEdit,
    model,
    plateCount,
    printer.bed.x,
    printer.bed.y,
    resetWorkspace,
    setSelectedObjectId,
  ])

  /** Rückgängig / Vorwärts über den Zustandsverlauf des Servers. */
  const runHistory = useCallback(
    async (kind: 'undo' | 'redo') => {
      if (!model) return
      try {
        const res = kind === 'undo' ? await api.undo(model.id) : await api.redo(model.id)
        await applyObjectEdit(res)
        setImportInfo(
          kind === 'undo'
            ? `${res.label ?? 'Schritt'} rückgängig gemacht.`
            : `${res.label ?? 'Schritt'} wiederhergestellt.`,
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Schritt nicht möglich.'
        // Modell wurde mit dem letzten Teil verworfen — dann ist die Platte leer.
        if (message.includes('Modell nicht gefunden')) {
          resetWorkspace()
          setImportInfo('Die Platte ist leer — bitte eine Datei neu laden.')
          return
        }
        setError(message)
      }
    },
    [applyObjectEdit, model, resetWorkspace],
  )

  const handleMenu = useCallback(
    (action: MenuAction) => {
      if (action !== 'transform') setRotateMode(false)
      if (action === 'transform') setRotateMode(false)
      if (action === 'load') {
        objectFileRef.current?.click()
        return
      }
      if (action === 'add') {
        if (model) addFileRef.current?.click()
        else objectFileRef.current?.click()
        return
      }
      if (action === 'litho') {
        setTool('litho')
        return
      }
      if (action === 'undo' || action === 'redo') {
        void runHistory(action)
        return
      }
      if (
        action === 'transform' ||
        action === 'text' ||
        action === 'cut' ||
        action === 'assembly' ||
        action === 'scan' ||
        action === 'scanimport' ||
        action === 'scanstart'
      ) {
        setTool(action)
        return
      }
      if (action === 'addplate') {
        if (plateCount >= MAX_PLATES) {
          setImportInfo(`Mehr als ${MAX_PLATES} Platten werden nicht unterstützt.`)
          return
        }
        const next = plateCount + 1
        setPlateCount(next)
        setActivePlate(next - 1)
        // Die neue Platte ist leer — keine Auswahl vom bisherigen Blech behalten.
        setSelectedObjectId(null)
        setImportInfo(`Platte ${next} angelegt — sie ist noch leer.`)
        return
      }
      if (action === 'removeplate') {
        void removeActivePlate()
        return
      }
      const labels: Record<string, string> = {
        duplicate: 'Objekt dupliziert — die Kopie liegt rechts daneben.',
        delete: 'Objekt gelöscht.',
        clear: 'Platte geleert — alle Teile sind entfernt.',
        merge: 'Ausgewählte Teile zu einem Objekt zusammengebaut.',
        arrange: 'Alle Objekte neu auf dem Bett angeordnet.',
        orient: 'Objekt automatisch ausgerichtet — größte Fläche liegt auf dem Bett.',
        center: 'Objekt auf die Bettmitte zentriert.',
        bed: 'Objekt liegt jetzt auf dem Bett.',
        repair: 'Mesh repariert.',
        separate: 'Objekt in Einzelteile getrennt.',
      }
      void runObjectTool(action as api.ObjectTool, labels[action] ?? 'Übernommen.')
    },
    [model, plateCount, removeActivePlate, runHistory, runObjectTool, setSelectedObjectId],
  )

  /** Lithophan-Mesh vom Server als neues Werkstück übernehmen. */
  const adoptLithophane = useCallback(async (res: UploadedModel) => {
    const stl = await api.fetchModelStl(res.id)
    const geometry = new STLLoader().parse(stl) as THREE.BufferGeometry
    geometry.computeVertexNormals()
    const name = res.name ?? 'Lithophane.stl'
    setModel({
      id: res.id,
      name,
      analysis: res.analysis,
      geometry,
      format: res.format,
      objects: res.objects,
    })
    setResult(null)
    setDirty(false)
    setCalibration(null)
    const restored = restoreDailySettings()
    setImportInfo(
      `Lithophane „${name}“ erzeugt — Form, Dicke und Kontrast stecken im Mesh.${restored ? ' Kalibrier-Testwerte wurden durch Alltagswerte ersetzt.' : ''}`,
    )
  }, [restoreDailySettings])

  const exportStl = async () => {
    if (!model) return
    try {
      const stl = await api.fetchModelStl(model.id)
      const outcome = await saveBlob(new Blob([stl], { type: 'model/stl' }), `${baseName}.stl`)
      if (outcome.status === 'saved' || outcome.status === 'downloaded') {
        setImportInfo('STL exportiert — Speicherort frei gewählt.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'STL-Export fehlgeschlagen.')
    }
  }

  const export3mf = async () => {
    if (!model) return
    try {
      const blob = await api.export3mf({
        modelId: model.id,
        settings,
        printerId: printer.id,
        filamentId: filament.id,
        plateId: plate.id,
        plate: activePlate,
        slots,
      })
      const outcome = await saveBlob(blob, `${baseName}.3mf`)
      if (outcome.status === 'saved' || outcome.status === 'downloaded') {
        setImportInfo('3MF mit Modell und Einstellungen exportiert.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '3MF-Export fehlgeschlagen.')
    }
  }

  /** Tastenkürzel wie im OrcaSlicer. Nicht belegte Tasten bleiben wirkungslos. */
  useEffect(() => {
    const isTyping = (target: EventTarget | null) => {
      const el = target as HTMLElement | null
      return Boolean(
        el &&
          (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable),
      )
    }
    const zoom = (direction: number) => {
      const canvas = document.querySelector('canvas')
      if (!canvas) return
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: direction * 120, bubbles: true, cancelable: true }))
    }
    const moveSelection = async (dx: number, dy: number) => {
      if (!model) return
      const picked = model.objects.filter((o) => selectedIds.includes(o.id))
      if (!picked.length) return
      try {
        await applyObjectEdit(
          await api.setObjects(
            model.id,
            picked.map((o) => ({
              id: o.id,
              offsetX: o.placement.offsetX + dx,
              offsetY: o.placement.offsetY + dy,
            })),
          ),
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Verschieben fehlgeschlagen.')
      }
    }
    const rotateSelection = async (deg: number) => {
      if (!model) return
      const picked = model.objects.filter((o) => selectedIds.includes(o.id))
      if (!picked.length) return
      try {
        await applyObjectEdit(
          await api.setObjects(
            model.id,
            picked.map((o) => ({ id: o.id, rotationZ: o.placement.rotationZ + deg })),
          ),
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Drehen fehlgeschlagen.')
      }
    }
    const cloneSelected = async () => {
      if (!model) return
      const picked = selectedIds.length ? selectedIds : selectedObjectId ? [selectedObjectId] : []
      if (!picked.length) return
      try {
        // Eine Anfrage für die ganze Auswahl — jede einzelne hätte das Modell
        // neu aufgebaut und das STL erneut geladen.
        await applyObjectEdit(await api.objectTool(model.id, 'duplicate', { objectIds: picked }))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Duplizieren fehlgeschlagen.')
      }
    }
    const deleteSelected = async () => {
      if (!model) return
      // Nur IDs, die es noch gibt: Nach dem Teilen kann die Auswahl kurzzeitig
      // auf dem ersetzten Original stehen — das ließ das Löschen abbrechen.
      const picked = (selectedIds.length ? selectedIds : selectedObjectId ? [selectedObjectId] : []).filter((id) =>
        model.objects.some((o) => o.id === id),
      )
      if (!picked.length) return
      try {
        // Eine Anfrage für die ganze Auswahl: Jede einzelne Anfrage hätte das
        // Modell neu zusammengesetzt und im Viewer das komplette STL neu
        // geladen — bei vielen Teilen auf einer Platte dauerte das Minuten.
        const res = await api.objectTool(model.id, 'delete', { objectIds: picked })
        // Letztes Teil gelöscht: Der Server verwirft das Modell. Ohne diesen
        // Zweig lief die nächste Anfrage in „Modell nicht gefunden".
        if (res.cleared) {
          resetWorkspace()
          setImportInfo('Alle Teile gelöscht — die Platte ist leer.')
          return
        }
        await applyObjectEdit(res)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen.')
      }
    }
    const pasteObjects = async () => {
      if (!model || !clipboard.current.length) return
      try {
        const ids = clipboard.current.filter((id) => model.objects.some((o) => o.id === id))
        if (!ids.length) return
        await applyObjectEdit(await api.objectTool(model.id, 'duplicate', { objectIds: ids }))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Einfügen fehlgeschlagen.')
      }
    }
    const togglePrintable = async () => {
      if (!model) return
      const picked = model.objects.filter((o) => selectedIds.includes(o.id))
      if (!picked.length) return
      const hide = picked.some((o) => o.placement.visible)
      try {
        await applyObjectEdit(
          await api.setObjects(
            model.id,
            picked.map((o) => ({ id: o.id, visible: !hide })),
          ),
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Sichtbarkeit nicht änderbar.')
      }
    }

    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur()
        return
      }
      const ctrl = e.ctrlKey || e.metaKey
      const lower = e.key.length === 1 ? e.key.toLowerCase() : e.key
      if (e.key === '?') {
        e.preventDefault()
        setShortcutsOpen((v) => !v)
        return
      }
      if (e.key === 'Escape') {
        setMenu(null)
        setShortcutsOpen(false)
        setTool(null)
        setRotateMode(false)
        setMeasureOn(false)
        setPreviewInspect(false)
        setPaint((p) => ({ ...p, on: false }))
        setSelectedIds([])
        return
      }
      if (ctrl) {
        switch (lower) {
          case 'i':
          case 'o':
          case 'n':
            e.preventDefault()
            objectFileRef.current?.click()
            return
          case 'r':
            e.preventDefault()
            if (model) void doSlice()
            return
          case 'z':
            e.preventDefault()
            void runHistory('undo')
            return
          case 'y':
            e.preventDefault()
            void runHistory('redo')
            return
          case 'a':
            e.preventDefault()
            if (model) setSelectedIds(model.objects.filter((o) => o.placement.visible).map((o) => o.id))
            return
          case 'c':
            e.preventDefault()
            clipboard.current = [...selectedIds]
            return
          case 'v':
            e.preventDefault()
            void pasteObjects()
            return
          case 'k':
            e.preventDefault()
            void cloneSelected()
            return
          case 'd':
            e.preventDefault()
            if (model) void runObjectTool('clear', 'Platte geleert.')
            return
        }
        return
      }
      switch (lower) {
        case 'delete':
        case 'backspace':
          e.preventDefault()
          void deleteSelected()
          return
        case 'arrowup':
          e.preventDefault()
          void moveSelection(0, e.shiftKey ? 1 : 10)
          return
        case 'arrowdown':
          e.preventDefault()
          void moveSelection(0, e.shiftKey ? -1 : -10)
          return
        case 'arrowleft':
          e.preventDefault()
          void moveSelection(e.shiftKey ? -1 : -10, 0)
          return
        case 'arrowright':
          e.preventDefault()
          void moveSelection(e.shiftKey ? 1 : 10, 0)
          return
        case 'pageup':
          e.preventDefault()
          void rotateSelection(e.shiftKey ? 5 : 45)
          return
        case 'pagedown':
          e.preventDefault()
          void rotateSelection(e.shiftKey ? -5 : -45)
          return
        case 'a':
          if (model) void runObjectTool('arrange', 'Alle Objekte neu auf dem Bett angeordnet.')
          return
        case 'q':
          void runObjectTool('orient', 'Objekt automatisch ausgerichtet.')
          return
        case 'm':
        case 's':
          setTool('transform')
          return
        case 'r':
          setRotateMode(true)
          return
        case 'f':
          void runObjectTool('bed', 'Objekt liegt jetzt auf dem Bett.')
          return
        case 'c':
          setTool('cut')
          return
        case 't':
          setTool('text')
          return
        case 'u':
          setMeasureOn((v) => !v)
          return
        case 'l':
          setPaint((p) => ({ ...p, on: !p.on }))
          setRotateMode(false)
          setMeasureOn(false)
          return
        case 'y':
        case 'b':
          void runObjectTool('merge', 'Ausgewählte Teile zusammengebaut.')
          return
        case 'v':
          void togglePrintable()
          return
        case 'i':
          zoom(-1)
          return
        case 'o':
          zoom(1)
          return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    applyObjectEdit,
    doSlice,
    export3mf,
    model,
    runHistory,
    runObjectTool,
    selectedIds,
    selectedObjectId,
  ])

  const exportAllPrinterProfiles = useCallback(async () => {
    const backup = buildPrinterBackup({
      setup,
      settings,
      workspace,
      customPrinters: catalog?.printers ?? [],
    })
    const outcome = await saveBlob(
      new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
      `easy-slicer-druckerprofile-${new Date().toISOString().slice(0, 10)}.json`,
    )
    if (outcome.status === 'saved' || outcome.status === 'downloaded') {
      setImportInfo(
        `${Object.keys(backup.snapshots).length} Druckerstände exportiert — inklusive aktivem Drucker, Grenzen und eigenem G-Code.`,
      )
    }
  }, [catalog?.printers, saveBlob, settings, setup, workspace])

  const importAllPrinterProfiles = useCallback(
    async (file: File) => {
      setBusy('profiles')
      setError(null)
      try {
        const backup = parsePrinterBackup(await file.text())
        // Eigene Drucker zuerst wieder anlegen, damit die Katalog-IDs existieren.
        for (const p of backup.customPrinters) {
          await api.saveCustomPrinter({
            id: p.id,
            name: p.name,
            bed: p.bed,
            baud: p.baud,
            control: p.control,
            hasBedLeveling: p.hasBedLeveling,
          })
        }
        const freshCatalog = backup.customPrinters.length ? await api.fetchCatalog() : catalog
        if (backup.customPrinters.length) setCatalog(freshCatalog)

        for (const [id, snap] of Object.entries(backup.snapshots)) {
          saveSnapshot({ ...snap, setup: { ...snap.setup, printerId: id } }, id)
        }
        const known = new Set((freshCatalog?.printers ?? PRINTERS).map((p) => p.id))
        const activeId = known.has(backup.activePrinterId)
          ? backup.activePrinterId
          : Object.keys(backup.snapshots)[0]
        const activeSnap = backup.snapshots[activeId]
        const ids = [
          ...new Set([
            ...backup.workspace.filter((id) => known.has(id)),
            ...Object.keys(backup.snapshots).filter((id) => known.has(id)),
            ...(known.has(activeId) ? [activeId] : []),
          ]),
        ]
        setWorkspace(ids)
        saveWorkspace(ids)

        if (activeSnap) {
          const base = (freshCatalog?.printers ?? PRINTERS).find((p) => p.id === activeId) ?? DEFAULT_PRINTER
          const nextSetup = ensureMachineGcode(
            normalizeSetup({ ...activeSnap.setup, printerId: activeId }),
            base,
          )
          setSetup(nextSetup)
          setQualityPresetId(nextSetup.qualityPresetId ?? 'normal')
          saveSetup(nextSetup)
          setSettings(mergeSettings(DEFAULT_SETTINGS, activeSnap.settings))
          setDirty(true)
          setResult(null)
          setOutputInfo(null)
          setImportInfo(
            `${Object.keys(backup.snapshots).length} Druckerstände wiederhergestellt — aktiv ist „${
              (freshCatalog?.printers ?? PRINTERS).find((p) => p.id === activeId)?.name ?? activeId
            }“.`,
          )
        } else {
          setImportInfo(`${Object.keys(backup.snapshots).length} Druckerstände gesichert; kein aktiver Stand enthalten.`)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Druckerprofile konnten nicht gelesen werden.')
      } finally {
        setBusy(null)
      }
    },
    [catalog],
  )

  const exportProfile = async () => {
    const payload = {
      app: 'kepler-slicer-studio',
      version: 2,
      exportedAt: new Date().toISOString(),
      printer: printer.id,
      filament: filament.id,
      plate: plate.id,
      nozzle: setup.nozzle,
      nozzleMaterial: setup.nozzleMaterial,
      slots,
      activeSlotId: setup.activeSlotId,
      settings,
    }
    const outcome = await saveBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      `kepler-${printer.id}.json`,
    )
    if (outcome.status === 'saved' || outcome.status === 'downloaded') {
      setImportInfo('Profil exportiert — Speicherort frei gewählt.')
    }
  }

  const importProfile = useCallback(
    async (file: File) => {
      try {
        const data = JSON.parse(await file.text()) as {
          printer?: string
          filament?: string
          plate?: string
          nozzle?: number
          nozzleMaterial?: NozzleMaterial
          slots?: FilamentSlot[]
          activeSlotId?: string
          settings?: Partial<PrintSettings>
        }
        const known = catalog?.printers.some((p) => p.id === data.printer)
        const target = (known ? catalog?.printers.find((p) => p.id === data.printer) : null) ?? printer
        if (known && data.printer) {
          applySetup({
            printerId: data.printer,
            filamentId: data.filament ?? setup.filamentId,
            plateId: data.plate ?? setup.plateId,
            nozzle: data.nozzle ?? setup.nozzle,
            nozzleMaterial: data.nozzleMaterial ?? setup.nozzleMaterial,
            customGcode: setup.customGcode,
            slots: Array.isArray(data.slots) ? data.slots : setup.slots,
            activeSlotId: data.activeSlotId ?? setup.activeSlotId,
          })
        } else if (Array.isArray(data.slots)) {
          const next = { ...setup, slots: data.slots, activeSlotId: data.activeSlotId ?? setup.activeSlotId }
          setSetup(next)
          saveSetup(next)
        }
        setSettings(
          applyPrinterLimits(
            { ...target, ...effectivePrinterLimits(target) },
            mergeSettings(DEFAULT_SETTINGS, data.settings ?? {}),
          ),
        )
        setDirty(true)
        setImportInfo(`Profil übernommen — Einstellungen auf ${target.name} begrenzt.`)
      } catch {
        setError('Profil konnte nicht gelesen werden (JSON erwartet).')
      }
    },
    [applySetup, catalog, printer, setup],
  )

  // Ausgabe nach dem Slicen: speichern, per USB streamen oder per WLAN senden.
  // Der Server prüft, ob die gewählte Verbindungsart überhaupt verbunden ist.
  const sendOutput = useCallback(
    async (target: 'usb' | 'network' | 'network-idle') => {
      if (!result) return
      if (target === 'network-idle') {
        setSending(true)
        setOutputInfo('Übertrage die Datei an den Drucker …')
        try {
          await api.selectPrinter(printer.id)
          const up = await api.uploadToPrinter(effectiveJobName, result.gcode, false, printer.id)
          setOutputInfo(`Als „${up.file}“ im G-Code-Ordner abgelegt — Start dann in Mainsail/Fluidd.`)
        } catch (err) {
          setOutputInfo(err instanceof Error ? err.message : 'Übertragung fehlgeschlagen.')
        } finally {
          setSending(false)
        }
        return
      }
      setSending(true)
      setOutputInfo(target === 'network' ? 'Übertrage an den Drucker …' : 'Starte USB-Streaming …')
      try {
        await api.selectPrinter(printer.id)
        const zRef = loadZRef(printer.id)
        const res = await api.startPrint(
          result.gcode,
          effectiveJobName,
          {
            modelId: model?.id ?? null,
            settings,
            profileId: printer.id,
            zRef: settings.autoZ.enabled && zRef ? { mean: zRef.mean } : undefined,
          },
          target,
        )
        if (res.prep?.adaptive) {
          setOutputInfo('Adaptiv gemessen — die Kompensation steckt im G-Code.')
          return
        }
        setOutputInfo(
          target === 'network'
            ? `An ${printer.name} übertragen und gestartet.`
            : 'USB-Streaming gestartet — Fortschritt unter „Drucker“.',
        )
      } catch (err) {
        setOutputInfo(err instanceof Error ? err.message : 'Übertragung fehlgeschlagen.')
      } finally {
        setSending(false)
      }
    },
    [effectiveJobName, model?.id, printer.id, printer.name, result, settings],
  )

  const openLogs = useCallback(async () => {
    setLogsOpen(true)
    try {
      const res = await api.fetchLogs()
      setLogsPath(res.path)
      setLogsText(res.text)
    } catch {
      setLogsText('Protokoll konnte nicht gelesen werden.')
    }
  }, [])

  /** Mainsail/Fluidd zur verbundenen IP öffnen (auch nachträglich per Kopfzeile). */
  const openWebUi = useCallback(async () => {
    // Die laufende Verbindung hat Vorrang vor einem alten gespeicherten Ziel.
    // Sonst öffnet der Kopfzeilen-Knopf nach dem Wechsel auf den Vyper weiter
    // die gespeicherte AD5X-Oberfläche.
    const live = status.port?.match(/^(https?):\/\/([^/:]+)(?::(\d+))?/i)
    const target = live
      ? {
          host: live[2],
          port: Number(live[3] ?? (live[1].toLowerCase() === 'https' ? 443 : 80)),
          secure: live[1].toLowerCase() === 'https',
          webUiUrl: '',
        }
      : loadWebTarget()
    if (!target) {
      setWebOpen(true)
      return
    }
    try {
      const explicit = target.webUiUrl && webUrlMatchesHost(target.webUiUrl, target.host)
        ? target.webUiUrl
        : undefined
      const info = await api.inspectWebUi(target.host, target.port, target.secure, explicit)
      if (info) {
        setWebUi(info)
        setView('webui')
      } else {
        setError(`Keine Web-Oberfläche auf ${target.host} gefunden (Port 80/443 oder ${target.port}).`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Web-Oberfläche nicht erreichbar.')
    }
  }, [status.port])

  /** Job-Steuerung aus der Web-UI-Leiste */
  const jobAction = useCallback(async (action: 'pause' | 'resume' | 'cancel') => {
    try {
      await api.selectPrinter(printer.id)
      if (action === 'pause') await api.pausePrint()
      else if (action === 'resume') await api.resumePrint()
      else await api.cancelPrint()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Aktion fehlgeschlagen.')
    }
  }, [printer.id])

  const quitApp = useCallback(async () => {
    if (!window.confirm('Easy-Slicer beenden? Ein laufender Druck wird dabei nicht gestoppt.')) return
    markDraftCleanExit()
    try {
      await api.quitApp()
    } catch {
      /* Server ist bereits beendet */
    }
    setImportInfo('Programm beendet — Fenster schließen.')
  }, [])

  // Beide Layouts verwenden dieselben Panel-Elemente. Die Variante ändert
  // nur CSS-Klassen und die Grid-Platzierung; dadurch bleiben DOM-Knoten und
  // lokaler Zustand beim Wechsel erhalten. ?ui=test bleibt als Alias für
  // die Werkstatt-Reihenfolge erhalten, ?ui=classic für die klassische.
  const settingsPanel = (
    <SettingsSidebar
      settings={settings}
      baseline={profileBaseline}
      qualityPresets={qualityPresets}
      qualityId={qualityId}
      onQualityChange={applyQuality}
      onSaveQualityProfile={saveQualityProfile}
      onRenameQualityProfile={renameQualityProfile}
      onDeleteQualityProfile={deleteQualityProfile}
      onChange={updateSettings}
      onReset={resetSettings}
      texturePreview={texturePreviewOn}
      onTexturePreview={setTexturePreviewOn}
      limits={{
        layer: printer.layerRange,
        nozzle: printer.nozzleOptions,
        speed: printerLimits.maxPrintSpeed,
        accel: printerLimits.maxAccel,
        travel: printerLimits.maxTravel,
        bed: printerLimits.maxBedTemp,
        nozzleTemp: printerLimits.maxNozzleTemp,
      }}
      nozzleMaterial={setup.nozzleMaterial}
      onNozzleMaterial={updateNozzleMaterial}
      profiles={userFilaments.map((f) => ({ id: f.id, name: f.name }))}
      filamentProfiles={filaments.map((f) => ({ id: f.id, name: f.name }))}
      currentFilamentName={filament.name}
      onSaveFilament={saveMyFilament}
      onLoadFilament={applyFilamentProfile}
      onDeleteFilament={removeMyFilament}
      printer={printer}
      objects={model?.objects ?? []}
      selectedObjectId={selectedObjectId}
      onObjects={(next) => void updateObjects(next)}
      slots={slots}
      onSlotsChange={updateSlots}
      onAssignSlot={assignObjectSlot}
      onOpenPrinterSettings={() => setPrinterSettingsOpen(true)}
      plates={catalog?.plates ?? []}
      plateProfiles={setup.plateProfiles}
      filamentId={setup.filamentId}
      activePlateId={setup.plateId}
      plateFallbackTemps={Object.fromEntries(
        (catalog?.plates ?? []).map((plate) => [
          plate.id,
          {
            bed: filament.bed + (filament.custom ? 0 : plate.bedTempOffset),
            firstLayer: filament.firstLayerBed + (filament.custom ? 0 : plate.bedTempOffset),
          },
        ]),
      )}
      onPlateTemps={(plateId, patch) => {
        const filamentId = setup.filamentId
        const profile = setup.plateProfiles?.[plateId] ?? {}
        const filamentTemps = { ...(profile.filamentTemps ?? {}) }
        const next = { ...(filamentTemps[filamentId] ?? {}), ...patch }
        if (next.bedTemp == null) delete next.bedTemp
        if (next.firstLayerBed == null) delete next.firstLayerBed
        if (Object.keys(next).length) filamentTemps[filamentId] = next
        else delete filamentTemps[filamentId]

        const plateProfiles = { ...(setup.plateProfiles ?? {}) }
        if (Object.keys(filamentTemps).length) {
          plateProfiles[plateId] = { ...profile, filamentTemps }
        } else {
          const rest = { ...profile }
          delete rest.filamentTemps
          if (Object.keys(rest).length) plateProfiles[plateId] = rest
          else delete plateProfiles[plateId]
        }

        const nextSetup = { ...setup, plateProfiles }
        setSetup(nextSetup)
        saveSetup(nextSetup)
        setDirty(true)

        let nextSettings = settings
        if (plateId === setup.plateId) {
          const plate = (catalog?.plates ?? []).find((entry) => entry.id === plateId)
          const offset = plate && !filament.custom ? plate.bedTempOffset : 0
          const fallbackBed = filament.bed + offset
          const fallbackFirstLayerBed = filament.firstLayerBed + offset
          const clampBed = (value: number) => Math.min(printerLimits.maxBedTemp, Math.max(0, value))
          nextSettings = {
            ...settings,
            temps: {
              ...settings.temps,
              bed: clampBed(next.bedTemp ?? fallbackBed),
              firstLayerBed: clampBed(next.firstLayerBed ?? fallbackFirstLayerBed),
            },
          }
          setSettings(nextSettings)
        }
        saveSnapshot({ setup: nextSetup, settings: nextSettings, savedAt: Date.now() }, nextSetup.printerId)
      }}
      activeSlotId={setup.activeSlotId}
      onActiveSlot={(slotId) => {
        const slot = slots.find((entry) => entry.id === slotId)
        if (!slot) return
        applySetup({ ...setup, activeSlotId: slotId, filamentId: slot.profileId })
      }}
    />
  )
  const modelPanel = (
    <ModelPanel
      analysis={model?.analysis ?? null}
      fileName={model?.name ?? null}
      format={model?.format ?? null}
      objects={model?.objects ?? []}
      filaments={filaments.map((f) => ({ id: f.id, name: f.name }))}
      selectedId={selectedObjectId}
      selectedIds={selectedIds}
      onSelect={selectObject}
      onObjects={(next) => void updateObjects(next)}
      onFile={(f) => void onFile(f)}
      onDemo={(s) => void onDemo(s)}
      onClear={() => {
        if (model) void api.objectTool(model.id, 'clear').catch(() => {})
        resetWorkspace()
      }}
      onExportStl={() => void exportStl()}
      onExport3mf={() => void export3mf()}
      onExportProfile={exportProfile}
      onImportProfile={(f) => void importProfile(f)}
      busy={busy === 'load'}
    />
  )
  const intentPanel = <IntentPanel intent={intent} onIntent={chooseIntent} />
  const suggestionsPanel = !embedded ? (
    <div className="flex flex-col gap-2.5">
      <SuggestionsPanel
        suggestions={suggestions}
        dismissed={dismissed}
        onApply={applySuggestion}
        onDismiss={(id) => setDismissed((prev) => [...prev, id])}
        onApplyAll={applyAll}
      />
      {model && <PrintAudit findings={auditFindings} onApply={applyAuditFix} />}
    </div>
  ) : null
  const resultPanel = (
    <ResultPanel
      result={result}
      dirty={dirty}
      busy={busy === 'slice'}
      canSlice={!!model}
      onSlice={() => void doSlice()}
      onDownload={downloadGcode}
      outputName={outputName}
      onOutputName={changeOutputName}
      layer={layer}
      onLayer={setLayer}
      showAll={showAll}
      onShowAll={setShowAll}
      mesh={mesh}
      status={status}
      printerName={printer.name}
      onSend={(target) => void sendOutput(target)}
      sending={sending}
      outputInfo={outputInfo}
    />
  )

  // Die Panels werden einmal in stabile Portal-Hosts gerendert. Beim Wechsel
  // der Spaltenvariante wandern nur diese Hosts zwischen den beiden Spalten;
  // React hängt die Panel-Komponenten dabei nicht neu ein.
  type StudioPanelKey = 'settings' | 'model' | 'intent' | 'suggestions' | 'result'
  const leftColumnRef = useRef<HTMLDivElement>(null)
  const rightColumnRef = useRef<HTMLDivElement>(null)
  const panelHostsRef = useRef<Record<StudioPanelKey, HTMLDivElement> | null>(null)
  if (!panelHostsRef.current) {
    const createHost = (key: StudioPanelKey) => {
      const host = document.createElement('div')
      host.className = `studio-slot studio-slot--${key}`
      return host
    }
    panelHostsRef.current = {
      settings: createHost('settings'),
      model: createHost('model'),
      intent: createHost('intent'),
      suggestions: createHost('suggestions'),
      result: createHost('result'),
    }
  }
  const panelHosts = panelHostsRef.current
  useLayoutEffect(() => {
    if (!catalog || !leftColumnRef.current || !rightColumnRef.current) return
    const order =
      studioLayout === 'workshop'
        ? {
            left: ['model', 'intent', 'result'] as const,
            right: ['settings', 'suggestions'] as const,
          }
        : {
            left: ['model', 'settings', 'intent'] as const,
            right: ['result', 'suggestions'] as const,
          }
    for (const key of order.left) leftColumnRef.current.appendChild(panelHosts[key])
    for (const key of order.right) rightColumnRef.current.appendChild(panelHosts[key])
    // Beim Wechsel von Kalibrieren/G-Code zurück ins Studio werden die
    // Spalten neu aufgebaut; die stabilen Portal-Hosts müssen dann erneut
    // eingehängt werden, sonst bleiben Einstellungen und Ergebnis leer.
  }, [catalog, studioLayout, panelHosts, view])

  const draftStatusText =
    draftStatus === 'saving'
      ? 'Entwurf wird gesichert …'
      : draftStatus === 'saved'
        ? `Entwurf gesichert${draftSavedAt ? ` · ${new Date(draftSavedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}` : ''}`
        : draftStatus === 'too-large'
          ? 'Zu groß für Autosave'
          : draftStatus === 'unavailable'
            ? 'Autosave nicht verfügbar'
            : draftStatus === 'error'
              ? 'Autosave fehlgeschlagen'
              : 'Autosave bereit'
  const draftTone =
    draftStatus === 'saved'
      ? 'mint'
      : draftStatus === 'saving'
        ? 'amber'
        : draftStatus === 'too-large' || draftStatus === 'unavailable' || draftStatus === 'error'
          ? 'rose'
          : 'muted'

  const errorResolution = (() => {
    if (!error) return null
    if (/Server nicht erreichbar/i.test(error)) {
      return {
        label: 'Seite neu laden',
        hint: 'Der lokale Server antwortet nicht. Prüfe, ob die App bzw. `npm run dev` noch läuft.',
        run: () => window.location.reload(),
      }
    }
    if (/Keine Modelldaten|Modell konnte nicht gelesen|Modell nicht gefunden|Datei.*ungültig/i.test(error)) {
      return {
        label: 'Andere Datei wählen',
        hint: 'Die Datei enthält kein lesbares Mesh. Wähle ein STL, 3MF, OBJ oder PLY.',
        run: () => objectFileRef.current?.click(),
      }
    }
    if (/passt nicht|Druckbett|zu groß/i.test(error)) {
      return {
        label: 'Objekt anordnen',
        hint: 'Das Objekt liegt außerhalb des Bauraums. Anordnen setzt es auf das aktive Druckbett.',
        run: () => void handleMenu('arrange'),
      }
    }
    if (/Verbindung|fetch failed|ECONN|aborted|nicht erreichbar|Port/i.test(error)) {
      return {
        label: 'Verbindung prüfen',
        hint: FEATURES.webUi
          ? 'Prüfe IP und Port. Der Web-Dialog öffnet die Verbindungsdaten direkt.'
          : 'Prüfe Kabel und Anschluss unter „Drucker → Verbindung“.',
        run: () => (FEATURES.webUi ? setWebOpen(true) : setView('printer')),
      }
    }
    if (/Filament|Profil|Material|Düse/i.test(error)) {
      return {
        label: 'Material prüfen',
        hint: 'Öffne Material, Platte und Düse und übernimm den passenden Stand.',
        run: () => setSetupOpen(true),
      }
    }
    return {
      label: 'Protokoll öffnen',
      hint: 'Die vollständige Meldung und der letzte Serverstand stehen im Protokoll.',
      run: () => void openLogs(),
    }
  })()

  if (!catalog) {
    return (
      <div className="grid h-full place-items-center">
        <div className="flex items-center gap-2 text-xs text-white/40">
          <span className="h-2 w-2 animate-pulse rounded-full bg-amber" />
          Lade Druckerkatalog …
        </div>
        {error && (
          <div className="mt-3 flex flex-col items-center gap-2 text-[11px] text-rose/80">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg border border-rose/40 px-2.5 py-1 text-[10px] text-rose/90 transition hover:bg-rose/10"
            >
              Seite neu laden
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {!embedded && (
        <>
          <TopBar
            view={view}
            onView={setView}
            status={status}
            printer={printer}
            filament={filament}
            plate={plate}
            nozzle={setup.nozzle}
            onSetup={() => setSetupOpen(true)}
            onWeb={() => setWebOpen(true)}
            onLogs={() => void openLogs()}
            onQuit={() => void quitApp()}
            theme={theme}
            onTheme={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
            layout={studioLayout}
            onLayout={setStudioLayout}
            uiScale={uiScaleId}
            onUiScale={setUiScaleId}
          />

          <PrinterHubStrip
            printers={workspacePrinters}
            statuses={printerStatuses}
            onSelect={switchPrinter}
            onSettings={(id) => {
              if (id !== setup.printerId) switchPrinter(id)
              setPrinterSettingsOpen(true)
            }}
            onPanes={() => setPanesOpen(true)}
          />
        </>
      )}

      {embedded && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line/50 bg-ink-950/55 px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[11px] font-semibold text-white/85">{printer.name}</span>
              <span className="shrink-0 rounded bg-white/8 px-1 py-0.5 text-[8px] font-bold tracking-wide text-white/40 uppercase">
                Studio
              </span>
            </div>
            <div className="truncate text-[9px] text-white/35">
              {model?.name ?? 'Kein Objekt geladen'} ·{' '}
              {status.connection === 'connected' ? 'verbunden' : 'nicht verbunden'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setEmbeddedPanel((panel) => (panel ? null : 'left'))}
            className={`rounded-lg border px-2 py-1 text-[10px] transition ${
              embeddedPanel
                ? 'border-amber/60 bg-amber/12 text-amber'
                : 'border-line/70 text-white/55 hover:border-white/25'
            }`}
          >
            Objekt & Einstellungen
          </button>
        </div>
      )}

      {view === 'studio' && (
        <>
          {calibration && (
            <div className="mx-3 mt-3 rounded-2xl border border-amber/30 bg-amber/8 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-amber px-2 py-0.5 text-[9px] font-bold tracking-wide text-ink-950 uppercase">
                    Kalibrierung
                  </span>
                  <span className="text-[11px] font-semibold text-white/85">{calibration.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded border border-line/70 bg-ink-900/60 px-1.5 py-0.5 text-[9px] text-white/40">
                    Plan in der Vorschau
                  </span>
                  <button
                    type="button"
                    onClick={() => setCalibration(null)}
                    className="text-white/30 hover:text-white/70"
                    aria-label="Kalibrierhinweis schließen"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <ol className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-white/45">
                {calibration.howTo.map((h, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className="text-amber/70">{i + 1}.</span>
                    {h}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {warnings.length > 0 && warningsClosed !== warnings.join('|') && (
            <div data-testid="printer-warning" className="mx-3 mt-3 rounded-2xl border border-rose/30 bg-rose/8 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold tracking-[0.14em] text-rose/90 uppercase">
                  Passt nicht zu {printer.name}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-white/30">{warnings.length} Hinweis(e)</span>
                  <button
                    type="button"
                    onClick={() => setWarningsClosed(warnings.join('|'))}
                    className="text-white/30 hover:text-white/70"
                    aria-label="Hinweis-Leiste schließen"
                  >
                    ✕
                  </button>
                </div>
              </div>
              <ul className="mt-1 space-y-0.5">
                {warnings.slice(0, 4).map((w) => (
                  <li key={w} className="flex gap-1.5 text-[10px] leading-snug text-white/55">
                    <span className="text-rose/60">•</span>
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {meshNotice && meshNoticeClosed !== meshNotice && (
            <div className="mx-3 mt-2 flex items-start gap-2 rounded-2xl border border-amber/30 bg-amber/8 px-3 py-2">
              <span className="shrink-0 text-[9px] font-semibold tracking-[0.12em] text-amber/80 uppercase">
                Bett-Mesh
              </span>
              <p className="flex-1 text-[10px] leading-snug text-white/55">{meshNotice}</p>
              <button
                type="button"
                onClick={() => setMeshNoticeClosed(meshNotice)}
                className="shrink-0 text-white/30 hover:text-white/70"
                aria-label="Bett-Mesh-Hinweis schließen"
              >
                ✕
              </button>
            </div>
          )}

          {scaleOffer && (
            <ImportScaleOffer
              largest={scaleOffer.largest}
              busy={busy !== null}
              onScale={(targetMm) => void scaleImportedModel(targetMm)}
              onClose={() => setScaleOffer(null)}
            />
          )}

          {importInfo && (
            <div className="mx-3 mt-2 flex items-start justify-between gap-2 rounded-xl border border-mint/25 bg-mint/8 px-3 py-1.5">
              <p className="text-[10px] leading-snug text-mint/90">{importInfo}</p>
              <button type="button" onClick={() => setImportInfo(null)} className="text-white/25 hover:text-white/70">
                ✕
              </button>
            </div>
          )}

          {filamentApplyUndo && (
            <div className="mx-3 mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-amber/35 bg-amber/8 px-3 py-1.5">
              <p className="min-w-0 flex-1 text-[10px] leading-snug text-amber/90">
                Filamentprofil „{filamentApplyUndo.label}“ wurde angewendet.
              </p>
              <button
                type="button"
                onClick={undoFilamentApply}
                className="shrink-0 rounded-lg border border-amber/50 bg-amber/15 px-2 py-1 text-[10px] font-semibold text-amber transition hover:bg-amber/25"
              >
                Rückgängig
              </button>
              <button
                type="button"
                onClick={() => setFilamentApplyUndo(null)}
                className="shrink-0 text-white/30 hover:text-white/70"
                aria-label="Rückgängig-Hinweis schließen"
              >
                ✕
              </button>
            </div>
          )}

          {!embedded && recoveryDraft && (
            <div
              data-testid="draft-recovery"
              className="mx-3 mt-2 flex flex-wrap items-center gap-2 rounded-2xl border border-sky/35 bg-sky/8 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-semibold tracking-wide text-sky/90">
                  Entwurf nach unerwartetem Ende gefunden
                </div>
                <p className="mt-0.5 text-[10px] leading-snug text-white/55">
                  {recoveryDraft.sourceName} · gesichert{' '}
                  {new Date(recoveryDraft.savedAt).toLocaleString('de-DE', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                  {recoveryDraft.printerId !== setup.printerId ? ' · anderes Studio' : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void restoreRecovery()}
                className="rounded-lg border border-sky/50 bg-sky/15 px-2.5 py-1 text-[10px] font-semibold text-sky transition hover:bg-sky/25"
              >
                Wiederherstellen
              </button>
              <button
                type="button"
                onClick={() => {
                  setRecoveryDraft(null)
                  void clearDraft()
                }}
                className="rounded-lg border border-line/70 px-2.5 py-1 text-[10px] text-white/50 transition hover:text-white"
              >
                Verwerfen
              </button>
            </div>
          )}

          {!embedded && (
            <WorkflowBar
              hasModel={!!model}
              hasResult={!!result}
              dirty={dirty}
              slicing={busy === 'slice'}
              material={filament.material}
              plate={plate.name}
              printerName={printer.name}
              autosaveText={draftStatusText}
              autosaveTone={draftTone}
              onLoad={() => objectFileRef.current?.click()}
              onSetup={() => setSetupOpen(true)}
              onSlice={() => void doSlice()}
              onSave={downloadGcode}
            />
          )}

          <main
            className={`studio-layout ${
              embedded ? 'studio-layout--embedded' : `studio-layout--${studioLayout}`
            } flex min-h-0 min-w-0 w-full flex-1 flex-col gap-3 overflow-y-auto select-none [&>*]:select-text ${
              embedded ? 'p-2' : 'p-3'
            }`}
          >
            {createPortal(settingsPanel, panelHosts.settings)}
            {createPortal(modelPanel, panelHosts.model)}
            {createPortal(intentPanel, panelHosts.intent)}
            {createPortal(suggestionsPanel, panelHosts.suggestions)}
            {createPortal(resultPanel, panelHosts.result)}
            {embedded && embeddedPanel && (
              <div
                className="fixed inset-0 z-30 bg-ink-950/60 backdrop-blur-sm"
                onClick={() => setEmbeddedPanel(null)}
              />
            )}
            <div
              ref={leftColumnRef}
              className={
                embedded
                  ? 'studio-side studio-side--left fixed inset-y-0 left-0 z-40 w-[min(360px,92vw)] flex-col gap-3 overflow-y-auto border-r border-line/70 bg-ink-950 p-3 shadow-2xl'
                  : 'studio-side studio-side--left'
              }
              style={
                embedded
                  ? {
                      transform: embeddedPanel ? 'translateX(0)' : 'translateX(-100%)',
                      // Tailwinds translate-Utility und die transform-Regel nicht doppelt anwenden.
                      translate: 'none',
                    }
                  : undefined
              }
            >
              {embedded && (
                <button
                  type="button"
                  onClick={() => setEmbeddedPanel(null)}
                  className="mb-2 w-full rounded-lg border border-line/70 px-2 py-1.5 text-[10px] text-white/50 transition hover:border-white/25 hover:text-white"
                >
                  Schließen
                </button>
              )}
            </div>

            <div
              ref={rightColumnRef}
              className={`studio-side studio-side--right ${
                embedded ? 'flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto pl-1' : ''
              }`}
            />

            <div className="studio-slot studio-slot--viewport flex min-h-0 min-w-0 flex-col gap-2">
              <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-line/70 bg-ink-900/55 px-2 py-1.5">
                {BAR_TOOLS.map((item) => {
                  const disabled = !model && item.action !== 'add'
                  const active = item.action === 'measure' && measureOn
                  return (
                    <span key={item.key} className="flex items-center gap-1.5">
                      {item.group && <span className="mx-0.5 h-5 w-px bg-line/80" />}
                      <button
                        type="button"
                        disabled={disabled}
                        data-testid={`studio-tool-${item.key}`}
                        title={item.hint}
                        onClick={() => {
                          if (item.action === 'add') {
                            if (model) addFileRef.current?.click()
                            else objectFileRef.current?.click()
                            return
                          }
                          if (item.action === 'measure') {
                            setMeasureOn((v) => !v)
                            setMeasure(null)
                            setRotateMode(false)
                            return
                          }
                          if (item.action === 'transform') {
                            setRotateMode(item.key === 'rotate')
                            setRotateInfo(null)
                            setTool('transform')
                            return
                          }
                          handleMenu(item.action)
                        }}
                        className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] transition ${
                          active
                            ? 'bg-amber/20 text-amber'
                            : 'text-white/70 hover:bg-white/8 hover:text-white'
                        } disabled:cursor-not-allowed disabled:text-white/25 disabled:hover:bg-transparent`}
                      >
                        <span className="text-[14px] leading-none">{item.icon}</span>
                        <span>{item.label}</span>
                      </button>
                    </span>
                  )
                })}
                {plateCount > 1 && (
                  <div className="ml-auto flex items-center gap-1 rounded-lg border border-line/70 bg-ink-950/60 px-1.5 py-1">
                    <span className="text-[10px] tracking-[0.12em] text-white/45 uppercase">Platte</span>
                    {Array.from({ length: plateCount }, (_, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => selectPlate(i)}
                        title={`Platte ${i + 1} slicen`}
                        className={`rounded px-2 py-0.5 text-[11px] transition ${
                          i === activePlate ? 'bg-amber/20 text-amber' : 'text-white/55 hover:text-white'
                        }`}
                      >
                        {i + 1}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  data-testid="toolbar-slice"
                  disabled={!model || busy === 'slice'}
                  onClick={() => void doSlice()}
                  title={model ? 'Aktuelles Modell mit den eingestellten Werten slicen' : 'Zuerst ein Objekt laden'}
                  className={`${plateCount > 1 ? '' : 'ml-auto'} flex shrink-0 items-center gap-1.5 rounded-lg border border-amber/40 bg-amber/15 px-2.5 py-1.5 text-[11px] font-semibold text-amber transition hover:bg-amber/25 disabled:cursor-not-allowed disabled:border-line/50 disabled:bg-transparent disabled:text-white/25`}
                >
                  <span className="h-2 w-2 rounded-full bg-amber shadow-[0_0_8px_rgba(251,191,36,0.8)]" />
                  <span>
                    {busy === 'slice'
                      ? 'Slicen läuft …'
                      : result && dirty
                        ? 'Neu slicen'
                        : result
                          ? 'Erneut slicen'
                          : 'Slicen'}
                  </span>
                </button>
              </div>

              <div
                data-preview-stage
                className="relative flex min-h-[46vh] flex-1 flex-col overflow-hidden rounded-3xl border border-line/70 bg-gradient-to-b from-ink-850/60 to-ink-950/80 lg:min-h-[420px]"
              >
              <div
                className="min-h-0 flex-1"
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({ x: e.clientX, y: e.clientY })
                }}
              >
                <Viewport
                  geometry={model?.geometry ?? null}
                  layers={dirty ? [] : (result?.layers ?? [])}
                  selectedIds={selectedIds}
                  paintMode={paint.on}
                  paintBlock={paint.block}
                  onPaint={(id, point, block) => void applyPaint(id, point, block)}
                  layer={layer}
                  showAll={showAll}
                  colorMode={previewColorMode}
                  hiddenFeatures={hiddenPreviewFeatures}
                  previewFilter={previewFilter}
                  palette={previewPalette}
                  compareLayers={compareResult?.layers ?? null}
                  maxVolumetricFlow={previewFlowLimit}
                  previewSection={previewSection}
                  previewPick={previewInspect}
                  onPreviewPick={handlePreviewPick}
                  bed={printer.bed}
                  kinematics={printer.kinematics}
                  onFitReady={(fit) => {
                    fitRef.current = fit
                  }}
                  measure={measureOn}
                  onMeasure={setMeasure}
                  plateCount={plateCount}
                  activePlate={activePlate}
                  objects={model?.objects ?? []}
                  selectedId={selectedObjectId}
                  onSelect={selectObject}
                  modelCenter={modelCenter}
                  rotateMode={rotateMode}
                  onRotate={rotateSelected}
                  onRotateEnd={finishRotate}
                  onMove={moveSelected}
                  overlayGeometry={overlayGeometry}
                  splitPlane={splitGuide}
                  onSplitPlaneMove={(value) => splitMoveRef.current?.(value)}
                  texturePreview={
                    settings.fuzzySkin.mode === 'off' && !texturePreviewOn
                      ? null
                      : {
                          pattern: settings.fuzzySkin.pattern ?? 'noise',
                          scale: settings.fuzzySkin.scale ?? 3,
                          angle: settings.fuzzySkin.angle ?? 0,
                          thickness: settings.fuzzySkin.thickness,
                        }
                  }
                />
              </div>

              {model && !rotateMode && !measureOn && (
                <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-xl border border-line/60 bg-ink-950/70 px-3 py-1.5 text-[10px] text-white/55 backdrop-blur-md">
                  Objekt anklicken zum Auswählen · ausgewähltes Objekt ziehen = verschieben
                </div>
              )}

              {paint.on && model && (
                <div className="pointer-events-auto absolute bottom-14 left-1/2 z-10 flex max-w-[calc(100%-16px)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-xl border border-mint/40 bg-ink-950/85 px-2.5 py-1.5 text-[10px] text-white/75 backdrop-blur-md">
                  <span className="text-mint">✎ Stützen malen</span>
                  <div className="flex gap-1">
                    {(
                      [
                        [false, 'Stützen'],
                        [true, 'Blocker'],
                      ] as const
                    ).map(([block, label]) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => setPaint((p) => ({ ...p, block }))}
                        className={`rounded border px-1.5 py-0.5 transition ${
                          paint.block === block
                            ? block
                              ? 'border-rose/60 bg-rose/15 text-rose'
                              : 'border-mint/60 bg-mint/15 text-mint'
                            : 'border-line/70 text-white/50 hover:border-white/20'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <label className="flex items-center gap-1 text-white/45">
                    Ø
                    <input
                      type="range"
                      min={2}
                      max={20}
                      step={1}
                      value={paint.radius}
                      onChange={(e) => setPaint((p) => ({ ...p, radius: Number(e.target.value) }))}
                      className="w-20 accent-mint"
                    />
                    <span className="tabular text-white/60">{paint.radius} mm</span>
                  </label>
                  <button type="button" onClick={() => void clearPaint()} className="rounded border border-line/70 px-1.5 py-0.5 text-white/45 transition hover:border-rose/50 hover:text-rose">
                    Markierungen löschen
                  </button>
                  <button type="button" onClick={() => setPaint((p) => ({ ...p, on: false }))} className="rounded border border-mint/40 bg-mint/10 px-1.5 py-0.5 text-mint">
                    Fertig (Esc)
                  </button>
                </div>
              )}

              {rotateMode && model && !measureOn && (
                <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-xl border border-amber/40 bg-ink-950/80 px-3 py-1.5 text-[10px] text-white/70 backdrop-blur-md">
                  <span className="text-amber">⟳ Drehen</span> · Ring ziehen · Weltachsen · frei drehen · Shift = 5°-Raster
                </div>
              )}

              {measureOn && (
                <div className="pointer-events-auto absolute bottom-14 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-amber/40 bg-ink-950/85 px-2.5 py-1.5 text-[10px] text-white/75 backdrop-blur-md">
                  <span className="text-amber">⌖ Messen</span>
                  {measure?.points === 2 ? (
                    <span className="tabular">
                      Abstand: <span className="text-amber">{measure.distance.toFixed(2)} mm</span>
                    </span>
                  ) : measure?.points === 1 ? (
                    <span>Erster Punkt gesetzt — zweiten Punkt anklicken (rastet an Kanten und Ecken ein).</span>
                  ) : (
                    <span>Zwei Punkte anklicken — Kanten, Ecken und Flächen rasten automatisch ein.</span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setMeasureOn(false)
                      setMeasure(null)
                    }}
                    className="text-white/40 hover:text-white"
                  >
                    Beenden
                  </button>
                </div>
              )}

              {previewInspect && result && !measureOn && (
                <div className="pointer-events-none absolute bottom-14 left-1/2 z-10 -translate-x-1/2 rounded-xl border border-sky/40 bg-ink-950/85 px-2.5 py-1.5 text-[10px] text-white/70 backdrop-blur-md">
                  <span className="text-sky">⌖ Segment prüfen</span> · Linie im Bild anklicken · Esc beendet die Auswahl
                </div>
              )}

              <input
                ref={objectFileRef}
                type="file"
                data-testid="object-file-input"
                accept=".stl,.3mf,.obj,.ply"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void onFile(file)
                  e.target.value = ''
                }}
              />

              <input
                ref={addFileRef}
                type="file"
                accept=".stl,.3mf,.obj,.ply"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (!file || !model) return
                  void (async () => {
                    try {
                      const res = await api.importObjects(
                        model.id,
                        await file.arrayBuffer(),
                        file.name,
                        activePlate,
                        printer.id,
                      )
                      await applyObjectEdit(res)
                      const restored = restoreDailySettings()
                      setImportInfo(
                        `„${file.name}“ als Objekt hinzugefügt — mit „Zusammenbauen“ verbinden.${meshRepairNote(res.importRepair)}${restored ? ' Kalibrier-Testwerte wurden durch Alltagswerte ersetzt.' : ''}`,
                      )
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Objekt konnte nicht hinzugefügt werden.')
                    }
                  })()
                }}
              />

              {menu && (
                <ObjectContextMenu
                  x={menu.x}
                  y={menu.y}
                  hasModel={Boolean(model)}
                  plates={plateCount}
                  onPick={handleMenu}
                  onShape={(shape) => void addShape(shape)}
                  onClose={() => setMenu(null)}
                />
              )}

              {tool === 'transform' && model && (
                <TransformDialog
                  modelId={model.id}
                  objects={model.objects}
                  initialId={selectedObjectId ?? undefined}
                  onEdit={applyObjectEdit}
                  onPreview={previewObjectEdit}
                  onClose={() => {
                    setTool(null)
                    setRotateMode(false)
                  }}
                />
              )}
              {tool === 'cut' && model && (
                <SplitDialog
                  modelId={model.id}
                  objects={model.objects}
                  bed={printer.bed}
                  preset={splitPreset ?? undefined}
                  onEdit={applyObjectEdit}
                  onGuideChange={setSplitGuide}
                  onRegisterMove={(move) => {
                    splitMoveRef.current = move
                  }}
                  onClose={() => {
                    setTool(null)
                    setSplitGuide(null)
                    setSplitPreset(null)
                    splitMoveRef.current = null
                  }}
                />
              )}
              {tool === 'assembly' && model && (
                <AssemblyAssistant
                  objects={model.objects}
                  bed={printer.bed}
                  tolerance={assemblyTolerance}
                  initialId={selectedObjectId ?? undefined}
                  onApply={(plan: AssemblyPlan) => {
                    setSplitPreset({
                      axis: plan.axis,
                      auto: false,
                      pieces: plan.pieces,
                      mode: plan.connector === 'none' ? plan.seam : plan.connector,
                      combine: false,
                      connectorClearance: plan.connectorClearance,
                      clearance: plan.clearance,
                      pinCount: plan.pinCount,
                      pinWidth: plan.pinWidth,
                      pinLength: plan.pinLength,
                      pinHeight: plan.pinHeight,
                      pinDepth: plan.pinDepth,
                      pinTaper: plan.pinTaper,
                      arrange: true,
                    })
                    setTool('cut')
                  }}
                  onClose={() => setTool(null)}
                />
              )}
              {tool === 'scanstart' && (
                <ScanStartDialog onLoad={adopt} onClose={() => setTool(null)} />
              )}
              {tool === 'scanimport' && (
                <ScanImportDialog onLoad={adopt} onClose={() => setTool(null)} />
              )}
              {tool === 'scan' && model && (
                <ScanAssistant
                  modelId={model.id}
                  objects={model.objects}
                  bed={printer.bed}
                  initialId={selectedObjectId ?? undefined}
                  onEdit={applyObjectEdit}
                  onClose={() => setTool(null)}
                />
              )}
              {tool === 'text' && model && (
                <TextDialog
                  modelId={model.id}
                  objects={model.objects}
                  initialId={selectedObjectId ?? undefined}
                  onEdit={applyObjectEdit}
                  onClose={() => setTool(null)}
                />
              )}
              {tool === 'litho' && (
                <LithophaneDialog onCreated={adoptLithophane} onClose={() => setTool(null)} />
              )}
              {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}

              <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
                <div className="flex flex-col gap-2">
                <div className="rounded-xl border border-line/60 bg-ink-950/60 px-2.5 py-1.5 backdrop-blur-md">
                  <div className="text-[9px] tracking-[0.18em] text-white/30 uppercase">{printer.brand}</div>
                  <div className="text-[11px] font-medium text-white/75">{printer.name}</div>
                  <div className="tabular text-[9px] text-white/30">
                    {printer.bed.x} × {printer.bed.y} × {printer.bed.z} mm
                  </div>
                  <div className="mt-0.5 text-[9px] text-white/30">
                    {filament.material} · {plate.name}
                  </div>
                  {plateCount > 1 && (
                    <div className="mt-0.5 text-[9px] text-amber/80">
                      {plateCount} Platten · geslict wird Platte {activePlate + 1}
                    </div>
                  )}
                </div>
                {model && (
                <div className="pointer-events-auto rounded-xl border border-amber/35 bg-ink-950/70 px-2.5 py-1.5 backdrop-blur-md">
                  <div className="text-[9px] tracking-[0.18em] text-amber/70 uppercase">Auswahl</div>
                  {selectedObject ? (
                    <>
                      <div className="max-w-[200px] truncate text-[11px] font-medium text-white/85">
                        {selectedObject.name}
                      </div>
                      {selectionInfo && (
                        <div className="tabular mt-0.5 text-[10px] text-white/60">
                          X <span className="text-amber">{selectionInfo.x.toFixed(1)}</span> · Y{' '}
                          <span className="text-amber">{selectionInfo.y.toFixed(1)}</span> · Z{' '}
                          <span className="text-amber">{selectionInfo.z.toFixed(1)}</span> mm
                        </div>
                      )}
                      <div className="text-[8px] text-white/30">
                        Bettmitte · Z = Unterkante · Platte {activePlate + 1}
                      </div>
                      {selectedObject.negative && (
                        <div className="mt-0.5 text-[9px] text-rose/80">eingelassen — wird ausgeschnitten</div>
                      )}
                      {rotateMode && rotateInfo && (
                        <div className="tabular mt-0.5 text-[10px] font-medium text-amber">
                          Drehung {rotateInfo.axis.toUpperCase()}: {rotateInfo.value.toFixed(0)}°
                        </div>
                      )}
                      <button
                        type="button"
                        data-testid="selection-transform"
                        onClick={() => {
                          setRotateMode(false)
                          setTool('transform')
                        }}
                        className="mt-1.5 w-full rounded-lg border border-amber/40 bg-amber/10 px-2 py-1 text-[9px] font-semibold text-amber transition hover:bg-amber/20"
                      >
                        Größe / Drehung ändern …
                      </button>
                    </>
                  ) : (
                    <div className="text-[9px] leading-snug text-white/35">
                      Objekt im Bild anklicken — dann erscheinen Name, Markierung und Koordinaten.
                    </div>
                  )}
                </div>
                )}
                {calibration && (
                  <CalibrationPlanPanel
                    tool={calibration}
                    result={result}
                    layer={layer}
                    settings={settings}
                    scvActive={isKlipperFlavor(printer.flavor)}
                    onLayer={(index) => {
                      setLayer(index)
                      setShowAll(false)
                    }}
                    onClose={() => setCalibration(null)}
                  />
                )}
                </div>
                <div className="pointer-events-auto flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => fitRef.current?.()}
                    className="rounded-lg border border-line/60 bg-ink-950/60 px-2 py-1 text-[10px] text-white/55 backdrop-blur-md transition hover:text-white"
                  >
                    Ansicht
                  </button>
                  <button
                    type="button"
                    onClick={(e) => setMenu({ x: e.clientX, y: e.clientY })}
                    className="rounded-lg border border-line/60 bg-ink-950/60 px-2 py-1 text-[10px] text-white/55 backdrop-blur-md transition hover:text-white"
                  >
                    Werkzeuge
                  </button>
                </div>
              </div>

              {result && (
                <FloatingPanel
                  storageKey="preview-legend"
                  className="absolute right-3 top-14 z-20 max-h-[calc(100%-4.5rem)] w-[min(260px,calc(100%-1.5rem))] overflow-y-auto overscroll-contain"
                >
                  <PreviewLegend
                    result={result}
                    layer={layer}
                    colorMode={previewColorMode}
                    onColorMode={setPreviewColorMode}
                    settings={settings}
                    filamentName={filament.name}
                    filamentPricePerKg={filament.pricePerKg}
                    plateName={plate.name}
                    hiddenFeatures={hiddenPreviewFeatures}
                    onToggleFeature={togglePreviewFeature}
                    onShowAllFeatures={() => setHiddenPreviewFeatures([])}
                    palette={previewPalette}
                    onPalette={setPreviewPalette}
                  />
                </FloatingPanel>
              )}
              {result && (
                <FloatingPanel
                  storageKey="preview-lab"
                  className="absolute bottom-20 left-3 z-20 max-h-[calc(100%-6rem)] w-[min(280px,calc(100%-1.5rem))] overflow-y-auto overscroll-contain"
                >
                  <PreviewLab
                    result={result}
                    settings={settings}
                    calibration={calibration}
                    layer={layer}
                    onLayer={(index) => {
                      setLayer(index)
                      setShowAll(false)
                    }}
                    compare={compareResult}
                    onCompare={() => setCompareResult(result)}
                    onClearCompare={() => setCompareResult(null)}
                    section={previewSection}
                    onSection={setPreviewSection}
                    pick={previewPick}
                    segment={previewSegment}
                    inspect={previewInspect}
                    onInspect={setPreviewInspectMode}
                    onClearPick={() => setPreviewPick(null)}
                    bed={printer.bed}
                    filterObjects={previewFilterObjects}
                    filterId={previewFilterId}
                    onFilter={setPreviewFilterId}
                    activePlate={activePlate}
                    sourceName={model ? `${model.name} · ${plate.name}` : undefined}
                    palette={previewPalette}
                    scvActive={isKlipperFlavor(printer.flavor)}
                    onJumpToGcode={openGcodeLine}
                  />
                </FloatingPanel>
              )}

              {result && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-end p-3">
                  <div className="rounded-xl border border-line/60 bg-ink-950/65 px-2.5 py-1.5 text-[10px] text-white/60 backdrop-blur-md">
                    Schicht <span className="tabular text-amber">{Math.min(layer + 1, result.layers.length)}</span> /{' '}
                    {result.layers.length}
                  </div>
                </div>
              )}

              {!model && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center p-4">
                  <div
                    data-testid="empty-state"
                    className="pointer-events-auto w-full max-w-md rounded-3xl border border-line/70 bg-ink-950/85 p-5 shadow-2xl backdrop-blur-md"
                  >
                    <div className="text-sm font-semibold text-white/85">Kein Modell geladen</div>
                    <p className="mt-1 text-[11px] leading-relaxed text-white/45">
                      In drei Schritten zum Ergebnis: Datei laden, Material und Bett prüfen, dann slicen. Deine aktuelle
                      Auswahl bleibt dabei erhalten.
                    </p>
                    <ol className="mt-3 grid gap-1.5 text-[10px] text-white/55">
                      <li className="flex gap-2">
                        <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-amber/20 text-[8px] font-bold text-amber">1</span>
                        Datei laden — STL, 3MF, OBJ oder PLY
                      </li>
                      <li className="flex gap-2">
                        <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-white/8 text-[8px] font-bold text-white/50">2</span>
                        Material, Platte und Bett prüfen
                      </li>
                      <li className="flex gap-2">
                        <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-white/8 text-[8px] font-bold text-white/50">3</span>
                        Slicen und Ergebnis speichern oder senden
                      </li>
                    </ol>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        data-testid="empty-load"
                        onClick={() => objectFileRef.current?.click()}
                        className="rounded-xl bg-gradient-to-r from-amber to-[#ff9f45] px-3 py-2 text-[11px] font-semibold text-ink-950 transition hover:brightness-110"
                      >
                        Datei laden …
                      </button>
                      <button
                        type="button"
                        data-testid="empty-demo"
                        onClick={() => void onDemo('wuerfel')}
                        className="rounded-xl border border-line/80 px-3 py-2 text-[11px] text-white/60 transition hover:border-mint/40 hover:text-mint"
                      >
                        Demo-Würfel
                      </button>
                      <button
                        type="button"
                        data-testid="empty-setup"
                        onClick={() => setSetupOpen(true)}
                        className="rounded-xl border border-line/80 px-3 py-2 text-[11px] text-white/60 transition hover:border-amber/40 hover:text-amber"
                      >
                        Material & Bett
                      </button>
                    </div>
                    <div className="mt-3 rounded-xl border border-line/60 bg-ink-900/50 px-2.5 py-1.5 text-[9px] text-white/35">
                      {filament.material} · {plate.name} · Bett {printer.bed.x}×{printer.bed.y} mm
                    </div>
                  </div>
                </div>
              )}

              {busy && (
                <div className="absolute inset-0 grid place-items-center bg-ink-950/55 backdrop-blur-sm">
                  <div className="flex items-center gap-2 rounded-xl border border-line/70 bg-ink-900/90 px-3 py-2 text-[11px] text-white/70">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-amber" />
                    {busy === 'slice'
                      ? 'Schichten werden berechnet …'
                      : busy === 'calibration'
                        ? 'Kalibrier-Modell wird erzeugt …'
                        : 'Modell wird geladen …'}
                  </div>
                </div>
              )}
              </div>
            </div>

          </main>

        </>
      )}

      {view === 'multiprint' && (
        <MultiPrintView
          catalog={catalog}
          printers={workspacePrinters}
          statuses={printerStatuses}
          filaments={filaments}
        />
      )}

      {view === 'calibration' && (
        <CalibrationView
          catalog={catalog}
          setup={setup}
          settings={settings}
          busy={busy === 'calibration'}
          activeProfileName={filament.name}
          activeProfileEditable={Boolean(activeUserFilament)}
          versionNameSuggestion={calibrationVersionName}
          onGenerate={(id, options) => void generateCalibration(id, options)}
          onFlowChange={(flow) => updateSettings({ ...settings, flow })}
          onApplyPressureAdvance={(value) =>
            updateSettings(
              mergeSettings(settings, {
                pressureAdvance: { enabled: true, value },
                // Ein übernommener Wert beendet den Linientest; sonst würde die
                // PA-Rampe den gerade eingetragenen Wert beim Slicen überschreiben.
                pressureAdvanceRamp: { enabled: false },
              }),
            )
          }
          onApplyInputShaper={(freqX, freqY) =>
            updateSettings(
              mergeSettings(settings, { inputShaper: { enabled: true, freqX, freqY } }),
            )
          }
          onSaveCalibration={saveCalibrationProfile}
          onApplySettings={(next) => updateSettings(next)}
        />
      )}

      {view === 'gcode' && (
        <GcodeView
          bed={printer.bed}
          printerName={printer.name}
          origin={printer.coordOrigin ?? 'corner'}
          initialRequest={gcodeJump}
          onInitialConsumed={() => setGcodeJump(null)}
        />
      )}

      {view === 'printer' && (
        <PrinterView
          status={status}
          mesh={mesh}
          log={log}
          profile={printer}
          setup={setup}
          catalog={catalog}
          settings={settings}
          devices={devices}
          deviceHint={deviceHint}
          gcode={result?.gcode ?? null}
          jobName={effectiveJobName}
          modelId={model?.id ?? null}
          modelSize={model ? { x: model.analysis.bbox.size.x, y: model.analysis.bbox.size.y } : null}
          onSettings={updateSettings}
          onError={setError}
          onScan={() => void scan()}
          onClearMesh={() => {
            void api
              .clearPrinterMesh(printer.id)
              .then(() => setMesh(null))
              .catch((e) => setError(e instanceof Error ? e.message : 'Mesh konnte nicht gelöscht werden.'))
          }}
          probeProgress={probeProgress}
          printers={workspacePrinters}
          onSwitchPrinter={switchPrinter}
          onAddPrinter={() => setSetupOpen(true)}
          limits={printerLimits}
          profileCount={Object.keys(loadSnapshots()).length}
          onExportAllProfiles={exportAllPrinterProfiles}
          onImportAllProfiles={(f) => void importAllPrinterProfiles(f)}
        />
      )}

      {FEATURES.webUi && view === 'webui' && !webUi && (
        <div className="grid min-h-0 flex-1 place-items-center p-6">
          <div className="max-w-md rounded-2xl border border-line/70 bg-ink-900/70 p-5 text-center">
            <div className="text-xs font-semibold tracking-[0.14em] text-white/80 uppercase">Web-UI als Tab</div>
            <p className="mt-2 text-[11px] leading-relaxed text-white/45">
              Mainsail, Fluidd oder OctoPrint bleiben in einem eigenen Tab geöffnet. Beim Wechsel in Studio,
              G-Code oder Drucker wird die Oberfläche nicht neu geladen.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => setWebOpen(true)}
                className="rounded-xl bg-gradient-to-r from-mint to-[#8ef0c8] px-3 py-2 text-[11px] font-semibold text-ink-950 transition hover:brightness-110"
              >
                Drucker verbinden
              </button>
              <button
                type="button"
                onClick={() => void openWebUi()}
                className="rounded-xl border border-line/80 px-3 py-2 text-[11px] text-white/60 transition hover:text-white"
              >
                Gespeicherte Oberfläche laden
              </button>
            </div>
          </div>
        </div>
      )}

      {FEATURES.webUi && webUi && (
        <div className={view === 'webui' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
          <WebUiPanel
            info={webUi}
            status={status}
            embedded
            onPause={() => void jobAction('pause')}
            onResume={() => void jobAction('resume')}
            onCancel={() => void jobAction('cancel')}
            onClose={() => {
              setWebUi(null)
              setView('printer')
            }}
          />
        </div>
      )}

      {filamentDiff && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-ink-950/70 p-4 backdrop-blur-sm">
          <div className="ui-max-h-80 flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line/70 bg-ink-900 shadow-2xl">
            <div className="flex items-start justify-between gap-2 border-b border-line/60 px-4 py-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-white/85">Filamentprofil anwenden?</div>
                <div className="truncate text-[10px] text-white/45">„{filamentDiff.name}“ · eigene Filamentwerte</div>
              </div>
              <button
                type="button"
                onClick={() => setFilamentDiff(null)}
                className="shrink-0 text-white/30 hover:text-white/70"
                aria-label="Profil-Diff schließen"
              >
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
              <p className="mb-2 text-[10px] leading-snug text-white/50">
                Diese Werte werden aus dem Profil übernommen. Qualität, Struktur und Geschwindigkeit bleiben aus dem
                laufenden Projekt erhalten.
              </p>
              {filamentDiff.rows.length ? (
                <div className="overflow-hidden rounded-xl border border-line/60">
                  <table className="w-full border-collapse text-left text-[10px]">
                    <thead className="bg-white/[0.04] text-[9px] tracking-wide text-white/35 uppercase">
                      <tr>
                        <th className="px-3 py-1.5 font-medium">Wert</th>
                        <th className="px-3 py-1.5 font-medium">Bisher</th>
                        <th className="px-3 py-1.5 font-medium">Neu</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filamentDiff.rows.map((row) => (
                        <tr key={row.label} className="border-t border-line/40">
                          <td className="px-3 py-1.5 text-white/60">{row.label}</td>
                          <td className="px-3 py-1.5 font-mono text-white/40">{row.before}</td>
                          <td className="px-3 py-1.5 font-mono text-amber">{row.after}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="rounded-xl border border-line/60 bg-white/[0.03] px-3 py-2 text-[10px] text-white/50">
                  Keine Werte ändern sich — das Profil entspricht dem aktuellen Stand.
                </p>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-line/60 px-4 py-2.5">
              <span className="text-[9px] text-white/30">
                {filamentDiff.rows.length} Wert{filamentDiff.rows.length === 1 ? '' : 'e'} geändert
              </span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setFilamentDiff(null)}
                  className="rounded-lg border border-line/80 px-2.5 py-1.5 text-[10px] text-white/60 transition hover:text-white"
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  onClick={confirmFilamentDiff}
                  className="rounded-lg border border-amber/50 bg-amber/15 px-2.5 py-1.5 text-[10px] font-semibold text-amber transition hover:bg-amber/25"
                >
                  Anwenden
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <PrinterSettingsDialog
        open={printerSettingsOpen}
        onClose={() => setPrinterSettingsOpen(false)}
        printer={printer}
        factoryPrinter={printerBase}
        printerOverrides={setup.printerOverrides}
        onPrinterOverrides={updatePrinterOverrides}
        setup={setup}
        limits={printerLimits}
        factoryLimits={effectivePrinterLimits(printer)}
        onLimits={updatePrinterLimits}
        customGcode={setup.customGcode}
        onCustomGcode={updateCustomGcode}
        onFlavor={updateGcodeFlavor}
        settings={settings}
        onSettings={updateSettings}
        postProcessing={setup.postProcessing ?? EMPTY_POST_PROCESSING}
        onPostProcessing={updatePostProcessing}
        slots={slots}
        profiles={filaments.map((f) => ({ id: f.id, name: f.name }))}
        nozzleMaterial={setup.nozzleMaterial}
        onNozzleMaterial={updateNozzleMaterial}
        onNozzle={(nozzle) => updateSettings({ ...settings, nozzle })}
        onSetup={() => setSetupOpen(true)}
        profileCount={Object.keys(loadSnapshots()).length}
        onExportAllProfiles={exportAllPrinterProfiles}
        onImportAllProfiles={(f) => void importAllPrinterProfiles(f)}
      />

      {logsOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink-950/70 p-4 backdrop-blur-sm">
          <div className="ui-max-h-80 flex w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line/70 bg-ink-900 shadow-2xl">
            <div className="flex items-center justify-between gap-2 border-b border-line/60 px-4 py-2.5">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-white/80">Protokoll</div>
                <div className="truncate text-[9px] text-white/35">{logsPath ?? 'keine Logdatei'}</div>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  onClick={() => void openLogs()}
                  className="rounded-lg border border-line/80 px-2 py-1 text-[10px] text-white/55 transition hover:text-white"
                >
                  Aktualisieren
                </button>
                <button
                  type="button"
                  onClick={() => setLogsOpen(false)}
                  className="rounded-lg border border-line/80 px-2 py-1 text-[10px] text-white/55 transition hover:text-white"
                >
                  Schließen
                </button>
              </div>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-white/55">
              {logsText || 'Keine Einträge.'}
            </pre>
          </div>
        </div>
      )}

      {FEATURES.webUi && (
        <WebConnectDialog
          open={webOpen}
          printer={printer}
          status={status}
          onClose={() => setWebOpen(false)}
          onConnected={(info) => {
            setWebOpen(false)
            if (info) {
              setWebUi(info)
              setView('webui')
            } else {
              setView('printer')
              setImportInfo('Verbunden — keine Mainsail/Fluidd-Oberfläche auf diesem Host gefunden.')
            }
          }}
        />
      )}

      <SetupDialog
        open={setupOpen}
        catalog={catalog}
        filaments={filaments}
        onDeleteFilament={removeMyFilament}
        setup={setup}
        settings={settings}
        devices={devices}
        onClose={() => setSetupOpen(false)}
        onApply={applySetup}
        onScan={() => void scan()}
        onReload={() => void reloadCatalog()}
        onUseDevice={(d) => {
          setDeviceHint(d.path)
          setSetupOpen(false)
          setView('printer')
        }}
      />

      {panesOpen && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-ink-950">
          <div className="flex shrink-0 items-center gap-3 border-b border-line/60 px-3 py-2">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-white/85">Zwei Studios nebeneinander</div>
              <div className="text-[9px] text-white/35">
                Jede Seite hat ihr eigenes Objekt und Ergebnis · Einstellungen über „Objekt & Einstellungen“
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPanesOpen(false)}
              className="ml-auto shrink-0 rounded-lg border border-line/80 px-2.5 py-1.5 text-[10px] text-white/60 transition hover:border-white/25 hover:text-white"
            >
              Ein Studio
            </button>
          </div>
          {workspacePrinters.length >= 2 ? (
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden p-2 md:grid-cols-2">
              {workspacePrinters.slice(0, 2).map((pane) => (
                <div
                  key={pane.id}
                  className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line/70 bg-ink-900"
                >
                  <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line/50 px-2.5 py-1.5">
                    <span className="truncate text-[10px] font-semibold text-white/75">{pane.name}</span>
                    <span className="shrink-0 rounded bg-white/8 px-1 py-0.5 text-[8px] font-bold tracking-wide text-white/40 uppercase">
                      Studio {pane.studio}
                    </span>
                  </div>
                  <iframe
                    title={`Studio ${pane.studio}: ${pane.name}`}
                    src={`/?embedded=1&studio=${encodeURIComponent(pane.id)}`}
                    className="min-h-0 w-full flex-1 border-0 bg-ink-950"
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid flex-1 place-items-center p-4">
              <div className="max-w-md rounded-2xl border border-line/70 bg-ink-900/70 p-5 text-center">
                <div className="text-xs font-semibold text-white/80">Zwei Panes brauchen zwei Drucker</div>
                <p className="mt-2 text-[11px] leading-relaxed text-white/45">
                  Im Arbeitsplatz ist momentan nur ein Drucker hinterlegt. Füge den zweiten Drucker hinzu,
                  dann kann jedes Studio sein eigenes Objekt halten.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setPanesOpen(false)
                    setSetupOpen(true)
                  }}
                  className="mt-4 rounded-xl bg-gradient-to-r from-mint to-[#8ef0c8] px-3 py-2 text-[11px] font-semibold text-ink-950"
                >
                  Drucker hinzufügen
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
        {toolNotice && (
          <div className="pointer-events-auto flex max-w-lg items-start gap-3 rounded-xl border border-mint/40 bg-ink-900/95 px-3 py-2 shadow-2xl backdrop-blur">
            <span className="mt-0.5 text-mint">✓</span>
            <p className="text-[11px] leading-relaxed text-white/80">{toolNotice}</p>
            <button type="button" onClick={() => setToolNotice(null)} className="ml-2 text-white/30 hover:text-white">
              ✕
            </button>
          </div>
        )}
        {error && (
          <div
            data-testid="error-toast"
            role="alert"
            className="pointer-events-auto flex max-w-xl items-start gap-3 rounded-xl border border-rose/40 bg-ink-900/95 px-3 py-2 shadow-2xl backdrop-blur"
          >
            <span className="mt-0.5 text-rose">!</span>
            <div className="min-w-0 flex-1">
              <div className="text-[9px] font-semibold tracking-[0.12em] text-rose/80 uppercase">
                Aktion nicht abgeschlossen
              </div>
              <p className="mt-0.5 text-[11px] leading-relaxed text-white/75">{error}</p>
              {errorResolution && (
                <p className="mt-1 text-[9px] leading-snug text-white/40">{errorResolution.hint}</p>
              )}
            </div>
            {errorResolution && (
              <button
                type="button"
                onClick={() => {
                  setError(null)
                  errorResolution.run()
                }}
                className="shrink-0 rounded-lg border border-rose/40 bg-rose/10 px-2.5 py-1.5 text-[10px] font-semibold text-rose/90 transition hover:bg-rose/20"
              >
                {errorResolution.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => setError(null)}
              className="ml-0.5 text-white/30 hover:text-white"
              aria-label="Meldung schließen"
            >
              ✕
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
