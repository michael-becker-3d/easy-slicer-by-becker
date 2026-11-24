import assert from 'node:assert/strict'
import { buildCalibration } from '../server/calibration.ts'
import { box } from '../server/meshlib.ts'
import { buildBinarySTL, parseSTL } from '../server/slicer/stl.ts'
import { sliceMesh } from '../server/slicer/index.ts'
import { applyPrinterLimits } from '../shared/limits.ts'
import { DEFAULT_SETTINGS, mergeSettings, type FuzzySkinSettings } from '../shared/types.ts'
import { filamentById, printerById } from '../shared/catalog.ts'
import { SETTING_INFO } from '../src/settingsInfo.ts'
import {
  SURFACE_TEXTURE_PATTERNS,
  SURFACE_TEXTURE_PRESETS,
  surfaceTextureDetail,
  surfaceTextureOffset,
  surfaceTextureSwatch,
  topSurfaceTextureAmplitude,
  topSurfaceTextureHeight,
  topSurfaceTextureSpacing,
  textureZoneAt,
  type TextureZone,
} from '../shared/surfaceTexture.ts'

const samples: [number, number, number][] = [
  [0, 0, 0.2],
  [1.3, 2.1, 0.4],
  [5.7, -2.4, 1.2],
  [-8.2, 4.8, 2.4],
  [12.5, 7.1, 4.8],
  [-3.3, -9.6, 7.5],
  [20.4, 0.7, 10.2],
  [2.8, 14.2, 13.6],
]

const patterns = SURFACE_TEXTURE_PATTERNS.map((entry) => entry.value)
assert.equal(patterns.length, 14, 'Alle vierzehn Oberflächenmuster müssen verfügbar sein')
assert.equal(
  new Set(patterns).size,
  patterns.length,
  'Die Musterauswahl darf keine doppelten Einträge enthalten',
)
for (const entry of SURFACE_TEXTURE_PATTERNS) {
  assert.ok(entry.label.trim(), `${entry.value}: UI-Label fehlt`)
  assert.ok(entry.hint.trim(), `${entry.value}: UI-Hinweis fehlt`)
}
const patternInfo = SETTING_INFO['Oberflächenmuster']
assert.ok(patternInfo, 'Info-Punkt für Oberflächenmuster fehlt')
for (const entry of SURFACE_TEXTURE_PATTERNS) {
  assert.ok(patternInfo.includes(entry.label), `${entry.value}: Label fehlt im Info-Punkt`)
}

const signatures = new Set<string>()
for (const pattern of patterns) {
  const values = samples.map(([x, y, z]) => surfaceTextureOffset(x, y, z, pattern, 3, 0))
  for (const value of values) {
    assert.ok(Number.isFinite(value), `${pattern}: Auslenkung ist keine endliche Zahl`)
    assert.ok(value >= -1 && value <= 1, `${pattern}: Auslenkung liegt außerhalb [-1, 1]`)
  }
  const repeat = samples.map(([x, y, z]) => surfaceTextureOffset(x, y, z, pattern, 3, 0))
  assert.deepEqual(values, repeat, `${pattern}: Muster ist nicht deterministisch`)
  assert.ok(new Set(values.map((value) => value.toFixed(4))).size > 3, `${pattern}: Struktur ist zu flach`)
  signatures.add(values.map((value) => value.toFixed(4)).join('|'))
}
assert.equal(signatures.size, patterns.length, 'Muster müssen sich voneinander unterscheiden')

// Musteratlas und Presets: Die Kacheln kommen aus derselben Engine wie der
// Wand-G-code. Geprüft werden nicht nur die Listen, sondern auch die
// tatsächlichen Swatch-Werte und die Grenzen der UI-Regler.
for (const pattern of patterns) {
  const swatch = surfaceTextureSwatch(pattern, 4, 0, 10, 12, 2)
  assert.equal(swatch.length, 100, `${pattern}: Swatch muss 10 × 10 Werte liefern`)
  for (const value of swatch) {
    assert.ok(Number.isFinite(value), `${pattern}: Swatch enthält keinen endlichen Wert`)
    assert.ok(value >= -1 && value <= 1, `${pattern}: Swatch liegt außerhalb [-1, 1]`)
  }
}
const swatchSignatures = new Set<string>()
for (const pattern of patterns) {
  swatchSignatures.add(
    surfaceTextureSwatch(pattern, 4, 0, 10, 12, 2)
      .map((value) => value.toFixed(4))
      .join('|'),
  )
}
assert.equal(swatchSignatures.size, patterns.length, 'Alle Muster brauchen unterscheidbare Swatches')

