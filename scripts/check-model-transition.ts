import assert from 'node:assert/strict'
import { DEFAULT_SETTINGS, mergeSettings, type DeepPartial, type PrintSettings } from '../shared/types.ts'
import { printerById } from '../shared/catalog.ts'
import { adaptImportedObjectSettings, adaptImportedSettings } from '../shared/limits.ts'
import {
  applyCalibrationTestReset,
  calibrationTestStateForNextTest,
  markMeasuredCalibrationValues,
  normalSettingsForTest,
  normalizeCalibrationTestState,
} from '../src/calibrationSettings.ts'
import {
  clearCalibrationTestState,
  readCalibrationTestState,
  writeCalibrationTestState,
  type CalibrationStorage,
} from '../src/calibrationState.ts'
import { applyModelSettingsTakeover } from '../src/modelTransition.ts'

/**
 * Prüft die Pfade, die App.tsx für adopt(), „Hinzufügen“, Formen, Lithophan
 * und den 3MF-Import verwendet. Die Modellwechsel selbst bleiben im UI, die
 * Settings-Übernahme und der Drucker-Marker sind hier direkt ausführbar.
 */

const profileA = mergeSettings(DEFAULT_SETTINGS, {
  layerHeight: 0.2,
  firstLayerHeight: 0.2,
  walls: 3,
  topLayers: 4,
  bottomLayers: 3,
  infillDensity: 20,
  temps: { nozzle: 215, firstLayerNozzle: 215, bed: 60, firstLayerBed: 60 },
  speeds: { print: 80, outerWall: 40, innerWall: 60, solid: 70, bridge: 35 },
  retraction: { distance: 0.9, speed: 35, minTravel: 1.2 },
})

const profileB = mergeSettings(profileA, {
  layerHeight: 0.28,
  firstLayerHeight: 0.28,
  walls: 2,
  topLayers: 2,
  bottomLayers: 2,
  infillDensity: 12,
  temps: { nozzle: 220, firstLayerNozzle: 220 },
  speeds: { print: 150, outerWall: 90, innerWall: 120, solid: 130, bridge: 50 },
  retraction: { distance: 0.7, speed: 40, minTravel: 1.5 },
})

const firstLayerPatch = {
  layerHeight: 0.3,
  firstLayerHeight: 0.3,
  walls: 1,
  topLayers: 0,
  bottomLayers: 0,
  infillDensity: 0,
  temps: { nozzle: 225 },
  speeds: { print: 30 },
} as DeepPartial<PrintSettings>

const firstState = calibrationTestStateForNextTest(
  profileA,
  firstLayerPatch,
  'quality-a',
  profileA,
)
assert.equal(firstState.qualityPresetId, 'quality-a')
assert.equal(firstState.normalStructure.layerHeight, 0.2, 'Baseline wird nicht aus dem Teststand abgeleitet')
assert.equal(firstState.normalStructure.walls, 3)
assert.deepEqual(firstState.measuredPaths, [])
assert.equal(firstState.normalSettings.layerHeight, 0.2, 'Normal-Snapshot ist nicht unveränderlich')

const afterFirstLayer = mergeSettings(profileA, firstLayerPatch)
const switchedProfileBase = normalSettingsForTest(afterFirstLayer, profileB, firstState)
assert.equal(switchedProfileBase.layerHeight, profileB.layerHeight, 'Profilwechsel nach First-Layer-Test fehlt')
assert.equal(switchedProfileBase.walls, profileB.walls)
assert.equal(switchedProfileBase.speeds.print, profileB.speeds.print)
assert.equal(switchedProfileBase.temps.nozzle, profileB.temps.nozzle)

const resetFirstLayer = applyCalibrationTestReset(afterFirstLayer, firstState)
assert.equal(resetFirstLayer.layerHeight, profileA.layerHeight)
assert.equal(resetFirstLayer.walls, profileA.walls)
assert.equal(resetFirstLayer.topLayers, profileA.topLayers)
assert.equal(resetFirstLayer.infillDensity, profileA.infillDensity)
assert.equal(resetFirstLayer.temps.nozzle, profileA.temps.nozzle)

const vfaPatch = {
  speeds: { print: 80 },
  retraction: { distance: 0.8 },
  temps: { nozzle: 225 },
} as DeepPartial<PrintSettings>
const vfaState = calibrationTestStateForNextTest(profileA, vfaPatch, 'quality-a', profileA)
const afterVfa = mergeSettings(profileA, vfaPatch)

