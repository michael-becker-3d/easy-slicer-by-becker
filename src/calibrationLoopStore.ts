import type { CalibrationVersion } from '../shared/calibrationLoop.ts'

/**
 * Ablage der Kalibrier-Versionen (V-18). Bewusst klein und lokal, wie die
 * übrigen Studio-Stände: eine beschädigte Liste darf das Kalibrieren nicht
 * blockieren.
 */
export const CALIBRATION_VERSION_KEY = 'easy-slicer.calibration-versions.v1'

const MAX_VERSIONS = 40

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function isVersion(value: unknown): value is CalibrationVersion {
  if (!value || typeof value !== 'object') return false
  const version = value as Partial<CalibrationVersion>
  return (
    typeof version.id === 'string' &&
    typeof version.at === 'number' &&
    typeof version.printerId === 'string' &&
    Boolean(version.before) &&
    Boolean(version.after)
  )
}

export function loadCalibrationVersions(): CalibrationVersion[] {
  const store = storage()
  if (!store) return []
  try {
    const parsed = JSON.parse(store.getItem(CALIBRATION_VERSION_KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter(isVersion) : []
  } catch {
    return []
  }
}

export function saveCalibrationVersion(version: CalibrationVersion): CalibrationVersion[] {
  const list = [version, ...loadCalibrationVersions().filter((entry) => entry.id !== version.id)].slice(0, MAX_VERSIONS)
  const store = storage()
  if (store) {
    try {
      store.setItem(CALIBRATION_VERSION_KEY, JSON.stringify(list))
    } catch {
      // Voller oder gesperrter Speicher: die laufende Sitzung behält die Liste.
    }
  }
  return list
}

export function clearCalibrationVersions(printerId?: string): CalibrationVersion[] {
  const list = printerId ? loadCalibrationVersions().filter((entry) => entry.printerId !== printerId) : []
  const store = storage()
  if (store) {
    try {
      store.setItem(CALIBRATION_VERSION_KEY, JSON.stringify(list))
    } catch {
      // Siehe oben.
    }
  }
  return list
}