assert.ok(SURFACE_TEXTURE_PRESETS.length >= 8, 'Es müssen mindestens acht Textur-Presets verfügbar sein')
const presetIds = new Set<string>()
const presetPatterns = new Set<string>()
for (const preset of SURFACE_TEXTURE_PRESETS) {
  assert.ok(preset.id.trim(), 'Preset ohne Id')
  assert.ok(!presetIds.has(preset.id), `Doppelte Preset-Id: ${preset.id}`)
  presetIds.add(preset.id)
  assert.ok(preset.label.trim(), `${preset.id}: Preset-Label fehlt`)
  assert.ok(preset.hint.trim(), `${preset.id}: Preset-Hinweis fehlt`)
  assert.ok(patterns.includes(preset.pattern), `${preset.id}: unbekanntes Muster ${preset.pattern}`)
  presetPatterns.add(preset.pattern)
  assert.ok(preset.thickness >= 0 && preset.thickness <= 1.5, `${preset.id}: Tiefe außerhalb der UI-Grenzen`)
  assert.ok(preset.scale >= 0.5 && preset.scale <= 20, `${preset.id}: Merkmalsgröße außerhalb der UI-Grenzen`)
  assert.ok(
    preset.pointDistance >= 0.2 && preset.pointDistance <= 3,
    `${preset.id}: Punktabstand außerhalb der UI-Grenzen`,
  )
  assert.ok(preset.angle >= 0 && preset.angle <= 180, `${preset.id}: Richtung außerhalb der UI-Grenzen`)
  assert.ok(
    surfaceTextureSwatch(preset.pattern, preset.scale, preset.angle, 10, 12, 2).some(
      (value) => Math.abs(value) > 0.05,
    ),
    `${preset.id}: Preset-Swatch ist leer`,
  )
}
assert.ok(presetPatterns.size >= 6, 'Die Presets müssen mehrere Musterfamilien abdecken')
assert.equal(
  new Set(SURFACE_TEXTURE_PRESETS.map((preset) => preset.label)).size,
  SURFACE_TEXTURE_PRESETS.length,
  'Preset-Labels müssen eindeutig sein',
)
assert.ok(SETTING_INFO['Musteratlas'], 'Info-Punkt für den Musteratlas fehlt')
assert.ok(SETTING_INFO['Textur-Presets'], 'Info-Punkt für die Textur-Presets fehlt')

const grain0 = samples.map(([x, y, z]) => surfaceTextureOffset(x, y, z, 'wood-grain', 3, 0))
const grain90 = samples.map(([x, y, z]) => surfaceTextureOffset(x, y, z, 'wood-grain', 3, 90))
assert.notDeepEqual(grain0, grain90, 'Die Richtung muss die Holzmaserung drehen')

const seam = surfaceTextureOffset(0, 0, 0, 'stone-blocks', 4, 0)
assert.ok(seam < -0.5, 'Mauerwerk muss an der Fuge eine Vertiefung erzeugen')
// A-128: Bei 4,5 mm Merkmalsgröße ist die Fuge 0,63 mm breit. Der Abtastschritt
// muss deutlich darunter liegen, sonst fallen die senkrechten Fugen aus.
assert.ok(
  surfaceTextureDetail('stone-blocks', 4.5) <= 0.63 / 2,
  'Mauerwerk muss feiner als die halbe Fugenbreite abgetastet werden',
)
const rubbleSeam = surfaceTextureOffset(0, 0, 0, 'rubble', 4, 0)
assert.ok(rubbleSeam < -0.5, 'Bruchstein muss an der Fuge eine Vertiefung erzeugen')

// Korbgeflecht darf nicht nur entlang u laufen: Auf einer Wand parallel zur
// Y-Achse wäre die Struktur sonst fast eine gerade Linie.
const basketAtOrigin = surfaceTextureOffset(0, 0, 0, 'basket', 4, 0)
const basketAcrossV = surfaceTextureOffset(0, 4, 0, 'basket', 4, 0)
assert.notEqual(
  basketAtOrigin,
  basketAcrossV,
  'Korbgeflecht muss auch quer zur Wandrichtung eine Struktur besitzen',
)

const printer = printerById('flashforge-ad5x')
const filament = filamentById('pla')
const bundle = buildCalibration('flow-cube', printer, filament, DEFAULT_SETTINGS)
assert.ok(bundle, 'Flowwürfel-Kalibrierbundle fehlt')

