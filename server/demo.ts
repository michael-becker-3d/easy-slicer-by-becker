import { buildBinarySTL } from './slicer/stl.ts'
import { loadAsset } from './assets.ts'

type Tri = number[]

function quad(a: number[], b: number[], c: number[], d: number[]): Tri[] {
  return [
    [...a, ...b, ...c],
    [...a, ...c, ...d],
  ]
}

function box(w: number, h: number, d: number, ox = 0, oy = 0, oz = 0): Tri[] {
  const x0 = ox - w / 2, x1 = ox + w / 2
  const y0 = oy - d / 2, y1 = oy + d / 2
  const z0 = oz, z1 = oz + h
  return [
    // unten
    ...quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]),
    // oben
    ...quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]),
    // seiten
    ...quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]),
    ...quad([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]),
    ...quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]),
    ...quad([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]),
  ]
}

function cylinder(r: number, h: number, seg = 72, ox = 0, oy = 0, oz = 0): Tri[] {
  const tris: Tri[] = []
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2
    const a1 = ((i + 1) / seg) * Math.PI * 2
    const x0 = Math.cos(a0) * r + ox, y0 = Math.sin(a0) * r + oy
    const x1 = Math.cos(a1) * r + ox, y1 = Math.sin(a1) * r + oy
    tris.push([ox, oy, oz, x0, y0, oz, x1, y1, oz])
    tris.push([ox, oy, oz + h, x1, y1, oz + h, x0, y0, oz + h])
    tris.push([x0, y0, oz, x1, y1, oz, x1, y1, oz + h])
    tris.push([x0, y0, oz, x1, y1, oz + h, x0, y0, oz + h])
  }
  return tris
}

/** Kugel mit dem tiefsten Punkt auf z = 0. */
function sphere(r: number, seg = 48, rings = 24): Tri[] {
  const tris: Tri[] = []
  const point = (i: number, j: number): number[] => {
    const phi = (j / rings) * Math.PI
    const theta = (i / seg) * Math.PI * 2
    return [
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.sin(phi) * Math.sin(theta),
      r * Math.cos(phi) + r,
    ]
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < seg; i++) {
      const a = point(i, j)
      const b = point(i + 1, j)
      const c = point(i + 1, j + 1)
      const d = point(i, j + 1)
      tris.push([...a, ...b, ...c], [...a, ...c, ...d])
    }
  }
  return tris
}

/** Kegel mit kreisförmiger Grundfläche auf z = 0. */
function cone(r: number, h: number, seg = 72): Tri[] {
  const tris: Tri[] = []
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2
    const a1 = ((i + 1) / seg) * Math.PI * 2
    const x0 = Math.cos(a0) * r, y0 = Math.sin(a0) * r
    const x1 = Math.cos(a1) * r, y1 = Math.sin(a1) * r
    tris.push([0, 0, 0, x0, y0, 0, x1, y1, 0])
    tris.push([x0, y0, 0, x1, y1, 0, 0, 0, h])
  }
  return tris
}

/** Torus, auf z = 0 abgesenkt. */
function torus(major: number, minor: number, seg = 48, tube = 16): Tri[] {
  const tris: Tri[] = []
  const point = (i: number, j: number): number[] => {
    const u = (i / seg) * Math.PI * 2
    const v = (j / tube) * Math.PI * 2
    const ring = major + minor * Math.cos(v)
    return [ring * Math.cos(u), ring * Math.sin(u), minor * Math.sin(v) + minor]
  }
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < tube; j++) {
      const a = point(i, j)
      const b = point(i + 1, j)
      const c = point(i + 1, j + 1)
      const d = point(i, j + 1)
      tris.push([...a, ...b, ...c], [...a, ...c, ...d])
    }
  }
  return tris
}

/** Einfache, gut druckbare Benchy-Silhouette aus geschlossenen Hüllen. */
function benchy(): Tri[] {
  return [
    ...box(44, 8, 16, 0, 0, 0),
    ...box(32, 10, 14, -2, 0, 8),
    ...box(18, 8, 10, -6, 0, 18),
    ...cylinder(2.4, 12, 32, 7, 0, 26),
    ...box(7, 4, 12, 21, 0, 2),
  ]
}

