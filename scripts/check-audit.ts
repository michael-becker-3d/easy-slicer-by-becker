import assert from 'node:assert/strict'
import { auditPrint, auditSummary, type AuditInput } from '../shared/audit.ts'
import { DEFAULT_SETTINGS, mergeSettings, type ModelAnalysis, type PrintSettings } from '../shared/types.ts'

function analysis(over: Partial<ModelAnalysis> = {}): ModelAnalysis {
  const size = over.bbox?.size ?? { x: 20, y: 20, z: 20 }
  return {
    name: 'Testwürfel',
    triangles: 12,
    bbox: {
      min: { x: -size.x / 2, y: -size.y / 2, z: 0 },
      max: { x: size.x / 2, y: size.y / 2, z: size.z },
      size,
    },
    volumeMm3: 8000,
    surfaceAreaMm2: 2400,
    overhangRatio: 0,
    flatTopRatio: 0,
    footprintAreaMm2: 400,
    ...over,
  }
}

const bed = { x: 245, y: 245, z: 260 }

function audit(
  shape: Partial<ModelAnalysis>,
  settings: PrintSettings = DEFAULT_SETTINGS,
): ReturnType<typeof auditPrint> {
  const input: AuditInput = { analysis: analysis(shape), settings, bed, objectName: 'Würfel' }
  return auditPrint(input)
}

const clean = audit({})
assert.equal(clean.length, 0, `Sauberes 20-mm-Teil darf keine Befunde liefern: ${clean.map((f) => f.id).join(', ')}`)

// Bettmaß: kritisch, ohne Fix, und der Ort nennt die Achse.
const tooBig = audit({ bbox: { min: { x: 0, y: 0, z: 0 }, max: { x: 300, y: 20, z: 20 }, size: { x: 300, y: 20, z: 20 } } })
const oversize = tooBig.find((finding) => finding.id === 'oversize')
assert.ok(oversize, 'Übergroßes Teil muss einen kritischen Befund erzeugen')
assert.equal(oversize.severity, 'critical')
assert.match(oversize.value, /X 300/)
assert.equal(oversize.fix, undefined, 'Ein zu großes Teil darf keinen Schein-Fix anbieten')
assert.match(oversize.why, /Fahrbereich/)

// Schichthöhe: Fix rechnet auf 60 % der Düse, nicht auf einen festen Wert.
const thickLayer = audit({}, mergeSettings(DEFAULT_SETTINGS, { layerHeight: 0.36 }))
const layer = thickLayer.find((finding) => finding.id === 'layer-height')
assert.ok(layer, '0,36 mm bei 0,4-mm-Düse muss auffallen')
assert.equal(layer.fix?.patch.layerHeight, 0.24, 'Fix muss 0,24 mm vorschlagen')
assert.match(layer.value, /Grenze 0,3/)

// Überhang ohne Stützen: Fix schaltet Baumstützen ein und behält die übrigen Werte.
const overhang = audit({ overhangRatio: 0.03 })
const support = overhang.find((finding) => finding.id === 'overhang-support')
assert.ok(support, 'Überhang ohne Stützen muss gemeldet werden')
assert.equal(support.severity, 'warn')
assert.equal(support.fix?.patch.support?.kind, 'tree')
assert.equal(support.fix?.patch.support?.threshold, DEFAULT_SETTINGS.support.threshold)
assert.ok(overhang.some((finding) => finding.id === 'overhang-cooling') === false, 'Volle Kühlung darf nicht gemeldet werden')

