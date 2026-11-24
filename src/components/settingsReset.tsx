import { createContext, useContext } from 'react'

export type SettingsResetValue = {
  /** Wert aus dem aktuell gewählten Qualitätsprofil, null = kein Profilfeld. */
  baselineFor: (label: string, unit?: string) => number | null
  reset: (label: string, unit?: string) => void
}

export const SettingsResetContext = createContext<SettingsResetValue | null>(null)

/**
 * Liefert den Rücksetzknopf für ein Zahlenfeld — nur wenn ein Profilwert
 * bekannt ist und der aktuelle Wert davon abweicht. Außerhalb der
 * Einstellungen (z. B. im Transformationsdialog) bleibt der Knopf aus.
 */
export function useSettingReset(label: string, unit: string | undefined, value: number) {
  const ctx = useContext(SettingsResetContext)
  if (!ctx) return null
  const baseline = ctx.baselineFor(label, unit)
  if (baseline === null || !Number.isFinite(baseline) || Math.abs(baseline - value) < 0.0005) return null
  return { baseline, reset: () => ctx.reset(label, unit) }
}
