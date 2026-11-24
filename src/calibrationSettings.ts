import { DEFAULT_SETTINGS, mergeSettings } from '../shared/types.ts'
import type { CalibrationTool, DeepPartial, PrintSettings } from '../shared/types.ts'

/** Die normalen Strukturwerte, die ein Kalibriertest nicht dauerhaft ändern darf. */
export type DailyStructurePatch = {
  layerHeight: number
  firstLayerHeight: number
  lineWidth: number
  firstLayerLineWidth: number
  outerWallLineWidth: number
  innerWallLineWidth: number
  topSurfaceLineWidth: number
  walls: number
  topLayers: number
  bottomLayers: number
  infillDensity: number
  adhesion: PrintSettings['adhesion']
  brim: PrintSettings['brim']
  ironing: PrintSettings['ironing']
  zHop: number
  support: PrintSettings['support']
  special: { vase: boolean; openShell: false }
}

/**
 * Laufender Kalibriertest eines Druckers.
 *
 * Der Normalstand wird beim Start des Tests einmalig als unveränderlicher
 * Snapshot festgehalten. `qualityPresetId` und `normalStructure` werden dabei
 * ausdrücklich mitgesichert und später nicht aus `settings.layerHeight`
 * zurückgerechnet. `testPatches` enthält nur den aktuellen Test.
 *
 * `measuredPaths` trennt echte, vom Nutzer übernommene Messwerte von den
 * Startwerten des Tests. Nur Pfade in dieser Liste werden beim Alltagsmodell
 * nicht zurückgesetzt.
 */
export type CalibrationTestState = {
  qualityPresetId: string
  normalSettings: PrintSettings
  normalStructure: DailyStructurePatch
  testPatches: DeepPartial<PrintSettings>[]
  measuredPaths: string[]
}

/**
 * Prozesswerte, die ein Kalibriertest nur für seine eigene Geometrie ändert.
 * Diese Werte dürfen nicht auf ein danach geladenes Alltagsmodell übergehen.
 *
 * Bewusst NICHT enthalten sind die eigentlichen Kalibrierwerte: Fluss,
 * Pressure Advance, Temperaturen, Retract, Input Shaper, Geschwindigkeiten
 * und Beschleunigungen. Solche Werte werden nur dann behalten, wenn der Nutzer
 * sie nach dem Test als Messwert übernommen hat (`measuredPaths`).
 */
export function dailyStructurePatch(baseline: PrintSettings): DailyStructurePatch {
  return {
    layerHeight: baseline.layerHeight,
    firstLayerHeight: baseline.firstLayerHeight,
    lineWidth: baseline.lineWidth,
    firstLayerLineWidth: baseline.firstLayerLineWidth,
    outerWallLineWidth: baseline.outerWallLineWidth,
    innerWallLineWidth: baseline.innerWallLineWidth,
    topSurfaceLineWidth: baseline.topSurfaceLineWidth,
    walls: baseline.walls,
    topLayers: baseline.topLayers,
    bottomLayers: baseline.bottomLayers,
    infillDensity: baseline.infillDensity,
    adhesion: baseline.adhesion,
    brim: { ...baseline.brim },
    ironing: { ...baseline.ironing },
    zHop: baseline.zHop,
    support: { ...baseline.support },
    special: { vase: false, openShell: false },
  }
}

/**
 * Wendet den Pflicht-Patch eines laufenden Kalibriertests unmittelbar vor dem
 * Slicen erneut an. Die Oberfläche kann zwischen dem Erzeugen des Tests und
 * dem Slicen z. B. durch ein Qualitätsprofil zurückgesetzt worden sein; der
 * Test darf dann nicht ohne seine Pflichtwerte (etwa die eine Wand des
 * Flowwürfels) geschnitten werden.
 */
export function calibrationSliceSettings(
  settings: PrintSettings,
  calibration: Pick<CalibrationTool, 'settingsPatch'> | null,
): PrintSettings {
  return calibration ? mergeSettings(settings, calibration.settingsPatch) : settings
}

/**
 * Sichert den unveränderlichen Ausgangsstand des aktuellen Tests.
 *
 * `structureSource` ist das ausgewählte Qualitätsprofil, nicht der bereits
 * laufende Teststand. Alte Test-Patches werden nicht fortgeschrieben.
 */
export function calibrationTestStateForNextTest(
  currentSettings: PrintSettings,
  patch: DeepPartial<PrintSettings>,
  qualityPresetId = 'normal',
  structureSource: PrintSettings = currentSettings,
): CalibrationTestState {
  return {
    qualityPresetId,
    normalSettings: mergeSettings(currentSettings, {}),
    normalStructure: dailyStructurePatch(structureSource),
    testPatches: [patch],
    measuredPaths: [],
  }
}

