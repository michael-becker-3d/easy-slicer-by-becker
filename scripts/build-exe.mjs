// Baut eine eigenständige Windows-EXE (Node SEA) mit eingebettetem Frontend
// und optional einen NSIS-Installer. Läuft komplett auf Linux — kein Wine.
//
//   node scripts/build-exe.mjs                 # Windows-EXE + Installer
//   KEPLER_TARGET=linux node scripts/build-exe.mjs   # Smoke-Test-Build
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const BUILD = join(ROOT, 'build')
const RELEASE = join(ROOT, 'release')
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
// Der SEA-Blob ist an die Node-Version gebunden — Laufzeit und Blob müssen passen.
const NODE_VERSION = process.env.KEPLER_NODE_VERSION ?? process.versions.node
const TARGET = (process.env.KEPLER_TARGET ?? 'win').toLowerCase()
const WITH_INSTALLER = process.env.KEPLER_NSIS !== '0'
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'

const fail = (message) => {
  console.error(`\nFEHLER: ${message}`)
  process.exit(1)
}
const sha256File = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
const releaseName = (file) => relative(RELEASE, file).split('\\').join('/')

const run = (cmd, args, opts = {}) => {
  console.log(`\n$ ${cmd} ${args.join(' ')}`)
  const { shell: shellOverride, ...rest } = opts
  // Windows startet .cmd-Dateien (npx, npm) nur über cmd.exe. execFileSync
  // mit shell:true würde jedoch den Node-Pfad mit Leerzeichen unquotiert
  // lassen; deshalb den Aufruf selbst sauber quotieren.
  const needsShell =
    shellOverride ??
    (process.platform === 'win32' && (/^(npx|npm)$/i.test(cmd) || /\.(cmd|bat)$/i.test(cmd)))
  if (needsShell) {
    const quote = (value) => (/[\s"&|<>^]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value)
    const line = [cmd, ...args].map(quote).join(' ')
    execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', line], {
      cwd: ROOT,
      stdio: 'inherit',
      ...rest,
    })
    return
  }
  execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', ...rest })
}
const step = (n, msg) => console.log(`\n=== ${n} ${msg}`)

step('1/7', 'Frontend bauen')
run(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'build'])

step('2/7', 'Server bündeln')
rmSync(BUILD, { recursive: true, force: true })
mkdirSync(BUILD, { recursive: true })
run(process.execPath, [
  join(ROOT, 'node_modules/esbuild/bin/esbuild'),
  'server/index.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--target=node20',
  '--outfile=build/app.cjs',
  // serialport wird mitgebündelt; das native Binding kommt als SEA-Asset dazu.
  '--alias:node-gyp-build=./server/printer/gyp-shim.cjs',
  // manifold lädt sein WASM zur Laufzeit aus %TEMP% — nicht mitbündeln.
  '--external:manifold-3d',
  '--external:bufferutil',
  '--external:utf-8-validate',
  '--log-level=warning',
  // Der Server enthält die proprietäre Slice-Engine; im Release nur minifiziert.
  '--minify',
])

step('3/7', 'Frontend-Dateien einsammeln')
const files = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full)
    else files.push(relative(join(ROOT, 'dist'), full).split('\\').join('/'))
  }
}
walk(join(ROOT, 'dist'))
const assets = Object.fromEntries(files.map((f) => [f, join('dist', f)]))

// Natives Serial-Binding (CH340/CH341, CP2102, FTDI) mit einbetten. Es wird
// beim Start nach %TEMP% entpackt, weil SEA keine .node-Dateien laden kann.
const serialPlatform = TARGET === 'win' ? 'win32-x64' : `${process.platform}-${process.arch}`
const serialDir = join(ROOT, 'node_modules/@serialport/bindings-cpp/prebuilds', serialPlatform)
// Windows heißt die Datei node.napi.node, Linux nutzt Varianten wie
// node.napi.glibc.node — deshalb den passenden Namen aus dem Ordner nehmen.
const serialBinding = (() => {
  if (!existsSync(serialDir)) return null
  const files = readdirSync(serialDir).filter((f) => f.endsWith('.node'))
  const preferred = files.find((f) => f === 'node.napi.node') ?? files.find((f) => f.includes('glibc')) ?? files[0]
  return preferred ? join(serialDir, preferred) : null
})()
if (!serialBinding) {
  console.error(`Serial-Binding fehlt in ${serialDir} — bitte npm ci ausführen.`)
  process.exit(1)
}
assets['serial-binding.node'] = serialBinding

