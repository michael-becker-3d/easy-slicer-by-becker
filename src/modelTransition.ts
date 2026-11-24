import { mergeSettings } from '../shared/types.ts'
import type { DeepPartial, PrintSettings } from '../shared/types.ts'
import {
  applyCalibrationTestReset,
  type CalibrationTestState,
} from './calibrationSettings.ts'

/**
 * Ein einziger Pfad für alle Wege, die ein neues Werkstück auf die Platte
 * bringen: adopt(), „Hinzufügen“, Formen und Lithophan. Der Testzustand wird
 * vor importierten 3MF-Werten zurückgesetzt; nur bewusst übernommene
 * Messwerte bleiben erhalten.
 */
export type ModelSettingsTakeoverInput = {
  current: PrintSettings
  imported?: DeepPartial<PrintSettings> | null
  testState: CalibrationTestState | null
  /** Begrenzt das Ergebnis auf den aktiven Drucker. */
  normalize: (settings: PrintSettings) => PrintSettings
}

export type ModelSettingsTakeoverResult = {
  settings: PrintSettings
  resetTestStructure: boolean
  qualityPresetId: string | null
}

export function applyModelSettingsTakeover(
  input: ModelSettingsTakeoverInput,
): ModelSettingsTakeoverResult {
  const testState = input.testState
  const base = testState ? applyCalibrationTestReset(input.current, testState) : input.current
  const imported = input.imported ?? {}
  const settings = mergeSettings(base, {
    ...imported,
    pressureAdvanceRamp: { enabled: false },
    special: {
      ...(base.special ?? {}),
      ...(testState ? { vase: false, openShell: false } : {}),
      ...(imported.special ?? {}),
      // openShell ist ein interner Kalibrierzustand, kein Alltagswert.
      openShell: false,
    },
  })

  return {
    settings: input.normalize(settings),
    resetTestStructure: testState !== null,
    qualityPresetId: testState?.qualityPresetId ?? null,
  }
}