/**
 * Ausgangsstand für einen neuen Kalibriertest:
 *
 * - Struktur, Geschwindigkeiten und Beschleunigungen kommen aus dem aktuell
 *   ausgewählten Qualitätsprofil.
 * - Echte Kalibrierwerte wie Fluss, PA und Input Shaper bleiben aus dem
 *   aktuellen Stand erhalten.
 * - Startwerte eines vorherigen Tests werden auf das Profil zurückgesetzt.
 *   Nur Pfade, die der Nutzer als Messwert übernommen hat, bleiben erhalten.
 */
export function normalSettingsForTest(
  current: PrintSettings,
  qualityBaseline: PrintSettings,
  previousTest: CalibrationTestState | null = null,
): PrintSettings {
  let base = mergeSettings(current, {
    ...dailyStructurePatch(qualityBaseline),
    speeds: { ...qualityBaseline.speeds },
    accelerations: { ...qualityBaseline.accelerations },
    pressureAdvanceRamp: { enabled: false },
    special: { ...(qualityBaseline.special ?? {}), vase: false, openShell: false },
  })

  for (const patch of previousTest?.testPatches ?? []) {
    base = applyPreviousTestValues(
      base as unknown as Record<string, unknown>,
      current as unknown as Record<string, unknown>,
      qualityBaseline as unknown as Record<string, unknown>,
      patch as unknown as Record<string, unknown>,
      new Set(previousTest?.measuredPaths ?? []),
      '',
    ) as unknown as PrintSettings
  }

  return base
}

/**
 * Stellt nach einem Test die gesicherte Alltagsstruktur wieder her. Nur
 * ausdrücklich übernommene Messpfade bleiben stehen; alle übrigen Testwerte
 * werden auf den Normal-Snapshot zurückgesetzt.
 */
export function applyCalibrationTestReset(
  current: PrintSettings,
  state: CalibrationTestState,
): PrintSettings {
  let next = mergeSettings(current, state.normalStructure)
  const normal = state.normalSettings as unknown as Record<string, unknown>
  for (const patch of state.testPatches) {
    next = applyNormalValues(
      next as unknown as Record<string, unknown>,
      normal,
      patch as unknown as Record<string, unknown>,
      new Set(state.measuredPaths),
      '',
    ) as unknown as PrintSettings
  }
  return next
}

/**
 * Markiert geänderte Kalibrierpfade als bewusst übernommene Messwerte.
 * Wird von Settings-Änderungen nach einem Test aufgerufen. Dadurch bleiben
 * Messwerte erhalten, während unveränderte Test-Startwerte später sicher
 * zurückgesetzt werden.
 */
export function markMeasuredCalibrationValues(
  state: CalibrationTestState,
  previous: PrintSettings,
  next: PrintSettings,
): CalibrationTestState {
  const testPaths = new Set(flattenPatchPaths(state.testPatches))
  const changed = changedLeafPaths(
    previous as unknown as Record<string, unknown>,
    next as unknown as Record<string, unknown>,
    '',
  )
  const measured = new Set(state.measuredPaths)
  for (const path of changed) {
    if (testPaths.has(path) && isMeasuredPath(path)) measured.add(path)
  }
  if (measured.size === state.measuredPaths.length) return state
  return { ...state, measuredPaths: [...measured].sort() }
}

/** Normalisiert einen aus localStorage oder Snapshot gelesenen Testzustand. */
export function normalizeCalibrationTestState(
  value: unknown,
  fallbackQualityPresetId?: string,
): CalibrationTestState | null {
  if (!isCalibrationTestState(value)) return null
  const normalSettings = mergeSettings(DEFAULT_SETTINGS, value.normalSettings)
  const normal = value.normalSettings as unknown as Record<string, unknown>
  const rawStructure = value.normalStructure
  const normalStructure = isRecord(rawStructure)
    ? (rawStructure as unknown as DailyStructurePatch)
    : dailyStructurePatch(normalSettings)
  return {
    qualityPresetId:
      typeof (value as { qualityPresetId?: unknown }).qualityPresetId === 'string'
        ? (value as { qualityPresetId: string }).qualityPresetId
        : fallbackQualityPresetId ?? 'normal',
    normalSettings,
    normalStructure,
    testPatches: value.testPatches.filter((patch) => isRecord(patch)) as DeepPartial<PrintSettings>[],
    measuredPaths: Array.isArray((value as { measuredPaths?: unknown }).measuredPaths)
      ? (value as { measuredPaths: unknown[] }).measuredPaths.filter(
          (path): path is string => typeof path === 'string',
        )
      : [],
  }
}