function sliceWithFuzzy(fuzzySkin: FuzzySkinSettings): string {
  const settings = applyPrinterLimits(
    printer,
    mergeSettings(DEFAULT_SETTINGS, {
      ...bundle.tool.settingsPatch,
      fuzzySkin,
      primeLine: { ...DEFAULT_SETTINGS.primeLine, enabled: false },
      ironing: { ...DEFAULT_SETTINGS.ironing, enabled: false },
      output: { ...DEFAULT_SETTINGS.output, verbosePaths: true },
    }),
  )
  return sliceMesh(parseSTL(bundle.stl), settings, printer, null, bundle.overrides, {
    start: false,
    end: false,
    metadata: false,
  }).gcode
}

function outerWallMoves(gcode: string): number {
  let inOuterWall = false
  let count = 0
  for (const line of gcode.split('\n')) {
    if (line.startsWith('; TYPE:')) {
      inOuterWall = line.includes('outer-wall')
      continue
    }
    if (inOuterWall && /^G1 X-?\d/.test(line) && / Y-?\d/.test(line)) count++
  }
  return count
}

const off = sliceWithFuzzy({
  mode: 'off',
  thickness: 0.3,
  pointDistance: 0.6,
  pattern: 'noise',
  scale: 3,
  angle: 0,
})
const noise = sliceWithFuzzy({
  mode: 'external',
  thickness: 0.3,
  pointDistance: 0.6,
  pattern: 'noise',
  scale: 3,
  angle: 0,
})
const offMoves = outerWallMoves(off)
const noiseMoves = outerWallMoves(noise)
assert.ok(offMoves > 0, 'Testbedingung: Außenwand ohne Textur fehlt')
assert.ok(
  noiseMoves > offMoves * 5,
  `Textur muss lange Wände aufteilen (ohne: ${offMoves}, mit: ${noiseMoves})`,
)
assert.ok(!/\bNaN\b|Infinity/.test(noise), 'Textur-G-Code enthält ungültige Koordinaten')

const wood = sliceWithFuzzy({
  mode: 'external',
  thickness: 0.3,
  pointDistance: 0.8,
  pattern: 'wood-grain',
  scale: 4,
  angle: 25,
})
const stone = sliceWithFuzzy({
  mode: 'external',
  thickness: 0.3,
  pointDistance: 0.8,
  pattern: 'stone',
  scale: 4,
  angle: 0,
})
const marble = sliceWithFuzzy({
  mode: 'external',
  thickness: 0.3,
  pointDistance: 0.8,
  pattern: 'marble',
  scale: 4,
  angle: 0,
})
const basket = sliceWithFuzzy({
  mode: 'external',
  thickness: 0.3,
  pointDistance: 0.8,
  pattern: 'basket',
  scale: 4,
  angle: 0,
})
assert.notEqual(noise, wood, 'Holzmaserung muss anderen G-Code erzeugen als Rauschen')
assert.notEqual(wood, stone, 'Stein muss anderen G-Code erzeugen als Holz')
assert.notEqual(stone, marble, 'Marmor muss anderen G-Code erzeugen als Stein')
assert.notEqual(stone, basket, 'Korbgeflecht muss anderen G-Code erzeugen als Stein')
assert.notEqual(noise, basket, 'Korbgeflecht muss anderen G-Code erzeugen als Rauschen')

// ---------------------------------------------------------------------------
// A-108: Deckflächen bekommen ein eigenes Höhenfeld. Der Test prüft nicht nur,
// dass sich der G-Code ändert, sondern auch die Schutzregeln: nur letzte
// Schicht, nur oberhalb der Deckschicht, begrenzter Aufbau, Randabstand und
// ein Düsenabstand zwischen den texturierten Bahnen.
const cubeMesh = parseSTL(buildBinarySTL(box(20, 20, 8)))
// Zwei benachbarte Blöcke mit unterschiedlicher Höhe: links 8,0 mm,
// rechts 7,4 mm. Die rechte Oberseite ist damit eine drei Schichten tiefere,
// frei liegende Stufe und liegt noch innerhalb der letzten vier Schichten.
const stepTopZ = 7.4
const steppedMesh = parseSTL(
  buildBinarySTL([
    ...box(10, 8, 20, -5, 0, 0),
    ...box(10, stepTopZ, 20, 5, 0, 0),
  ]),
)