// manifold-3d (WASM) mit einbetten. Der Lader braucht eine echte Datei auf der
// Platte; die App entpackt beide beim ersten Schnitt nach %TEMP%.
const manifoldGlue = join(ROOT, 'node_modules/manifold-3d/manifold.js')
const manifoldWasm = join(ROOT, 'node_modules/manifold-3d/manifold.wasm')
if (!existsSync(manifoldGlue) || !existsSync(manifoldWasm)) {
  console.error('manifold-3d fehlt in node_modules — bitte npm ci ausführen.')
  process.exit(1)
}
assets['manifold.js'] = manifoldGlue
assets['manifold.wasm'] = manifoldWasm

// Die sieben Kalibrier-Modelle liegen als STL im Projekt und müssen in der EXE
// mitreisen; server/calibrationModels.ts liest sie über getAsset().
const calibrationModelDir = join(ROOT, 'assets', 'calibration-models')
const calibrationModels = readdirSync(calibrationModelDir).filter((name) => name.endsWith('.stl'))
if (calibrationModels.length !== 7) {
  console.error(`Kalibrier-Modelle: ${calibrationModels.length} STL gefunden, erwartet 7.`)
  process.exit(1)
}
for (const name of calibrationModels) {
  assets[`calibration-models/${name}`] = join(calibrationModelDir, name)
}
console.log(`Kalibrier-Modelle eingebettet: ${calibrationModels.join(', ')}`)

// Die fertigen Vorlagen (Rechtsklick → Formen → Extra) reisen ebenfalls mit;
// server/demo.ts liest sie über getAsset().
const shapeModelDir = join(ROOT, 'assets', 'shape-models')
const shapeModels = readdirSync(shapeModelDir).filter((name) => name.endsWith('.stl'))
if (shapeModels.length !== 2) {
  console.error(`Vorlagen-STLs: ${shapeModels.length} Datei(en) gefunden, erwartet 2.`)
  process.exit(1)
}
for (const name of shapeModels) {
  assets[`shape-models/${name}`] = join(shapeModelDir, name)
}
console.log(`Vorlagen-STLs eingebettet: ${shapeModels.join(', ')}`)
console.log(`${files.length} Dateien: ${files.join(', ')} (plus Serial-Binding ${serialPlatform})`)

writeFileSync(
  join(BUILD, 'sea-config.json'),
  JSON.stringify(
    {
      main: 'build/app.cjs',
      output: 'build/sea-prep.blob',
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
      assets,
    },
    null,
    2,
  ),
)

step('4/7', 'SEA-Blob erzeugen')
run(process.execPath, ['--experimental-sea-config', 'build/sea-config.json'])

step('5/7', 'Laufzeit besorgen')
const runtime = join(BUILD, TARGET === 'win' ? 'node.exe' : 'node-runtime')
if (TARGET === 'win') {
  if (process.platform === 'win32' && existsSync(process.execPath)) {
    console.log(`Nutze lokale Node-Laufzeit ${process.version}: ${process.execPath}`)
    copyFileSync(process.execPath, runtime)
  } else {
    const url = `https://nodejs.org/dist/v${NODE_VERSION}/win-x64/node.exe`
    console.log(`Lade ${url}`)
    run('curl', ['-fsSL', '-o', runtime, url])
  }
} else {
  copyFileSync(process.execPath, runtime)
}

const exeName = TARGET === 'win' ? 'Easy-Slicer-by-Becker.exe' : 'Easy-Slicer-by-Becker'
const exe = join(BUILD, exeName)
copyFileSync(runtime, exe)