/** Prüft einen aus localStorage gelesenen Testzustand (auch alte Stände). */
export function isCalibrationTestState(value: unknown): value is CalibrationTestState {
  if (!isRecord(value)) return false
  if (!isRecord(value.normalSettings) || !Array.isArray(value.testPatches)) return false
  const normal = value.normalSettings
  return (
    typeof normal.layerHeight === 'number' &&
    typeof normal.nozzle === 'number' &&
    value.testPatches.every((patch) => isRecord(patch))
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9
  return Object.is(a, b)
}

/** Setzt einen Testpfad auf den Normalwert; Messpfade bleiben unangetastet. */
function applyNormalValues(
  current: Record<string, unknown>,
  normal: Record<string, unknown>,
  patch: Record<string, unknown>,
  measured: Set<string>,
  prefix: string,
): Record<string, unknown> {
  let changed = false
  const next: Record<string, unknown> = { ...current }
  for (const [key, patchValue] of Object.entries(patch)) {
    if (patchValue === undefined) continue
    const path = prefix ? `${prefix}.${key}` : key
    if (isRecord(patchValue)) {
      if (!isRecord(current[key])) continue
      const nested = applyNormalValues(
        current[key],
        isRecord(normal[key]) ? normal[key] : {},
        patchValue,
        measured,
        path,
      )
      if (nested !== current[key]) {
        next[key] = nested
        changed = true
      }
      continue
    }
    if (measured.has(path)) continue
    const normalValue = normal[key]
    if (normalValue === undefined) continue
    if (!sameValue(current[key], normalValue)) {
      next[key] = normalValue
      changed = true
    }
  }
  return changed ? next : current
}

/** Übernimmt Messwerte unverändert, alles andere aus dem Profil. */
function applyPreviousTestValues(
  base: Record<string, unknown>,
  current: Record<string, unknown>,
  normal: Record<string, unknown>,
  patch: Record<string, unknown>,
  measured: Set<string>,
  prefix: string,
): Record<string, unknown> {
  let changed = false
  const next: Record<string, unknown> = { ...base }
  for (const [key, patchValue] of Object.entries(patch)) {
    if (patchValue === undefined) continue
    const path = prefix ? `${prefix}.${key}` : key
    if (isRecord(patchValue)) {
      if (!isRecord(base[key]) || !isRecord(current[key])) continue
      const nested = applyPreviousTestValues(
        base[key],
        current[key],
        isRecord(normal[key]) ? normal[key] : {},
        patchValue,
        measured,
        path,
      )
      if (nested !== base[key]) {
        next[key] = nested
        changed = true
      }
      continue
    }
    if (!(key in normal)) continue
    const value = measured.has(path) && current[key] !== undefined ? current[key] : normal[key]
    if (value !== undefined && !sameValue(base[key], value)) {
      next[key] = value
      changed = true
    }
  }
  return changed ? next : base
}

/** Alle Blattpfade eines Patches, z. B. `temps.nozzle`. */
export function flattenPatchPaths(
  patch: DeepPartial<PrintSettings> | DeepPartial<PrintSettings>[],
): string[] {
  const paths: string[] = []
  const walk = (value: Record<string, unknown>, prefix: string) => {
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined) continue
      const path = prefix ? `${prefix}.${key}` : key
      if (isRecord(child)) walk(child, path)
      else paths.push(path)
    }
  }
  for (const entry of Array.isArray(patch) ? patch : [patch]) {
    walk(entry as unknown as Record<string, unknown>, '')
  }
  return paths
}

function changedLeafPaths(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
  prefix: string,
): string[] {
  const paths: string[] = []
  for (const [key, value] of Object.entries(next)) {
    const path = prefix ? `${prefix}.${key}` : key
    const before = previous[key]
    if (isRecord(value)) {
      paths.push(...changedLeafPaths(isRecord(before) ? before : {}, value, path))
      continue
    }
    if (!sameValue(before, value)) paths.push(path)
  }
  return paths
}

/** Nur echte Kalibrierwerte dürfen als Messwert übernommen werden. */
function isMeasuredPath(path: string): boolean {
  const root = path.split('.')[0]
  return (
    root === 'flow' ||
    root === 'maxVolumetricFlow' ||
    root === 'temps' ||
    root === 'retraction' ||
    root === 'speeds' ||
    root === 'accelerations' ||
    root === 'pressureAdvance' ||
    root === 'pressureAdvanceRamp' ||
    root === 'inputShaper'
  )
}