function slicePart(
  mesh: ReturnType<typeof parseSTL>,
  fuzzySkin: FuzzySkinSettings,
): ReturnType<typeof sliceMesh> {
  const settings = applyPrinterLimits(
    printer,
    mergeSettings(DEFAULT_SETTINGS, {
      layerHeight: 0.2,
      firstLayerHeight: 0.2,
      walls: 3,
      topLayers: 4,
      bottomLayers: 3,
      infillDensity: 20,
      infillPattern: 'grid',
      fuzzySkin,
      primeLine: { ...DEFAULT_SETTINGS.primeLine, enabled: false },
      ironing: { ...DEFAULT_SETTINGS.ironing, enabled: false },
      output: { ...DEFAULT_SETTINGS.output, verbosePaths: true },
    }),
  )
  return sliceMesh(mesh, settings, printer, null, [], {
    start: false,
    end: false,
    metadata: false,
  })
}

function sliceCube(fuzzySkin: FuzzySkinSettings): ReturnType<typeof sliceMesh> {
  return slicePart(cubeMesh, fuzzySkin)
}

function sliceStepped(fuzzySkin: FuzzySkinSettings): ReturnType<typeof sliceMesh> {
  return slicePart(steppedMesh, fuzzySkin)
}

const topBase: FuzzySkinSettings = {
  mode: 'external',
  thickness: 0.3,
  pointDistance: 0.5,
  pattern: 'stone',
  scale: 4,
  angle: 0,
  topSurfaces: true,
}
const wallOnly = sliceCube({ ...topBase, topSurfaces: false })
const withTop = sliceCube(topBase)
const offTop = sliceCube({ ...topBase, mode: 'off', topSurfaces: true })

// A-112: Höhenzonen und ein eigenes Deckflächenmuster müssen unabhängig von
// der Wandtextur wirken. Die erste passende Zone gewinnt; außerhalb aller
// Zonen bleibt die Oberfläche glatt.
const zoneA: TextureZone = { from: 0, to: 0.6, pattern: 'wood-grain' }
const zoneB: TextureZone = { from: 0.6, to: 2, pattern: 'stone' }
assert.equal(textureZoneAt(undefined, 0.4), undefined, 'Ohne Zonen muss die ganze Höhe texturiert werden')
assert.equal(textureZoneAt([], 0.4), undefined, 'Leere Zonenliste muss die ganze Höhe texturieren')
assert.equal(textureZoneAt([zoneA, zoneB], 0.2)?.pattern, 'wood-grain', 'Erste Zone muss Vorrang haben')
assert.equal(textureZoneAt([zoneA, zoneB], 0.6)?.pattern, 'wood-grain', 'Zonengrenze muss zur ersten Zone gehören')
assert.equal(textureZoneAt([zoneA, zoneB], 1.2)?.pattern, 'stone', 'Spätere Zone muss ihr Muster übernehmen')
assert.equal(textureZoneAt([zoneA, zoneB], 3), null, 'Außerhalb aller Zonen darf nicht texturiert werden')
assert.equal(
  textureZoneAt([{ from: 2, to: 1, pattern: 'inherit' }], 1.5)?.pattern,
  'inherit',
  'Vertauschte Zonengrenzen müssen als Bereich erkannt werden',
)

function layerSection(gcode: string, offsetFromEnd = 0): string {
  const starts = [...gcode.matchAll(/;LAYER:/g)].map((match) => match.index ?? 0)
  const index = starts.length - 1 - offsetFromEnd
  if (index < 0) return ''
  return gcode.slice(starts[index], starts[index + 1] ?? gcode.length)
}

function layerSectionAt(gcode: string, index: number): string {
  const starts = [...gcode.matchAll(/;LAYER:/g)].map((match) => match.index ?? 0)
  if (index < 0 || index >= starts.length) return ''
  return gcode.slice(starts[index], starts[index + 1] ?? gcode.length)
}

/** Nur die X/Y-Bewegungen einer Schicht; E ist durch die Vorgeschichte kumulativ. */
function layerGeometry(gcode: string, index: number): string {
  return layerSectionAt(gcode, index)
    .split(/\r?\n/)
    .filter((line) => /^G1 X/.test(line))
    .map((line) => line.replace(/ E-?[\d.]+/g, '').replace(/ F[\d.]+/g, ''))
    .join('\n')
}

// A-128: Mauerwerk muss auf beiden Achsen senkrechte Fugen zeigen. Der Test
// sucht die Fugen im echten G-Code einer mittleren Schicht; bei der alten
// globalen X/Y-Scherung hatte die X-Fläche nur eine lange Diagonale.
const masonryMesh = parseSTL(buildBinarySTL(box(20, 8, 20)))
const masonryBase: FuzzySkinSettings = {
  mode: 'external',
  thickness: 0.5,
  pointDistance: 0.9,
  pattern: 'stone-blocks',
  scale: 4.5,
  angle: 0,
  topSurfaces: false,
}