/** Formen entstehen entweder im Code oder kommen als fertiges STL aus `assets/shape-models`. */
type Demo = { label: string } & ({ build: () => Tri[] } | { file: string })

export const DEMOS: Record<string, Demo> = {
  wuerfel: { label: 'Kalibrierwürfel 20 mm', build: () => box(20, 20, 20) },
  zylinder: { label: 'Zylinder 30 × 40 mm', build: () => cylinder(15, 40) },
  kugel: { label: 'Kugel 24 mm', build: () => sphere(12) },
  kegel: { label: 'Kegel 24 × 30 mm', build: () => cone(12, 30) },
  torus: { label: 'Torus 40 mm', build: () => torus(16, 5) },
  platte: { label: 'Platte 60 × 40 × 2 mm', build: () => box(60, 2, 40) },
  'fluss-wuerfel': {
    label: 'Flow-Würfel 30 × 30 × 15 mm',
    build: () => box(30, 15, 30),
  },
  'retract-turm': {
    label: 'Retract-Turm 2 × 10 × 40 mm',
    build: () => [
      ...box(34, 3, 10),
      ...box(10, 40, 10, -12, 0, 0),
      ...box(10, 40, 10, 12, 0, 0),
    ],
  },
  kabelklemme: {
    label: 'Kabelklemme 22 mm',
    build: () => [
      ...box(22, 3, 12),
      ...box(3, 10, 4, -9.5, 0, 3),
      ...box(3, 10, 4, 9.5, 0, 3),
      ...box(4, 3, 4, -6.5, 0, 10),
      ...box(4, 3, 4, 6.5, 0, 10),
    ],
  },
  wandhaken: {
    label: 'Wandhaken 20 mm',
    build: () => [
      ...box(20, 20, 4),
      ...box(6, 6, 18, 0, 10, 8),
      ...box(6, 10, 6, 0, 18, 13),
    ],
  },
  schluesselanhaenger: {
    label: 'Schlüsselanhänger 34 mm',
    build: () => [...torus(8, 2), ...box(20, 4, 12, 14, 0, 0)],
  },
  untersetzer: {
    label: 'Untersetzer Ø 80 × 4 mm',
    build: () => cylinder(40, 4, 96),
  },
  'orca-wuerfel': {
    label: 'Orca-Würfel (Testform)',
    build: () => [
      ...box(20, 20, 20),
      ...box(12, 12, 2, 0, 0, 20),
      ...box(2, 12, 2, 0, 0, 22),
      ...box(12, 2, 2, 0, 0, 22),
    ],
  },
  'voron-wuerfel': {
    label: 'Voron-Würfel (Testform)',
    build: () => [
      ...box(20, 20, 20),
      ...box(4, 4, 4, 8, 8, 20),
      ...box(4, 4, 4, -8, 8, 20),
      ...box(4, 4, 4, 8, -8, 20),
      ...box(4, 4, 4, -8, -8, 20),
      ...cylinder(3, 4, 32, 0, 0, 20),
    ],
  },
  benchy: { label: 'Benchy (einfache Form)', build: benchy },
  bruecke: {
    label: 'Brücke (Überhang-Test)',
    build: () => [
      ...box(40, 6, 20, 0, 0, 0),
      ...box(8, 20, 20, -16, 0, 6),
      ...box(8, 20, 20, 16, 0, 6),
      ...box(40, 6, 20, 0, 0, 26),
    ],
  },
  turm: {
    label: 'Schlanker Turm 12 × 90 mm',
    build: () => [...box(12, 90, 12), ...cylinder(3, 12).map((t, i) => (i < 4 ? t.map((v, k) => (k % 3 === 2 ? v + 90 : v)) : t))],
  },
  // Fertige Modelle: liegen unter `assets/shape-models` und reisen in der EXE mit.
  kalibrierungswuerfel: { label: 'Kalibrierungswürfel 20 mm (STL)', file: 'kalibrierungswurfel.stl' },
  'hyperion-skiff-x3': { label: 'Hyperion Skiff X3 (STL)', file: 'hyperion-skiff-x3.stl' },
}

export function demoSTL(shape: string): Buffer | null {
  const demo = DEMOS[shape]
  if (!demo) return null
  if ('file' in demo) return loadAsset(`shape-models/${demo.file}`)
  return buildBinarySTL(demo.build())
}
