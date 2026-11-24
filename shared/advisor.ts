import type { DeepPartial, PrintSettings, Suggestion } from './types.ts'

export type IntentId = 'detail' | 'balanced' | 'fast'

export type Intent = {
  id: IntentId
  label: string
  hint: string
  patch: DeepPartial<PrintSettings>
}

/** Drei Absichten statt 200 Reglern. */
export const INTENTS: Intent[] = [
  {
    id: 'detail',
    label: 'Feindetail',
    hint: 'Dünne Schichten, mehr Wände, glatte Deckschicht',
    patch: {
      layerHeight: 0.12,
      firstLayerHeight: 0.2,
      walls: 4,
      topLayers: 5,
      bottomLayers: 4,
      infillDensity: 25,
      speeds: { print: 45, outerWall: 25, travel: 150, firstLayer: 18 },
      ironing: { enabled: true, flow: 0.14, speed: 22, spacing: 0.1 },
    },
  },
  {
    id: 'balanced',
    label: 'Ausgewogen',
    hint: 'Der Allrounder für die meisten Teile',
    patch: {
      layerHeight: 0.2,
      firstLayerHeight: 0.24,
      walls: 3,
      topLayers: 4,
      bottomLayers: 3,
      infillDensity: 20,
      speeds: { print: 60, outerWall: 35, travel: 150, firstLayer: 20 },
      ironing: { enabled: false, flow: 0.12, speed: 25, spacing: 0.12 },
    },
  },
  {
    id: 'fast',
    label: 'Schnell',
    hint: 'Funktionsteile, bei denen Zeit zählt',
    patch: {
      layerHeight: 0.28,
      firstLayerHeight: 0.3,
      walls: 2,
      topLayers: 3,
      bottomLayers: 2,
      infillDensity: 15,
      speeds: { print: 90, outerWall: 45, travel: 180, firstLayer: 22 },
      ironing: { enabled: false, flow: 0.12, speed: 25, spacing: 0.12 },
    },
  },
]

/** Smarte Vorschläge aus der Modellanalyse — jeweils mit Begründung. */
export function suggest(
  analysis: {
    overhangRatio: number
    flatTopRatio: number
    footprintAreaMm2: number
    bbox: { size: { x: number; y: number; z: number } }
  },
  settings: PrintSettings,
  bed: { x: number; y: number },
): Suggestion[] {
  const out: Suggestion[] = []
  const { size } = analysis.bbox
  const maxXY = Math.max(size.x, size.y)
  const height = size.z

  if (analysis.flatTopRatio > 0.08 && !settings.ironing.enabled) {
    out.push({
      id: 'ironing',
      title: 'Oberfläche glätten',
      detail: `${Math.round(analysis.flatTopRatio * 100)} % der Oberfläche sind flache Deckflächen. Glätten (Ironing) bügelt sie mit heißer Düse und wenig Fluss glatt — kostet ca. 10 % Zeit.`,
      impact: 'quality',
      patch: { ironing: { enabled: true, flow: 0.12, speed: 25, spacing: 0.12 } },
    })
  }

  if (height > 0.9 * maxXY && height > 25 && settings.zHop < 0.2) {
    out.push({
      id: 'tall',
      title: 'Z-Hop gegen Kollisionen',
      detail: 'Das Teil ist hoch und schlank. Beim Reisen hebt die Düse jetzt an, damit sie keine bereits gedruckten Wände umreißt.',
      impact: 'safety',
      patch: { zHop: 0.4, retraction: { distance: 0.8, speed: 45, minTravel: 2 } },
    })
  }

  if (analysis.overhangRatio > 0.015) {
    out.push({
      id: 'overhang',
      title: 'Überhänge bändigen',
      detail: `${(analysis.overhangRatio * 100).toFixed(1)} % der Fläche hängen über. Langsamere Außenwand und mehr Kühlung halten die Kanten sauber.`,
      impact: 'quality',
      patch: { speeds: { ...settings.speeds, outerWall: Math.min(settings.speeds.outerWall, 25) }, fanSpeed: 100 },
    })
  }

  if (settings.adhesion === 'none' && analysis.footprintAreaMm2 < 400 && height > 15) {
    out.push({
      id: 'brim',
      title: 'Brim für Haftung',
      detail: 'Kleine Standfläche, hohes Teil: ein 5-mm-Brim verhindert das Ablösen während des Drucks.',
      impact: 'adhesion',
      patch: { adhesion: 'brim' },
    })
  }

  if (maxXY > Math.min(bed.x, bed.y) - 20) {
    out.push({
      id: 'margin',
      title: 'Teil fast so groß wie das Bett',
      detail: 'Nur wenig Rand zum Bett. Ein Skirt hilft beim Anlaufen der Düse, ohne dass Material übersteht.',
      impact: 'adhesion',
      patch: { adhesion: 'skirt' },
    })
  }

  if (height < 12 && settings.layerHeight > 0.16) {
    out.push({
      id: 'small',
      title: 'Feinere Schichten',
      detail: 'Flaches Teil — feinere Schichten kosten hier kaum Zeit, bringen aber deutlich mehr Auflösung.',
      impact: 'quality',
      patch: { layerHeight: 0.12 },
    })
  }

  if (height > 120 && settings.speeds.print > 70) {
    out.push({
      id: 'longprint',
      title: 'Ruhiger in der Höhe',
      detail: 'Ab dieser Höhe schwingt das Teil mit. Etwas langsamer drucken verhindert Geisterkanten.',
      impact: 'quality',
      patch: { speeds: { ...settings.speeds, print: 55 } },
    })
  }

  return out
}