function sliceMasonryCube(fuzzySkin: FuzzySkinSettings): ReturnType<typeof sliceMesh> {
  const settings = applyPrinterLimits(
    printer,
    mergeSettings(DEFAULT_SETTINGS, {
      layerHeight: 0.2,
      firstLayerHeight: 0.2,
      walls: 1,
      topLayers: 1,
      bottomLayers: 1,
      infillDensity: 0,
      infillPattern: 'grid',
      fuzzySkin,
      primeLine: { ...DEFAULT_SETTINGS.primeLine, enabled: false },
      ironing: { ...DEFAULT_SETTINGS.ironing, enabled: false },
      output: { ...DEFAULT_SETTINGS.output, verbosePaths: true },
    }),
  )
  return sliceMesh(masonryMesh, settings, printer, null, [], {
    start: false,
    end: false,
    metadata: false,
  })
}

function extrusionMoves(section: string): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  for (const line of section.split(/\r?\n/)) {
    const match = /^G1 X(-?[\d.]+) Y(-?[\d.]+) E/.exec(line)
    if (match) out.push({ x: Number(match[1]), y: Number(match[2]) })
  }
  return out
}

type MasonryFace = 'x+' | 'x-' | 'y+' | 'y-'

function seamRunsByFace(gcode: string, layerIndex: number, nominal: Record<MasonryFace, number>) {
  const moves = extrusionMoves(layerSectionAt(gcode, layerIndex))
  assert.ok(moves.length > 40, `Testbedingung: zu wenige Außenwandpunkte (${moves.length})`)
  const ranges: Record<MasonryFace, [number, number]> = {
    'x+': [nominal['y-'], nominal['y+']],
    'x-': [nominal['y-'], nominal['y+']],
    'y+': [nominal['x-'], nominal['x+']],
    'y-': [nominal['x-'], nominal['x+']],
  }
  const data: Record<MasonryFace, { t: number; deviation: number }[]> = {
    'x+': [],
    'x-': [],
    'y+': [],
    'y-': [],
  }
  const faces: MasonryFace[] = ['x+', 'x-', 'y+', 'y-']
  for (const point of moves) {
    const candidates: [MasonryFace, number][] = [
      ['x+', Math.abs(point.x - nominal['x+'])],
      ['x-', Math.abs(point.x - nominal['x-'])],
      ['y+', Math.abs(point.y - nominal['y+'])],
      ['y-', Math.abs(point.y - nominal['y-'])],
    ]
    candidates.sort((a, b) => a[1] - b[1])
    const [face, distance] = candidates[0]
    if (distance > 0.7) continue
    const tangent = face === 'x+' || face === 'x-' ? point.y : point.x
    const [from, to] = ranges[face]
    // Ecken gehören zu zwei Flächen und würden die Frequenz verfälschen.
    if (tangent < from + 1 || tangent > to - 1) continue
    const faceCoordinate = face === 'x+' || face === 'x-' ? point.x : point.y
    data[face].push({ t: tangent, deviation: Math.abs(faceCoordinate - nominal[face]) })
  }
  const runs: Record<MasonryFace, number> = { 'x+': 0, 'x-': 0, 'y+': 0, 'y-': 0 }
  for (const face of faces) {
    data[face].sort((a, b) => a.t - b.t)
    let last = -Infinity
    for (const entry of data[face]) {
      if (entry.deviation <= 0.08) continue
      if (entry.t - last > 1.2) runs[face]++
      last = entry.t
    }
  }
  return { runs, counts: Object.fromEntries(faces.map((face) => [face, data[face].length])) }
}

const masonryReference = sliceMasonryCube({ ...masonryBase, mode: 'off' })
const masonryLayer = masonryReference.layers.findIndex((layer) => Math.abs(layer.z - 2) < 1e-6)
assert.ok(masonryLayer > 0, 'Testbedingung: mittlere Mauerwerkschicht fehlt')
const referenceMoves = extrusionMoves(layerSectionAt(masonryReference.gcode, masonryLayer))
const nominal = {
  'x+': Math.max(...referenceMoves.map((point) => point.x)),
  'x-': Math.min(...referenceMoves.map((point) => point.x)),
  'y+': Math.max(...referenceMoves.map((point) => point.y)),
  'y-': Math.min(...referenceMoves.map((point) => point.y)),
}
const texturedMasonry = sliceMasonryCube(masonryBase)
const masonrySeams = seamRunsByFace(texturedMasonry.gcode, masonryLayer, nominal)
for (const face of ['x+', 'x-', 'y+', 'y-'] as MasonryFace[]) {
  assert.ok(masonrySeams.counts[face] > 10, `${face}: zu wenige Wandpunkte`)
  assert.ok(
    masonrySeams.runs[face] >= 2,
    `${face}: Mauerwerk braucht mindestens zwei senkrechte Fugen, gefunden ${masonrySeams.runs[face]}`,
  )
}
// A-129: Feine Texturpunkte dürfen die Zeitrechnung nicht pro Segment auf
// null abbremsen. Die Textur darf die Schätzung nur um den echten Mehrweg
// erhöhen, nicht um ein Vielfaches.
const masonryTimeRatio =
  texturedMasonry.stats.estimatedSeconds / Math.max(1, masonryReference.stats.estimatedSeconds)
