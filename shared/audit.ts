import type { DeepPartial, ModelAnalysis, PrintSettings } from './types.ts'

/**
 * Druckbarkeits-Audit (V-17).
 *
 * Anders als der Modellberater (`advisor.ts`) bewertet das Audit nicht nur das
 * Modell, sondern das Zusammenspiel aus Modell, Druckprofil und Bett. Jeder
 * Befund nennt einen Ort, den gemessenen Wert, die Folge beim Weiterdrucken,
 * die Begründung der Regel und — wenn möglich — einen Ein-Klick-Fix.
 */
export type AuditSeverity = 'critical' | 'warn' | 'info'

export type AuditFix = {
  label: string
  patch: DeepPartial<PrintSettings>
}

export type AuditFinding = {
  id: string
  severity: AuditSeverity
  title: string
  /** Wo der Befund sitzt, z. B. „Objekt · Überhang“ oder „Bett X/Y/Z“. */
  where: string
  /** Der gemessene Wert als lesbarer Text inklusive Einheit. */
  value: string
  /** Was ohne Änderung passiert. */
  consequence: string
  /** Warum die Regel gilt — die Erklärung, die Orca nicht mitliefert. */
  why: string
  fix?: AuditFix
}

export type AuditInput = {
  analysis: ModelAnalysis
  settings: PrintSettings
  bed: { x: number; y: number; z: number }
  /** Objektname für den Befundort; ohne Angabe „Modell“. */
  objectName?: string
}

export type AuditSummary = {
  total: number
  critical: number
  warn: number
  info: number
}

const round2 = (value: number) => Math.round(value * 100) / 100

const mm = (value: number) => `${value.toFixed(1).replace('.', ',')} mm`
const pct = (value: number) => `${(value * 100).toFixed(1).replace('.', ',')} %`
const times = (value: number) => `${value.toFixed(2).replace('.', ',')} ×`

/** Zählt die Befunde nach Schwere — für die Kopfzeile des Panels. */
export function auditSummary(findings: readonly AuditFinding[]): AuditSummary {
  const summary: AuditSummary = { total: findings.length, critical: 0, warn: 0, info: 0 }
  for (const finding of findings) summary[finding.severity] += 1
  return summary
}

/**
 * Prüft das Modell gegen Bett und Profil. Die Reihenfolge ist bewusst:
 * kritische Fehler zuerst, danach Warnungen, zum Schluss Hinweise.
 */
