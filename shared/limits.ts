import type { DeepPartial, PrinterProfile, PrintSettings } from './types.ts'
import { mergeSettings } from './types.ts'

/** Vom Nutzer gesetzte Obergrenzen — bewusst pro Drucker gespeichert. */
export type PrinterLimits = {
  maxPrintSpeed: number
  maxAccel: number
  maxTravel: number
  maxNozzleTemp: number
  maxBedTemp: number
}

/**
 * Werte aus dem Druckerprofil, überschrieben durch die eigenen Grenzen.
 * Eigene Grenzen dürfen bewusst über den Werkswerten liegen (Modding), aber
 * niemals darunter auf einen unsinnigen Wert fallen.
 */
export function effectivePrinterLimits(
  profile: PrinterProfile,
  limits?: Partial<PrinterLimits>,
): PrinterLimits {
  const pick = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
  return {
    maxPrintSpeed: pick(limits?.maxPrintSpeed, profile.maxPrintSpeed),
    maxAccel: pick(limits?.maxAccel, profile.maxAccel),
    maxTravel: pick(limits?.maxTravel, profile.maxTravel),
    maxNozzleTemp: pick(limits?.maxNozzleTemp, profile.maxNozzleTemp),
    maxBedTemp: pick(limits?.maxBedTemp, profile.maxBedTemp),
  }
}

/**
 * Setzt die wirksamen Druckergrenzen auf ein Projektprofil durch. Diese
 * Funktion läuft sowohl in der Oberfläche als auch im Server, damit ein
 * importiertes 3MF oder ein manipuliertes Request die Maschine nicht über
 * ihre eingestellten Grenzen treiben kann.
 *
 * Wichtig: Jede Bahnart hat dieselbe Obergrenze wie das Grundtempo. Ein
 * Nutzer darf also bei 300 mm/s Druckerlimit auch 300 mm/s für die Außenwand
 * eintragen; die frühere Begrenzung auf das gerade gesetzte Grundtempo war
 * zu restriktiv.
 */
export function applyPrinterLimits(profile: PrinterProfile, s: PrintSettings): PrintSettings {
  const [minLayer, maxLayer] = profile.layerRange
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  const maxSpeed = Math.max(1, profile.maxPrintSpeed)
  const maxAccel = Math.max(1, profile.maxAccel)
  const maxTravel = Math.max(1, profile.maxTravel)
  const print = clamp(s.speeds.print, 5, maxSpeed)
  const speed = (value: number | undefined, fallback = print) => clamp(value ?? fallback, 5, maxSpeed)
  const accel = (value: number | undefined, fallback = 1000) => clamp(value ?? fallback, 1, maxAccel)
  const adaptive = s.adaptiveLayerHeight ?? { enabled: false, minHeight: minLayer, maxHeight: maxLayer, quality: 0.1 }
  const adaptiveMin = clamp(Number.isFinite(adaptive.minHeight) ? adaptive.minHeight : minLayer, minLayer, maxLayer)
  const adaptiveMax = clamp(Number.isFinite(adaptive.maxHeight) ? adaptive.maxHeight : maxLayer, minLayer, maxLayer)

  return mergeSettings(s, {
    layerHeight: clamp(s.layerHeight, minLayer, maxLayer),
    firstLayerHeight: clamp(s.firstLayerHeight, minLayer, maxLayer),
    adaptiveLayerHeight: {
      ...adaptive,
      minHeight: Math.min(adaptiveMin, adaptiveMax),
      maxHeight: Math.max(adaptiveMin, adaptiveMax),
      quality: clamp(Number.isFinite(adaptive.quality) ? adaptive.quality : 0.1, 0.01, 1),
    },
    nozzle: profile.nozzleOptions.includes(s.nozzle) ? s.nozzle : profile.nozzle,
    temps: {
      nozzle: Math.min(s.temps.nozzle, profile.maxNozzleTemp),
      firstLayerNozzle: Math.min(s.temps.firstLayerNozzle, profile.maxNozzleTemp),
      bed: Math.min(s.temps.bed, profile.maxBedTemp),
      firstLayerBed: Math.min(s.temps.firstLayerBed, profile.maxBedTemp),
    },
    speeds: {
      print,
      outerWall: speed(s.speeds.outerWall),
      innerWall: speed(s.speeds.innerWall),
      infill: speed(s.speeds.infill),
      solid: speed(s.speeds.solid),
      topSurface: speed(s.speeds.topSurface),
      bridge: speed(s.speeds.bridge),
      support: speed(s.speeds.support),
      supportInterface: speed(s.speeds.supportInterface),
      overhang: speed(s.speeds.overhang),
      travel: clamp(s.speeds.travel, 30, maxTravel),
      firstLayer: speed(s.speeds.firstLayer),
    },
    skirt: {
      ...s.skirt,
      speed: speed(s.skirt?.speed, 20),
    },
    brim: {
      ...s.brim,
      flow: clamp(s.brim?.flow ?? 1, 0.1, 3),
    },
    accelerations: {
      print: accel(s.accelerations?.print),
      outerWall: accel(s.accelerations?.outerWall, 800),
      innerWall: accel(s.accelerations?.innerWall, 1000),
      infill: accel(s.accelerations?.infill, 1000),
      solid: accel(s.accelerations?.solid, 1000),
      topSurface: accel(s.accelerations?.topSurface, 900),
      bridge: accel(s.accelerations?.bridge, 800),
      support: accel(s.accelerations?.support, 800),
      supportInterface: accel(s.accelerations?.supportInterface, 700),
      travel: accel(s.accelerations?.travel, 1500),
      firstLayer: accel(s.accelerations?.firstLayer, 800),
    },
  })
}

