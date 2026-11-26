import type {
  CustomGcode,
  FilamentSlot,
  GcodeFlavor,
  NozzleMaterial,
  PostProcessingScript,
  PlateFilamentTemps,
  PlateProfile,
  PrinterProfile,
  PrinterOverrides,
} from '../shared/types.ts'
import { EMPTY_CUSTOM_GCODE, EMPTY_POST_PROCESSING } from '../shared/types.ts'
import { isGcodeFlavor } from '../shared/gcode-flavors.ts'
import { defaultEndGcode, defaultStartGcode } from '../shared/gcode-templates.ts'
import type { PrinterLimits } from '../shared/limits.ts'
import { readLocal, removeLocal, writeLocal } from './persist.ts'

export type { PrinterLimits } from '../shared/limits.ts'
export { effectivePrinterLimits } from '../shared/limits.ts'

export type Setup = {
  printerId: string
  filamentId: string
  plateId: string
  nozzle: number
  /** Messing, gehärteter Stahl, Edelstahl oder unbekannt */
  nozzleMaterial: NozzleMaterial
  /** Eigener Start-/End-/Schicht-/Pause-G-code, getrennt je Drucker. */
  customGcode: CustomGcode
  /** Abweichender Firmware-Geschmack; fehlt er, gilt der Katalogwert. */
  gcodeFlavor?: GcodeFlavor
  /** Zuletzt gewähltes Qualitätsprofil — gehört zum Gesamtstand des Druckers. */
  qualityPresetId?: string
  /** Eigene Maximalwerte; fehlen sie, gelten die Werkswerte des Profils. */
  limits?: PrinterLimits
  /** Eigene Bauraum-, Kinematik- und Materialwerte; der Katalog bleibt unverändert. */
  printerOverrides?: PrinterOverrides
  /** Externes G-Code-Post-Processing, getrennt je Drucker. */
  postProcessing?: PostProcessingScript
  /** Physische Slots bei AMS/ACE/IFS/CFS/MMU; bei Einzelfilament leer. */
  slots?: FilamentSlot[]
  /** Bett-Temperaturen und Z-Mod-Mesh je Druckplatte; Schlüssel ist die Platten-ID. */
  plateProfiles?: Record<string, PlateProfile>
  activeSlotId?: string
}

function normalizePrinterOverrides(input: Setup['printerOverrides']): Setup['printerOverrides'] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const out: PrinterOverrides = {}
  const bed = input.bed
  if (
    bed &&
    typeof bed === 'object' &&
    Number.isFinite(bed.x) &&
    Number.isFinite(bed.y) &&
    Number.isFinite(bed.z) &&
    bed.x > 0 &&
    bed.y > 0 &&
    bed.z > 0
  ) {
    out.bed = { x: bed.x, y: bed.y, z: bed.z }
  }
  if (input.kinematics === 'cartesian' || input.kinematics === 'corexy' || input.kinematics === 'delta') {
    out.kinematics = input.kinematics
  }
  if (input.firmware === 'auto' || input.firmware === 'zmod' || input.firmware === 'original') {
    out.firmware = input.firmware
  }
  if (Array.isArray(input.materials)) {
    const materials = input.materials
      .filter((material): material is string => typeof material === 'string')
      .map((material) => material.trim())
      .filter(Boolean)
    // Auch eine leere Liste ist eine bewusste Freigabe „keine Einschränkung“
    // und muss deshalb als Override erhalten bleiben.
    out.materials = [...new Set(materials)]
  }
  return Object.keys(out).length ? out : undefined
}