/**
 * Entfernt die Authenticode-Signatur aus einer PE-Datei (node.exe ist signiert).
 * Die Injektion macht die Signatur ohnehin ungültig — sauber entfernt startet
 * Windows die Datei als normale unsignierte Anwendung.
 */
function stripPeSignature(file) {
  const buf = readFileSync(file)
  if (buf.readUInt16LE(0) !== 0x5a4d) return false
  const pe = buf.readUInt32LE(0x3c)
  if (buf.readUInt32LE(pe) !== 0x00004550) return false
  const coff = pe + 4
  const opt = coff + 20
  const magic = buf.readUInt16LE(opt)
  const dirOff = opt + (magic === 0x20b ? 112 : 96)
  const count = buf.readUInt32LE(dirOff - 4)
  const SECURITY = 4
  if (count <= SECURITY) return false
  const entry = dirOff + SECURITY * 8
  const addr = buf.readUInt32LE(entry)
  const size = buf.readUInt32LE(entry + 4)
  if (!addr || !size || addr >= buf.length) return false
  const out = Buffer.from(buf.subarray(0, addr))
  out.writeUInt32LE(0, entry)
  out.writeUInt32LE(0, entry + 4)
  out.writeUInt32LE(0, opt + 64) // CheckSum
  writeFileSync(file, out)
  console.log(`Signatur entfernt: ${size} Bytes Zertifikatstabelle abgeschnitten`)
  return true
}

/**
 * Stellt die EXE auf das Windows-GUI-Subsystem um: Windows öffnet dann kein
 * Konsolenfenster. Node schreibt danach ins Leere — deshalb legt
 * server/applog.ts zusätzlich eine Logdatei im Datenordner an.
 */
function setWindowsGuiSubsystem(file) {
  const buf = readFileSync(file)
  if (buf.readUInt16LE(0) !== 0x5a4d) return false
  const pe = buf.readUInt32LE(0x3c)
  if (buf.readUInt32LE(pe) !== 0x00004550) return false
  const opt = pe + 4 + 20
  const magic = buf.readUInt16LE(opt)
  if (magic !== 0x10b && magic !== 0x20b) return false
  const subsystem = opt + 68
  const before = buf.readUInt16LE(subsystem)
  buf.writeUInt16LE(2, subsystem) // 2 = IMAGE_SUBSYSTEM_WINDOWS_GUI
  buf.writeUInt32LE(0, opt + 64) // Prüfsumme zurücksetzen
  writeFileSync(file, buf)
  console.log(`Subsystem: ${before} → 2 (kein Konsolenfenster)`)
  return true
}

if (TARGET === 'win') stripPeSignature(exe)

step('6/7', 'Blob injizieren')
// postject direkt über Node starten: kein cmd.exe/npx und keine Pfadprobleme
// mit Leerzeichen im Worktree.
run(process.execPath, [
  join(ROOT, 'node_modules/postject/dist/cli.js'),
  relative(ROOT, exe),
  'NODE_SEA_BLOB',
  'build/sea-prep.blob',
  '--sentinel-fuse',
  FUSE,
])
if (TARGET === 'win') {
  // Erst nach postject: So bleibt die vom Injizierer erzeugte PE-Struktur
  // unangetastet. resedit erhält den eingebetteten SEA-Ressourcenbereich.
  run(process.execPath, [join(ROOT, 'scripts/apply-exe-metadata.mjs'), exe])
  if (!setWindowsGuiSubsystem(exe)) {
    console.warn('Subsystem konnte nicht gesetzt werden — die EXE öffnet weiterhin ein Konsolenfenster.')
  }
}

mkdirSync(RELEASE, { recursive: true })
const finalExe = join(RELEASE, exeName)
copyFileSync(exe, finalExe)
console.log(`\nEXE: ${finalExe} (${(statSync(finalExe).size / 1024 / 1024).toFixed(1)} MB)`)

if (TARGET !== 'win') {
  console.log('\nFertig (Linux-Smoke-Build).')
  process.exit(0)
}

step('7/7', 'Lizenzen, Prüflisten, ZIP und SHA-256')
run(process.execPath, [join(ROOT, 'scripts/build-third-party-notices.mjs')])

