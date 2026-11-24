import assert from 'node:assert/strict'
import { box } from '../server/meshlib.ts'
import { buildBinarySTL, parseSTL } from '../server/slicer/stl.ts'
import { sliceMesh } from '../server/slicer/index.ts'
import { printerById } from '../shared/catalog.ts'
import { DEFAULT_SETTINGS, mergeSettings, type PrintSettings, type ScarfSeamSettings } from '../shared/types.ts'
import { SETTING_INFO } from '../src/settingsInfo.ts'

const printer = printerById('flashforge-ad5x')
const mesh = parseSTL(buildBinarySTL(box(30, 30, 10)))

const OFF: ScarfSeamSettings = {
  enabled: false,
  length: 20,
  startHeight: 15,
  steps: 10,
  flow: 1,
  innerWalls: false,
}

function settings(scarf: Partial<ScarfSeamSettings>, extra: Partial<PrintSettings> = {}): PrintSettings {
  return mergeSettings(DEFAULT_SETTINGS, {
    layerHeight: 0.2,
    firstLayerHeight: 0.2,
    walls: 1,
    topLayers: 1,
    bottomLayers: 1,
    infillDensity: 0,
    adhesion: 'none',
    primeLine: { enabled: false },
    ironing: { enabled: false },
    surfaceGuard: { enabled: false },
    fuzzySkin: { mode: 'off' },
    seam: { position: 'rear', gap: 0, wipe: false, scarf: { ...OFF, ...scarf } },
    output: { verbosePaths: true },
    ...extra,
  })
}

function slice(scarf: Partial<ScarfSeamSettings>, extra: Partial<PrintSettings> = {}) {
  return sliceMesh(mesh, settings(scarf, extra), printer, null, [], {
    start: false,
    end: false,
    metadata: false,
  })
}

type Sample = { x: number; y: number; z: number; ePerMm: number; dist: number }
type WallSection = { top: number; endZ: number; samples: Sample[] }

function layerSection(gcode: string, layer: number): string {
  const parts = gcode.split(/;LAYER:/)
  const section = parts[layer]
  assert.ok(section, `Schicht ${layer} fehlt im G-Code`)
  return section
}

/** Liest nur extrudierende G1-Bewegungen eines Bahntyps und die Z-Höhe. */
function wallSection(gcode: string, layer: number, kind = 'outer-wall'): WallSection {
  const section = layerSection(gcode, layer)
  const topMatch = /^; Z:([\d.]+)/m.exec(section)
  const top = topMatch ? Number(topMatch[1]) : layer * 0.2
  let active = false
  let currentZ = top
  let previousE = 0
  let haveE = false
  let lastX: number | null = null
  let lastY: number | null = null
  const samples: Sample[] = []
  for (const raw of section.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('; TYPE:')) {
      active = line === `; TYPE: ${kind}`
      continue
    }
    if (!active) continue
    const zOnly = /^G1 Z(-?[\d.]+)/.exec(line)
    if (zOnly && !/^G1 X/.test(line)) {
      currentZ = Number(zOnly[1])
      continue
    }
    const match = /^G1 X(-?[\d.]+) Y(-?[\d.]+)(?: Z(-?[\d.]+))? E(-?[\d.]+)/.exec(line)
    if (!match) continue
    const x = Number(match[1])
    const y = Number(match[2])
    const z = match[3] !== undefined ? Number(match[3]) : currentZ
    const e = Number(match[4])
    const dist = lastX !== null && lastY !== null ? Math.hypot(x - lastX, y - lastY) : 0
    const eDelta = haveE ? e - previousE : 0
    if (dist > 1e-6) samples.push({ x, y, z, dist, ePerMm: eDelta / dist })
    lastX = x
    lastY = y
    previousE = e
    haveE = true
    currentZ = z
  }
  return { top, endZ: currentZ, samples }
}

const intermediate = (section: WallSection) =>
  section.samples.filter((sample) => sample.z < section.top - 0.005 && sample.z > section.top - 0.19).length

const baseline = slice({ enabled: false })
const scarf = slice({ enabled: true })
const scarfAgain = slice({ enabled: true })

assert.equal(scarf.gcode, scarfAgain.gcode, 'Scarf-Naht muss deterministisch sein')
assert.ok(!/\bNaN\b|Infinity/.test(scarf.gcode), 'Scarf-G-Code enthält ungültige Koordinaten')

const baseSecond = wallSection(baseline.gcode, 2)
const scarfSecond = wallSection(scarf.gcode, 2)
assert.equal(intermediate(baseSecond), 0, 'Ohne Scarf darf die zweite Schicht keine Zwischenhöhen haben')
assert.ok(scarfSecond.samples.length >= 10, 'Scarf-Naht muss die Wand in Rampenstützpunkte teilen')
assert.ok(intermediate(scarfSecond) >= 3, 'Scarf-Naht muss mehrere Zwischenhöhen erzeugen')
assert.ok(
  scarfSecond.samples.every((sample) => sample.z >= 0.2 - 1e-6 && sample.z <= scarfSecond.top + 1e-6),
  'Scarf-Naht darf nicht unter die vorherige oder über die aktuelle Schicht laufen',
)
const scarfMin = Math.min(...scarfSecond.samples.map((sample) => sample.z))
const scarfMax = Math.max(...scarfSecond.samples.map((sample) => sample.z))
assert.ok(scarfMax >= 0.399, `Scarf muss die volle Schichthöhe erreichen: ${scarfMax}`)
assert.ok(Math.abs(scarfMin - 0.23) < 0.025, `Scarf-Starthöhe 15 % falsch: ${scarfMin}`)
assert.ok(Math.abs(scarfSecond.endZ - 0.4) < 0.002, 'Nach der Rampe muss die Düse wieder auf Schichthöhe stehen')

