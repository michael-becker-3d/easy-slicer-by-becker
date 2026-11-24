import assert from 'node:assert/strict'
import { box } from '../server/meshlib.ts'
import { makeMesh } from '../server/slicer/stl.ts'
import { sliceMesh } from '../server/slicer/index.ts'
import { planWalls } from '../server/slicer/walls.ts'
import { printerById } from '../shared/catalog.ts'
import { heightRangeAt, heightRangeSettings } from '../shared/heightRanges.ts'
import { DEFAULT_SETTINGS, mergeSettings, type HeightRangeModifier, type PrintSettings } from '../shared/types.ts'
import { SETTING_INFO } from '../src/settingsInfo.ts'

const printer = printerById('flashforge-ad5x')

function rect(width: number, height = 20): { x: number; y: number }[][] {
  return [[
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ]]
}

function settings(extra: Partial<PrintSettings> = {}): PrintSettings {
  return mergeSettings(DEFAULT_SETTINGS, {
    layerHeight: 0.2,
    firstLayerHeight: 0.2,
    lineWidth: 0.4,
    walls: 1,
    topLayers: 2,
    bottomLayers: 2,
    infillDensity: 20,
    adhesion: 'none',
    support: { kind: 'none' },
    primeLine: { enabled: false },
    ironing: { enabled: false },
    surfaceGuard: { enabled: false },
    fuzzySkin: { mode: 'off' },
    seam: { position: 'rear', gap: 0, wipe: false, scarf: { enabled: false } },
    output: { verbosePaths: true },
    ...extra,
  })
}

function slice(s: PrintSettings, mesh = makeMesh(new Float32Array(box(20, 10, 20).flat()))) {
  return sliceMesh(mesh, s, printer, null, [], { start: false, end: false, metadata: false })
}

function layerSection(gcode: string, index: number): string {
  const section = gcode.split(/;LAYER:/)[index + 1]
  assert.ok(section, `Schicht ${index + 1} fehlt im G-Code`)
  return section
}

function typeCount(section: string, type: string): number {
  return [...section.matchAll(new RegExp(`; TYPE: ${type}\\b`, 'g'))].length
}

function firstSpeed(section: string, type: string): number {
  const start = section.indexOf(`; TYPE: ${type}`)
  assert.ok(start >= 0, `Pfadtyp ${type} fehlt`)
  // Nicht die Entlastungszeile `G1 E… F2400` nehmen: Sie hat eine feste
  // Retract-Geschwindigkeit und sagt nichts über die Wandgeschwindigkeit.
  for (const raw of section.slice(start).split(/\r?\n/)) {
    const line = raw.trim()
    if (!/^G1 X-?[\d.]+ Y-?[\d.]+/.test(line) || !/E-?[\d.]+/.test(line)) continue
    const match = /F(\d+(?:\.\d+)?)/.exec(line)
    if (match) return Number(match[1])
  }
  assert.fail(`Keine Extrusionsgeschwindigkeit nach ${type}`)
}

function ePerMm(section: string, type: string): number {
  let active = false
  let lastX: number | null = null
  let lastY: number | null = null
  let lastE: number | null = null
  let distance = 0
  let eSum = 0
  for (const raw of section.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('; TYPE:')) {
      active = line === `; TYPE: ${type}`
      continue
    }
    const match = /^G1 X(-?[\d.]+) Y(-?[\d.]+)(?: Z(-?[\d.]+))? E(-?[\d.]+)/.exec(line)
    if (!active || !match) continue
    const x = Number(match[1])
    const y = Number(match[2])
    const e = Number(match[4])
    if (lastX !== null && lastY !== null && lastE !== null) {
      const d = Math.hypot(x - lastX, y - lastY)
      if (d > 1e-6) {
        distance += d
        eSum += e - lastE
      }
    }
    lastX = x
    lastY = y
    lastE = e
  }
  assert.ok(distance > 0, `Keine Bahn vom Typ ${type}`)
  return eSum / distance
}

/**
 * Bei einer geraden Zwei-Punkt-Lücke besteht der Pfad aus genau einer
 * Extrusionszeile. Dann ist die absolute E-Differenz zur vorherigen
 * Entlastungszeile die belastbare Messgröße; eine Strecke lässt sich aus dem
 * G-Code allein nicht rekonstruieren, weil der Startpunkt nur als Fahrziel
 * vorkommt.
 */
function extrusionDelta(section: string, type: string): number {
  const start = section.indexOf(`; TYPE: ${type}`)
  assert.ok(start >= 0, `Pfadtyp ${type} fehlt`)
  const lines = section.slice(start).split(/\r?\n/)
  let before: number | null = null
  for (const raw of lines) {
    const line = raw.trim()
    const eOnly = /^G1 E(-?[\d.]+)/.exec(line)
    if (eOnly) {
      before = Number(eOnly[1])
      continue
    }
    const move = /^G1 X-?[\d.]+ Y-?[\d.]+(?: Z-?[\d.]+)? E(-?[\d.]+)/.exec(line)
    if (move && before !== null) return Number(move[1]) - before
  }
  assert.fail(`Keine Extrusionszeile nach ${type}`)
}