assert.ok(
  masonryTimeRatio < 1.35,
  `Mauerwerk bläht die Druckzeitschätzung auf das ${masonryTimeRatio.toFixed(2)}-Fache auf`,
)

function texturedMoves(gcode: string, baseZ: number, offsetFromEnd = 0) {
  const out: { x: number; y: number; z: number }[] = []
  const re = /^G1 X(-?[\d.]+) Y(-?[\d.]+) Z([\d.]+) E/
  for (const line of layerSection(gcode, offsetFromEnd).split(/\r?\n/)) {
    const match = re.exec(line)
    if (!match) continue
    const z = Number(match[3])
    if (z > baseZ + 0.001) out.push({ x: Number(match[1]), y: Number(match[2]), z })
  }
  return out
}

const topZ = withTop.layers[withTop.layers.length - 1].z
const texture = texturedMoves(withTop.gcode, topZ)
const amplitude = topSurfaceTextureAmplitude(topBase.thickness, 0.2)
const minRise = topSurfaceTextureHeight(-1, topBase.thickness, 0.2)
assert.ok(texture.length > 10, `Deckflächentextur fehlt im G-Code (${texture.length} Bahnpunkte)`)
assert.equal(
  texturedMoves(wallOnly.gcode, wallOnly.layers[wallOnly.layers.length - 1].z).length,
  0,
  'topSurfaces=false darf keine Deckflächentextur erzeugen',
)
assert.equal(
  texturedMoves(offTop.gcode, offTop.layers[offTop.layers.length - 1].z).length,
  0,
  'Modus off darf keine Deckflächentextur erzeugen',
)
for (const move of texture) {
  assert.ok(Number.isFinite(move.x) && Number.isFinite(move.y) && Number.isFinite(move.z), 'Deckflächentextur enthält keine endlichen Koordinaten')
  assert.ok(move.z >= topZ + minRise - 0.002, `Deckflächentextur fällt unter die Deckschicht: ${move.z}`)
  assert.ok(move.z <= topZ + amplitude + 0.002, `Deckflächentextur überschreitet den sicheren Aufbau: ${move.z}`)
}
assert.ok(!/\bNaN\b|Infinity/.test(withTop.gcode), 'Deckflächen-G-Code enthält ungültige Koordinaten')

// Auch der Fahrthub darf nicht relativ auf den bereits erhöhten Aufbau
// aufaddiert werden und über die sichere Höhe hinausschießen.
const topLayerCode = layerSection(withTop.gcode)
for (const line of topLayerCode.split(/\r?\n/)) {
  const match = /^G1 Z([\d.]+)/.exec(line)
  if (!match) continue
  const z = Number(match[1])
  assert.ok(z >= topZ - 0.002, `Deckflächenfahrt taucht unter die Schicht: ${z}`)
  assert.ok(
    z <= topZ + amplitude + 0.2 + 0.002,
    `Deckflächenfahrt hebt zu hoch: ${z} > ${(topZ + amplitude + 0.2).toFixed(3)}`,
  )
}

// Die Textur liegt deutlich innerhalb der Außenwand. Der Randabstand wird
// aus dem tatsächlichen G-Code-Bild der letzten Schicht bestimmt, nicht aus
// der Bettmitte — so prüft der Test auch eine verschobene Objektlage.
const lastExtrusions: { x: number; y: number }[] = []
for (const line of layerSection(withTop.gcode).split(/\r?\n/)) {
  const match = /^G1 X(-?[\d.]+) Y(-?[\d.]+) E/.exec(line)
  if (match) lastExtrusions.push({ x: Number(match[1]), y: Number(match[2]) })
}
const minX = Math.min(...lastExtrusions.map((p) => p.x))
const maxX = Math.max(...lastExtrusions.map((p) => p.x))
const minY = Math.min(...lastExtrusions.map((p) => p.y))
const maxY = Math.max(...lastExtrusions.map((p) => p.y))
const cx = (minX + maxX) / 2
const cy = (minY + maxY) / 2
const maxHalf = (maxX - minX) / 2 - 1
assert.ok(
  texture.every((move) => Math.abs(move.x - cx) <= maxHalf + 1e-6 && Math.abs(move.y - cy) <= maxHalf + 1e-6),
  'Deckflächentextur hält den Randabstand zur Wand nicht ein',
)