const zipPath = join(RELEASE, `Easy-Slicer-by-Becker-${VERSION}-win-x64.zip`)
const checksumPath = join(RELEASE, 'SHA256SUMS.txt')
rmSync(zipPath, { force: true })
rmSync(checksumPath, { force: true })

const readme = `Easy-Slicer by Becker ${VERSION} — Testbuild für Windows
================================================================

Start
-----
Doppelklick auf Easy-Slicer-by-Becker.exe. Das Programm startet den lokalen
Slicer und öffnet die Oberfläche in einem eigenen Fenster (Edge/Chrome im
App-Modus, ohne Adresszeile und Tabs). Fehlt beides, öffnet sich der
Standardbrowser auf http://127.0.0.1:8787.

  * Der Server lauscht ausschließlich auf 127.0.0.1. Andere Geräte im LAN
    können nicht zugreifen; eine Firewall-Freigabe ist nicht nötig.
  * Läuft das Programm schon, startet der neue Start auf dem nächsten freien
    Port (8788, 8789 …) und öffnet dort ein eigenes Fenster.
  * Es öffnet sich kein Konsolenfenster. Meldungen und Fehler stehen in
    %LOCALAPPDATA%\\Easy-Slicer-by-Becker\\data\\logs\\easy-slicer.log.
  * Schließen: Fenster schließen. Der Server läuft danach im Hintergrund
    weiter — beenden über den Task-Manager (Easy-Slicer-by-Becker.exe) oder
    durch Abmelden. Ein erneuter Start öffnet ein neues Fenster auf einem
    freien Port; die alte Instanz läuft unverändert weiter.

Was drin ist
------------
Frontend und Slicer-Server stecken in der EXE. Keine Node-Installation,
keine Internetverbindung nötig. Messverlauf liegt unter
%LOCALAPPDATA%\\Easy-Slicer-by-Becker\\data. Die Prüfanleitungen für den
Anycubic Vyper und die allgemeine Windows-Abnahme liegen als
PRUEFANLEITUNG-VYPER.md und PRUEFANLEITUNG-WINDOWS.md im ZIP. Die
SHA-256-Prüfsummen für EXE und ZIP stehen in SHA256SUMS.txt neben dem ZIP.

Lizenz und Slice-Engine
-----------------------
Dieser Build ist proprietär. Es gilt LICENSE.txt; der Quellcode und die
Slice-Engine sind nicht lizenziert. Der gesonderte Schutzvermerk für die
Slice-Engine steht in LICENSE-SLICE-ENGINE.md. Die Hinweise und Lizenztexte
der eingebetteten Drittanbieter-Komponenten stehen in THIRD_PARTY_NOTICES.md.
Eine Weitergabe oder kommerzielle Nutzung ist ohne schriftliche Zustimmung
nicht erlaubt.

Eigene Qualitätsprofile
-----------------------
Aktuelle Qualitätswerte unter der Suchzeile benennen und mit "Profil
speichern" sichern. Eigene Profile erscheinen mit Stern, lassen sich
umbenennen und nach einer Rückfrage löschen.

Grenzen dieses Builds
---------------------
  * USB-Serial ist enthalten (CH340/CH341, CP2102, FTDI). Windows braucht für
    CH340/CH341 den Treiber CH341SER — ohne ihn erscheint kein COM-Port.
    Baudrate am besten auf "Automatisch" lassen; ist der Port von Cura,
    OctoPrint oder Pronterface belegt, schlägt das Verbinden fehl.
  * Netzwerk (Klipper/Moonraker, OctoPrint) und Simulation laufen ohne Treiber.
  * Der Build ist nicht signiert. Windows SmartScreen meldet "Unbekannter
    Herausgeber" — über "Weitere Informationen" → "Trotzdem ausführen"
    starten.

Deinstallation
--------------
Mit Installer: Einstellungen → Apps → "Easy-Slicer by Becker" → Deinstallieren,
oder Uninstall.exe im Installationsordner starten. Ohne Installer genügt das
Löschen der EXE; die Daten unter %LOCALAPPDATA% können zusätzlich manuell
entfernt werden.
`

