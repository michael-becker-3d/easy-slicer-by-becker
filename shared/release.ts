/**
 * Funktionsumfang der veröffentlichten Testversion.
 *
 * Hier wird zentral entschieden, welche Funktionen in der Oberfläche
 * erscheinen. Der Code bleibt vollständig erhalten: Eine Funktion wieder
 * einzuschalten heißt, genau einen Wert auf `true` zu setzen. Damit bleibt
 * der Weg zurück offen, ohne verstreute Stellen im Code zu suchen.
 *
 * Ausgeblendet heißt nicht nur „nicht anklickbar“: Was hier aus ist, wird
 * auch serverseitig nicht mehr wirksam (siehe `server/index.ts`) oder gar
 * nicht mehr gerendert (siehe `src/App.tsx`).
 */
export const FEATURES = {
  /**
   * „Kratzerfreie Oberfläche“ im Bereich Glätten: dichter Unterbau,
   * zusätzliche Deckschichten und höherer Fahrweg-Hub gegen Düsenkratzer.
   * Standard war ohnehin aus; die Funktion ist kein Alleinstellungsmerkmal.
   */
  surfaceGuard: false,
  /**
   * Eingebettete Web-Oberfläche (Mainsail/Fluidd/OctoPrint) samt
   * Verbindungsdialog und eigenem Tab. Der Druck über USB und die
   * Klipper-Verbindung im Drucker-Tab bleiben davon unberührt.
   */
  webUi: false,
} as const

export type FeatureId = keyof typeof FEATURES

/** Eine Funktion ist nur dann sichtbar und wirksam, wenn sie hier an ist. */
export function featureEnabled(id: FeatureId): boolean {
  return FEATURES[id]
}