/**
 * Schlüssel, deren Inhalt als Profilstand auf dem Rechner gesichert wird.
 *
 * Die Oberfläche (src/persist.ts) und der Server (server/userStore.ts) müssen
 * dieselbe Liste kennen — deshalb steht sie hier an einer Stelle.
 */
export const PROFILE_STORE_KEYS = [
  /** Zuletzt aktiver Drucker, Filament, Platte, Flavor und Start-/End-G-code */
  'kepler.setup.v1',
  /** Alle Druckerstände mit den vollständigen Druckparametern */
  'kepler.printers.v1',
  /** Drucker in der Arbeitsleiste */
  'kepler.workspace.v1',
  /** Eigene Qualitätsprofile (Druckparameter je Drucker) */
  'kepler.quality-profiles.v1',
  /** Eigene Filamentprofile */
  'kepler.filaments.v1',
  /** Gemessene Z-Referenz je Drucker */
  'kepler.zref.v1',
  /** Verbindungsart je Drucker */
  'kepler.conn.v1',
  /** Zuletzt gewähltes Modell je Marke */
  'kepler.brandmodel.v1',
  /** Laufende Kalibriertests je Drucker inklusive vor dem Test gesicherter Werte */
  'kepler.calibration-tests.v1',
] as const

export type ProfileStoreKey = (typeof PROFILE_STORE_KEYS)[number]

const KEY_SET: ReadonlySet<string> = new Set(PROFILE_STORE_KEYS)

export function isProfileStoreKey(key: string): key is ProfileStoreKey {
  return KEY_SET.has(key)
}