export type ImportedLineWidthKey =
  | 'lineWidth'
  | 'firstLayerLineWidth'
  | 'outerWallLineWidth'
  | 'innerWallLineWidth'
  | 'topSurfaceLineWidth'

export const IMPORTED_LINE_WIDTH_KEYS: ImportedLineWidthKey[] = [
  'lineWidth',
  'firstLayerLineWidth',
  'outerWallLineWidth',
  'innerWallLineWidth',
  'topSurfaceLineWidth',
]

export type ImportedSettingsOptions = {
  /** Am Drucker tatsächlich gewählte Düse; hat Vorrang vor der 3MF-Düse. */
  activeNozzle?: number
  /** Düse aus der 3MF-Datei. Nur damit werden Linienbreiten skaliert. */
  sourceNozzle?: number
  /** Nur diese Linienbreiten kamen tatsächlich aus der 3MF-Datei. */
  lineWidthKeys?: ImportedLineWidthKey[]
  /** Obergrenze des aktiven Filamentprofils. */
  maxVolumetricFlow?: number
}

/**
 * Macht importierte 3MF-Einstellungen für den aktiven Drucker kompatibel.
 *
 * Die harten Druckergrenzen kommen aus `applyPrinterLimits`. Zusätzlich wird
 * eine abweichende 3MF-Düse auf die am Gerät gewählte Düse umgerechnet: Sonst
 * bliebe z. B. eine 0,6-mm-Linienbreite an einer 0,4-mm-Düse stehen. Der
 * Volumenstrom wird auf das aktive Filament begrenzt, damit ein fremdes
 * 3MF-Profil den Drucker nicht über die Materialreserve treibt.
 */
export function adaptImportedSettings(
  profile: PrinterProfile,
  s: PrintSettings,
  options: ImportedSettingsOptions = {},
): { settings: PrintSettings; notes: string[] } {
  const notes: string[] = []
  const valid = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
  const round = (value: number) => Math.round(value * 1000) / 1000
  const fmt = (value: number) => String(round(value)).replace('.', ',')

  const requestedNozzle = valid(options.activeNozzle)
  const activeNozzle = requestedNozzle && profile.nozzleOptions.includes(requestedNozzle)
    ? requestedNozzle
    : valid(profile.nozzle) ?? s.nozzle
  const sourceNozzle = valid(options.sourceNozzle)
  const ratio = sourceNozzle && Math.abs(sourceNozzle - activeNozzle) > 0.005
    ? activeNozzle / sourceNozzle
    : 1

  let next = mergeSettings(s, { nozzle: activeNozzle })
  const widths = options.lineWidthKeys ?? []
  if (sourceNozzle !== null && ratio !== 1 && widths.length > 0) {
    const patch: Partial<Record<ImportedLineWidthKey, number>> = {}
    for (const key of widths) {
      const value = next[key]
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        patch[key] = round(Math.max(0.05, Math.min(activeNozzle * 1.5, value * ratio)))
      }
    }
    next = mergeSettings(next, patch)
    notes.push(
      `Düse ${fmt(sourceNozzle)} → ${fmt(activeNozzle)} mm, Linienbreiten angepasst`,
    )
  } else if (sourceNozzle !== null && Math.abs(sourceNozzle - activeNozzle) > 0.005) {
    notes.push(`Düse ${fmt(sourceNozzle)} → ${fmt(activeNozzle)} mm`)
  }

  const flowLimit = valid(options.maxVolumetricFlow)
  if (flowLimit !== null && next.maxVolumetricFlow > flowLimit) {
    const before = next.maxVolumetricFlow
    next = mergeSettings(next, { maxVolumetricFlow: flowLimit })
    notes.push(`max. Volumenstrom ${fmt(before)} → ${fmt(flowLimit)} mm³/s`)
  }

  return {
    settings: applyPrinterLimits({ ...profile, nozzle: activeNozzle }, next),
    notes,
  }
}

/**
 * Dasselbe für die Teilmenge eines einzelnen 3MF-Objekts. Objektwerte werden
 * beim Slicen nach den Projektwerten angewendet; ohne diese Anpassung könnte
 * eine objektindividuelle 0,6-mm-Linienbreite die Umrechnung auf 0,4 mm wieder
 * überschreiben. Nur tatsächlich vorhandene Felder werden verändert.
 */
export function adaptImportedObjectSettings(
  settings: DeepPartial<PrintSettings>,
  options: ImportedSettingsOptions = {},
): DeepPartial<PrintSettings> {
  const next = JSON.parse(JSON.stringify(settings)) as DeepPartial<PrintSettings>
  const valid = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
  const active = valid(options.activeNozzle) ?? valid(next.nozzle)
  if (active === null) return next

  const source = valid(options.sourceNozzle) ?? valid(next.nozzle)
  const ratio = source && Math.abs(source - active) > 0.005 ? active / source : 1
  if (ratio !== 1) {
    for (const key of IMPORTED_LINE_WIDTH_KEYS) {
      const value = next[key]
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        next[key] = Math.round(Math.max(0.05, Math.min(active * 1.5, value * ratio)) * 1000) / 1000
      }
    }
  }

  if (typeof next.nozzle === 'number' && Math.abs(next.nozzle - active) > 0.005) {
    next.nozzle = active
  }
  const flowLimit = valid(options.maxVolumetricFlow)
  if (flowLimit !== null && typeof next.maxVolumetricFlow === 'number' && next.maxVolumetricFlow > flowLimit) {
    next.maxVolumetricFlow = flowLimit
  }
  return next
}