// Vorherige Schicht bleibt glatt: Der Aufbau darf erst nach der letzten
// Deckschicht beginnen, sonst könnte eine spätere Düsenbahn kollidieren.
const beforeTop = layerSection(withTop.gcode, 1)
assert.ok(
  !/^G1 X-?[\d.]+ Y-?[\d.]+ Z[\d.]+ E/m.test(beforeTop),
  'Deckflächentextur darf nicht bereits in der vorletzten Schicht liegen',
)

// Gestufte Deckfläche: Die tiefere Stufe liegt drei Schichten unter der
// höchsten Fläche. Dort darf die Textur nur bis 0,05 mm unter die nächste
// Schicht aufgebaut werden; die höchste Stufe behält den vollen Aufbau.
const stepped = sliceStepped(topBase)
const stepIndex = stepped.layers.findIndex((layer) => Math.abs(layer.z - stepTopZ) < 1e-6)
assert.ok(stepIndex >= 0 && stepIndex < stepped.layers.length - 1, 'Testbedingung: gestufte Schicht fehlt')
const lowerStepZ = stepped.layers[stepIndex].z
const nextStepZ = stepped.layers[stepIndex + 1].z
assert.ok(nextStepZ > lowerStepZ + 0.1, 'Testbedingung: auf die Stufe folgt keine höhere Schicht')
const lowerStepTexture = texturedMoves(
  stepped.gcode,
  lowerStepZ,
  stepped.layers.length - 1 - stepIndex,
)
assert.ok(lowerStepTexture.length > 10, `Textur auf der tieferen Stufe fehlt (${lowerStepTexture.length} Punkte)`)
const lowerStepMax = Math.max(...lowerStepTexture.map((move) => move.z))
const cappedAmplitude = Math.min(amplitude, nextStepZ - lowerStepZ - 0.05)
assert.ok(cappedAmplitude < amplitude, 'Testbedingung: die tiefere Stufe muss den Aufbau begrenzen')
assert.ok(
  lowerStepMax > lowerStepZ + 0.08,
  `Textur auf der tieferen Stufe ist zu flach: ${(lowerStepMax - lowerStepZ).toFixed(3)} mm`,
)
assert.ok(
  lowerStepMax <= lowerStepZ + cappedAmplitude + 0.002,
  `Aufbau auf der tieferen Stufe überschreitet die begrenzte Höhe: ${lowerStepMax.toFixed(3)} mm`,
)
assert.ok(
  lowerStepMax <= nextStepZ - 0.05 + 0.002,
  `Textur auf der tieferen Stufe kommt der nächsten Schicht zu nah: ${lowerStepMax.toFixed(3)} / ${nextStepZ.toFixed(3)} mm`,
)
const highestZ = stepped.layers[stepped.layers.length - 1].z
const highestTexture = texturedMoves(stepped.gcode, highestZ)
assert.ok(highestTexture.length > 10, 'Textur auf der höchsten Stufe fehlt')
assert.ok(
  Math.max(...highestTexture.map((move) => move.z)) > lowerStepMax + 0.05,
  'Die höchste Stufe muss den vollen Texturaufbau erhalten',
)
assert.ok(!/\bNaN\b|Infinity/.test(stepped.gcode), 'Gestufter Deckflächen-G-Code enthält ungültige Koordinaten')

// Schutzregeln der Flächenabtastung selbst.
assert.equal(topSurfaceTextureAmplitude(1.5, 0.2), 0.4, 'Deckflächenaufbau muss auf die sichere Höhe begrenzt sein')
assert.ok(
  topSurfaceTextureSpacing(printer.nozzle, 0.42, amplitude) > printer.nozzle + 2 * amplitude,
  'Düsenabstand zwischen texturierten Bahnen ist zu klein',
)
assert.ok(Number.isFinite(topSurfaceTextureHeight(0.7, 0.3, 0.2)), 'Deckflächenhöhe ist nicht endlich')
assert.ok(
  topSurfaceTextureHeight(1, 0.3, 0.2) > topSurfaceTextureHeight(-1, 0.3, 0.2),
  'Deckflächenhöhenfeld muss eine Struktur besitzen',
)

