import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Startet die Oberfläche als eigenes Fenster ohne Adresszeile und Tabs.
 *
 * Unter Windows und Linux übernimmt das Edge bzw. Chrome im App-Modus
 * (Chromium ohne Browser-Bedienelemente, eigenes Profil, eigene Fenstergröße).
 * Ist kein Chromium installiert oder läuft macOS, öffnet sich wie bisher der
 * Standardbrowser — besser als gar kein Fenster.
 */
function windowProfileDir(): string {
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'EasySlicerBecker', 'window')
  }
  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'easy-slicer', 'window')
}

function windowsBrowser(): string | null {
  const roots = [process.env['PROGRAMFILES(X86)'], process.env.PROGRAMFILES, process.env.LOCALAPPDATA].filter(
    (r): r is string => !!r,
  )
  const relative = ['Microsoft\\Edge\\Application\\msedge.exe', 'Google\\Chrome\\Application\\chrome.exe']
  for (const root of roots) {
    for (const rel of relative) {
      const file = join(root, rel)
      if (existsSync(file)) return file
    }
  }
  return null
}

function unixBrowser(): string | null {
  for (const cmd of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) {
    if (spawnSync('which', [cmd], { stdio: 'ignore' }).status === 0) return cmd
  }
  return null
}

/** Öffnet die App in einem eigenen Fenster; fällt auf den Browser zurück. */
export function openAppWindow(url: string): void {
  const browser =
    process.platform === 'win32' ? windowsBrowser() : process.platform === 'linux' ? unixBrowser() : null

  if (browser) {
    const args = [
      `--app=${url}`,
      '--window-size=1500,960',
      `--user-data-dir=${windowProfileDir()}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate',
      '--new-window',
    ]
    try {
      const child = spawn(browser, args, { detached: true, stdio: 'ignore', windowsHide: true })
      // Scheitert der App-Modus (ältere Edge-Version, gesperrte Richtlinie),
      // nach kurzer Prüfung den Standardbrowser öffnen, statt gar nichts.
      let settled = false
      const fallback = () => {
        if (settled) return
        settled = true
        openInBrowser(url)
      }
      child.on('error', fallback)
      child.on('exit', (code) => {
        if (code !== 0) fallback()
      })
      setTimeout(() => {
        settled = true
      }, 4000)
      child.unref()
      return
    } catch {
      /* Fallback unten */
    }
  }

  openInBrowser(url)
}

function openInBrowser(url: string): void {
  try {
    const child =
      process.platform === 'win32'
        ? spawn('cmd', ['/c', `start "" "${url}"`], { detached: true, stdio: 'ignore', windowsHide: true })
        : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' })
    // Ohne Handler würde ein fehlender Starter als unbehandelter Fehler enden.
    child.on('error', () => undefined)
    child.unref()
  } catch {
    /* Fenster öffnen ist Komfort */
  }
}