// Unveränderte Test-Startwerte dürfen nicht am Alltagsmodell hängen bleiben.
const resetVfa = applyCalibrationTestReset(afterVfa, vfaState)
assert.equal(resetVfa.speeds.print, profileA.speeds.print)
assert.equal(resetVfa.retraction.distance, profileA.retraction.distance)
assert.equal(resetVfa.temps.nozzle, profileA.temps.nozzle)

// Ein bewusst eingetragener Messwert wird markiert und bleibt erhalten.
const editedAfterVfa = mergeSettings(afterVfa, {
  speeds: { print: 95 },
  retraction: { distance: 1.1 },
  temps: { nozzle: 228 },
})
const markedVfa = markMeasuredCalibrationValues(vfaState, afterVfa, editedAfterVfa)
assert.ok(markedVfa.measuredPaths.includes('speeds.print'))
assert.ok(markedVfa.measuredPaths.includes('retraction.distance'))
assert.ok(markedVfa.measuredPaths.includes('temps.nozzle'))
const resetMeasured = applyCalibrationTestReset(editedAfterVfa, markedVfa)
assert.equal(resetMeasured.speeds.print, 95)
assert.equal(resetMeasured.retraction.distance, 1.1)
assert.equal(resetMeasured.temps.nozzle, 228)

// Dieselbe Übernahme wie adopt(), „Hinzufügen“, Formen und Lithophan.
const adoptResult = applyModelSettingsTakeover({
  current: afterVfa,
  testState: vfaState,
  normalize: (settings) => settings,
})
assert.equal(adoptResult.resetTestStructure, true)
assert.equal(adoptResult.qualityPresetId, 'quality-a')
assert.equal(adoptResult.settings.speeds.print, profileA.speeds.print)
assert.equal(adoptResult.settings.retraction.distance, profileA.retraction.distance)
assert.equal(adoptResult.settings.temps.nozzle, profileA.temps.nozzle)

const addedObjectResult = applyModelSettingsTakeover({
  current: editedAfterVfa,
  testState: markedVfa,
  normalize: (settings) => settings,
})
assert.equal(addedObjectResult.settings.speeds.print, 95, 'Hinzufügen verliert Messwert')
assert.equal(addedObjectResult.settings.retraction.distance, 1.1)
assert.equal(addedObjectResult.settings.temps.nozzle, 228)

// 3MF-Import nach einem Test: importierte Werte gewinnen, Test-Startwerte
// werden vorher zurückgesetzt, interne Testschalter bleiben aus.
const imported3mf = {
  layerHeight: 0.16,
  walls: 4,
  speeds: { print: 120 },
  temps: { nozzle: 230 },
  pressureAdvanceRamp: { enabled: true },
  special: { vase: true },
} as DeepPartial<PrintSettings>
const importResult = applyModelSettingsTakeover({
  current: afterVfa,
  imported: imported3mf,
  testState: vfaState,
  normalize: (settings) => settings,
})
assert.equal(importResult.settings.layerHeight, 0.16)
assert.equal(importResult.settings.walls, 4)
assert.equal(importResult.settings.speeds.print, 120)
assert.equal(importResult.settings.temps.nozzle, 230)
assert.equal(importResult.settings.pressureAdvanceRamp.enabled, false)
assert.equal(importResult.settings.special?.openShell, false)

// Fremdes 3MF für einen anderen Drucker: Düsen-/Linienbreiten und der
// Volumenstrom werden auf die aktive Maschine und das aktive Filament
// umgerechnet; harte Grenzen bleiben erhalten.
const importedForVyper = mergeSettings(DEFAULT_SETTINGS, {
  nozzle: 0.6,
  lineWidth: 0.6,
  firstLayerLineWidth: 0.7,
  outerWallLineWidth: 0.6,
  innerWallLineWidth: 0.6,
  topSurfaceLineWidth: 0.6,
  maxVolumetricFlow: 28,
  speeds: { print: 250, outerWall: 230, innerWall: 300, travel: 500 },
})
const vyper = printerById('anycubic-vyper')
const adaptedImport = adaptImportedSettings(vyper, importedForVyper, {
  activeNozzle: 0.4,
  sourceNozzle: 0.6,
  lineWidthKeys: [
    'lineWidth',
    'firstLayerLineWidth',
    'outerWallLineWidth',
    'innerWallLineWidth',
    'topSurfaceLineWidth',
  ],
  maxVolumetricFlow: 12,
})
assert.equal(adaptedImport.settings.nozzle, 0.4, '3MF-Düse darf die aktive Düse nicht ersetzen')
assert.equal(adaptedImport.settings.lineWidth, 0.4)
assert.ok(Math.abs(adaptedImport.settings.firstLayerLineWidth - 0.467) < 0.001)
assert.equal(adaptedImport.settings.maxVolumetricFlow, 12)
assert.ok(adaptedImport.settings.speeds.print <= vyper.maxPrintSpeed)
assert.ok(adaptedImport.settings.speeds.travel <= vyper.maxTravel)
assert.ok(adaptedImport.notes.some((note) => note.includes('Düse 0,6 → 0,4 mm')))
assert.ok(adaptedImport.notes.some((note) => note.includes('Volumenstrom 28 → 12')))