// Hohes, schlankes Teil ohne Z-Hop, dazu hohe Geschwindigkeit.
const tall = audit(
  { bbox: { min: { x: 0, y: 0, z: 0 }, max: { x: 20, y: 20, z: 180 }, size: { x: 20, y: 20, z: 180 } } },
  mergeSettings(DEFAULT_SETTINGS, { zHop: 0, speeds: { ...DEFAULT_SETTINGS.speeds, print: 90 } }),
)
assert.ok(tall.some((finding) => finding.id === 'tall-zhop'), 'Hohes Teil ohne Z-Hop fehlt')
assert.ok(tall.some((finding) => finding.id === 'tall-speed'), 'Hohes Teil mit 90 mm/s fehlt')
assert.ok(tall.some((finding) => finding.id === 'slender'), 'Schlankes Teil muss als Hinweis erscheinen')
const zHopFix = tall.find((finding) => finding.id === 'tall-zhop')?.fix
assert.equal(zHopFix?.patch.zHop, 0.4)

// Kleine Standfläche, hohes Teil, keine Haftung.
const smallFoot = audit(
  { footprintAreaMm2: 180, bbox: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 20, z: 40 }, size: { x: 10, y: 20, z: 40 } } },
  mergeSettings(DEFAULT_SETTINGS, { adhesion: 'none' }),
)
const brim = smallFoot.find((finding) => finding.id === 'small-footprint')
assert.ok(brim, 'Kleine Standfläche ohne Haftung fehlt')
assert.equal(brim.fix?.patch.adhesion, 'brim')

// Flache Deckfläche ohne Glätten.
const flatTop = audit({ flatTopRatio: 0.2 })
assert.ok(flatTop.some((finding) => finding.id === 'flat-top'), 'Große Deckfläche ohne Glätten fehlt')

// Fluss außerhalb des gesunden Bereichs.
const flow = audit({}, mergeSettings(DEFAULT_SETTINGS, { flow: 1.3 }))
assert.equal(flow.find((finding) => finding.id === 'flow-range')?.fix?.patch.flow, 1)

// Reihenfolge: kritisch vor Warnung vor Hinweis.
const mixed = audit(
  { overhangRatio: 0.08, flatTopRatio: 0.2 },
  mergeSettings(DEFAULT_SETTINGS, { layerHeight: 0.36, flow: 1.2, support: { ...DEFAULT_SETTINGS.support, kind: 'none' } }),
)
assert.equal(mixed[0].severity, 'critical', 'Kritischer Überhang muss zuerst stehen')
const rank = { critical: 0, warn: 1, info: 2 } as const
for (let index = 1; index < mixed.length; index++) {
  assert.ok(
    rank[mixed[index - 1].severity] <= rank[mixed[index].severity],
    'Befunde müssen nach Schwere sortiert sein',
  )
}
const summary = auditSummary(mixed)
assert.equal(summary.total, mixed.length)
assert.equal(summary.critical + summary.warn + summary.info, mixed.length)
assert.ok(summary.critical >= 1 && summary.warn >= 1 && summary.info >= 1, 'Der Mischfall braucht alle drei Stufen')

// Jeder Befund muss Ort, Zahl, Folge und Begründung wirklich gefüllt haben.
for (const finding of mixed) {
  assert.ok(finding.where.trim(), `${finding.id}: Ort fehlt`)
  assert.ok(finding.value.trim(), `${finding.id}: Messwert fehlt`)
  assert.ok(finding.consequence.trim(), `${finding.id}: Folge fehlt`)
  assert.ok(finding.why.trim(), `${finding.id}: Begründung fehlt`)
  assert.ok(finding.title.trim(), `${finding.id}: Titel fehlt`)
}

// Determinismus.
assert.deepEqual(audit({ overhangRatio: 0.05 }), audit({ overhangRatio: 0.05 }))

console.log(
  `OK: Audit prüft ${clean.length === 0 ? 'sauberes Teil ohne Befund' : 'sauberes Teil'}; ` +
    `${mixed.length} Befunde im Mischfall (${summary.critical} kritisch, ${summary.warn} Warnung, ${summary.info} Hinweis); ` +
    `Schichthöhe → ${layer.fix?.patch.layerHeight} mm, Überhang → ${support.fix?.patch.support?.kind}; ` +
    `Ort/Wert/Folge/Warum bei allen Befunden gefüllt.`,
)
