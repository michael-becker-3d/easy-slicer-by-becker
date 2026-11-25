/**
 * Regressionstest für den Mehrfarbdruck-Unterbau: Wechselbefehl, Spülvolumen
 * und Spüllinien-Platzierung. Läuft ohne Drucker und ohne externe Dienste.
 */
import {
  DEFAULT_MULTI_MATERIAL,
  filamentChangeGcode,
  normalizeMultiMaterial,
  planPurgeLine,
  purgeLineLength,
} from '../shared/multiMaterial.ts'
import { planPurgeTowers, purgeTowerPatch, purgeTowerSize } from '../shared/purgeTower.ts'
import { DEFAULT_SETTINGS, mergeSettings } from '../shared/types.ts'

let failures = 0

function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  ok   ${name}`)
  } else {
    failures++
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const near = (a: number, b: number, tolerance = 0.001) => Math.abs(a - b) <= tolerance

console.log('Mehrfarbdruck')

// --- Einstellungen ---
const merged = mergeSettings(DEFAULT_SETTINGS, {})
check('Standardwerte im zusammengeführten Profil', merged.multiMaterial.change === 'm600')
check('Spülen ist standardmäßig an', merged.multiMaterial.purge.enabled === true)
check(
  'Spülvolumen-Standard 60 mm³',
  merged.multiMaterial.purge.volume === 60,
  String(merged.multiMaterial.purge.volume),
)
check('Objektmarker sind standardmäßig an', merged.output.excludeObjects === true)

const oldProfile = mergeSettings(DEFAULT_SETTINGS, { multiMaterial: undefined as never })
check('altes Profil ohne Abschnitt bleibt gültig', oldProfile.multiMaterial.purge.volume === 60)

const broken = normalizeMultiMaterial({ change: 'quatsch' as never, retract: Number.NaN })
check('unbekannter Wechselmodus fällt auf M600 zurück', broken.change === 'm600')
check('ungültiger Rückzug wird ersetzt', broken.retract === DEFAULT_MULTI_MATERIAL.retract)
check('leeres Makro wird ersetzt', normalizeMultiMaterial({ changeGcode: '   ' }).changeGcode === 'M600')

// --- Wechselbefehl ---
const m600 = filamentChangeGcode({ multi: normalizeMultiMaterial({}), tool: 2, nozzle: 215, bed: 60 })
check('M600-Modus schreibt M600', m600.some((line) => line.startsWith('M600')))
check('M600-Modus schreibt kein T2', !m600.some((line) => /^T\d/.test(line)))
check(
  'Temperatur wird nach dem Wechsel abgewartet',
  m600.includes('M109 S215') && m600.includes('M140 S60'),
)

const tool = filamentChangeGcode({
  multi: normalizeMultiMaterial({ change: 'tool' }),
  tool: 2,
  nozzle: 200,
  bed: 55,
})
check('Werkzeugmodus schreibt T2', tool.some((line) => line.startsWith('T2')))

const custom = filamentChangeGcode({
  multi: normalizeMultiMaterial({ change: 'custom', changeGcode: 'LOAD_FILAMENT SLOT={tool} NOZZLE={nozzle}' }),
  tool: 3,
  nozzle: 240,
  bed: 80,
})
check(
  'eigenes Makro ersetzt die Platzhalter',
  custom.includes('LOAD_FILAMENT SLOT=3 NOZZLE=240'),
  custom.join(' | '),
)

const retracted = filamentChangeGcode({
  multi: normalizeMultiMaterial({ retract: 2.5 }),
  tool: 1,
  nozzle: 210,
  bed: 60,
})
check('Rückzug steht vor dem Wechselbefehl', retracted[0] === 'G1 E-2.50 F1800')

// --- Spüllänge aus Volumen ---
const length = purgeLineLength({ volume: 60, length: 0, layerHeight: 0.2, lineWidth: 0.45 })
check(
  'Spüllänge wird auf die Bettbreite begrenzt',
  length === 200,
  `${length} statt 200 (${(60 / (0.2 * 0.45)).toFixed(0)} mm wären rechnerisch nötig)`,
)
check(
  'fest eingestellte Länge hat Vorrang',
  purgeLineLength({ volume: 60, length: 80, layerHeight: 0.2, lineWidth: 0.45 }) === 80,
)

// --- Spüllinie ---
const bed = { x: 220, y: 220 }
const plan = planPurgeLine({
  bed,
  objects: [{ minX: 60, minY: 60, maxX: 160, maxY: 160 }],
  multi: normalizeMultiMaterial({}),
  index: 0,
  nozzle: 0.4,
  filamentDiameter: 1.75,
  z: 0.24,
  layerHeight: 0.24,
})
check('Spüllinie wird erzeugt', plan.lines.length > 4, plan.skipped ?? '')
const purges = plan.lines.filter((line) => line.includes('; Spüllinie'))
check('60 mm³ brauchen mehrere parallele Bahnen', purges.length === 3, `${purges.length} Bahnen`)
const eMm = purges.reduce(
  (sum, line) => sum + Number(/(?:^|\s)E(-?\d+(?:\.\d+)?)/.exec(line)?.[1] ?? 0),
  0,
)
const expectedMm = 60 / (Math.PI * (1.75 / 2) ** 2)
check(
  'Extrusion entspricht 60 mm³ Filament',
  near(eMm, expectedMm, 0.05),
  `${eMm.toFixed(3)} statt ${expectedMm.toFixed(3)}`,
)
check(
  'Spüllinie liegt hinter dem Objekt',
  /Y21[0-9]\.\d\d/.test(plan.lines[1]),
  plan.lines[1],
)
check('Spülung zählt Material', near(plan.filamentMm, expectedMm, 0.05), String(plan.filamentMm))
check('Spülung zählt Volumen', plan.volumeMm3 === 60)

const front = planPurgeLine({
  bed,
  objects: [],
  multi: normalizeMultiMaterial({ purge: { ...DEFAULT_MULTI_MATERIAL.purge, side: 'front' } }),
  index: 0,
  nozzle: 0.4,
  filamentDiameter: 1.75,
  z: 0.24,
  layerHeight: 0.24,
})
check(
  'Spülseite vorne liegt am vorderen Rand',
  near(Number(/Y(-?\d+(?:\.\d+)?)/.exec(front.lines[1])?.[1] ?? NaN), 8.22, 0.1),
  front.lines[1],
)

const firstRow = planPurgeLine({
  bed,
  objects: [],
  multi: normalizeMultiMaterial({}),
  index: 0,
  nozzle: 0.4,
  filamentDiameter: 1.75,
  z: 0.24,
  layerHeight: 0.24,
})
const second = planPurgeLine({
  bed,
  objects: [],
  multi: normalizeMultiMaterial({}),
  index: 1,
  nozzle: 0.4,
  filamentDiameter: 1.75,
  z: 0.24,
  layerHeight: 0.24,
})
const yOf = (line: string) => Number(/Y(-?\d+(?:\.\d+)?)/.exec(line)?.[1] ?? NaN)
check(
  'zweite Spülung rückt eine Reihe nach innen',
  yOf(second.lines[1]) < yOf(firstRow.lines[1]) - 1,
  `${yOf(second.lines[1])} gegen ${yOf(firstRow.lines[1])}`,
)

const blocked = planPurgeLine({
  bed,
  objects: [{ minX: 0, minY: 0, maxX: 220, maxY: 220 }],
  multi: normalizeMultiMaterial({}),
  index: 0,
  nozzle: 0.4,
  filamentDiameter: 1.75,
  z: 0.24,
  layerHeight: 0.24,
})
check('belegtes Bett erzeugt keine Linie durchs Bauteil', blocked.lines.length === 0 && !!blocked.skipped)

const off = planPurgeLine({
  bed,
  objects: [],
  multi: normalizeMultiMaterial({ purge: { ...DEFAULT_MULTI_MATERIAL.purge, enabled: false } }),
  index: 0,
  nozzle: 0.4,
  filamentDiameter: 1.75,
  z: 0.24,
  layerHeight: 0.24,
})
check('ausgeschaltetes Spülen schreibt nichts', off.lines.length === 0 && off.filamentMm === 0)

const zero = planPurgeLine({
  bed,
  objects: [],
  multi: normalizeMultiMaterial({ purge: { ...DEFAULT_MULTI_MATERIAL.purge, volume: 0 } }),
  index: 0,
  nozzle: 0.4,
  filamentDiameter: 1.75,
  z: 0.24,
  layerHeight: 0.24,
})
check('Spülvolumen 0 schreibt nichts', zero.lines.length === 0)

// --- Purge-Turm (schichtweiser Mehrfarbdruck) ---
check('Purge-Turm ist standardmäßig an', merged.multiMaterial.tower.enabled === true)
check('Turm-Abstand 3 mm', merged.multiMaterial.tower.gap === 3)
check('Z-Hub nach Spülen 0,6 mm', merged.multiMaterial.zLift === 0.6)
check(
  'altes Profil bekommt einen Turm',
  oldProfile.multiMaterial.tower.enabled === true && oldProfile.multiMaterial.zLift === 0.6,
)

const size = purgeTowerSize(60, 0.2)
check('60 mm³ bei 0,2 mm ergeben 17,5 mm Kantenlänge', near(size, 17.5), String(size))
const smallSize = purgeTowerSize(8, 0.2)
check('kleines Volumen wird nicht beliebig dünn', smallSize >= 4, String(smallSize))
check(
  'zwei Farben: 24,5 mm Kantenlänge',
  near(purgeTowerSize(60, 0.2, 2), 24.5),
  String(purgeTowerSize(60, 0.2, 2)),
)
check(
  'vier Farben: 35 mm Kantenlänge',
  near(purgeTowerSize(60, 0.2, 4), 35),
  String(purgeTowerSize(60, 0.2, 4)),
)
check('acht Farben bleiben im Bettmaß', purgeTowerSize(60, 0.2, 8) <= 60)

const towerObjects = [{ minX: 80, minY: 80, maxX: 140, maxY: 140 }]
const towerPlan = planPurgeTowers({
  bed: { x: 220, y: 220 },
  objects: towerObjects,
  tools: [0, 1],
  volume: 20,
  layerHeight: 0.2,
  gap: 3,
})
check('zwei Farben bekommen EINEN Turm', towerPlan.ok && towerPlan.tower.bands.length === 2)
if (towerPlan.ok) {
  const { tower } = towerPlan
  check(
    'Turm steht vollständig auf dem Bett',
    tower.x >= 0 && tower.y >= 0 && tower.x + tower.size <= 220 && tower.y + tower.size <= 220,
  )
  check(
    'Turm hält Abstand zu den Objekten',
    tower.x + tower.size < 80 || tower.x > 140 || tower.y + tower.size < 80 || tower.y > 140,
  )
  const [first, second] = tower.bands
  check('Bänder liegen im selben Turm', first.x === second.x && first.width === second.width)
  check('Bänder überlappen sich nicht', near(first.y1, second.y0))
  check('Bänder füllen den Turm genau', near(first.y0, tower.y) && near(second.y1, tower.y + tower.size))
  check(
    'jedes Band hat die Fläche für das Spülvolumen',
    first.width * (first.y1 - first.y0) >= 20 / 0.2 - 0.01,
  )
}

const fourPlan = planPurgeTowers({
  bed: { x: 220, y: 220 },
  objects: towerObjects,
  tools: [0, 1, 2, 3],
  volume: 20,
  layerHeight: 0.2,
  gap: 3,
})
check('vier Farben bekommen einen Turm mit vier Bändern', fourPlan.ok && fourPlan.tower.bands.length === 4)
if (fourPlan.ok) {
  const { tower } = fourPlan
  const bands = tower.bands
  const contiguous = bands.every((band, index) =>
    index === 0 ? near(band.y0, tower.y) : near(band.y0, bands[index - 1].y1),
  )
  check('vier Bänder liegen lückenlos übereinander', contiguous && near(bands[3].y1, tower.y + tower.size))
  check(
    'jedes der vier Bänder trägt das Spülvolumen',
    bands.every((band) => band.width * (band.y1 - band.y0) >= 20 / 0.2 - 0.01),
  )
  check('Turm bleibt ein Quadrat', near(tower.size, purgeTowerSize(20, 0.2, 4)))
}

const noRoom = planPurgeTowers({
  bed: { x: 220, y: 220 },
  objects: [{ minX: 0, minY: 0, maxX: 220, maxY: 220 }],
  tools: [0, 1],
  volume: 20,
  layerHeight: 0.2,
})
check('volles Bett wird abgelehnt statt ohne Turm zu drucken', !noRoom.ok && !!noRoom.error)

if (fourPlan.ok) {
  const band = fourPlan.tower.bands[2]
  const towerPatch = purgeTowerPatch({
    band,
    z: 4.1,
    height: 0.2,
    volume: 20,
    speed: 40,
    nozzle: 0.4,
    filamentDiameter: 1.75,
    retract: 1,
    zLift: 0.6,
  })
  const patchText = towerPatch.lines.join('\n')
  const expectedFilament = 20 / (Math.PI * (1.75 / 2) ** 2)
  check('Turmspülung fördert genau das Spülvolumen', near(towerPatch.filamentMm, expectedFilament, 0.01))
  check('Turmspülung setzt den E-Nullpunkt', towerPatch.lines.includes('G92 E0'))
  check('Turmspülung hebt die Düse danach an', /Z-Hub nach dem Spülen/.test(patchText))
  check('Turmspülung endet über der Schichthöhe', /G1 Z4\.7\d* F600 ; Z-Hub nach dem Spülen/.test(patchText))
  const moves = [...patchText.matchAll(/^G[01] X(-?[\d.]+) Y(-?[\d.]+)/gm)]
  const insideBand = moves.every((match) => {
    const x = Number(match[1])
    const y = Number(match[2])
    return (
      x >= band.x - 0.01 &&
      x <= band.x + band.width + 0.01 &&
      y >= band.y0 - 0.01 &&
      y <= band.y1 + 0.01
    )
  })
  check('Turmspülung bleibt im eigenen Band', moves.length > 0 && insideBand)
  check('Turmspülung liegt auf dem Bett', towerPatch.pathMm > 0 && !/NaN|Infinity/.test(patchText))
}

const allText = [...plan.lines, ...front.lines, ...second.lines, ...tool, ...custom].join('\n')
check('keine NaN/Infinity im G-Code', !/NaN|Infinity/.test(allText))

if (failures) {
  console.log(`\n${failures} Prüfung(en) fehlgeschlagen.`)
  process.exit(1)
}
console.log('\nAlle Prüfungen bestanden.')