const adaptedObject = adaptImportedObjectSettings(
  {
    nozzle: 0.6,
    lineWidth: 0.6,
    outerWallLineWidth: 0.6,
    maxVolumetricFlow: 28,
    walls: 0,
  },
  { activeNozzle: 0.4, sourceNozzle: 0.6, maxVolumetricFlow: 12 },
)
assert.equal(adaptedObject.nozzle, 0.4)
assert.equal(adaptedObject.lineWidth, 0.4)
assert.equal(adaptedObject.outerWallLineWidth, 0.4)
assert.equal(adaptedObject.maxVolumetricFlow, 12)
assert.equal(adaptedObject.walls, 0, 'Objektwerte ohne Düsenbezug bleiben unverändert')

const samePrinterImport = adaptImportedSettings(vyper, mergeSettings(DEFAULT_SETTINGS, { nozzle: 0.4 }), {
  activeNozzle: 0.4,
  sourceNozzle: 0.4,
  maxVolumetricFlow: DEFAULT_SETTINGS.maxVolumetricFlow,
})
assert.equal(samePrinterImport.settings.nozzle, 0.4)
assert.equal(samePrinterImport.notes.length, 0, 'Passende Düse erzeugt keinen Anpassungshinweis')

// Marker bleiben pro Drucker getrennt; ein Modellwechsel löscht nur den
// Zustand seines eigenen Druckers.
const memory = new Map<string, string>()
const storage: CalibrationStorage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => {
    memory.set(key, value)
  },
}
const secondState = calibrationTestStateForNextTest(profileB, firstLayerPatch, 'quality-b', profileB)
writeCalibrationTestState('vyper', vfaState, storage)
writeCalibrationTestState('adventurer', secondState, storage)
assert.equal(readCalibrationTestState('vyper', storage)?.qualityPresetId, 'quality-a')
assert.equal(readCalibrationTestState('adventurer', storage)?.qualityPresetId, 'quality-b')
clearCalibrationTestState('vyper', storage)
assert.equal(readCalibrationTestState('vyper', storage), null)
assert.equal(
  readCalibrationTestState('adventurer', storage)?.qualityPresetId,
  'quality-b',
  'Druckerwechsel verliert den anderen Marker',
)

// Ein alter Zustand ohne die neuen Felder bleibt lesbar.
const legacy = {
  normalSettings: profileA,
  testPatches: [vfaPatch],
}
memory.clear()
storage.setItem('kepler.calibration-tests.v1', JSON.stringify({ vyper: legacy }))
const migrated = readCalibrationTestState('vyper', storage)
assert.ok(migrated)
assert.equal(migrated.qualityPresetId, 'normal')
assert.equal(migrated.normalStructure.layerHeight, profileA.layerHeight)
assert.deepEqual(migrated.measuredPaths, [])
assert.equal(
  normalizeCalibrationTestState(legacy, 'quality-from-printer-snapshot')?.qualityPresetId,
  'quality-from-printer-snapshot',
  'Altes Profil wird nicht aus dem Drucker-Setup migriert',
)

console.log('OK: Modellwechsel und Kalibrierzustand geprüft')
console.log('  adopt/Form/Lithophan/3MF nutzen applyModelSettingsTakeover')
console.log('  First-Layer-Test + Profilwechsel startet mit dem neuen Profil')
console.log('  Test-Startwerte werden zurückgesetzt, markierte Messwerte bleiben')
console.log('  3MF-Einstellungen werden auf aktive Düse und Druckergrenzen angepasst')
console.log('  Marker sind pro Drucker getrennt und alte Zustände werden migriert')
