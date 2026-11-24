import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { chromium, type Browser, type Locator, type Page } from 'playwright-core'
import { boxMinMax } from '../server/meshlib.ts'
import { buildBinarySTL } from '../server/slicer/stl.ts'
import { FEATURES } from '../shared/release.ts'

/**
 * Headless UI-Smoke-Test für die Abläufe, die reine Geometrietests nicht
 * abdecken:
 * - Objekt laden, Transformationsdialog, 90°-Drehung, Maße und Vorschau
 * - Slicen, Vorschau und gespeicherte G-Code-Datei
 * - Druckbestätigung: Checkbox, gesperrter Startknopf und Layout (ohne Start)
 * - Rückgängig / Vorwärts
 * - Druckerwechsel mit getrennten Studio-Sitzungen
 * - ungültige Datei, zu großes Objekt, nicht erreichbare Verbindung
 *
 * Der Test startet einen eigenen Server und einen Vite-Dev-Server auf freien
 * Ports. Er verbindet nur den lokalen Simulationsdrucker und startet keinen
 * Druck. Der lokale Chrome wird über playwright-core gesteuert; es wird kein
 * Browser geladen.
 */

const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = address && typeof address === 'object' ? address.port : 0
      probe.close((error) => (error ? reject(error) : resolvePort(port)))
    })
  })
}

