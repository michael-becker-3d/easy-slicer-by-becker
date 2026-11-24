import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { flushPending, hydrateLocalProfiles } from './persist.ts'
import { applyStoredUiScale } from './uiScale.ts'

// Der KI-UI-Test wird über VITE_KI_UI=1 gebaut. Die normale Anwendung bleibt
// unverändert; im Testbuild wird nur die eigenständige Layoutstudie geladen.
const KI_UI_BUILD = import.meta.env.VITE_KI_UI === '1'

async function start(): Promise<void> {
  if (KI_UI_BUILD) {
    await import('./ki-ui.css')
    const { KiUi } = await import('./KiUi.tsx')
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <KiUi />
      </StrictMode>,
    )
    return
  }

  await import('./styles.css')
  applyStoredUiScale()
  // Profile zuerst aus der Profildatei holen: Die Oberfläche liest sie beim
  // ersten Rendern synchron, sonst startet sie mit einem leeren Regal.
  await hydrateLocalProfiles()
  const { default: App } = await import('./App.tsx')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

// Beim Schließen des Fensters noch Vorgemerktes mitnehmen.
window.addEventListener('pagehide', () => void flushPending(true))
window.addEventListener('beforeunload', () => void flushPending(true))

void start()
