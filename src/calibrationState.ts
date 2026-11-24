import {
  normalizeCalibrationTestState,
  type CalibrationTestState,
} from './calibrationSettings.ts'
import { loadSnapshot, saveSnapshot } from './printers.ts'
import { readLocal, writeLocal } from './persist.ts'

/**
 * Der Kalibriertest-Marker liegt bewusst nicht im App-Component. Er wird pro
 * Drucker gespeichert und zusätzlich in den Drucker-Snapshot geschrieben.
 * Ein Modellwechsel löscht nur den Zustand seines eigenen Druckers.
 */
export const CALIBRATION_TEST_STORE_KEY = 'kepler.calibration-tests.v1'

export type CalibrationStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function browserStorage(): CalibrationStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function parseStore(storage: CalibrationStorage | null): Record<string, CalibrationTestState> {
  if (!storage) return {}
  try {
    const raw = storage.getItem(CALIBRATION_TEST_STORE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const store: Record<string, CalibrationTestState> = {}
    for (const [printerId, value] of Object.entries(parsed)) {
      // Alte Zustände hatten noch keine qualityPresetId. Das gespeicherte
      // Drucker-Setup nennt das zuletzt gewählte Profil; daraus migrieren,
      // nicht aus settings.layerHeight raten.
      const normalized = normalizeCalibrationTestState(
        value,
        snapshotFor(printerId)?.setup.qualityPresetId,
      )
      if (normalized) store[printerId] = normalized
    }
    return store
  } catch {
    return {}
  }
}

function persistStore(store: Record<string, CalibrationTestState>, storage: CalibrationStorage | null): void {
  if (!storage) return
  try {
    storage.setItem(CALIBRATION_TEST_STORE_KEY, JSON.stringify(store))
  } catch {
    /* Speicher voll oder blockiert — der Snapshot bleibt */
  }
}

function snapshotFor(printerId: string) {
  const snapshot = loadSnapshot(printerId)
  return snapshot
}

function syncSnapshot(printerId: string, state: CalibrationTestState | null): void {
  const snapshot = snapshotFor(printerId)
  if (!snapshot) return
  saveSnapshot(
    {
      ...snapshot,
      calibrationTest: state,
      testStructureActive: state !== null,
    },
    printerId,
  )
}

/** Liest alle Marker; optional mit einem eigenen Speicher für Tests. */
export function loadCalibrationTestStore(
  storage: CalibrationStorage | null = browserStorage(),
): Record<string, CalibrationTestState> {
  return parseStore(storage)
}

/** Liest den Marker eines Druckers, notfalls aus dessen PrinterSnapshot. */
export function readCalibrationTestState(
  printerId: string,
  storage: CalibrationStorage | null = browserStorage(),
): CalibrationTestState | null {
  const fromStore = loadCalibrationTestStore(storage)[printerId]
  if (fromStore) {
    // Alte Builds kannten den Marker nur im Profilspeicher. Beim ersten Lesen
    // in den Drucker-Snapshot übernehmen, damit ein Druckerwechsel ihn sicher
    // mitführt und nicht vom globalen localStorage abhängig bleibt.
    const snapshot = snapshotFor(printerId)
    const snapshotState = normalizeCalibrationTestState(snapshot?.calibrationTest)
    if (
      !snapshot?.testStructureActive ||
      !snapshotState ||
      snapshotState.qualityPresetId !== fromStore.qualityPresetId
    ) {
      syncSnapshot(printerId, fromStore)
    }
    return fromStore
  }
  const fromSnapshot = normalizeCalibrationTestState(snapshotFor(printerId)?.calibrationTest)
  return fromSnapshot
}

/** Schreibt den Marker eines Druckers und hält den Snapshot synchron. */
export function writeCalibrationTestState(
  printerId: string,
  state: CalibrationTestState,
  storage: CalibrationStorage | null = browserStorage(),
): void {
  const store = loadCalibrationTestStore(storage)
  store[printerId] = state
  if (storage && storage === browserStorage()) writeLocal(CALIBRATION_TEST_STORE_KEY, JSON.stringify(store))
  else persistStore(store, storage)
  syncSnapshot(printerId, state)
}

/** Löscht ausschließlich den Marker dieses Druckers. */
export function clearCalibrationTestState(
  printerId: string,
  storage: CalibrationStorage | null = browserStorage(),
): void {
  const store = loadCalibrationTestStore(storage)
  if (!(printerId in store)) return
  delete store[printerId]
  if (storage && storage === browserStorage()) writeLocal(CALIBRATION_TEST_STORE_KEY, JSON.stringify(store))
  else persistStore(store, storage)
  syncSnapshot(printerId, null)
}

/** Nur für Migrationen und Diagnose: beide Persistenzorte getrennt lesen. */
export function readCalibrationTestStateFromSnapshot(printerId: string): CalibrationTestState | null {
  return normalizeCalibrationTestState(snapshotFor(printerId)?.calibrationTest)
}

export function readRawCalibrationTestStore(storage: CalibrationStorage | null = browserStorage()): string | null {
  if (!storage) return null
  try {
    return storage.getItem(CALIBRATION_TEST_STORE_KEY)
  } catch {
    return null
  }
}

export function readRawCalibrationTestStoreLocal(): string | null {
  return readLocal(CALIBRATION_TEST_STORE_KEY)
}