function normalizePlateProfiles(input: Setup['plateProfiles']): Setup['plateProfiles'] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const out: Record<string, PlateProfile> = {}
  for (const [plateId, raw] of Object.entries(input)) {
    if (!plateId || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const profile: PlateProfile = {}
    const filamentTemps: Record<string, PlateFilamentTemps> = {}
    for (const [filamentId, rawTemps] of Object.entries(raw.filamentTemps ?? {})) {
      if (!filamentId || !rawTemps || typeof rawTemps !== 'object' || Array.isArray(rawTemps)) continue
      const temps: PlateFilamentTemps = {}
      const bed = Number(rawTemps.bedTemp)
      const firstLayerBed = Number(rawTemps.firstLayerBed)
      if (Number.isFinite(bed) && bed > 0) temps.bedTemp = bed
      if (Number.isFinite(firstLayerBed) && firstLayerBed > 0) temps.firstLayerBed = firstLayerBed
      if (Object.keys(temps).length) filamentTemps[filamentId] = temps
    }
    if (Object.keys(filamentTemps).length) profile.filamentTemps = filamentTemps
    const meshProfile = typeof raw.meshProfile === 'string' ? raw.meshProfile.trim() : ''
    if (meshProfile) profile.meshProfile = meshProfile
    if (Object.keys(profile).length) out[plateId] = profile
  }
  return Object.keys(out).length ? out : undefined
}

/** Ältere gespeicherte Stände kennen customGcode noch nicht. */
export function normalizeSetup(setup: Setup): Setup {
  return {
    ...setup,
    nozzleMaterial: setup.nozzleMaterial ?? 'unknown',
    qualityPresetId:
      typeof setup.qualityPresetId === 'string' && setup.qualityPresetId ? setup.qualityPresetId : 'normal',
    customGcode: { ...EMPTY_CUSTOM_GCODE, ...(setup.customGcode ?? {}) },
    plateProfiles: normalizePlateProfiles(setup.plateProfiles),
    gcodeFlavor: isGcodeFlavor(setup.gcodeFlavor) ? setup.gcodeFlavor : undefined,
    limits: setup.limits ? { ...setup.limits } : undefined,
    printerOverrides: normalizePrinterOverrides(setup.printerOverrides),
    postProcessing: { ...EMPTY_POST_PROCESSING, ...(setup.postProcessing ?? {}) },
    slots: Array.isArray(setup.slots)
      ? setup.slots
          .filter((s) => s && typeof s.id === 'string' && typeof s.profileId === 'string')
          .map((s) => ({ ...s, present: s.present !== false }))
      : undefined,
    activeSlotId: typeof setup.activeSlotId === 'string' ? setup.activeSlotId : undefined,
  }
}

/**
 * Setzt die Standardblöcke in den editierbaren G-Code ein und bewahrt dabei
 * ältere Zusatzblöcke. Beim Wechsel von Drucker oder Flavor werden nur noch
 * unveränderte Standardblöcke aktualisiert — eigene Texte bleiben stehen.
 */
export function ensureMachineGcode(
  setup: Setup,
  profile: PrinterProfile,
  previous?: { profile: PrinterProfile; flavor?: GcodeFlavor },
): Setup {
  const flavor = setup.gcodeFlavor ?? profile.flavor
  const start = defaultStartGcode(profile, flavor)
  const end = defaultEndGcode(profile, flavor)
  const custom = setup.customGcode

  if (custom.fullMachineGcode !== true) {
    const legacyStart = String(custom.start ?? '').trim()
    const legacyEnd = String(custom.end ?? '').trim()
    return {
      ...setup,
      customGcode: {
        ...custom,
        start: [start, legacyStart].filter(Boolean).join('\n'),
        end: [end, legacyEnd].filter(Boolean).join('\n'),
        fullMachineGcode: true,
      },
    }
  }

  if (!previous) return setup
  const oldFlavor = previous.flavor ?? previous.profile.flavor
  const oldStart = defaultStartGcode(previous.profile, oldFlavor)
  const oldEnd = defaultEndGcode(previous.profile, oldFlavor)
  const replaceStart = !custom.start.trim() || custom.start === oldStart
  const replaceEnd = !custom.end.trim() || custom.end === oldEnd
  if (!replaceStart && !replaceEnd) return setup

  return {
    ...setup,
    customGcode: {
      ...custom,
      start: replaceStart ? start : custom.start,
      end: replaceEnd ? end : custom.end,
      fullMachineGcode: true,
    },
  }
}

const KEY = 'kepler.setup.v1'

