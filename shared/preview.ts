import type { PreviewFeatureKind } from './types.ts'

export type PreviewFeatureMeta = {
  kind: PreviewFeatureKind
  code: number
  label: string
  color: string
}

/**
 * Reifefolge der Legende. Die Farben orientieren sich an der vertrauten
 * OrcaSlicer-Linientyp-Ansicht: Außenwand warm, Innenwand gelb, Füllung violett,
 * Deckschicht rot, Stützen blau.
 */
export const PREVIEW_FEATURES: PreviewFeatureMeta[] = [
  { kind: 'outer-wall', code: 1, label: 'Außenwand', color: '#ff8a3d' },
  { kind: 'inner-wall', code: 2, label: 'Innenwand', color: '#ffd166' },
  { kind: 'overhang', code: 8, label: 'Überhänge', color: '#f43f5e' },
  { kind: 'bridge', code: 9, label: 'Brücken', color: '#2dd4bf' },
  { kind: 'solid', code: 3, label: 'Deck-/Bodenschicht', color: '#ff6378' },
  { kind: 'sparse', code: 4, label: 'Füllung', color: '#a78bfa' },
  { kind: 'support', code: 5, label: 'Stützen', color: '#38bdf8' },
  { kind: 'iron', code: 6, label: 'Glätten', color: '#f472b6' },
  { kind: 'adhesion', code: 7, label: 'Skirt / Brim', color: '#60a5fa' },
  { kind: 'travel', code: 10, label: 'Reisen', color: '#94a3b8' },
  { kind: 'other', code: 11, label: 'Sonstige', color: '#cbd5e1' },
]

export const PREVIEW_CODE_KIND = new Map<number, PreviewFeatureKind>(
  PREVIEW_FEATURES.map((f) => [f.code, f.kind]),
)

export const PREVIEW_KIND_CODE = Object.fromEntries(
  PREVIEW_FEATURES.map((f) => [f.kind, f.code]),
) as Record<PreviewFeatureKind, number>

export const PREVIEW_FEATURE_META = new Map<PreviewFeatureKind, PreviewFeatureMeta>(
  PREVIEW_FEATURES.map((f) => [f.kind, f]),
)