// 1) Gap-Fill: nur Bereiche schmaler als eine Wand werden zur Mittellinie.
const narrow = planWalls(rect(0.25) as any, 0.4, 1)
assert.equal(narrow.rings.length, 0, 'Eine 0,25-mm-Fläche darf keinen vollen Ring bekommen')
assert.equal(narrow.thin.length, 1, 'Eine 0,25-mm-Fläche braucht genau eine Lückenfüllung')
assert.ok(narrow.thin[0].width >= 0.2 && narrow.thin[0].width <= 0.41, `Gap-Breite außerhalb der Grenzen: ${narrow.thin[0].width}`)

const narrowOff = planWalls(rect(0.25) as any, 0.4, 1, undefined, { enabled: false, minWidth: 0.2, maxWidth: 0.44 })
assert.equal(narrowOff.thin.length, 0, 'Gap-Fill aus muss die Mittellinie weglassen')

const widthLimited = planWalls(rect(0.35) as any, 0.4, 1, undefined, { enabled: true, minWidth: 0.25, maxWidth: 0.3 })
assert.ok(widthLimited.thin.length > 0, 'Testbedingung: breite Lücke fehlt')
assert.ok(widthLimited.thin.every((p) => p.width >= 0.249 && p.width <= 0.301), 'Max. Gap-Breite muss die Bahn begrenzen')

const minLimited = planWalls(rect(0.25) as any, 0.4, 1, undefined, { enabled: true, minWidth: 0.3, maxWidth: 0.44 })
assert.ok(minLimited.thin.length > 0 && minLimited.thin.every((p) => p.width >= 0.299), 'Min. Gap-Breite muss angehoben werden')

// 2) Der Gap-Fluss kommt im G-Code an und aus schaltet die Bahn wirklich ab.
const thinMesh = makeMesh(new Float32Array(box(20, 10, 0.25).flat()))
const gapBase = settings({ gapFill: { enabled: true, minWidth: 0.2, maxWidth: 0.44, flow: 1 } })
const gapHeavy = settings({ gapFill: { enabled: true, minWidth: 0.2, maxWidth: 0.44, flow: 1.5 } })
const gapOff = settings({ gapFill: { enabled: false, minWidth: 0.2, maxWidth: 0.44, flow: 1 } })
const gapBaseResult = slice(gapBase, thinMesh)
const gapHeavyResult = slice(gapHeavy, thinMesh)
const gapOffResult = slice(gapOff, thinMesh)
const gapBaseE = extrusionDelta(layerSection(gapBaseResult.gcode, 5), 'inner-wall')
const gapHeavyE = extrusionDelta(layerSection(gapHeavyResult.gcode, 5), 'inner-wall')
assert.ok(gapHeavyE > gapBaseE * 1.35, `Gap-Fluss muss die Extrusion erhöhen: ${gapBaseE} / ${gapHeavyE}`)
assert.equal(typeCount(layerSection(gapOffResult.gcode, 5), 'inner-wall'), 0, 'Gap-Fill aus darf keine Innenbahn erzeugen')
assert.ok(gapBaseE > 0.1 && gapBaseE < 5, `Gap-E pro Bahn unplausibel: ${gapBaseE}`)

// 3) Höhenbereiche: reine Auswahl und vollständige Einstellungen.
const ranges: HeightRangeModifier[] = [
  { from: 0, to: 2.2, label: 'unten', patch: { speedFactor: 0.5, flow: 0.9, lineWidthFactor: 1.25, walls: 2, infillDensity: 45 } },
  { from: 4, to: 6.2, label: 'mitte', patch: { speedFactor: 1.5, walls: 3, infillDensity: 10 } },
]
const rangedBase = settings({ heightRanges: ranges })
assert.equal(heightRangeAt(ranges, 1.2)?.label, 'unten', 'Erster passender Bereich muss gewinnen')
assert.equal(heightRangeAt(ranges, 3)?.label, undefined, 'Zwischen Bereichen darf nichts gelten')
assert.equal(heightRangeAt(ranges, 4)?.label, 'mitte', 'Bereichsgrenze muss einschließen')
assert.equal(heightRangeAt(ranges, 6.2), null, 'Obere Grenze muss exklusiv sein')

const lower = heightRangeSettings(rangedBase, 1.2)
assert.equal(lower.walls, 2, 'Wandzahl muss aus dem Bereich kommen')
assert.equal(lower.infillDensity, 45, 'Füllgrad muss aus dem Bereich kommen')
assert.ok(Math.abs(lower.speeds.outerWall - rangedBase.speeds.outerWall * 0.5) < 1, 'Tempo-Faktor muss greifen')
assert.ok(Math.abs(lower.lineWidth - 0.5) < 1e-9, `Linienbreite muss skaliert werden: ${lower.lineWidth}`)
assert.ok(Math.abs(lower.flow - 0.9) < 1e-9, 'Fluss muss aus dem Bereich kommen')
assert.equal(heightRangeSettings(rangedBase, 0.2).walls, 2, 'Helper wendet den Bereich an; die erste Schicht wird im Slice ausgenommen')

