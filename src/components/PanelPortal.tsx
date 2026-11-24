import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Seitenleisten und Dialoge werden direkt unter `#root` gerendert, nicht im
 * Bühnen-Container. Dessen Kopfleisten (Drucker-Streifen mit „2 Panes“,
 * Plattenreiter) liegen in derselben Ebene und malen sonst über die Leiste —
 * Klicks treffen dann den Knopf darunter statt das Panel.
 *
 * `#root` trägt den UI-Zoom, deshalb bleibt die Größe wie gewohnt. Fehlt
 * `#root` (z. B. mitten im Hot-Reload), wird der Inhalt an seiner Stelle
 * gerendert, statt die Oberfläche abzustürzen.
 */
export function PanelPortal({ children }: { children: ReactNode }) {
  const host = document.getElementById('root')
  return host ? createPortal(children, host) : <>{children}</>
}
