import type { GcodeFlavor } from './types.ts'

export type GcodeFlavorInfo = {
  id: GcodeFlavor
  label: string
  short: string
  hint: string
}

/** Die fünf Firmware-Typen aus OrcaSlicer. */
export const GCODE_FLAVORS: readonly GcodeFlavorInfo[] = [
  {
    id: 'marlin',
    label: 'Marlin (Legacy)',
    short: 'Marlin',
    hint: 'Marlin 1.x: M900 Linear Advance, M205 Classic Jerk, M486 Objektausschluss.',
  },
  {
    id: 'marlin2',
    label: 'Marlin 2',
    short: 'Marlin 2',
    hint: 'Marlin 2.x: M900, M205 und M593 Input Shaping; M486 Objektausschluss.',
  },
  {
    id: 'klipper',
    label: 'Klipper',
    short: 'Klipper',
    hint: 'Klipper: SET_PRESSURE_ADVANCE, SET_INPUT_SHAPER, SET_VELOCITY_LIMIT und EXCLUDE_OBJECT.',
  },
  {
    id: 'reprapfirmware',
    label: 'RepRapFirmware',
    short: 'RepRapFirmware',
    hint: 'Duet/RRF: M566, M572 Pressure Advance und M593 Input Shaping.',
  },
  {
    id: 'repetier',
    label: 'Repetier',
    short: 'Repetier',
    hint: 'Repetier Firmware: M233 Advance und M204/M205 Bewegungswerte.',
  },
]

const FLAVOR_IDS = new Set<string>(GCODE_FLAVORS.map((flavor) => flavor.id))

export function isGcodeFlavor(value: unknown): value is GcodeFlavor {
  return typeof value === 'string' && FLAVOR_IDS.has(value)
}

export function flavorLabel(flavor: GcodeFlavor): string {
  return GCODE_FLAVORS.find((entry) => entry.id === flavor)?.label ?? flavor
}

export function isKlipperFlavor(flavor: GcodeFlavor): boolean {
  return flavor === 'klipper'
}

/** PA-Befehl passend zur gewählten Firmware. */
export function pressureAdvanceGcode(flavor: GcodeFlavor, value: string): string {
  if (flavor === 'klipper') return `SET_PRESSURE_ADVANCE ADVANCE=${value}`
  if (flavor === 'reprapfirmware') return `M572 S${value} ; Pressure Advance`
  if (flavor === 'repetier') return `M233 X${value} ; Advance`
  return `M900 K${value} ; Linear Advance`
}

/** Input-Shaper-Befehle; Marlin/Marlin 2 setzen X und Y getrennt. */
export function inputShaperGcode(
  flavor: GcodeFlavor,
  formatter: (value: number) => string,
  x: number,
  y: number,
  damping: number,
  method: 'auto' | 'zv' | 'mzv' | 'ei' | '2hump_ei' | '3hump_ei' = 'auto',
): string[] {
  const dx = formatter(damping)
  if (flavor === 'klipper') {
    const shaperType = method === 'auto' ? '' : ` SHAPER_TYPE=${method}`
    return [
      `SET_INPUT_SHAPER${shaperType} SHAPER_FREQ_X=${formatter(x)} SHAPER_FREQ_Y=${formatter(y)} DAMPING_RATIO_X=${dx} DAMPING_RATIO_Y=${dx}`,
    ]
  }
  if (flavor === 'reprapfirmware') {
    // RRF kennt nur eine gemeinsame Frequenz für X und Y und nicht alle
    // Klipper-Shaper. Nicht unterstützte Typen fallen auf MZV zurück.
    const rrfType = method === 'zv' || method === 'mzv' || method === 'ei' ? method.toUpperCase() : 'MZV'
    return [`M593 P"${rrfType}" F${formatter(x)} S${dx} ; Input Shaping`]
  }
  if (flavor === 'repetier') {
    return [`M593 F${formatter(x)} ; Input Shaping (falls von Repetier unterstützt)`]
  }
  return [
    `M593 X F${formatter(x)} D${dx} ; Input Shaping X`,
    `M593 Y F${formatter(y)} D${dx} ; Input Shaping Y`,
  ]
}