writeFileSync(join(RELEASE, 'README-TEST.txt'), readme)

const checklistSpecs = [
  {
    file: 'PRUEFANLEITUNG-VYPER.md',
    minSteps: 8,
    markers: [
      '## Vorbereitung',
      '## Test 1: Prime-Linie',
      '## Test 2: Z-Korrektur während des Drucks',
      '## Dauerhaften Wert übernehmen',
      '## Abbruchkriterien',
    ],
  },
  {
    file: 'PRUEFANLEITUNG-WINDOWS.md',
    minSteps: 10,
    markers: [
      '## 1. Start',
      '## 2. Bett und Modell',
      '## 3. Einstellungen',
      'Profil speichern',
      'Umbenennen',
      'Löschen',
      '## 5. AD5X-Z-Mod-Postprocessing',
      '## 6. 4-Platten-3MF',
      '## 7. Ergebnis',
      '127.0.0.1',
    ],
  },
]

const releaseExtras = [join(RELEASE, 'README-TEST.txt')]
const licenseCopies = [
  ['LICENSE', 'LICENSE.txt'],
  ['LICENSE-SLICE-ENGINE.md', 'LICENSE-SLICE-ENGINE.md'],
  ['THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'],
]
for (const [sourceName, targetName] of licenseCopies) {
  const source = join(ROOT, sourceName)
  if (!existsSync(source)) fail(`Pflicht-Lizenzdatei fehlt: ${sourceName}`)
  const target = join(RELEASE, targetName)
  copyFileSync(source, target)
  releaseExtras.push(target)
  console.log(`Lizenzdatei OK: ${targetName}`)
}
for (const spec of checklistSpecs) {
  const source = join(ROOT, spec.file)
  if (!existsSync(source)) fail(`Pflicht-Prüfliste fehlt: ${spec.file}`)
  const text = readFileSync(source, 'utf8')
  if (text.trim().length < 1000) fail(`Pflicht-Prüfliste ist leer oder zu kurz: ${spec.file}`)
  for (const marker of spec.markers) {
    if (!text.includes(marker)) {
      fail(`Pflicht-Prüfliste ${spec.file} enthält den Abschnitt nicht: ${marker}`)
    }
  }
  const steps = (text.match(/^\s*\d+\.\s+/gm) ?? []).length
  if (steps < spec.minSteps) {
    fail(`Pflicht-Prüfliste ${spec.file} hat nur ${steps} nummerierte Prüfschritte, erwartet ${spec.minSteps}.`)
  }
  const target = join(RELEASE, spec.file)
  copyFileSync(source, target)
  releaseExtras.push(target)
  console.log(`Pflicht-Prüfliste OK: ${spec.file} (${steps} Prüfschritte)`)
}
if (!readme.includes('PRUEFANLEITUNG-VYPER.md') || !readme.includes('PRUEFANLEITUNG-WINDOWS.md')) {
  fail('README-TEST.txt verweist nicht auf beide Pflicht-Prüflisten.')
}
if (!readme.includes('SHA256SUMS.txt')) fail('README-TEST.txt verweist nicht auf SHA256SUMS.txt.')
if (!readme.includes('LICENSE.txt') || !readme.includes('LICENSE-SLICE-ENGINE.md')) {
  fail('README-TEST.txt verweist nicht auf die Lizenzdateien.')
}

const psQuote = (value) => `'${value.replaceAll("'", "''")}'`

