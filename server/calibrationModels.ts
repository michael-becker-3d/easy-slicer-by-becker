import { loadAsset } from './assets.ts'

/**
 * Die sieben Kalibrier-Modelle liegen als STL unter `assets/calibration-models`.
 * In der EXE stecken sie als SEA-Assets; im Entwicklungsbetrieb werden sie
 * direkt aus dem Projekt gelesen. Die Werte-Bereiche sind fest an die
 * Modellgeometrie gebunden: Jedes Modell hat eine feste Zahl sichtbarer
 * Stufen, nur Von/Bis/Schritt der Werte sind einstellbar.
 */
export type CalibrationModel = {
  /** Dateiname unter `assets/calibration-models` */
  file: string
  /** Maße aus dem STL (mm) — nur zur Anzeige und Prüfung */
  size: { x: number; y: number; z: number }
  /** Z-Höhe einer Stufe in mm; fehlt bei Modellen ohne Werte-Sweep. */
  bandHeight?: number
  /** Erste Stufe beginnt bei dieser Z-Höhe (Standard 0). */
  bandStartZ?: number
  /** Zahl der festen Stufen im Modell. */
  bands?: number
  /** Deutscher Name des Modells für die Oberfläche. */
  modelName: string
}

export const CALIBRATION_MODELS: Record<string, CalibrationModel> = {
  'temp-tower': {
    file: 'thermal-cell.stl',
    modelName: 'Thermal-Cell',
    size: { x: 28, y: 20.78, z: 48 },
    bandHeight: 8,
    bands: 6,
  },
  'max-flow': {
    file: 'max-flow-core.stl',
    modelName: 'Max-Flow-Core',
    size: { x: 40.08, y: 40.08, z: 35 },
    bandHeight: 5,
    bands: 7,
  },
  'pressure-advance': {
    file: 'pa-blade.stl',
    modelName: 'PA-Blade',
    size: { x: 46.25, y: 45.65, z: 40 },
    bandHeight: 4,
    bands: 10,
  },
  'retract-tower': {
    file: 'needle-grid.stl',
    modelName: 'Needle-Grid',
    size: { x: 52, y: 45.03, z: 37 },
    bandStartZ: 2,
    bandHeight: 7,
    bands: 5,
  },
  'input-shaper': {
    file: 'resonance-fin.stl',
    modelName: 'Resonance-Fin',
    size: { x: 90, y: 18, z: 45 },
    bandHeight: 9,
    bands: 5,
  },
  overhang: {
    file: 'overhang-array.stl',
    modelName: 'Overhang-Array',
    size: { x: 49.31, y: 54.91, z: 20.26 },
  },
  'fit-coupon': {
    file: 'mech-clutch.stl',
    modelName: 'Mech-Clutch',
    size: { x: 68, y: 22, z: 11 },
  },
}

const ASSET_PREFIX = 'calibration-models/'

export function calibrationModel(toolId: string): CalibrationModel | null {
  return CALIBRATION_MODELS[toolId] ?? null
}

/** Z-Höhen der Stufen eines Modells; leere Liste bei Modellen ohne Sweep. */
export function modelBandLevels(model: CalibrationModel): number[] {
  const count = model.bands ?? 0
  const height = model.bandHeight ?? 0
  const start = model.bandStartZ ?? 0
  if (!count || height <= 0) return []
  return Array.from({ length: count }, (_, index) => Math.round((start + index * height) * 1000) / 1000)
}

/** Lädt das STL des Modells aus dem Projekt oder aus den Assets der EXE. */
export function loadCalibrationModel(toolId: string): Buffer {
  const model = calibrationModel(toolId)
  if (!model) throw new Error(`Unbekanntes Kalibrier-Modell: ${toolId}`)
  const data = loadAsset(`${ASSET_PREFIX}${model.file}`)
  if (!data) {
    throw new Error(`Kalibrier-Modell ${model.file} fehlt (assets/${ASSET_PREFIX}${model.file}).`)
  }
  return data
}
