const TAU = Math.PI * 2

/**
 * Einzige Quelle für die Musterliste: Die UI-Auswahl und der Typ werden
 * daraus abgeleitet, damit ein neues Muster nicht nur im Switch landet,
 * sondern auch in der Oberfläche und in den Tests auftaucht.
 */
export const SURFACE_TEXTURE_PATTERNS = [
  {
    value: 'noise',
    label: 'Fuzzy / Rauschen',
    hint: 'Klassische, gleichmäßige Fuzzy-Skin-Rauheit. Gut als Ausgangspunkt und für griffige Flächen.',
  },
  {
    value: 'stone',
    label: 'Stein / Fels',
    hint: 'Unregelmäßige, mehrstufige Felsstruktur. Für Terrakotta, Kunststein und rustikale Oberflächen.',
  },
  {
    value: 'stone-blocks',
    label: 'Mauerwerk / Steinplatten',
    hint: 'Versetzte Steinreihen mit schmalen Fugen. Die Merkmalsgröße bestimmt die Blockhöhe.',
  },
  {
    value: 'wood-grain',
    label: 'Holzmaserung',
    hint: 'Lange, leicht gewellte Maserung mit feiner Porenstruktur. Richtung über den Winkel einstellen.',
  },
  {
    value: 'wood-rings',
    label: 'Holzjahresringe',
    hint: 'Gebogene Jahresringe mit organischer Störung. Wirkt besonders auf runden und vasenförmigen Teilen.',
  },
  {
    value: 'bark',
    label: 'Baumrinde',
    hint: 'Tiefe, unregelmäßige Rindenfurchen. Für rustikale Deko, Griffe und naturbelassene Flächen.',
  },
  {
    value: 'hammered',
    label: 'Gehämmert',
    hint: 'Runde Schlagspuren wie bei gehämmertem Metall oder Kupfer.',
  },
  {
    value: 'knurl',
    label: 'Rändel / Rauten',
    hint: 'Diagonal gekreuzte Rillen für Griffigkeit an Knöpfen, Griffen und Deckeln.',
  },
  {
    value: 'ripple',
    label: 'Wellen',
    hint: 'Weiche, horizontale Wellen. Eine ruhige Struktur für Vasen und Zierflächen.',
  },
  {
    value: 'marble',
    label: 'Marmor / Schiefer',
    hint: 'Geäderte, leicht gewellte Steinlagen. Für edle Deko, Schalen und schieferartige Flächen.',
  },
  {
    value: 'concrete',
    label: 'Beton / Sandstein',
    hint: 'Feine Körnung mit einzelnen Poren und Ausbrüchen. Für architektonische und rustikale Teile.',
  },
  {
    value: 'leather',
    label: 'Leder',
    hint: 'Unregelmäßige Zellstruktur mit weichen Graten. Für Griffe, Taschen und griffige Oberflächen.',
  },
  {
    value: 'basket',
    label: 'Korbgeflecht / Wabe',
    hint: 'Geflochtene Bahnen mit wabenartiger Überlagerung. Für Griffigkeit an Deckeln und Behältern.',
  },
  {
    value: 'rubble',
    label: 'Bruchstein',
    hint: 'Grobe, unregelmäßige Steinreihen mit breiten Fugen. Die rustikale Variante des Mauerwerks.',
  },
] as const

export type SurfaceTexturePattern = (typeof SURFACE_TEXTURE_PATTERNS)[number]['value']

/**
 * Kuratierte Kombination aus Muster und den vier Texturparametern. Presets
 * ändern bewusst nur die Wandtextur; Deckflächenmuster und Texturzonen des
 * Nutzers bleiben erhalten.
 */
export type SurfaceTexturePreset = {
  id: string
  label: string
  hint: string
  pattern: SurfaceTexturePattern
  thickness: number
  pointDistance: number
  scale: number
  angle: number
}