async function waitForHttp(url: string, child: ChildProcess, logs: () => string): Promise<void> {
  const deadline = Date.now() + 40_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Testserver wurde mit Code ${child.exitCode} beendet.\n${logs()}`)
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(800) })
      if (response.ok) return
    } catch {
      // Server startet noch.
    }
    await delay(200)
  }
  throw new Error(`Testserver wurde nicht rechtzeitig erreichbar: ${url}\n${logs()}`)
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  child.kill()
  await Promise.race([new Promise<void>((done) => child.once('exit', () => done())), delay(2500)])
  if (child.exitCode === null) child.kill('SIGKILL')
}

function chromePath(): string {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter((value): value is string => !!value)
  const found = candidates.find((candidate) => existsSync(candidate))
  if (!found) {
    throw new Error(
      'Kein lokaler Chrome/Edge gefunden. Setze CHROME_PATH auf einen installierten Chromium-Browser.',
    )
  }
  return found
}

function makeBoxStl(width: number, depth: number, height: number): Buffer {
  return buildBinarySTL(boxMinMax(-width / 2, -depth / 2, 0, width / 2, depth / 2, height))
}

async function waitForInputValue(input: Locator, expected: string, timeout = 15_000): Promise<void> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      if ((await input.inputValue()) === expected) return
    } catch {
      // React hat den Dialog gerade neu gerendert.
    }
    await delay(100)
  }
  throw new Error(`Eingabewert wurde nicht ${expected}; aktuell ${await input.inputValue().catch(() => '?')}`)
}

async function waitForEnabled(locator: Locator, label: string, timeout = 15_000): Promise<void> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await locator.isEnabled().catch(() => false)) return
    await delay(100)
  }
  throw new Error(`${label} bleibt deaktiviert`)
}

async function waitForExactText(page: Page, text: string, timeout = 20_000): Promise<void> {
  await page.getByText(text, { exact: true }).first().waitFor({ state: 'visible', timeout })
}

/** Prüft eine Anzeige über ihren stabilen Testhaken, nicht über Feldreihenfolge. */
async function waitForTestIdText(page: Page, testId: string, expected: string, timeout = 20_000): Promise<void> {
  const locator = page.getByTestId(testId)
  await locator.waitFor({ state: 'visible', timeout })
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if ((await locator.textContent())?.trim() === expected) return
    await delay(100)
  }
  throw new Error(`${testId} wurde nicht ${expected}; aktuell ${(await locator.textContent().catch(() => '?'))?.trim()}`)
}

async function setFile(page: Page, name: string, buffer: Buffer): Promise<void> {
  const input = page.getByTestId('object-file-input')
  await input.setInputFiles({ name, mimeType: 'model/stl', buffer })
}

async function main(): Promise<void> {
  const apiPort = await freePort()
  // Der Server lässt WebSockets nur vom eigenen Port oder vom festen
  // Vite-Entwicklungsport 3000 zu. Der Test nutzt deshalb 3000; ist er belegt,
  // bricht er mit einer klaren Meldung ab, statt still ohne Live-Kanal zu laufen.
  const vitePort = 3000
  const apiBase = `http://127.0.0.1:${apiPort}`
  const appBase = `http://127.0.0.1:${vitePort}`
  let apiLogs = ''
  let viteLogs = ''

  const api = spawn(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), 'server/index.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(apiPort), KEPLER_NO_BROWSER: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  api.stdout?.on('data', (chunk: Buffer) => {
    apiLogs = (apiLogs + chunk.toString()).slice(-16_000)
  })
  api.stderr?.on('data', (chunk: Buffer) => {
    apiLogs = (apiLogs + chunk.toString()).slice(-16_000)
  })

  const vite = spawn(
    process.execPath,
    [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'],
    {
      cwd: process.cwd(),
      env: { ...process.env, KEPLER_API: apiBase },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  vite.stdout?.on('data', (chunk: Buffer) => {
    viteLogs = (viteLogs + chunk.toString()).slice(-16_000)
  })
  vite.stderr?.on('data', (chunk: Buffer) => {
    viteLogs = (viteLogs + chunk.toString()).slice(-16_000)
  })

  let browser: Browser | undefined
  try {
    await waitForHttp(`${apiBase}/api/health`, api, () => apiLogs)
    await waitForHttp(appBase, vite, () => viteLogs)

    browser = await chromium.launch({
      executablePath: chromePath(),
      headless: true,
      args: ['--disable-gpu', '--no-sandbox'],
    })
    const context = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
      acceptDownloads: true,
      locale: 'de-DE',
    })
    // Der Server teilt seine Profildatei mit der laufenden App. Für einen
    // reproduzierbaren Smoke-Test wird der Profil-Hydration leer geantwortet;
    // gespeicherte Drucker/Profile der echten Installation bleiben unberührt.
    await context.route('**/api/user-store', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"entries":{}}' })
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
      }
    })
    // Der native Speichern-Dialog ist in Headless nicht bedienbar. Der
    // Produktions-Fallback für Browser ohne File System Access API wird
    // getestet; die heruntergeladene Datei wird anschließend geprüft.
    await context.addInitScript(() => {
      Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })
    })
    const page = await context.newPage()
    const pageErrors: string[] = []
    let printRequests = 0
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/api/printer/print')) printRequests++
    })
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('console', (message) => {
      // Die drei absichtlich ausgelösten 400er (ungültige Datei, zu großes
      // Objekt, toter Port) erzeugen Browser-Konsolenzeilen. Sie sind Teil des
      // getesteten Fehlerverhaltens; unerwartete JS-Fehler bleiben sichtbar.
      if (message.type() === 'error' && !/Failed to load resource:.*status of 400/i.test(message.text())) {
        pageErrors.push(message.text())
      }
    })

    await page.goto(appBase, { waitUntil: 'domcontentloaded' })
    const setupDialog = page.getByRole('dialog', { name: 'Drucker einrichten', exact: true })
    try {
      await setupDialog.waitFor({ state: 'visible', timeout: 20_000 })
    } catch (error) {
      console.error(`UI nicht bereit: ${page.url()}\n${await page.locator('body').innerText().catch(() => '')}`)
      console.error(`Browserfehler: ${pageErrors.join(' | ')}`)
      console.error(`Vite:\n${viteLogs.slice(-4000)}`)
      throw error
    }
    await setupDialog.getByTestId('setup-apply').click()
    await setupDialog.waitFor({ state: 'hidden' })
    await page.getByTestId('result-slice').waitFor({ state: 'visible' })
    await page.getByTestId('workflow-bar').waitFor({ state: 'visible' })

    // Veröffentlichte Testversion: ausgeblendete Funktionen dürfen nirgends
    // auftauchen — weder als Reiter oder Knopf noch als Einstellung.
    if (!FEATURES.webUi) {
      assert.equal(await page.getByTestId('open-web-dialog').count(), 0, 'Web-Knopf ist sichtbar')
      assert.equal(
        await page.getByRole('button', { name: 'Web-UI', exact: true }).count(),
        0,
        'Web-UI-Reiter ist sichtbar',
      )
    }
    if (!FEATURES.surfaceGuard) {
      assert.equal(
        await page.getByText('Kratzerfreie Oberfläche', { exact: true }).count(),
        0,
        '„Kratzerfreie Oberfläche“ ist sichtbar',
      )
    }

    // 1. Objekt laden und über den echten Dialog um 90° um X drehen.
    await setFile(page, 'smoke-box.stl', makeBoxStl(20, 10, 5))
    await waitForTestIdText(page, 'model-dimensions', '20×10×5')
    await page.getByTestId('studio-tool-rotate').click()
    const transform = page.getByRole('dialog', { name: 'Größe, Drehung und Position', exact: true })
    await transform.waitFor({ state: 'visible', timeout: 20_000 })

    // Stabile accessible Labels statt nth(index): Die Feldreihenfolge darf sich
    // ändern, ohne dass der Test falsche Felder prüft.
    const widthInput = transform.getByLabel('Breite X (mm)', { exact: true })
    const depthInput = transform.getByLabel('Tiefe Y (mm)', { exact: true })
    const heightInput = transform.getByLabel('Höhe Z (mm)', { exact: true })

    const previewResponse = page.waitForResponse(
      (response) => response.url().includes('/objects') && response.request().method() === 'POST',
      { timeout: 20_000 },
    )
    const rotationX = transform.getByLabel('Drehung X', { exact: true })
    await rotationX.fill('90')
    await rotationX.press('Tab')
    assert.ok((await previewResponse).ok(), 'Live-Vorschau der Drehung antwortet nicht erfolgreich')

    // Nach der Serverantwort müssen die Dialogfelder die neue Bounding-Box
    // zeigen: aus 20×10×5 wird bei X-90° 20×5×10.
    await waitForInputValue(widthInput, '20')
    await waitForInputValue(depthInput, '5')
    await waitForInputValue(heightInput, '10')

    const applyResponse = page.waitForResponse(
      (response) => response.url().includes('/objects') && response.request().method() === 'POST',
      { timeout: 20_000 },
    )
    await transform.getByRole('button', { name: 'Übernehmen', exact: true }).click()
    assert.ok((await applyResponse).ok(), 'Übernehmen der Drehung antwortet nicht erfolgreich')
    await transform.waitFor({ state: 'hidden' })
    await waitForTestIdText(page, 'model-dimensions', '20×5×10')

    // 2. Rückgängig und Vorwärts über den Serververlauf.
    const undoResponse = page.waitForResponse((response) => response.url().endsWith('/undo'))
    await page.getByTestId('studio-tool-undo').click()
    assert.ok((await undoResponse).ok(), 'Rückgängig antwortet nicht erfolgreich')
    await waitForTestIdText(page, 'model-dimensions', '20×10×5')

    const redoResponse = page.waitForResponse((response) => response.url().endsWith('/redo'))
    await page.getByTestId('studio-tool-redo').click()
    assert.ok((await redoResponse).ok(), 'Vorwärts antwortet nicht erfolgreich')
    await waitForTestIdText(page, 'model-dimensions', '20×5×10')

    // 3. Slicen, Vorschau und Ergebnisdatei.
    const sliceResponse = page.waitForResponse(
      (response) => response.url().endsWith('/api/slice') && response.request().method() === 'POST',
      { timeout: 90_000 },
    )
    await page.getByTestId('toolbar-slice').click()
    const sliced = await sliceResponse
    assert.ok(sliced.ok(), `Slicen antwortet ${sliced.status()}`)
    await waitForExactText(page, 'Druckzeit')
    const layerText = page.getByText(/Schicht \d+ \/ \d+/).first()
    await layerText.waitFor({ state: 'visible', timeout: 20_000 })
    assert.ok((await page.locator('canvas').count()) > 0, 'Vorschau-Canvas fehlt nach dem Slicen')

    const downloadPromise = page.waitForEvent('download', { timeout: 20_000 })
    await page.getByRole('button', { name: 'G-Code speichern…', exact: true }).click()
    const download = await downloadPromise
    assert.match(download.suggestedFilename(), /\.gcode$/i, 'Ergebnisdatei hat keine G-Code-Endung')
    const downloadedPath = await download.path()
    assert.ok(downloadedPath, 'Download wurde nicht abgelegt')
    const gcode = readFileSync(downloadedPath, 'utf8')
    assert.ok(gcode.length > 10_000, `G-Code ist zu kurz (${gcode.length} Zeichen)`)
    assert.match(gcode, /G[01]\s/, 'G-Code enthält keine Bewegungszeilen')

    // 4. Druckbestätigung: nur öffnen und prüfen, niemals starten.
    // Der Testserver läuft isoliert; die Simulation ersetzt keine echte Verbindung.
    const activeProfileId = await page.evaluate(async () => {
      const response = await fetch('/api/printer/ports')
      const data = (await response.json()) as { profile?: { id?: string } }
      return data.profile?.id ?? ''
    })
    assert.ok(activeProfileId, 'Aktives Druckerprofil konnte nicht ermittelt werden')
    const simulated = await page.evaluate(async (profileId) => {
      const response = await fetch('/api/printer/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'simulation', profileId }),
      })
      return { ok: response.ok, status: response.status }
    }, activeProfileId)
    assert.ok(simulated.ok, `Simulationsdrucker verbindet nicht (${simulated.status})`)

    const outputAction = page.getByTestId('output-action')
    await waitForEnabled(outputAction.locator('option[value="usb"]'), 'USB-Ausgabe')
    await outputAction.selectOption('usb')
    const outputRun = page.getByTestId('output-run')
    await waitForEnabled(outputRun, 'Ausgabeknopf')
    await outputRun.click()

    const printConfirm = page.getByTestId('print-confirm')
    await printConfirm.waitFor({ state: 'visible', timeout: 10_000 })
    const confirmCheck = page.getByTestId('print-confirm-check')
    const confirmStart = page.getByTestId('print-confirm-start')
    assert.equal(await confirmCheck.isChecked(), false, 'Checkbox ist beim Öffnen bereits gesetzt')
    assert.equal(await confirmStart.isDisabled(), true, 'Startknopf ist ohne Checkbox nicht gesperrt')
    for (const text of [
      'Druckzeit',
      'Material',
      'Ich habe Bett, Düse und Material geprüft.',
      'Abbrechen',
      'Druck starten',
    ]) {
      await printConfirm.getByText(text, { exact: true }).first().waitFor({ state: 'visible', timeout: 10_000 })
    }

    const viewport = page.viewportSize()
    assert.ok(viewport, 'Viewport-Größe fehlt')
    const dialogBox = await printConfirm.boundingBox()
    assert.ok(dialogBox, 'Druckbestätigung hat keine messbare Box')
    assert.ok(dialogBox.x >= 0 && dialogBox.y >= 0, 'Druckbestätigung beginnt außerhalb des Viewports')
    assert.ok(
      dialogBox.x + dialogBox.width <= viewport.width + 1,
      `Druckbestätigung ragt rechts heraus (${dialogBox.x + dialogBox.width} > ${viewport.width})`,
    )
    assert.ok(
      dialogBox.y + dialogBox.height <= viewport.height + 1,
      `Druckbestätigung ragt unten heraus (${dialogBox.y + dialogBox.height} > ${viewport.height})`,
    )
    assert.ok(dialogBox.width >= 360 && dialogBox.width <= 520, `Druckbestätigung ist unerwartet breit: ${dialogBox.width}`)
    const horizontalOverflow = await printConfirm.evaluate((element) => element.scrollWidth - element.clientWidth)
    assert.ok(horizontalOverflow <= 1, `Druckbestätigung hat horizontalen Überlauf: ${horizontalOverflow}px`)

    await confirmCheck.check()
    assert.equal(await confirmCheck.isChecked(), true, 'Checkbox lässt sich nicht setzen')
    await waitForEnabled(confirmStart, 'Startknopf nach Checkbox')
    await page.getByTestId('print-confirm-cancel').click()
    await printConfirm.waitFor({ state: 'hidden' })
    assert.equal(printRequests, 0, 'Druckbestätigung hat einen Druckrequest ausgelöst')

    const disconnected = await page.evaluate(async () => (await fetch('/api/printer/disconnect', { method: 'POST' })).ok)
    assert.ok(disconnected, 'Simulationsdrucker lässt sich nicht trennen')

    // 5. Druckerwechsel und getrennte Studio-Objekte.
    const switchTo = async (printerId: string) => {
      await page.getByTestId('printer-switch').click()
      await setupDialog.waitFor({ state: 'visible', timeout: 20_000 })
      // Der Dialog startet mit der Marke des aktiven Druckers; für den Wechsel
      // wird die vollständige Liste benötigt.
      await setupDialog.getByLabel('Hersteller').selectOption('alle')
      await setupDialog.getByTestId(`printer-option-${printerId}`).click()
      await setupDialog.getByTestId('setup-apply').click()
      await setupDialog.waitFor({ state: 'hidden' })
    }

    await switchTo('anycubic-vyper')
    await waitForExactText(page, 'Datei ablegen oder klicken')
    await page.getByRole('button', { name: 'Zylinder', exact: true }).click()
    await waitForExactText(page, 'zylinder.stl')
    await waitForTestIdText(page, 'model-dimensions', '30×30×40')

    await switchTo('flashforge-ad5x')
    await waitForExactText(page, 'smoke-box.stl')
    await waitForTestIdText(page, 'model-dimensions', '20×5×10')

    await switchTo('anycubic-vyper')
    await waitForExactText(page, 'zylinder.stl')

    // 6a. Ungültige Datei.
    await setFile(page, 'kaputt.stl', Buffer.from('kurz'))
    await waitForExactText(page, 'Keine Modelldaten empfangen.')
    await waitForExactText(page, 'zylinder.stl')

    // 6b. Objekt außerhalb des Betts: 300 mm Würfel auf dem 245-mm-Vyper.
    await setFile(page, 'zu-gross.stl', makeBoxStl(300, 300, 5))
    await waitForExactText(page, 'zu-gross.stl')
    await page
      .getByTestId('printer-warning')
      .getByText(/Modell passt nicht auf Vyper:/)
      .waitFor({ state: 'visible', timeout: 15_000 })
    const arrangeResponse = page.waitForResponse(
      (response) => response.url().endsWith('/tools') && response.request().method() === 'POST',
    )
    await page.getByTestId('studio-tool-arrange').click()
    const arranged = await arrangeResponse
    assert.equal(arranged.status(), 400, 'Zu großes Objekt wird beim Anordnen nicht abgewiesen')
    await waitForExactText(page, 'Kein Objekt passt auf das Druckbett.')

    // 6b. Formenauswahl: Kategorien und Vorschaukarten im Rechtsklick-Menü.
    await page.locator('canvas').first().click({ button: 'right', position: { x: 300, y: 250 } })
    const shapeMenu = page.getByRole('menu')
    await shapeMenu.waitFor({ state: 'visible', timeout: 10_000 })
    await shapeMenu.getByRole('button', { name: 'Extra', exact: true }).click()
    await shapeMenu.getByRole('tab', { name: 'Praktisch', exact: true }).click()
    const practicalShapes = shapeMenu.getByRole('button', { name: /^(Kabelklemme|Wandhaken|Schlüsselanhänger|Untersetzer):/ })
    assert.equal(await practicalShapes.count(), 4, 'Praktische Extra-Formen fehlen')
    assert.ok((await shapeMenu.locator('svg').count()) >= 4, 'Vorschausymbole der Extra-Formen fehlen')
    await shapeMenu.getByRole('tab', { name: 'Testkörper', exact: true }).click()
    assert.ok(
      (await shapeMenu.getByRole('button', { name: /^(Orca-Würfel|Voron-Würfel|Benchy|Brücke|Schlanker Turm|Flow-Würfel|Retract-Turm):/ }).count()) >= 7,
      'Testkörper der Extra-Formen fehlen',
    )
    await page.keyboard.press('Escape')
    await shapeMenu.waitFor({ state: 'hidden' })

    // 6c. Nicht erreichbare Verbindung: geschlossener lokaler Port.
    // Der Verbindungsdialog gehört zur Web-Oberfläche und ist in der
    // veröffentlichten Testversion bewusst nicht vorhanden.
    if (FEATURES.webUi) {
      const deadPort = await freePort()
      await page.getByTestId('open-web-dialog').click()
      const webDialog = page.getByRole('dialog', { name: 'Web-Drucker', exact: true })
      await webDialog.waitFor({ state: 'visible', timeout: 20_000 })
      await webDialog.getByLabel('IP / Host', { exact: true }).fill('127.0.0.1')
      await webDialog.getByLabel('Port', { exact: true }).fill(String(deadPort))
      const connectResponse = page.waitForResponse(
        (response) => response.url().endsWith('/api/printer/connect'),
        { timeout: 25_000 },
      )
      await webDialog.getByRole('button', { name: 'Verbinden', exact: true }).click()
      const failed = await connectResponse
      assert.equal(failed.status(), 400, 'Toter Port wird nicht als Verbindungsfehler gemeldet')
      await webDialog
        .getByText(/Verbindung fehlgeschlagen|fetch failed|aborted|ECONN|nicht erreichbar/i)
        .first()
        .waitFor({ state: 'visible', timeout: 10_000 })
    }

    assert.deepEqual(pageErrors, [], `Browserfehler während des Smoke-Tests:\n${pageErrors.join('\n')}`)
    assert.equal(printRequests, 0, 'Während des Smoke-Tests wurde ein Druckrequest ausgelöst')
    console.log('OK: UI-Smoke-Test — Drehen, Vorschau, Slice/Datei, Druckbestätigung, getrennte Studios und Fehlerfälle.')
    console.log('  Transformationsdialog: 20×10×5 → 20×5×10 nach 90° X, Live-Vorschau und Übernehmen.')
    console.log('  Ergebnis: Slice-Vorschau sichtbar, G-Code-Datei mit Bewegungszeilen heruntergeladen.')
    console.log('  Druckbestätigung: Checkbox und Startknopf gesperrt/entsperrt, Layout im Viewport, kein Druckrequest.')
    console.log('  Studios: Vyper-Zylinder und AD5X-Box bleiben beim Wechsel getrennt erhalten.')
    console.log(
      FEATURES.webUi
        ? '  Fehler: ungültige Datei, 300-mm-Objekt auf 245-mm-Bett und toter lokaler Port sichtbar gemeldet.'
        : '  Fehler: ungültige Datei und 300-mm-Objekt auf 245-mm-Bett sichtbar gemeldet.',
    )
  } finally {
    await browser?.close().catch(() => undefined)
    await stopChild(vite)
    await stopChild(api)
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
