/** Eingebaute Formen; IDs müssen mit `server/demo.ts` übereinstimmen. */
export type ShapeCategory = 'Testkörper' | 'Praktisch'

export type ShapePreview =
  | 'cube'
  | 'cube-top'
  | 'boat'
  | 'bridge'
  | 'tower'
  | 'clip'
  | 'hook'
  | 'tag'
  | 'coaster'

export type ShapeEntry = {
  id: string
  label: string
  /** Kurze Größe/Funktion für die Vorschaukarte. */
  detail: string
  preview?: ShapePreview
}

export type ExtraShapeEntry = ShapeEntry & {
  category: ShapeCategory
  preview: ShapePreview
}

export type ShapeLibrary = {
  standard: readonly ShapeEntry[]
  extra: readonly ExtraShapeEntry[]
}

export const SHAPE_LIBRARY: ShapeLibrary = {
  standard: [
    { id: 'wuerfel', label: 'Würfel 20', detail: '20 × 20 × 20 mm' },
    { id: 'zylinder', label: 'Zylinder', detail: 'Ø 30 × 40 mm' },
    { id: 'kugel', label: 'Kugel', detail: 'Ø 24 mm' },
    { id: 'kegel', label: 'Kegel', detail: 'Ø 24 × 30 mm' },
    { id: 'torus', label: 'Torus', detail: 'Ø 42 × 10 mm' },
    { id: 'platte', label: 'Platte 60×40', detail: '60 × 40 × 2 mm' },
  ],
  extra: [
    // Testkörper: bekannte Formen plus zwei neue Drucktests.
    { id: 'orca-wuerfel', label: 'Orca-Würfel', detail: '20 × 20 × 34 mm', category: 'Testkörper', preview: 'cube-top' },
    { id: 'voron-wuerfel', label: 'Voron-Würfel', detail: '20 × 20 × 24 mm', category: 'Testkörper', preview: 'cube-top' },
    { id: 'benchy', label: 'Benchy', detail: '47 × 16 × 38 mm', category: 'Testkörper', preview: 'boat' },
    { id: 'bruecke', label: 'Brücke', detail: '40 mm Überhang', category: 'Testkörper', preview: 'bridge' },
    { id: 'turm', label: 'Schlanker Turm', detail: '12 × 102 mm', category: 'Testkörper', preview: 'tower' },
    { id: 'fluss-wuerfel', label: 'Flow-Würfel', detail: '30 × 30 × 15 mm', category: 'Testkörper', preview: 'cube' },
    { id: 'retract-turm', label: 'Retract-Turm', detail: '2 × 10 × 40 mm', category: 'Testkörper', preview: 'tower' },
    { id: 'kalibrierungswuerfel', label: 'Kalibrierungswürfel', detail: '20 × 20 × 20 mm', category: 'Testkörper', preview: 'cube' },
    { id: 'hyperion-skiff-x3', label: 'Hyperion Skiff X3', detail: '89 × 56 × 62 mm', category: 'Testkörper', preview: 'boat' },

    // Praktische Kleinteile: bewusst einfache, druckbare Grundformen.
    { id: 'kabelklemme', label: 'Kabelklemme', detail: '22 × 12 × 13 mm', category: 'Praktisch', preview: 'clip' },
    { id: 'wandhaken', label: 'Wandhaken', detail: '20 × 23 × 23 mm', category: 'Praktisch', preview: 'hook' },
    { id: 'schluesselanhaenger', label: 'Schlüsselanhänger', detail: '34 × 20 × 4 mm', category: 'Praktisch', preview: 'tag' },
    { id: 'untersetzer', label: 'Untersetzer', detail: 'Ø 80 × 4 mm', category: 'Praktisch', preview: 'coaster' },
  ],
}

export const SHAPE_CATEGORIES: readonly ShapeCategory[] = ['Testkörper', 'Praktisch']
