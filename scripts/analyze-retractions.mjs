// Ordnet Rückzüge der Pfadart davor/danach zu (über die Vorschubgeschwindigkeit)
// und zählt sie je Schicht. Reine Analyse: liest nur.
import fs from 'node:fs'

const file = process.argv[2]
if (!file) throw new Error('Aufruf: node scripts/analyze-retractions.mjs <datei.gcode>')
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)

let layer = 0
let lastE = 0
let prevFeed = null
let lastX = null
let lastY = null
const perLayer = new Map()
const pairs = new Map()
let retractions = 0
const pendingRetract = { active: false, layer: 0, prevFeed: null, distance: null }

const flush = (nextFeed, distance) => {
  if (!pendingRetract.active) return
  const key = `${pendingRetract.prevFeed ?? '?'} → ${nextFeed ?? '?'}`
  const g = pairs.get(key) ?? { count: 0, distances: [] }
  g.count++
  if (distance !== null) g.distances.push(distance)
  pairs.set(key, g)
  pendingRetract.active = false
}

for (const raw of lines) {
  const line = raw.trim()
  if (line.startsWith(';LAYER:')) {
    const m = line.match(/:(\d+)/)
    if (m) layer = Number(m[1])
    continue
  }
  const eOnly = line.match(/^G1 E(-?\d+(?:\.\d+)?) F(\d+)$/)
  if (eOnly) {
    const e = Number(eOnly[1])
    if (e < lastE - 1e-9) {
      retractions++
      perLayer.set(layer, (perLayer.get(layer) ?? 0) + 1)
      pendingRetract.active = true
      pendingRetract.layer = layer
      pendingRetract.prevFeed = prevFeed
      pendingRetract.distance = null
    }
    lastE = e
    continue
  }
  const move = line.match(/^G([01]) (.*)$/)
  if (move) {
    const x = Number(line.match(/X(-?\d+(?:\.\d+)?)/)?.[1])
    const y = Number(line.match(/Y(-?\d+(?:\.\d+)?)/)?.[1])
    const e = Number(line.match(/E(-?\d+(?:\.\d+)?)/)?.[1])
    const f = Number(line.match(/F(\d+)/)?.[1])
    if (Number.isFinite(e)) lastE = e
    if (Number.isFinite(x) && Number.isFinite(y)) {
      const dist = lastX === null ? null : Math.hypot(x - lastX, y - lastY)
      lastX = x
      lastY = y
      if (pendingRetract.active && pendingRetract.distance === null && move[1] === '0') {
        pendingRetract.distance = dist
      }
    }
    if (Number.isFinite(f) && Number.isFinite(x) && Number.isFinite(y) && move[1] === '1' && Number.isFinite(e)) {
      prevFeed = f
      flush(f, pendingRetract.distance)
    }
    continue
  }
}

const feedToMm = (f) => (f ? Math.round((f / 60) * 10) / 10 : null)
const summary = [...pairs.entries()]
  .map(([key, g]) => {
    const d = g.distances.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
    return {
      key: key
        .split(' → ')
        .map((part) => (part === '?' ? '?' : `${feedToMm(Number(part))} mm/s`))
        .join(' → '),
      count: g.count,
      medianTravel: d.length ? Math.round(d[Math.floor(d.length / 2)] * 10) / 10 : null,
      maxTravel: d.length ? Math.round(d[d.length - 1] * 10) / 10 : null,
    }
  })
  .sort((a, b) => b.count - a.count)

const layers = [...perLayer.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
console.log(JSON.stringify({ file, retractions, summary, topLayers: layers }, null, 2))