export const SURFACE_TEXTURE_PRESETS: readonly SurfaceTexturePreset[] = [
  {
    id: 'fuzzy-fine',
    label: 'Fuzzy fein',
    hint: 'Feine, gleichmäßige Rauheit für griffige Deko und feine Sichtflächen.',
    pattern: 'noise',
    thickness: 0.15,
    pointDistance: 0.4,
    scale: 1.8,
    angle: 0,
  },
  {
    id: 'fuzzy-classic',
    label: 'Fuzzy klassisch',
    hint: 'Der übliche Fuzzy-Skin-Look mit mittlerer Tiefe und guter Griffigkeit.',
    pattern: 'noise',
    thickness: 0.3,
    pointDistance: 0.8,
    scale: 3,
    angle: 0,
  },
  {
    id: 'stone-natural',
    label: 'Naturstein',
    hint: 'Unregelmäßige Felsstruktur mit mittlerer Tiefe für rustikale Flächen.',
    pattern: 'stone',
    thickness: 0.4,
    pointDistance: 0.8,
    scale: 4,
    angle: 0,
  },
  {
    id: 'masonry',
    label: 'Mauerwerk',
    hint: 'Versetzte Steinreihen mit schmalen Fugen und klarer Blockstruktur.',
    pattern: 'stone-blocks',
    thickness: 0.35,
    pointDistance: 0.8,
    scale: 4,
    angle: 0,
  },
  {
    id: 'wood-grain',
    label: 'Holz längs',
    hint: 'Lange Maserung entlang der X-Achse; die Richtung lässt sich danach noch drehen.',
    pattern: 'wood-grain',
    thickness: 0.3,
    pointDistance: 0.8,
    scale: 4,
    angle: 0,
  },
  {
    id: 'wood-rings',
    label: 'Holz Hirnholz',
    hint: 'Jahresringe um die Wandmitte. Wirkt besonders auf runden Teilen und Vasen.',
    pattern: 'wood-rings',
    thickness: 0.3,
    pointDistance: 0.8,
    scale: 4,
    angle: 0,
  },
  {
    id: 'bark',
    label: 'Baumrinde',
    hint: 'Tiefe, unregelmäßige Rindenfurchen für rustikale Griffe und Naturflächen.',
    pattern: 'bark',
    thickness: 0.45,
    pointDistance: 0.7,
    scale: 3,
    angle: 0,
  },
  {
    id: 'metal-grip',
    label: 'Metall-Griff',
    hint: 'Diagonal gekreuzte Rillen für sicheren Halt an Knöpfen und Griffen.',
    pattern: 'knurl',
    thickness: 0.35,
    pointDistance: 0.6,
    scale: 2,
    angle: 0,
  },
  {
    id: 'marble',
    label: 'Marmor',
    hint: 'Geäderte Steinlagen mit leicht gedrehter Struktur für edle Deko.',
    pattern: 'marble',
    thickness: 0.3,
    pointDistance: 0.8,
    scale: 4,
    angle: 20,
  },
  {
    id: 'concrete',
    label: 'Beton',
    hint: 'Feine Körnung mit einzelnen Poren und Ausbrüchen.',
    pattern: 'concrete',
    thickness: 0.25,
    pointDistance: 0.7,
    scale: 3,
    angle: 0,
  },
  {
    id: 'basket',
    label: 'Korbgeflecht',
    hint: 'Geflochtene Bahnen mit wabenartiger Überlagerung für griffige Deckel.',
    pattern: 'basket',
    thickness: 0.35,
    pointDistance: 0.7,
    scale: 3,
    angle: 0,
  },
]

/** Ein Muster oder „wie das Grundmuster“ für eine Zone/Deckfläche. */
export type TexturePatternChoice = SurfaceTexturePattern | 'inherit'

/** Deckflächen dürfen zusätzlich vollständig glatt bleiben. */
export type TopTexturePatternChoice = TexturePatternChoice | 'none'

/** Eine Höhenzone in mm. Die erste passende Zone gewinnt. */
export type TextureZone = {
  from: number
  to: number
  pattern: TexturePatternChoice
}