const highStart = wallSection(slice({ enabled: true, startHeight: 50 }).gcode, 2)
assert.ok(
  Math.abs(Math.min(...highStart.samples.map((sample) => sample.z)) - 0.3) < 0.025,
  'Scarf-Starthöhe 50 % muss auf halber Schichthöhe beginnen',
)
const zeroStart = wallSection(slice({ enabled: true, startHeight: 0 }).gcode, 2)
assert.ok(
  zeroStart.samples.every((sample) => sample.z >= 0.2 - 1e-6),
  'Scarf-Starthöhe 0 darf nicht unter die vorherige Schicht fallen',
)

// Der Fluss ist an den Rampenenden deutlich kleiner als in der Wandmitte.
const firstFlow = scarfSecond.samples[0]?.ePerMm ?? 0
const midFlow = scarfSecond.samples[Math.floor(scarfSecond.samples.length / 2)]?.ePerMm ?? 0
assert.ok(midFlow > 0, 'Testbedingung: Wandmitte ohne Extrusionsfluss')
assert.ok(firstFlow < midFlow * 0.6, `Scarf-Anfang muss weniger Material fördern: ${firstFlow} / ${midFlow}`)

// Die erste Schicht bleibt unangetastet, auch wenn die Scarf-Naht aktiv ist.
const firstLayerScarf = wallSection(scarf.gcode, 1)
assert.equal(intermediate(firstLayerScarf), 0, 'Scarf-Naht darf auf Schicht 1 nicht aktiv sein')
assert.ok(
  firstLayerScarf.samples.every((sample) => Math.abs(sample.z - 0.2) < 1e-6),
  'Erste Schicht muss trotz Scarf auf ihrer Höhe bleiben',
)

// Die Rampe erreicht die volle Höhe ungefähr nach der eingestellten Länge.
function distanceToFullHeight(section: WallSection): number {
  let distance = 0
  for (const sample of section.samples) {
    distance += sample.dist
    if (sample.z >= section.top - 0.005) return distance
  }
  return Infinity
}
const shortScarf = wallSection(slice({ enabled: true, length: 10 }).gcode, 2)
const longScarf = wallSection(slice({ enabled: true, length: 20 }).gcode, 2)
const shortDistance = distanceToFullHeight(shortScarf)
const longDistance = distanceToFullHeight(longScarf)
assert.ok(Math.abs(shortDistance - 10) < 3, `Kurze Scarf-Rampe endet zu spät: ${shortDistance}`)
assert.ok(Math.abs(longDistance - 20) < 3, `Lange Scarf-Rampe endet zu spät: ${longDistance}`)
assert.ok(longDistance > shortDistance, 'Längere Scarf-Rampe muss länger brauchen')

// 0 mm und deaktiviert schalten die Rampe ab.
assert.equal(intermediate(wallSection(slice({ enabled: true, length: 0 }).gcode, 2)), 0)

// Innenwände standardmäßig glatt, optional mit Scarf.
const innerOff = wallSection(slice({ enabled: true, innerWalls: false }, { walls: 2 }).gcode, 2, 'inner-wall')
const innerOn = wallSection(slice({ enabled: true, innerWalls: true }, { walls: 2 }).gcode, 2, 'inner-wall')
assert.equal(intermediate(innerOff), 0, 'Scarf darf Innenwände standardmäßig nicht verändern')
assert.ok(intermediate(innerOn) >= 2, 'Scarf muss Innenwände optional erfassen')

const oldProfile = mergeSettings(DEFAULT_SETTINGS, { seam: { gap: 0.1 } as any })
assert.equal(oldProfile.seam.scarf.enabled, false, 'Alte Profile müssen eine ausgeschaltete Scarf-Naht bekommen')
assert.equal(oldProfile.seam.scarf.length, 20, 'Alte Profile müssen den Standardwert für die Scarf-Länge bekommen')
for (const key of ['Scarf-Naht', 'Scarf-Länge|mm', 'Scarf-Starthöhe|%', 'Scarf-Schritte', 'Scarf-Fluss|×', 'Scarf auch Innenwände']) {
  assert.ok(SETTING_INFO[key], `Info-Punkt fehlt: ${key}`)
}

console.log(
  `OK: Scarf-Naht ab Schicht 2; ${intermediate(scarfSecond)} Zwischenhöhen, ` +
    `Z ${scarfMin.toFixed(2)}–${scarfMax.toFixed(2)} mm, Fluss ${firstFlow.toFixed(3)} → ${midFlow.toFixed(3)} E/mm; ` +
    `Länge 10/20 mm, Innenwände optional, alte Profile kompatibel.`,
)