// 4) Der Slice wendet den Bereich auf Wände, Füllung, Tempo und Fluss an.
const plain = slice(settings())
const ranged = slice(rangedBase)
assert.equal(plain.stats.layerCount, 50)
assert.equal(ranged.stats.layerCount, 50)
assert.equal(layerSection(ranged.gcode, 0), layerSection(plain.gcode, 0), 'Erste Schicht muss unverändert bleiben')
assert.equal(typeCount(layerSection(ranged.gcode, 1), 'inner-wall'), 1, 'Bereich ab 0,2 mm muss zwei Wände erzeugen')
assert.equal(typeCount(layerSection(plain.gcode, 1), 'inner-wall'), 0, 'Ohne Bereich bleibt eine Wand')
assert.equal(typeCount(layerSection(ranged.gcode, 15), 'inner-wall'), 0, 'Nach Bereichsende muss die Wandzahl zurückfallen')
assert.equal(typeCount(layerSection(ranged.gcode, 25), 'inner-wall'), 2, 'Zweiter Bereich muss drei Wände erzeugen')
assert.ok(firstSpeed(layerSection(ranged.gcode, 5), 'outer-wall') < firstSpeed(layerSection(plain.gcode, 5), 'outer-wall'), 'Bereich muss das Tempo senken')
assert.ok(firstSpeed(layerSection(ranged.gcode, 25), 'outer-wall') > firstSpeed(layerSection(plain.gcode, 15), 'outer-wall'), 'Zweiter Bereich muss das Tempo erhöhen')
const plainE = ePerMm(layerSection(plain.gcode, 5), 'outer-wall')
const rangedE = ePerMm(layerSection(ranged.gcode, 5), 'outer-wall')
assert.ok(rangedE > plainE * 1.03, `Linienbreite/Fluss müssen die Extrusion erhöhen: ${plainE} / ${rangedE}`)
const afterRange = layerSection(ranged.gcode, 40)
const plainAfter = layerSection(plain.gcode, 40)
assert.equal(typeCount(afterRange, 'inner-wall'), 0, 'Nach allen Bereichen muss die Wandzahl wieder 1 sein')
assert.equal(firstSpeed(afterRange, 'outer-wall'), firstSpeed(plainAfter, 'outer-wall'), 'Nach allen Bereichen muss das Basistempo wieder gelten')
assert.equal(
  afterRange.replace(/E-?[\d.]+/g, 'E'),
  plainAfter.replace(/E-?[\d.]+/g, 'E'),
  'Nach allen Bereichen muss die Bahngeometrie wieder der Basis entsprechen',
)
assert.ok(typeCount(layerSection(ranged.gcode, 25), 'sparse') < typeCount(layerSection(plain.gcode, 25), 'sparse'), 'Weniger Füllung muss weniger Bahnen erzeugen')

assert.ok(!/\bNaN\b|Infinity/.test(ranged.gcode), 'G-Code enthält ungültige Koordinaten')
assert.equal(ranged.gcode, slice(rangedBase).gcode, 'Höhenbereiche müssen deterministisch sein')

// 5) Alte Profile und UI-Texte.
const oldProfile = mergeSettings(DEFAULT_SETTINGS, { layerHeight: 0.2 } as any)
assert.equal(oldProfile.gapFill.enabled, true, 'Gap-Fill muss für alte Profile standardmäßig an sein')
assert.deepEqual(oldProfile.heightRanges, [], 'Alte Profile dürfen keine Höhenbereiche bekommen')
for (const key of ['Gap-Fill', 'Min. Gap-Breite|mm', 'Max. Gap-Breite|mm', 'Gap-Fluss|×', 'Height-Range-Modifier']) {
  assert.ok(SETTING_INFO[key], `Info-Punkt fehlt: ${key}`)
}

console.log(
  `OK: Gap-Fill ${narrow.thin[0].width.toFixed(3)} mm (aus: 0, begrenzt: ${widthLimited.thin[0]?.width.toFixed(3)} mm), ` +
    `Fluss ${gapBaseE.toFixed(4)} → ${gapHeavyE.toFixed(4)} E je Bahn; Höhenbereiche: Schicht 2 ${typeCount(layerSection(ranged.gcode, 1), 'inner-wall')} Innenwand, ` +
    `Schicht 26 ${typeCount(layerSection(ranged.gcode, 25), 'inner-wall')} Innenwände, Tempo ` +
    `${firstSpeed(layerSection(ranged.gcode, 5), 'outer-wall')} < ${firstSpeed(layerSection(plain.gcode, 5), 'outer-wall')} und ` +
    `${firstSpeed(layerSection(ranged.gcode, 25), 'outer-wall')} > ${firstSpeed(layerSection(plain.gcode, 15), 'outer-wall')} mm/min.`,
)