/**
 * Liefert die aktive Zone für eine Schichthöhe.
 * `undefined` = keine Zonen konfiguriert (überall texturieren),
 * `null` = Zonen vorhanden, aber diese Höhe liegt außerhalb.
 */
export function textureZoneAt(
  zones: TextureZone[] | undefined,
  z: number,
): TextureZone | null | undefined {
  if (!Array.isArray(zones) || zones.length === 0) return undefined
  const height = Number.isFinite(z) ? z : 0
  for (const zone of zones) {
    if (!zone || !Number.isFinite(zone.from) || !Number.isFinite(zone.to)) continue
    const from = Math.min(zone.from, zone.to)
    const to = Math.max(zone.from, zone.to)
    if (height >= from - 1e-9 && height <= to + 1e-9) return zone
  }
  return null
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const mod = (value: number, divisor: number) => ((value % divisor) + divisor) % divisor

/**
 * Maximaler Aufbau einer Deckflächentextur. Der Wert bleibt bewusst unter
 * der doppelten Schichthöhe: Die Düse darf beim Abtasten nicht in bereits
 * gedruckte Nachbarbahnen oder Wände eintauchen, und der Höhenunterschied
 * soll auch bei dünnen Schichten noch sicher überfahrbar bleiben.
 */
export function topSurfaceTextureAmplitude(thickness: number, layerHeight: number): number {
  const requested = Number.isFinite(thickness) ? Math.max(0, thickness) : 0
  const layer = Number.isFinite(layerHeight) && layerHeight > 0 ? layerHeight : 0.2
  return Math.min(1.5, requested, Math.max(0.3, layer * 2))
}

/**
 * Höhe eines Deckflächenpunkts über der nominalen Schichtoberseite.
 * Anders als bei Wänden wird hier nur nach oben aufgebaut: Die Düse bleibt
 * immer auf oder über der bereits gedruckten Deckschicht. Die Mindesthöhe
 * verhindert Nullfluss an den Talsohlen; die Oberseite bleibt dort trotzdem
 * geschlossen, weil die normale Deckschicht darunter bereits gedruckt ist.
 */
export function topSurfaceTextureHeight(
  normalized: number,
  thickness: number,
  layerHeight: number,
): number {
  const amplitude = topSurfaceTextureAmplitude(thickness, layerHeight)
  if (amplitude <= 0) return 0
  const layer = Number.isFinite(layerHeight) && layerHeight > 0 ? layerHeight : 0.2
  const minRise = Math.min(amplitude, Math.max(0.08, layer * 0.5))
  const t = (clamp(normalized, -1, 1) + 1) / 2
  return minRise + (amplitude - minRise) * t
}

/**
 * Sicherer Mittenabstand texturierter Deckflächenbahnen. Zwischen zwei
 * erhöhten Bahnen muss die Düse samt Breite Platz haben; deshalb wächst der
 * Abstand mit der Aufbauhöhe. Der Faktor 2 berücksichtigt beide Flanken.
 */
export function topSurfaceTextureSpacing(
  nozzle: number,
  lineWidth: number,
  amplitude: number,
): number {
  const n = Number.isFinite(nozzle) && nozzle > 0 ? nozzle : 0.4
  const w = Number.isFinite(lineWidth) && lineWidth > 0 ? lineWidth : n
  const a = Number.isFinite(amplitude) ? Math.max(0, amplitude) : 0
  return Math.max(w * 2.2, n + 2 * a + 0.2)
}

/** Mehrstufige, glatte 3D-Störung. Deterministisch und ohne Zufallsgenerator. */
function noise3(x: number, y: number, z: number, scale: number): number {
  const k = TAU / Math.max(0.2, scale)
  return clamp(
    0.55 * Math.sin(x * k * 1.13 + y * k * 0.37 + z * k * 0.91) +
      0.3 * Math.sin(x * k * 2.71 - y * k * 1.19 + z * k * 0.53) +
      0.15 * Math.sin((x + y) * k * 4.37 - z * k * 2.11),
    -1,
    1,
  )
}

/**
 * Gemeinsames Raster für Mauerwerk und Bruchstein. Die beiden Muster
 * unterscheiden sich nur in Blockgröße, Fugenbreite, Versatz und Rauheit;
 * die eigentliche Fugenberechnung bleibt hier an einer Stelle.
 */
function masonryCell(
  u: number,
  v: number,
  z: number,
  block: number,
  rowHeight: number,
  shift: number,
  upOffset: number,
  mortar: number,
  skew: number,
): { across: number; up: number; seam: number } {
  const across = mod(u + v * skew + shift, block)
  const up = mod(z + upOffset, rowHeight)
  const seam = Math.min(across, block - across, up, rowHeight - up) < mortar ? -1 : 0
  return { across, up, seam }
}

/**
 * Wandlokale Koordinaten. `u` läuft entlang der Wand, `v` bleibt über eine
 * flache Wand konstant. Ohne diese Koordinaten würde eine X-Fläche nur eine
 * langsame diagonale Fuge erhalten, weil dort das globale x konstant ist.
 */
export type SurfaceTextureLocal = { u: number; v: number }

/**
 * Kleinste Struktur, die ein Muster noch sauber auflösen muss. Mauerwerk und
 * Bruchstein haben schmale Fugen; sie brauchen einen deutlich feineren
 * Abtastschritt als die Merkmalsgröße vermuten lässt.
 */
export function surfaceTextureDetail(pattern: SurfaceTexturePattern, scale: number): number {
  const feature = Math.max(0.5, Number.isFinite(scale) ? scale : 3)
  switch (pattern) {
    case 'stone-blocks':
      return Math.max(0.22, feature * 0.07) * 0.5
    case 'rubble':
      return Math.max(0.3, feature * 0.11) * 0.5
    default:
      return feature / 4
  }
}

/**
 * Liefert die normierte Auslenkung [-1, 1] für einen Punkt auf der Wand.
 * Der Aufrufer multipliziert mit der halben gewünschten Tiefe und schiebt
 * den Punkt entlang der Wandnormalen. Für Mauerwerk und Bruchstein übergibt
 * der Wand-Writer wandlokale Koordinaten; Deckflächen und andere Muster
 * verwenden weiterhin die globalen Bettkoordinaten.
 */
export function surfaceTextureOffset(
  x: number,
  y: number,
  z: number,
  pattern: SurfaceTexturePattern,
  scale: number,
  angle: number,
  local?: SurfaceTextureLocal,
): number {
  const feature = Math.max(0.3, scale)
  const rad = (angle * Math.PI) / 180
  const u = local ? local.u : x * Math.cos(rad) + y * Math.sin(rad)
  const v = local ? local.v : -x * Math.sin(rad) + y * Math.cos(rad)

  switch (pattern) {
    case 'stone': {
      const base = noise3(x, y, z, feature)
      const coarse = noise3(x * 0.47 + 7.1, y * 0.47 - 3.3, z * 0.61, feature * 2.4)
      return clamp(Math.tanh((base * 0.78 + coarse * 0.42) * 1.7), -1, 1)
    }

    case 'stone-blocks': {
      // Blöcke laufen waagerecht; die Reihen sind versetzt. u wird leicht mit
      // v verschoben, damit die Fugen auch auf zur X-Achse parallelen Wänden
      // nicht zu einer einzigen geraden Linie zusammenfallen.
      const block = Math.max(1.2, feature * 1.9)
      const rowHeight = Math.max(0.8, feature)
      const row = Math.floor(z / rowHeight)
      const shift = (row & 1) === 0 ? 0 : block * 0.5
      const mortar = Math.max(0.22, feature * 0.07)
      const { across, up, seam } = masonryCell(
        u,
        v,
        z,
        block,
        rowHeight,
        shift,
        0,
        mortar,
        0.32,
      )
      const face =
        0.16 * Math.sin(across * (TAU / block) * 1.7 + up * (TAU / rowHeight) * 0.8) +
        0.08 * noise3(x, y, z, feature * 0.7)
      return clamp(seam + face, -1, 1)
    }

    case 'wood-grain': {
      // Die Maserung läuft bevorzugt entlang u. Der v-Anteil sorgt dafür,
      // dass auch die dazu senkrechten Wände eine sichtbare Struktur behalten.
      const wobble =
        0.26 * Math.sin((z / (feature * 2.8)) * TAU) +
        0.12 * Math.sin((v / (feature * 1.7)) * TAU)
      const grain = Math.sin((u / feature) * TAU + wobble * TAU)
      const pores = Math.sin(
        ((u * 3.4 + v * 0.8) / feature) * TAU + (z / (feature * 1.3)) * TAU * 0.7,
      )
      return clamp(0.78 * grain + 0.22 * pores, -1, 1)
    }

    case 'wood-rings': {
      const radius = Math.hypot(x, y)
      const warp =
        0.34 * Math.sin((z / (feature * 2.2)) * TAU) +
        0.16 * Math.sin((v / (feature * 1.4)) * TAU)
      const rings = Math.sin((radius / feature) * TAU + warp * TAU)
      const pores = Math.sin((radius * 3.1 + z * 0.7) / feature * TAU)
      return clamp(0.82 * rings + 0.18 * pores, -1, 1)
    }

    case 'bark': {
      const groove = Math.sin(
        ((u / (feature * 0.24)) * TAU) +
          1.1 * Math.sin((v / (feature * 0.8)) * TAU) +
          0.45 * Math.sin((z / (feature * 1.4)) * TAU),
      )
      const fine = Math.sin(
        ((u * 0.9 + v * 2.7) / (feature * 0.16)) * TAU + (z / (feature * 0.9)) * TAU,
      )
      return clamp(0.8 * groove + 0.2 * fine, -1, 1)
    }

    case 'hammered': {
      const k = TAU / Math.max(0.6, feature)
      const dents =
        Math.cos(x * k) * Math.cos(y * k) * Math.cos(z * k) +
        0.35 * Math.cos((x + y) * k * 0.63 + z * k * 0.41)
      return clamp(-dents * 0.9, -1, 1)
    }

    case 'knurl': {
      const k = TAU / Math.max(0.5, feature)
      const diagonalA = Math.sin((u + v) * k)
      const diagonalB = Math.sin((u - v) * k)
      return clamp((diagonalA + diagonalB) * 0.7, -1, 1)
    }

    case 'ripple': {
      const wave = Math.sin(
        (z / (feature * 0.8)) * TAU + 0.7 * Math.sin((u / (feature * 1.6)) * TAU),
      )
      return clamp(wave * 0.9 + 0.1 * noise3(x, y, z, feature * 0.5), -1, 1)
    }

    case 'marble': {
      // Schichten laufen schräg durch das Bauteil; eine zweite, schärfere Welle
      // legt die geäderten Adern darüber. Beide Richtungen werden gestört,
      // damit keine gleichmäßigen Zylinderlinien entstehen.
      const bed = noise3(x * 0.55 + 2.3, y * 0.55 - 1.7, z * 0.9, feature * 2.2)
      const layers = Math.sin(
        ((u * 0.42 + v * 0.18 + z * 0.78) / feature) * TAU + bed * 2.4,
      )
      const veinWarp = noise3(x * 1.9 + 5.1, y * 1.9 - 4.2, z * 1.2, feature * 0.8)
      const vein = Math.sin(
        ((u * 1.15 - v * 0.35 - z * 0.22) / (feature * 0.38)) * TAU + veinWarp * 2.8,
      )
      const sharpVein = Math.sign(vein) * Math.pow(Math.abs(vein), 0.35)
      return clamp(0.62 * layers + 0.38 * sharpVein, -1, 1)
    }

    case 'concrete': {
      const grain = noise3(x * 1.8, y * 1.8, z * 1.25, feature * 0.55)
      const fine = noise3(x * 4.2 + 4.1, y * 4.2 - 2.7, z * 2.6, feature * 0.22)
      const k = TAU / Math.max(0.35, feature * 0.42)
      const cell =
        Math.sin(x * k * 1.7 + 0.8 * Math.sin(z * k * 0.9)) *
        Math.sin(y * k * 1.3 - 0.7 * Math.sin(x * k * 0.6)) *
        Math.sin(z * k * 1.1 + 0.6 * Math.sin(y * k * 0.8))
      const pores = Math.pow(Math.abs(cell), 6)
      return clamp(0.5 * grain + 0.22 * fine - 0.72 * pores, -1, 1)
    }

    case 'leather': {
      const k = TAU / Math.max(0.6, feature * 0.7)
      const warpX = 0.9 * noise3(x * 1.4, y * 1.4, z * 0.8, feature * 1.3)
      const warpY = 0.9 * noise3(x * 1.1 + 3.2, y * 1.1 - 2.4, z * 0.9, feature * 1.1)
      const pebble =
        Math.sin(x * k + warpX * 2.2) *
        Math.sin(y * k - warpY * 2.2) *
        Math.sin(z * k * 0.82 + (warpX - warpY) * 1.4)
      const crease = Math.sin((x + y) * k * 2.4 + z * k * 1.3 + warpX * 2.0)
      return clamp(0.72 * pebble + 0.28 * crease, -1, 1)
    }

    case 'basket': {
      const k = TAU / Math.max(0.8, feature * 0.9)
      const weave =
        Math.sin(((u + v * 0.85) / (feature * 1.15)) * TAU) *
        Math.sin((z / (feature * 0.62)) * TAU)
      const honey =
        (Math.sin((u + v * 0.35) * k * 1.55) +
          Math.sin((u * 0.5 - v * 0.25 + z * 0.866) * k * 1.55) +
          Math.sin((u * 0.5 - v * 0.25 - z * 0.866) * k * 1.55)) /
        3
      return clamp(0.66 * weave + 0.34 * honey, -1, 1)
    }

    case 'rubble': {
      const block = Math.max(1.8, feature * 2.5)
      const rowHeight = Math.max(1.0, feature * 1.2)
      const row = Math.floor(z / rowHeight)
      const rowJitter = noise3(x * 0.35, y * 0.35, z * 0.2 + row * 4.1, feature) * 0.6
      const shift = ((row & 1) === 0 ? 0 : block * 0.5) + rowJitter * block
      const mortar = Math.max(0.3, feature * 0.11)
      const { seam } = masonryCell(
        u,
        v,
        z,
        block,
        rowHeight,
        shift,
        rowJitter * rowHeight * 0.35,
        mortar,
        0.45,
      )
      const rough = 0.24 * noise3(x * 1.7, y * 1.7, z * 1.1, feature * 0.45)
      return clamp(seam + rough, -1, 1)
    }

    default:
      return noise3(x, y, z, feature)
  }
}

/**
 * Wertefeld für einen echten Muster-Swatch. Die Oberfläche benutzt dieselbe
 * Funktion wie der Wand-G-Code, damit die Kachel nicht nur ein Symbol ist.
 * Das Feld läuft zeilenweise von links oben nach rechts unten.
 */
export function surfaceTextureSwatch(
  pattern: SurfaceTexturePattern,
  scale: number,
  angle: number,
  cells = 10,
  span = 12,
  z = 2,
): number[] {
  const count = Math.max(2, Math.min(24, Math.floor(cells)))
  const width = Number.isFinite(span) && span > 0 ? span : 12
  const values: number[] = []
  for (let row = 0; row < count; row++) {
    for (let column = 0; column < count; column++) {
      const x = ((column + 0.5) / count - 0.5) * width
      const y = ((row + 0.5) / count - 0.5) * width
      values.push(surfaceTextureOffset(x, y, z, pattern, scale, angle))
    }
  }
  return values
}
