import assert from 'node:assert/strict'
import { cylinder } from '../server/meshlib.ts'
import { sliceMesh } from '../server/slicer/index.ts'
import { makeMesh } from '../server/slicer/stl.ts'
import { printerById } from '../shared/catalog.ts'
import { DEFAULT_SETTINGS, mergeSettings, type PrintSettings } from '../shared/types.ts'
import { arcLength, arcPointAt, findLongestArc, fitArc, type ArcPoint } from '../shared/arcFitting.ts'

function circlePoints(radius: number, count: number, jitter = 0): ArcPoint[] {
  const points: ArcPoint[] = []
  for (let i = 0; i <= count; i++) {
    const a = (i / count) * Math.PI * 2
    const r = radius + (jitter ? Math.sin(i * 2.17) * jitter : 0)
    points.push({ x: Math.cos(a) * r, y: Math.sin(a) * r })
  }
  return points
}

function settings(extra: Partial<PrintSettings> = {}): PrintSettings {
  return mergeSettings(DEFAULT_SETTINGS, {
    layerHeight: 0.2,
    firstLayerHeight: 0.2,
    walls: 1,
    topLayers: 1,
    bottomLayers: 1,
    infillDensity: 0,
    adhesion: 'none',
    primeLine: { enabled: false },
    output: { objectLabels: false, excludeObjects: false },
    arcFitting: { enabled: true, tolerance: 0.05, minSegments: 4 },
    ...extra,
  })
}

function arcsIn(gcode: string): string[] {
  return gcode.split(/\r?\n/).filter((line) => /^G[23]\b/.test(line.trim()))
}

function main(): void {
  // Reine Geometrie: ein Kreis mit 32 Sehnen wird zu einem echten Bogen.
  const circle = circlePoints(10, 32)
  const arc = findLongestArc(circle, 0, 0.02, 4)
  assert.ok(arc, 'Kreisbogen wurde nicht erkannt')
  assert.ok(Math.abs(arc.radius - 10) < 0.01, `Kreisradius falsch: ${arc.radius}`)
  assert.equal(arc.ccw, true, 'Gegen den Uhrzeigersinn muss G3 werden')
  assert.ok(Math.abs(arc.sweep) > Math.PI / 2, 'Der Bogen muss deutlich länger als ein Viertelkreis sein')
  assert.ok(arc.endIndex >= 4, 'Der Bogen muss mehrere Sehnen ersetzen')
  assert.ok(Math.abs(arcLength(arc) - Math.abs(arc.sweep) * arc.radius) < 1e-6)
  const start = arcPointAt(arc, 0)
  const end = arcPointAt(arc, 1)
  assert.ok(Math.hypot(start.x - circle[0].x, start.y - circle[0].y) < 1e-6)
  assert.ok(Math.hypot(end.x - circle[arc.endIndex].x, end.y - circle[arc.endIndex].y) < 1e-6)
  assert.equal(fitArc(circle, 0, 4, 0.005)?.ccw, true)
  // Umgekehrte Laufrichtung wird als G2 erkannt.
  assert.equal(findLongestArc([...circle].reverse(), 0, 0.02, 4)?.ccw, false, 'Uhrzeigersinn muss G2 werden')
  // Mindestsegmente verhindern einen Bogen aus zu wenigen Stützpunkten.
  assert.equal(findLongestArc(circle, 0, 0.02, 1000), null, 'minSegments muss wirken')

  // Ein Quadrat ist kein Bogen; die vier Ecken dürfen nicht als Kreis glattgebügelt werden.
  const square: ArcPoint[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
    { x: 0, y: 0 },
  ]
  assert.equal(findLongestArc(square, 0, 0.05, 4), null, 'Eine quadratische Kontur darf keinen Bogen erhalten')

  // Toleranz: eine deutliche Abweichung wird nicht als Bogen akzeptiert.
  const wobbly = circlePoints(10, 32, 0.2)
  assert.equal(findLongestArc(wobbly, 0, 0.02, 4), null, 'Eine 0,2-mm-Welle darf bei 0,02 mm Toleranz kein Bogen sein')

  // Integration: ein 72-seitiger Zylinder wird als Wand tatsächlich mit G2/G3 ausgegeben.
  const mesh = makeMesh(new Float32Array(cylinder(15, 8, 72).flat()))
  const profile = printerById('anycubic-vyper')
  const enabled = sliceMesh(mesh, settings(), profile, null)
  const arcs = arcsIn(enabled.gcode)
  assert.ok(arcs.length > 0, 'Arc-Fitting hat keine G2/G3-Zeilen erzeugt')
  assert.ok(arcs.every((line) => / [IJ]-?\d/.test(line)), 'G2/G3 ohne I/J-Mittelpunkt')
  assert.ok(enabled.layers.length > 0)
  const preview = enabled.layers[0]?.data ?? []
  assert.ok(preview.length > 0 && preview.every((value) => Number.isFinite(value)), 'Vorschau enthält ungültige Werte')

  const disabled = sliceMesh(mesh, settings({ arcFitting: { enabled: false, tolerance: 0.05, minSegments: 4 } }), profile, null)
  assert.equal(arcsIn(disabled.gcode).length, 0, 'Bei ausgeschaltetem Arc-Fitting darf kein G2/G3 entstehen')
  assert.ok(disabled.gcode.includes('G1 X'), 'Die normale G1-Ausgabe muss erhalten bleiben')

  // Unterschiedliche Toleranz darf die Ausgabe nicht in unendliche Werte oder Müll ziehen.
  const loose = sliceMesh(mesh, settings({ arcFitting: { enabled: true, tolerance: 0.2, minSegments: 4 } }), profile, null)
  const looseArcs = arcsIn(loose.gcode)
  assert.ok(looseArcs.length > 0, 'Auch eine größere Toleranz muss gültige Bögen liefern')
  assert.ok(!loose.gcode.includes('NaN') && !loose.gcode.includes('Infinity'))

  console.log(
    `OK: Arc-Fitting; ${arcs.length} G2/G3-Zeilen am Zylinder, Bogenradius 10 mm, Quadrat bleibt G1, ` +
      `${disabled ? 'Aus' : 'An'}-Vergleich und Toleranz 0,20 mm geprüft.`,
  )
}

main()