function verifyReleaseZip(zipFile, entries) {
  const expected = entries.map((entry) => ({
    name: entry.name,
    length: statSync(entry.file).size,
    sha256: sha256File(entry.file),
  }))

  if (process.platform === 'win32') {
    const expectedPs = expected
      .map(
        (entry) =>
          `    @{ Name = ${psQuote(entry.name)}; Length = ${entry.length}; Sha256 = ${psQuote(entry.sha256)} }`,
      )
      .join(',\n')
    const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead(${psQuote(zipFile)})
try {
  $expected = @(
${expectedPs}
  )
  $actual = @($zip.Entries)
  if ($actual.Count -ne $expected.Count) {
    throw "ZIP hat $($actual.Count) Einträge, erwartet $($expected.Count)."
  }
  foreach ($want in $expected) {
    $entry = $actual | Where-Object { $_.FullName -eq $want.Name } | Select-Object -First 1
    if (-not $entry) { throw "ZIP-Eintrag fehlt: $($want.Name)" }
    if ($entry.Length -ne $want.Length) {
      throw "ZIP-Eintrag $($want.Name) hat $($entry.Length) Bytes, erwartet $($want.Length)."
    }
    $stream = $entry.Open()
    try {
      $hasher = [System.Security.Cryptography.SHA256]::Create()
      try {
        $hash = -join ($hasher.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') })
      } finally {
        $hasher.Dispose()
      }
    } finally {
      $stream.Dispose()
    }
    if ($hash -ne $want.Sha256) {
      throw "ZIP-Eintrag $($want.Name) hat eine falsche SHA-256-Summe."
    }
  }
} finally {
  $zip.Dispose()
}
Write-Output 'ZIP_OK'
`
    try {
      execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
        cwd: ROOT,
        stdio: 'inherit',
      })
    } catch (error) {
      rmSync(zipFile, { force: true })
      fail(`ZIP-Prüfung fehlgeschlagen: ${error.message}`)
    }
  } else {
    try {
      const listed = execFileSync('unzip', ['-Z1', zipFile], { encoding: 'utf8' })
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
      const expectedNames = expected.map((entry) => entry.name).sort()
      const actualNames = [...listed].sort()
      if (
        actualNames.length !== expectedNames.length ||
        actualNames.some((name, index) => name !== expectedNames[index])
      ) {
        throw new Error(`ZIP-Inhalt weicht ab: ${actualNames.join(', ')}`)
      }
      for (const entry of expected) {
        const data = execFileSync('unzip', ['-p', zipFile, entry.name], {
          maxBuffer: Math.max(32 * 1024 * 1024, entry.length + 4 * 1024 * 1024),
        })
        if (data.length !== entry.length) {
          throw new Error(`ZIP-Eintrag ${entry.name} hat ${data.length} Bytes, erwartet ${entry.length}.`)
        }
        const digest = createHash('sha256').update(data).digest('hex')
        if (digest !== entry.sha256) throw new Error(`ZIP-Eintrag ${entry.name} hat eine falsche SHA-256-Summe.`)
      }
    } catch (error) {
      rmSync(zipFile, { force: true })
      fail(`ZIP-Prüfung fehlgeschlagen: ${error.message}`)
    }
  }
  console.log(`ZIP geprüft: ${expected.length} Einträge, Größe und SHA-256 stimmen.`)
}

function writeChecksums(files) {
  if (files.length === 0) fail('Keine Release-Dateien für SHA256SUMS.txt vorhanden.')
  const rows = files.map((file) => `${sha256File(file)}  ${releaseName(file)}`)
  writeFileSync(checksumPath, `${rows.join('\n')}\n`)
  const lines = readFileSync(checksumPath, 'utf8').trim().split(/\r?\n/)
  if (lines.length !== rows.length) {
    fail(`SHA256SUMS.txt hat ${lines.length} Zeilen, erwartet ${rows.length}.`)
  }
  for (const line of lines) {
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line)
    if (!match) fail(`Ungültige Prüfsummenzeile: ${line}`)
    const target = join(RELEASE, match[2])
    if (!existsSync(target)) fail(`Prüfsummendatei verweist auf fehlende Datei: ${match[2]}`)
    if (sha256File(target) !== match[1]) fail(`Prüfsumme stimmt nicht: ${match[2]}`)
  }
  console.log(`SHA256SUMS.txt geprüft: ${rows.length} Datei(en).`)
}

if (process.platform === 'win32') {
  // Windows hat kein zip im System. Compress-Archive ist ohne Zusatzpaket da.
  run(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Compress-Archive -LiteralPath ${[finalExe, ...releaseExtras].map(psQuote).join(',')} -DestinationPath ${psQuote(zipPath)} -Force`,
    ],
    { shell: false },
  )
} else {
  run('zip', ['-q', '-j', zipPath, finalExe, ...releaseExtras])
}

