import type { GcodeFlavor, PrintSettings, PrinterProfile } from './types.ts'
import { machineOffset } from './types.ts'
import { flavorLabel } from './gcode-flavors.ts'

export type PrimeLinePlan = {
  x1: number
  y1: number
  x2: number
  y2: number
  length: number
  speed: number
}

/**
 * Sucht eine freie Randspur neben dem Modell. Die Koordinaten sind in
 * Bettkoordinaten (0…Bettgröße); der G-Code-Schreiber addiert den
 * Maschinen-Offset für Klipper mit Mittelpunkt-Nullpunkt.
 */
export function planPrimeLine(
  bbox: { min: { x: number; y: number }; max: { x: number; y: number } },
  profile: PrinterProfile,
  s: PrintSettings,
): PrimeLinePlan | null {
  const bedW = profile.bed.x
  const bedH = profile.bed.y
  const lineW = s.lineWidth > 0 ? s.lineWidth : s.nozzle
  const inset = Math.max(4, lineW * 2)
  const clearance =
    Math.max(4, lineW * 2) +
    (s.adhesion === 'brim' ? lineW * 10 : s.adhesion === 'skirt' ? lineW * 3 : 0)
  const want = Math.max(10, Math.min(300, Number(s.primeLine?.length) || 60))
  const speed = Math.max(1, Math.min(100, Number(s.primeLine?.speed) || 20))
  const minStrip = lineW * 1.8 + 2
  const maxLen = want

  const candidates: { x1: number; y1: number; x2: number; y2: number; length: number }[] = []

  // Linke/rechte Spur: senkrecht am Modell vorbei.
  const leftOuter = Math.min(bedW - inset, bbox.min.x - clearance)
  if (leftOuter - inset >= minStrip) {
    const x = (inset + leftOuter) / 2
    const length = Math.min(maxLen, bedH - inset * 2)
    if (length >= 12) candidates.push({ x1: x, y1: inset, x2: x, y2: inset + length, length })
  }
  const rightInner = Math.max(inset, bbox.max.x + clearance)
  if (bedW - inset - rightInner >= minStrip) {
    const x = (rightInner + bedW - inset) / 2
    const length = Math.min(maxLen, bedH - inset * 2)
    if (length >= 12) candidates.push({ x1: x, y1: inset, x2: x, y2: inset + length, length })
  }

  // Vordere/hintere Spur: waagerecht am Modell vorbei.
  const frontOuter = Math.min(bedH - inset, bbox.min.y - clearance)
  if (frontOuter - inset >= minStrip) {
    const y = (inset + frontOuter) / 2
    const length = Math.min(maxLen, bedW - inset * 2)
    if (length >= 12) candidates.push({ x1: inset, y1: y, x2: inset + length, y2: y, length })
  }
  const backInner = Math.max(inset, bbox.max.y + clearance)
  if (bedH - inset - backInner >= minStrip) {
    const y = (backInner + bedH - inset) / 2
    const length = Math.min(maxLen, bedW - inset * 2)
    if (length >= 12) candidates.push({ x1: inset, y1: y, x2: inset + length, y2: y, length })
  }

  // Delta-Drucker haben ein rundes Bett. Die rechteckige Randspur kann
  // außerhalb des Kreises liegen; deshalb wird jede Kandidatenlinie auf den
  // nutzbaren Kreis gekürzt, bevor sie in den G-Code kommt.
  const clipped = candidates
    .map((c) => {
      if (profile.kinematics !== 'delta') return c
      const cx = bedW / 2
      const cy = bedH / 2
      const radius = Math.min(bedW, bedH) / 2 - inset
      if (Math.abs(c.x1 - c.x2) < 1e-6) {
        const off = c.x1 - cx
        if (Math.abs(off) >= radius) return null
        const half = Math.sqrt(radius * radius - off * off)
        const y1 = Math.max(Math.min(c.y1, c.y2), cy - half)
        const y2 = Math.min(Math.max(c.y1, c.y2), cy + half)
        return y2 - y1 >= 12 ? { ...c, y1, y2, length: y2 - y1 } : null
      }
      const off = c.y1 - cy
      if (Math.abs(off) >= radius) return null
      const half = Math.sqrt(radius * radius - off * off)
      const x1 = Math.max(Math.min(c.x1, c.x2), cx - half)
      const x2 = Math.min(Math.max(c.x1, c.x2), cx + half)
      return x2 - x1 >= 12 ? { ...c, x1, x2, length: x2 - x1 } : null
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)

  if (!clipped.length) return null
  const best = clipped.reduce((a, b) => (b.length > a.length ? b : a))
  return { ...best, speed }
}

/**
 * Vollständiger Standard-Startblock für das Profil. Die Platzhalter werden
 * beim Slicen ersetzt; derselbe Text wird beim Laden eines Druckers in den
 * editierbaren Start-G-code übernommen.
 */
export function defaultStartGcode(
  profile: PrinterProfile,
  flavor: GcodeFlavor = profile.flavor,
): string {
  const delta = profile.kinematics === 'delta'
  return [
    '; ---- Easy-Slicer by Becker ----',
    `; Drucker: ${profile.name}`,
    `; Firmware: ${flavorLabel(flavor)}`,
    'G21',
    'G90',
    'M82',
    'G28 ; Homen',
    'M140 S{firstLayerBed}',
    'M104 S{firstLayerNozzle}',
    'M190 S{firstLayerBed}',
    'M109 S{firstLayerNozzle}',
    '; Bett-Mesh ist in den Z-Werten eingerechnet — kein M420/Profil nötig',
    'G92 E0',
    delta ? 'G1 Z5 F600 ; Delta: aus der Home-Stellung absenken' : 'G1 Z5 F600 ; Duese anheben',
    'M107',
  ].join('\n')
}

/** Vollständiger Standard-Endblock für das Profil. */
export function defaultEndGcode(
  profile: PrinterProfile,
  flavor: GcodeFlavor = profile.flavor,
): string {
  const delta = profile.kinematics === 'delta'
  const { dx, dy } = machineOffset(profile)
  // Delta: in die Bettmitte fahren, nicht in eine Ecke außerhalb des Kreises.
  // Bei Klipper-Delta ist die Mitte (0,0), bei Marlin-Delta die halbe Bettbreite.
  const parkX = delta ? profile.bed.x / 2 + dx : 5
  const parkY = delta ? profile.bed.y / 2 + dy : profile.bed.y - 5
  return [
    '; ---- Ende ----',
    `; ${flavorLabel(flavor)}`,
    'M104 S0',
    'M140 S0',
    'M107',
    'G91',
    'G1 Z10 F300',
    'G90',
    `G1 X${Math.round(parkX)} Y${Math.round(parkY)} F3000`,
    'M84',
  ].join('\n')
}

function replaceStartPlaceholders(text: string, s: PrintSettings): string[] {
  return text
    .split('\n')
    .map((line) =>
      line
        .replaceAll('{firstLayerBed}', String(s.temps.firstLayerBed))
        .replaceAll('{firstLayerNozzle}', String(s.temps.firstLayerNozzle)),
    )
}

export function buildStartGcode(profile: PrinterProfile, s: PrintSettings): string[] {
  return replaceStartPlaceholders(defaultStartGcode(profile), s)
}

/**
 * Setzt ein vorhandenes START_PRINT MESH= auf den übergebenen Profilnamen.
 * Ohne vorhandenes MESH bleibt der Startblock unverändert; die Auswahl im
 * Setup ergänzt bewusst keinen Parameter in fremde Makros.
 */
export function injectMeshName(start: string, meshName: string): string {
  const profile = String(meshName ?? '').trim()
  if (!profile) return start
  let found = false
  const lines = start.split('\n').map((line) => {
    if (!/^\s*START_PRINT\b/i.test(line)) return line
    if (!/\bMESH\s*=/i.test(line)) return line
    found = true
    return line.replace(/\bMESH\s*=\s*\S*/i, `MESH=${profile}`)
  })
  return found ? lines.join('\n') : start
}

/**
 * Setzt ein vorhandenes START_PRINT MESH= auf die Betttemperatur der ersten
 * Schicht. Z-Mod-Nutzer speichern ihre Klipper-Meshes oft unter dem
 * Temperatur-Namen, z. B. MESH=65 bei 65 °C.
 */
export function injectBedTemperatureMesh(start: string, bedTemp: number): string {
  if (!Number.isFinite(bedTemp) || bedTemp <= 0) return start
  return injectMeshName(start, String(Math.round(bedTemp)))
}

export type StartPreviewValues = {
  nozzle: number
  firstLayerNozzle: number
  bed: number
  firstLayerBed: number
  layerHeight: number
  firstLayerHeight: number
  nozzleDiameter: number
  filamentDiameter: number
  printerName: string
  totalLayerCount?: number
}

/**
 * Ersetzt die Platzhalter der ersten START_PRINT-Zeile mit denselben Werten,
 * die der Slicer beim Schreiben des Startblocks verwendet. So zeigt das Setup
 * die tatsächliche Zeile und nicht nur den gespeicherten Entwurf.
 */
export function renderStartGcodeLine(start: string, values: StartPreviewValues): string {
  const line = start.split('\n').find((l) => /^\s*START_PRINT\b/i.test(l)) ?? ''
  if (!line) return ''
  const vars: Record<string, string> = {
    nozzle: String(values.nozzle),
    firstLayerNozzle: String(values.firstLayerNozzle),
    bed: String(values.bed),
    firstLayerBed: String(values.firstLayerBed),
    layer: '1',
    z: String(values.firstLayerHeight),
  }
  const bracketVars: Record<string, string> = {
    nozzle_temperature_initial_layer: vars.firstLayerNozzle,
    bed_temperature_initial_layer_single: vars.firstLayerBed,
    first_layer_temperature: vars.firstLayerNozzle,
    first_layer_bed_temperature: vars.firstLayerBed,
    layer_height: String(values.layerHeight),
    initial_layer_print_height: String(values.firstLayerHeight),
    nozzle_diameter: String(values.nozzleDiameter),
    filament_diameter: String(values.filamentDiameter),
    printer_model: values.printerName,
    printer_settings_id: values.printerName,
    initial_extruder: '0',
  }
  if (values.totalLayerCount != null) bracketVars.total_layer_count = String(values.totalLayerCount)
  return line
    .replace(/\{\s*single_extruder_multi_material\s*\?\s*0\s*:\s*initial_extruder\s*\}/g, '0')
    .replace(
      /\{\s*single_extruder_multi_material\s*\?\s*";\s*T0"\s*:\s*"T"\s*\+\s*initial_extruder\s*\}/g,
      '; T0',
    )
    .replace(/\[single_extruder_multi_material\s*\?\s*0\s*:\s*initial_extruder\]/g, '0')
    .replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match)
    .replace(/\[([a-zA-Z0-9_]+)\]/g, (match, key: string) => bracketVars[key] ?? match)
    .trimEnd()
}

export function buildEndGcode(profile: PrinterProfile, _s: PrintSettings): string[] {
  void _s
  return defaultEndGcode(profile).split('\n')
}
