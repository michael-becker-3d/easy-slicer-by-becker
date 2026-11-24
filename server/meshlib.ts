export type Tri = number[]

function quad(a: number[], b: number[], c: number[], d: number[]): Tri[] {
  return [
    [...a, ...b, ...c],
    [...a, ...c, ...d],
  ]
}

/** Achsenparalleler Quader mit Min/Max-Koordinaten, Außennormalen. */
export function boxMinMax(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Tri[] {
  return [
    ...quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]),
    ...quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]),
    ...quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]),
    ...quad([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]),
    ...quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]),
    ...quad([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]),
  ]
}

export function box(w: number, h: number, d: number, ox = 0, oy = 0, oz = 0): Tri[] {
  return boxMinMax(ox - w / 2, oy - d / 2, oz, ox + w / 2, oy + d / 2, oz + h)
}

export function cylinder(r: number, h: number, seg = 64, ox = 0, oy = 0, oz = 0): Tri[] {
  const tris: Tri[] = []
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2
    const a1 = ((i + 1) / seg) * Math.PI * 2
    const x0 = ox + Math.cos(a0) * r, y0 = oy + Math.sin(a0) * r
    const x1 = ox + Math.cos(a1) * r, y1 = oy + Math.sin(a1) * r
    tris.push([ox, oy, oz, x0, y0, oz, x1, y1, oz])
    tris.push([ox, oy, oz + h, x1, y1, oz + h, x0, y0, oz + h])
    tris.push([x0, y0, oz, x1, y1, oz, x1, y1, oz + h])
    tris.push([x0, y0, oz, x1, y1, oz + h, x0, y0, oz + h])
  }
  return tris
}

/**
 * Geschlossenes Prisma aus einem abgerundeten Rechteck. Die vier Ecken werden
 * fein in Bögen zerlegt, die vier Seiten dazwischen bleiben echte Geraden.
 * Genau das braucht der Max-Flow-Test: keine 96 kurzen Kreis-Sehnen, sondern
 * lange Strecken zum Beschleunigen und nur wenige Richtungswechsel.
 */
export function roundedRectPrism(
  width: number,
  depth: number,
  radius: number,
  height: number,
  cornerSegments = 10,
  ox = 0,
  oy = 0,
  oz = 0,
): Tri[] {
  const w = Math.max(0.2, width)
  const d = Math.max(0.2, depth)
  const r = Math.max(0, Math.min(radius, w / 2, d / 2))
  const n = Math.max(1, Math.round(cornerSegments))
  const corners = [
    { cx: w / 2 - r, cy: -d / 2 + r, start: -Math.PI / 2 },
    { cx: w / 2 - r, cy: d / 2 - r, start: 0 },
    { cx: -w / 2 + r, cy: d / 2 - r, start: Math.PI / 2 },
    { cx: -w / 2 + r, cy: -d / 2 + r, start: Math.PI },
  ]
  const perimeter: { x: number; y: number }[] = []
  for (const corner of corners) {
    for (let i = 0; i <= n; i++) {
      const angle = corner.start + (i / n) * (Math.PI / 2)
      perimeter.push({
        x: ox + corner.cx + Math.cos(angle) * r,
        y: oy + corner.cy + Math.sin(angle) * r,
      })
    }
  }

  const tris: Tri[] = []
  const center = { x: ox, y: oy }
  for (let i = 0; i < perimeter.length; i++) {
    const a = perimeter[i]
    const b = perimeter[(i + 1) % perimeter.length]
    tris.push([center.x, center.y, oz, b.x, b.y, oz, a.x, a.y, oz])
    tris.push([center.x, center.y, oz + height, a.x, a.y, oz + height, b.x, b.y, oz + height])
    tris.push(...quad([a.x, a.y, oz], [b.x, b.y, oz], [b.x, b.y, oz + height], [a.x, a.y, oz + height]))
  }
  return tris
}