const withTopAgain = sliceCube(topBase)
assert.equal(withTop.gcode, withTopAgain.gcode, 'Deckflächentextur muss deterministisch sein')
const woodTop = sliceCube({ ...topBase, pattern: 'wood-grain', angle: 30 })
assert.notEqual(
  layerSection(withTop.gcode),
  layerSection(woodTop.gcode),
  'Holz- und Steintextur müssen sich auf der Deckfläche unterscheiden',
)

// Eigenes Deckflächenmuster: Die Oberseite bekommt Holz, die Wand bleibt Stein.
const separateTopPattern = sliceCube({ ...topBase, topPattern: 'wood-grain', angle: 30 })
assert.notEqual(
  layerSection(withTop.gcode),
  layerSection(separateTopPattern.gcode),
  'Deckflächenmuster muss die oberste Schicht verändern',
)
assert.equal(
  layerGeometry(withTop.gcode, 3),
  layerGeometry(separateTopPattern.gcode, 3),
  'Deckflächenmuster darf die Wandtextur nicht verändern',
)

// A-131: „Glatt“ schaltet nur den erhöhten Deckflächen-Aufbau ab. Die
// Wandtextur bleibt erhalten; die oberste Schicht entspricht der normalen
// Deckschicht ohne zusätzliche Z-Bewegungen.
const smoothTop = sliceCube({ ...topBase, topPattern: 'none' })
assert.equal(
  layerGeometry(smoothTop.gcode, 3),
  layerGeometry(wallOnly.gcode, 3),
  'Glatte Deckfläche muss der normalen Deckschicht ohne Texturaufbau entsprechen',
)
assert.equal(
  texturedMoves(smoothTop.gcode, smoothTop.layers[smoothTop.layers.length - 1].z).length,
  0,
  'Glatte Deckfläche darf keine erhöhten Texturbahnen enthalten',
)
assert.notEqual(
  layerGeometry(smoothTop.gcode, 1),
  layerGeometry(sliceCube({ ...topBase, mode: 'off' }).gcode, 1),
  'Glatte Deckfläche darf die Wandtextur nicht abschalten',
)

// Texturzonen: In der ersten Zone Holz, darüber Stein; außerhalb aller Zonen glatt.
const wallBase: FuzzySkinSettings = { ...topBase, topSurfaces: false }
const wallPlain = sliceCube(wallBase)
const wallZoned = sliceCube({
  ...wallBase,
  textureZones: [zoneA, { from: 0.6, to: 8, pattern: 'stone' }],
})
const wallOutside = sliceCube({
  ...wallBase,
  textureZones: [{ from: 2, to: 3, pattern: 'wood-grain' }],
})
const wallOff = sliceCube({ ...wallBase, mode: 'off' })
assert.notEqual(
  layerGeometry(wallZoned.gcode, 1),
  layerGeometry(wallPlain.gcode, 1),
  'Zone mit eigenem Muster muss die frühe Wand verändern',
)
assert.equal(
  layerGeometry(wallZoned.gcode, 5),
  layerGeometry(wallPlain.gcode, 5),
  'Oberhalb der ersten Zone muss wieder das Grundmuster gelten',
)
assert.equal(
  layerGeometry(wallOutside.gcode, 1),
  layerGeometry(wallOff.gcode, 1),
  'Außerhalb aller Zonen darf keine Wandtextur entstehen',
)
const topOutsideZone = sliceCube({
  ...topBase,
  textureZones: [{ from: 0, to: 2, pattern: 'stone' }],
})
assert.equal(
  texturedMoves(topOutsideZone.gcode, topOutsideZone.layers[topOutsideZone.layers.length - 1].z).length,
  0,
  'Deckfläche außerhalb der Texturzone muss glatt bleiben',
)

console.log(
  `Oberflächenmuster: ${patterns.length} geprüft; Außenwandbewegungen ${offMoves} → ${noiseMoves}; ` +
    `Deckflächentextur ${texture.length} Punkte, Aufbau max. ${amplitude.toFixed(2)} mm; ` +
    `Deckfläche glatt ohne Texturaufbau geprüft; ` +
    `Musteratlas mit ${swatchSignatures.size} Swatches und ${SURFACE_TEXTURE_PRESETS.length} Presets geprüft; ` +
    `Texturzonen und separates Deckflächenmuster geprüft; Holz und Stein unterscheiden sich.`,
)