const zipEntries = [
  { name: exeName, file: finalExe },
  ...releaseExtras.map((file) => ({
    name: relative(RELEASE, file).split('\\').join('/'),
    file,
  })),
]
verifyReleaseZip(zipPath, zipEntries)

const nsisAvailable = spawnSync('makensis', ['-VERSION'], { stdio: 'ignore' }).status === 0
const installerPath = join(RELEASE, `Easy-Slicer-by-Becker-Setup-${VERSION}.exe`)
rmSync(installerPath, { force: true })
let installerBuilt = false
if (!WITH_INSTALLER || !nsisAvailable) {
  console.log(nsisAvailable ? 'Installer übersprungen (KEPLER_NSIS=0).' : 'makensis fehlt — nur EXE und ZIP gebaut.')
} else {
const nsi = `Unicode true
!include "MUI2.nsh"

!define APPNAME "Easy-Slicer by Becker"
!define APPEXE "Easy-Slicer-by-Becker.exe"

Name "\${APPNAME}"
OutFile "${join(RELEASE, `Easy-Slicer-by-Becker-Setup-${VERSION}.exe`)}"
InstallDir "$LOCALAPPDATA\\Easy-Slicer-by-Becker"
InstallDirRegKey HKCU "Software\\Easy-Slicer-by-Becker" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma

!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\\\${APPEXE}"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "German"

Section "Installieren" SecMain
  SetOutPath "$INSTDIR"
  File "${finalExe}"
  WriteUninstaller "$INSTDIR\\Uninstall.exe"
  CreateShortcut "$DESKTOP\\\${APPNAME}.lnk" "$INSTDIR\\\${APPEXE}"
  CreateDirectory "$SMPROGRAMS\\\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\\\${APPNAME}\\\${APPNAME}.lnk" "$INSTDIR\\\${APPEXE}"
  CreateShortcut "$SMPROGRAMS\\\${APPNAME}\\Deinstallieren.lnk" "$INSTDIR\\Uninstall.exe"
  WriteRegStr HKCU "Software\\Easy-Slicer-by-Becker" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Easy-Slicer-by-Becker" "DisplayName" "\${APPNAME}"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Easy-Slicer-by-Becker" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Easy-Slicer-by-Becker" "Publisher" "Easy-Slicer by Becker"
  WriteRegStr HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Easy-Slicer-by-Becker" "UninstallString" "$INSTDIR\\Uninstall.exe"
  WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Easy-Slicer-by-Becker" "NoModify" 1
  WriteRegDWORD HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Easy-Slicer-by-Becker" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$INSTDIR\\\${APPEXE}"
  Delete "$INSTDIR\\Uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$DESKTOP\\\${APPNAME}.lnk"
  Delete "$SMPROGRAMS\\\${APPNAME}\\\${APPNAME}.lnk"
  Delete "$SMPROGRAMS\\\${APPNAME}\\Deinstallieren.lnk"
  RMDir "$SMPROGRAMS\\\${APPNAME}"
  DeleteRegKey HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Easy-Slicer-by-Becker"
  DeleteRegKey HKCU "Software\\Easy-Slicer-by-Becker"
SectionEnd
`

  const nsiPath = join(BUILD, 'installer.nsi')
  writeFileSync(nsiPath, nsi)
  run('makensis', ['-V2', nsiPath])
  installerBuilt = existsSync(installerPath)
  if (!installerBuilt) fail('Installer wurde nicht erzeugt.')
}

const artifacts = [finalExe, zipPath, ...(installerBuilt ? [installerPath] : [])]
writeChecksums(artifacts)
console.log(
  `\nFertig: ${['EXE', 'ZIP', ...(installerBuilt ? ['Installer'] : [])].join(', ')} und SHA256SUMS.txt liegen in release/.`,
)