/** Hohler quadratischer Turm (4 Wände, oben/unten offen). */
export function tube(outer: number, wall: number, height: number, ox = 0, oy = 0, oz = 0): Tri[] {
  const h = outer / 2
  const i = h - wall
  return [
    ...boxMinMax(ox - h, oy - h, oz, ox - i, oy + h, oz + height),
    ...boxMinMax(ox + i, oy - h, oz, ox + h, oy + h, oz + height),
    ...boxMinMax(ox - i, oy - h, oz, ox + i, oy - i, oz + height),
    ...boxMinMax(ox - i, oy + i, oz, ox + i, oy + h, oz + height),
  ]
}

/** 5×7-Ziffern für aufgedruckte Beschriftungen. */
const GLYPHS: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  'B': ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  'C': ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  'D': ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  'F': ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  'G': ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  'H': ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  'I': ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  'J': ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  'K': ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  'L': ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  'N': ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  'Q': ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  'R': ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  'S': ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  'T': ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  'U': ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  'V': ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  'W': ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  'X': ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  'Y': ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  'Z': ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  '&': ['01100', '10010', '10100', '01000', '10101', '10010', '01101'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ',': ['00000', '00000', '00000', '00000', '01100', '01100', '11000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '_': ['00000', '00000', '00000', '00000', '00000', '00000', '11111'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
}

/**
 * Erhabene Schrift als Pixelblöcke auf der XY-Ebene (Bettoberseite).
 * Text wird in X und Y um 0 zentriert, die Blöcke stehen auf z = 0.
 */
export function textBlocks(
  text: string,
  opts: { fontHeight: number; depth: number; spacing?: number },
): { tris: Tri[]; width: number; height: number } {
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
  const chars = [...normalized]
  const pixel = Math.max(0.2, opts.fontHeight / 7)
  const gap = opts.spacing ?? pixel * 0.9
  const advance = pixel * 5 + gap
  const width = Math.max(pixel, chars.length * advance - gap)
  const x0 = -width / 2
  const y0 = -(pixel * 7) / 2
  const tris: Tri[] = []

  chars.forEach((ch, ci) => {
    const glyph = GLYPHS[ch] ?? GLYPHS['?']
    glyph.forEach((row, ry) => {
      ;[...row].forEach((bit, rx) => {
        if (bit !== '1') return
        const bx = x0 + ci * advance + rx * pixel
        const by = y0 + (6 - ry) * pixel
        tris.push(...boxMinMax(bx, by, 0, bx + pixel * 0.82, by + pixel * 0.82, opts.depth))
      })
    })
  })

  return { tris, width, height: pixel * 7 }
}

/**
 * Prägt Text als erhabene Pixel auf eine senkrechte Fläche (Blick von -Y).
 * xCenter/zBottom beziehen sich auf die Modellkoordinaten.
 */
export function emboss(
  text: string,
  opts: {
    xCenter: number
    yFace: number
    zBottom: number
    pixel?: number
    depth?: number
  },
): Tri[] {
  const px = opts.pixel ?? 0.8
  const depth = opts.depth ?? 0.8
  const chars = [...text]
  const width = chars.length * 6 * px
  const x0 = opts.xCenter - width / 2
  const tris: Tri[] = []

  chars.forEach((ch, ci) => {
    const glyph = GLYPHS[ch] ?? GLYPHS[' ']
    glyph.forEach((row, ry) => {
      ;[...row].forEach((bit, rx) => {
        if (bit !== '1') return
        const bx = x0 + (ci * 6 + rx) * px
        const bz = opts.zBottom + (6 - ry) * px
        tris.push(
          ...boxMinMax(bx, opts.yFace - depth, bz, bx + px * 0.82, opts.yFace, bz + px * 0.82),
        )
      })
    })
  })
  return tris
}

export function embossFitted(
  text: string,
  opts: { xCenter: number; yFace: number; zBottom: number; maxWidth: number; depth?: number },
): Tri[] {
  const pixel = Math.min(0.8, opts.maxWidth / Math.max(1, text.length * 6))
  return emboss(text, { ...opts, pixel })
}