export function auditPrint({ analysis, settings, bed, objectName }: AuditInput): AuditFinding[] {
  const out: AuditFinding[] = []
  const { size } = analysis.bbox
  const label = objectName?.trim() || 'Modell'
  const maxXY = Math.max(size.x, size.y)
  const minXY = Math.min(size.x, size.y)
  const height = size.z
  const nozzle = settings.nozzle > 0 ? settings.nozzle : 0.4

  // 1. Passt das Modell überhaupt auf das Bett?
  const oversize = [
    size.x > bed.x + 0.01 ? `X ${mm(size.x)} > ${mm(bed.x)}` : null,
    size.y > bed.y + 0.01 ? `Y ${mm(size.y)} > ${mm(bed.y)}` : null,
    size.z > bed.z + 0.01 ? `Z ${mm(size.z)} > ${mm(bed.z)}` : null,
  ].filter((value): value is string => value !== null)
  if (oversize.length) {
    out.push({
      id: 'oversize',
      severity: 'critical',
      title: 'Teil passt nicht auf das Bett',
      where: `${label} · Bettmaß`,
      value: oversize.join(' · '),
      consequence: 'Der Slicer bricht ab oder schneidet das Teil am Rand ab; ein Druck ist so nicht möglich.',
      why: 'Die Düse kann nur innerhalb des freigegebenen Fahrbereichs arbeiten. Rand, Saum und Brim brauchen zusätzlich Platz.',
    })
  }

  // 2. Schichthöhe gegen Düsendurchmesser.
  if (settings.layerHeight > nozzle * 0.8) {
    const suggested = round2(Math.max(0.08, nozzle * 0.6))
    out.push({
      id: 'layer-height',
      severity: 'warn',
      title: 'Schichthöhe zu groß für die Düse',
      where: `${label} · Qualität`,
      value: `${mm(settings.layerHeight)} bei ${mm(nozzle)} Düse (Grenze ${mm(nozzle * 0.8)})`,
      consequence: 'Die Bahnen werden nicht mehr sauber geglättet; es entstehen Lücken, raue Wände und schwache Verbindungen.',
      why: 'Eine Schicht muss von der Düse noch angedrückt werden können. Über etwa 80 % des Düsendurchmessers fehlt der Anpressdruck.',
      fix: { label: `Auf ${mm(suggested)} setzen`, patch: { layerHeight: suggested } },
    })
  }

  // 3. Erste Schicht dicker als die Düse.
  if (settings.firstLayerHeight > nozzle * 1.1) {
    const suggested = round2(Math.max(0.12, nozzle * 0.5))
    out.push({
      id: 'first-layer-height',
      severity: 'warn',
      title: 'Erste Schicht zu dick',
      where: `${label} · Erste Schicht`,
      value: `${mm(settings.firstLayerHeight)} bei ${mm(nozzle)} Düse`,
      consequence: 'Die erste Lage wird nicht gleichmäßig angedrückt und löst sich an Ecken; die Folge ist Warping.',
      why: 'Die erste Schicht braucht vollen Anpressdruck auf die Platte. Mehr als etwa eine Düsenbreite verhindert das.',
      fix: { label: `Auf ${mm(suggested)} setzen`, patch: { firstLayerHeight: suggested } },
    })
  }

  // 4. Zu wenige Wände.
  if (settings.walls < 2) {
    out.push({
      id: 'walls',
      severity: 'warn',
      title: 'Nur eine Wand',
      where: `${label} · Wände`,
      value: `${settings.walls} Wand${settings.walls === 1 ? '' : 'e'}`,
      consequence: 'Das Teil wird druckempfindlich und bricht leicht entlang der Schichten; Füllung scheint durch.',
      why: 'Zwei Wände tragen die Füllung und schließen die Außenhaut. Eine einzelne Wand ist nur bei Vasen sinnvoll.',
      fix: { label: '3 Wände setzen', patch: { walls: 3 } },
    })
  }

  // 5. Zu wenige Deckschichten.
  if (settings.topLayers > 0 && settings.topLayers < 3) {
    out.push({
      id: 'top-layers',
      severity: 'warn',
      title: 'Deckschicht zu dünn',
      where: `${label} · Deckfläche`,
      value: `${settings.topLayers} Deckschicht${settings.topLayers === 1 ? '' : 'en'}`,
      consequence: 'Die Füllung zeichnet sich ab (Pillowing), und die Oberfläche wird beim Glätten uneben.',
      why: 'Erst drei bis vier geschlossene Lagen über der Füllung ergeben eine dichte, ebene Deckfläche.',
      fix: { label: '4 Deckschichten setzen', patch: { topLayers: 4 } },
    })
  }

  // 6. Sehr offene Füllung unter dünner Decke.
  if (settings.infillDensity > 0 && settings.infillDensity < 10 && settings.topLayers < 4) {
    out.push({
      id: 'infill-under-top',
      severity: 'info',
      title: 'Offene Füllung unter dünner Decke',
      where: `${label} · Füllung`,
      value: `${Math.round(settings.infillDensity)} % Füllung, ${settings.topLayers} Deckschichten`,
      consequence: 'Die Deckfläche sackt zwischen den Füllbahnen durch und wird wellig.',
      why: 'Bei weniger als 10 % Füllung liegen die Stützbahnen weit auseinander. Entweder mehr Füllung oder mehr Deckschichten fangen das auf.',
      fix: { label: '15 % Füllung setzen', patch: { infillDensity: 15 } },
    })
  }

  // 7. Überhänge ohne Stützen.
  if (analysis.overhangRatio > 0.015 && settings.support.kind === 'none') {
    out.push({
      id: 'overhang-support',
      severity: analysis.overhangRatio > 0.05 ? 'critical' : 'warn',
      title: 'Überhänge ohne Stützen',
      where: `${label} · Überhang`,
      value: `${pct(analysis.overhangRatio)} der Fläche hängt über 45°`,
      consequence: 'Die Außenwand fällt durch oder hängt als Schlaufe herunter; die Oberfläche wird unbrauchbar.',
      why: 'Eine Bahn braucht unter sich Material oder eine Stütze. Ab etwa 45° Neigung reicht die vorherige Schicht nicht mehr.',
      fix: {
        label: 'Baumstützen einschalten',
        patch: { support: { ...settings.support, kind: 'tree' } },
      },
    })
  }

  // 8. Überhänge ohne volle Kühlung.
  if (analysis.overhangRatio > 0.015 && settings.fanSpeed < 80) {
    out.push({
      id: 'overhang-cooling',
      severity: 'warn',
      title: 'Zu wenig Kühlung an Überhängen',
      where: `${label} · Lüfter`,
      value: `${Math.round(settings.fanSpeed)} % Lüfter bei ${pct(analysis.overhangRatio)} Überhang`,
      consequence: 'Die überstehenden Bahnen kühlen zu langsam und sacken ab; Kanten werden rund.',
      why: 'Überhangmaterial muss erstarren, bevor die nächste Bahn darauf liegt. Unter 80 % Lüfter reicht die Kühlung meist nicht.',
      fix: { label: 'Lüfter auf 100 %', patch: { fanSpeed: 100 } },
    })
  }

  // 9. Hohes, schlankes Teil ohne Z-Hop.
  if (height > 25 && height > 0.9 * maxXY && settings.zHop < 0.2) {
    out.push({
      id: 'tall-zhop',
      severity: 'warn',
      title: 'Hohes Teil ohne Z-Hop',
      where: `${label} · Fahrweg`,
      value: `${mm(height)} hoch bei ${mm(maxXY)} Grundfläche, Z-Hop ${settings.zHop.toFixed(2).replace('.', ',')} mm`,
      consequence: 'Die Düse streift bereits gedruckte Wände, reißt sie um und hinterlässt Kratzer.',
      why: 'Bei schlanken Teilen biegt sich die Spitze beim Fahren. Ein Hub von 0,4 mm hebt die Düse über die gedruckte Kante.',
      fix: {
        label: 'Z-Hop 0,4 mm',
        patch: { zHop: 0.4, retraction: { ...settings.retraction, distance: Math.max(0.8, settings.retraction.distance), minTravel: 2 } },
      },
    })
  }

  // 10. Kleine Standfläche, hohes Teil, keine Haftungshilfe.
  if (settings.adhesion === 'none' && analysis.footprintAreaMm2 < 400 && height > 15) {
    out.push({
      id: 'small-footprint',
      severity: 'warn',
      title: 'Kleine Standfläche ohne Brim',
      where: `${label} · Haftung`,
      value: `${analysis.footprintAreaMm2.toFixed(0)} mm² Standfläche bei ${mm(height)} Höhe`,
      consequence: 'Das Teil löst sich während des Drucks vom Bett; der Druck ist verloren.',
      why: 'Je kleiner die Auflage und je höher der Schwerpunkt, desto eher kippt das Teil. Ein Brim vergrößert die Haftfläche.',
      fix: { label: 'Brim einschalten', patch: { adhesion: 'brim' } },
    })
  }

  // 11. Fast kein Rand zum Bett.
  if (maxXY > Math.min(bed.x, bed.y) - 20 && settings.adhesion === 'none') {
    out.push({
      id: 'bed-margin',
      severity: 'info',
      title: 'Kaum Rand zum Bett',
      where: `${label} · Bettrand`,
      value: `${mm(maxXY)} bei ${mm(Math.min(bed.x, bed.y))} Bettbreite`,
      consequence: 'Der Anlauf der Düse liegt zu nah am Teil; ein Saum fehlt und die erste Bahn startet unsauber.',
      why: 'Der Slicer braucht Platz für Saum und Anlauf. Ein Skirt reinigt die Düse, ohne das Teil zu vergrößern.',
      fix: { label: 'Skirt einschalten', patch: { adhesion: 'skirt' } },
    })
  }

  // 12. Große flache Deckfläche ohne Glätten.
  if (analysis.flatTopRatio > 0.08 && !settings.ironing.enabled) {
    out.push({
      id: 'flat-top',
      severity: 'info',
      title: 'Große Deckfläche ungeglättet',
      where: `${label} · Deckfläche`,
      value: `${pct(analysis.flatTopRatio)} flache Deckfläche`,
      consequence: 'Die oberste Lage bleibt sichtbar geriffelt; bei Sichtteilen wirkt das unfertig.',
      why: 'Glätten fährt die Deckfläche mit heißer Düse und wenig Fluss nach. Es kostet rund 10 % Zeit, aber keine Genauigkeit.',
      fix: { label: 'Glätten einschalten', patch: { ironing: { ...settings.ironing, enabled: true, flow: 0.12, speed: 25, spacing: 0.12 } } },
    })
  }

  // 13. Flaches Teil mit groben Schichten.
  if (height < 12 && settings.layerHeight > 0.16) {
    out.push({
      id: 'fine-layers',
      severity: 'info',
      title: 'Grobe Schichten an einem flachen Teil',
      where: `${label} · Qualität`,
      value: `${mm(settings.layerHeight)} bei nur ${mm(height)} Höhe`,
      consequence: 'Sichtbare Treppenstufen an Schrägen, obwohl das Teil schnell gedruckt wäre.',
      why: 'Bei geringer Höhe kostet eine feinere Schicht kaum Zeit. Der Gewinn an Oberfläche ist dagegen deutlich.',
      fix: { label: '0,12 mm Schichthöhe', patch: { layerHeight: 0.12 } },
    })
  }

  // 14. Fluss außerhalb des gesunden Bereichs.
  if (settings.flow < 0.85 || settings.flow > 1.15) {
    out.push({
      id: 'flow-range',
      severity: 'warn',
      title: 'Fluss weit vom Normalwert',
      where: `${label} · Fluss`,
      value: times(settings.flow),
      consequence: 'Wände werden zu dünn oder zu dick; Passungen stimmen nicht mehr und die Oberfläche bekommt Wülste.',
      why: 'Der Fluss gleicht Messungen aus, ersetzt aber keine Kalibrierung. Werte außerhalb von 0,85–1,15 deuten auf eine falsche Wandmessung hin.',
      fix: { label: 'Fluss auf 1,00 setzen', patch: { flow: 1 } },
    })
  }

  // 15. Hohe Teile zu schnell.
  if (height > 120 && settings.speeds.print > 70) {
    out.push({
      id: 'tall-speed',
      severity: 'info',
      title: 'Hohes Teil mit hoher Geschwindigkeit',
      where: `${label} · Tempo`,
      value: `${Math.round(settings.speeds.print)} mm/s bei ${mm(height)} Höhe`,
      consequence: 'Das Teil schwingt mit; es entstehen Geisterkanten und sichtbare Ringe.',
      why: 'Ab etwa 120 mm Höhe wirkt der Hebel des Bauteils. Etwas langsamer zu drucken ist billiger als eine Nacharbeit.',
      fix: { label: '55 mm/s setzen', patch: { speeds: { ...settings.speeds, print: 55 } } },
    })
  }

  // 16. Erste Schicht zu schnell für die Haftung.
  if (settings.speeds.firstLayer > 25) {
    out.push({
      id: 'first-layer-speed',
      severity: 'info',
      title: 'Erste Schicht zu schnell',
      where: `${label} · Erste Schicht`,
      value: `${Math.round(settings.speeds.firstLayer)} mm/s`,
      consequence: 'Die erste Lage wird nicht gleichmäßig angedrückt und haftet schlechter, besonders an Ecken.',
      why: 'Langsam fahren gibt dem Material Zeit, sich in die Platte zu drücken. 20 mm/s sind ein bewährter Wert.',
      fix: { label: '20 mm/s setzen', patch: { speeds: { ...settings.speeds, firstLayer: 20 } } },
    })
  }

  // 17. Sehr schmale Grundfläche bei großer Höhe.
  if (minXY > 0 && height / minXY > 8) {
    out.push({
      id: 'slender',
      severity: 'info',
      title: 'Sehr schlankes Bauteil',
      where: `${label} · Standfestigkeit`,
      value: `Verhältnis Höhe zu schmaler Seite ${(height / minXY).toFixed(1).replace('.', ',')} : 1`,
      consequence: 'Das Teil kann während des Drucks kippen oder nach dem Abnehmen brechen.',
      why: 'Ab etwa 8 : 1 wird die Standfestigkeit zum bestimmenden Faktor. Eine andere Ausrichtung oder Teilung hilft mehr als schnellere Parameter.',
    })
  }

  const rank: Record<AuditSeverity, number> = { critical: 0, warn: 1, info: 2 }
  return out.sort((a, b) => rank[a.severity] - rank[b.severity])
}