export function loadSetup(): Setup | null {
  try {
    const raw = readLocal(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Setup
    if (!parsed.printerId || !parsed.filamentId) return null
    return normalizeSetup(parsed)
  } catch {
    return null
  }
}

export function saveSetup(setup: Setup): void {
  try {
    writeLocal(KEY, JSON.stringify(setup))
  } catch {
    /* Speicher voll oder blockiert — nicht kritisch */
  }
}

export type ConnMode = 'simulation' | 'serial' | 'klipper' | 'octoprint'

const CONN_KEY = 'kepler.conn.v1'

/**
 * Verbindungsart je Drucker merken: ein Vyper/Ender mit Klipper-Mod bleibt so
 * bei „Klipper“ statt bei „USB“, ohne dass das Profil geändert werden muss.
 */
export function loadConnMode(printerId: string): ConnMode | null {
  try {
    const raw = readLocal(CONN_KEY)
    if (!raw) return null
    const all = JSON.parse(raw) as Record<string, ConnMode>
    return all[printerId] ?? null
  } catch {
    return null
  }
}

export function saveConnMode(printerId: string, mode: ConnMode): void {
  try {
    const raw = readLocal(CONN_KEY)
    const all = raw ? (JSON.parse(raw) as Record<string, ConnMode>) : {}
    all[printerId] = mode
    writeLocal(CONN_KEY, JSON.stringify(all))
  } catch {
    /* nicht kritisch */
  }
}

/** Zuletzt gewähltes Modell je Marke (Markenname → Drucker-ID). */
const BRAND_MODEL_KEY = 'kepler.brandmodel.v1'

export function loadBrandModels(): Record<string, string> {
  try {
    const raw = readLocal(BRAND_MODEL_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, string>
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function rememberBrandModel(brand: string, printerId: string): void {
  if (!brand || brand === 'alle') return
  try {
    const all = loadBrandModels()
    all[brand] = printerId
    writeLocal(BRAND_MODEL_KEY, JSON.stringify(all))
  } catch {
    /* nicht kritisch */
  }
}

export type ZRef = { printerId: string; mean: number; offset: number; at: number }

const ZKEY = 'kepler.zref.v1'

/** Gespeicherte Referenz des Z-Triggerpunkts je Drucker. */
export function loadZRef(printerId: string): ZRef | null {
  try {
    const raw = readLocal(ZKEY)
    if (!raw) return null
    const all = JSON.parse(raw) as Record<string, ZRef>
    const ref = all[printerId]
    return ref && Number.isFinite(ref.mean) ? ref : null
  } catch {
    return null
  }
}

export function saveZRef(ref: ZRef): void {
  try {
    const raw = readLocal(ZKEY)
    const all = raw ? (JSON.parse(raw) as Record<string, ZRef>) : {}
    all[ref.printerId] = ref
    writeLocal(ZKEY, JSON.stringify(all))
  } catch {
    /* nicht kritisch */
  }
}

export function clearSetup(): void {
  try {
    removeLocal(KEY)
  } catch {
    /* egal */
  }
}

/** Zuletzt genutzter Netzwerkdrucker (Client, IP, Port). */
export type WebTarget = {
  client: 'moonraker' | 'octoprint'
  host: string
  port: number
  secure: boolean
  apiKey: string
  /** Mainsail/Fluidd-Adresse — getrennt vom Moonraker-Port, z. B. :8080 */
  webUiUrl?: string
}

const WEBKEY = 'kepler.web.v1'

export function loadWebTarget(): WebTarget | null {
  try {
    const raw = readLocal(WEBKEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as WebTarget
    if (!parsed.host || !parsed.client) return null
    return {
      client: parsed.client,
      host: parsed.host,
      port: Number(parsed.port) || (parsed.client === 'octoprint' ? 80 : 7125),
      secure: !!parsed.secure,
      apiKey: parsed.apiKey ?? '',
      webUiUrl: parsed.webUiUrl ?? '',
    }
  } catch {
    return null
  }
}

export function saveWebTarget(target: WebTarget): void {
  try {
    writeLocal(WEBKEY, JSON.stringify(target))
  } catch {
    /* nicht kritisch */
  }
}

/** Host einer gespeicherten Web-UI-Adresse — für den Abgleich mit der neuen IP. */
export function webUrlMatchesHost(url: string | undefined | null, host: string): boolean {
  if (!url?.trim() || !host.trim()) return false
  try {
    return new URL(url).hostname.toLowerCase() === host.trim().toLowerCase()
  } catch {
    return false
  }
}
