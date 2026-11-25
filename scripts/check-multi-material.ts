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

const allText = [...plan.lines, ...front.lines, ...second.lines, ...tool, ...custom].join('\n')
check('keine NaN/Infinity im G-Code', !/NaN|Infinity/.test(allText))

if (failures) {
  console.log(`\n${failures} Prüfung(en) fehlgeschlagen.`)
  process.exit(1)
}
console.log('\nAlle Prüfungen bestanden.')
