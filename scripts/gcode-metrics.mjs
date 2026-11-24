// Zählt Vergleichswerte in einer G-Code-Datei (absoluter und relativer E-Modus).
import fs from 'node:fs'

const file = process.argv[2]
if (!file) throw new Error('Aufruf: node scripts/gcode-metrics.mjs <datei.gcode>')
const text = fs.readFileSync(file, 'utf8')
const lines = text.split(/\r?\n/)

const NUM = String.raw`-?(?:\d+(?:\.\d*)?|\.\d+)`
const RE_Z = new RegExp(String.raw`^G[01] Z(${NUM})`)
const RE_E_ONLY = new RegExp(String.raw`^G1 E(${NUM}) F\d+$`)
const RE_X = new RegExp(String.raw`X(${NUM})`)
const RE_Y = new RegExp(String.raw`Y(${NUM})`)
const RE_E = new RegExp(String.raw`E(${NUM})`)

let lastE = 0
let lastX = null
let lastY = null
let retractions = 0
let retractMm = 0
let zMoves = 0
let travels = 0
let travelMm = 0
let layers = 0
let maxZ = 0
let extrusionMm = 0

for (const raw of lines) {
  const trimmed = raw.trim()
  if (trimmed.startsWith(';LAYER:') || trimmed.startsWith(';LAYER_CHANGE')) layers++
  // Kommentar am Zeilenende abschneiden (Orca schreibt "; retract" hinter den Befehl).
  const line = trimmed.split(';')[0].trim()
  if (!line) continue

  const zMatch = line.match(RE_Z)
  if (zMatch) {
    zMoves++
    maxZ = Math.max(maxZ, Number(zMatch[1]))
    continue
  }

  const eOnly = line.match(RE_E_ONLY)
  if (eOnly) {
    const e = Number(eOnly[1])
    if (e < 0) {
      // Relativer Modus: negativer E-Satz ist der Rückzug selbst.
      retractions++
      retractMm += Math.abs(e)
    } else if (e < lastE - 1e-9) {
      // Absoluter Modus: reiner E-Satz mit kleinerem Wert.
      retractions++
      retractMm += lastE - e
    }
    lastE = e
    continue
  }

  if (/^G[01] /.test(line) && /[XY]/.test(line)) {
    const x = Number(line.match(RE_X)?.[1])
    const y = Number(line.match(RE_Y)?.[1])
    const e = Number(line.match(RE_E)?.[1])
    if (Number.isFinite(e)) {
      if (e > 0) extrusionMm += e
      lastE = e
    }
    // Leerfahrt: Bewegung mit X/Y ohne Extrusion — egal ob G0 oder G1.
    const isTravel = !Number.isFinite(e)
    if (Number.isFinite(x) && Number.isFinite(y)) {
      if (isTravel) {
        travels++
        if (lastX !== null) travelMm += Math.hypot(x - lastX, y - lastY)
      }
      lastX = x
      lastY = y
    }
  }
}

const duration = text.match(/; Dauer \(Schaetzung\): ([\d.]+) min/)
const filament = text.match(/; Filament: ([\d.]+) mm/)

console.log(
  JSON.stringify(
    {
      file,
      layers,
      maxZ: Math.round(maxZ * 100) / 100,
      retractions,
      retractMm: Math.round(retractMm * 10) / 10,
      zMoves,
      travels,
      travelMm: Math.round(travelMm * 10) / 10,
      seconds: duration ? Math.round(Number(duration[1]) * 60) : null,
      filamentMm: filament ? Number(filament[1]) : Math.round(extrusionMm * 10) / 10,
      bytes: text.length,
    },
    null,
    2,
  ),
)
