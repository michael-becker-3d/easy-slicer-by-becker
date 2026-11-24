import type { FilamentProfile, PlateProfile, PrintSettings } from '../shared/types.ts'
import { readLocal, writeLocal } from './persist.ts'

/** Vom Nutzer gespeichertes Filamentprofil — nur Filamentwerte, kein Drucker. */
export type UserFilament = {
  id: string
  name: string
  material: string
  /** Katalogprofil, aus dem es entstanden ist */
  baseId: string | null
  settings: PrintSettings
  savedAt: number
}

const KEY = 'kepler.filaments.v1'

export function loadUserFilaments(): UserFilament[] {
  try {
    const raw = readLocal(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as UserFilament[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter((f) => f && typeof f.id === 'string' && f.settings)
  } catch {
    return []
  }
}

function persist(list: UserFilament[]): UserFilament[] {
  try {
    writeLocal(KEY, JSON.stringify(list))
  } catch {
    /* Speicher voll oder blockiert — nicht kritisch */
  }
  return list
}

export type SaveUserFilamentResult =
  | { ok: true; profiles: UserFilament[]; profile: UserFilament }
  | { ok: false; error: string }

/**
 * Speichert die aktuellen Filamentwerte. Mit `targetId` wird genau dieses
 * Profil ausdrücklich überschrieben. Ohne `targetId` wird nur ein neues Profil
 * angelegt; ein bereits vergebener Name wird nicht mehr still überschrieben.
 */
export function saveUserFilament(
  name: string,
  settings: PrintSettings,
  baseId: string | null,
  targetId?: string,
): SaveUserFilamentResult {
  const clean = name.trim().slice(0, 40) || 'Mein Filament'
  const list = loadUserFilaments()
  const target = targetId ? list.find((f) => f.id === targetId) : undefined
  if (targetId && !target) {
    return { ok: false, error: 'Das ausgewählte Profil existiert nicht mehr. Bitte erneut öffnen.' }
  }
  if (!target) {
    const duplicate = list.find((f) => f.name.trim().toLowerCase() === clean.toLowerCase())
    if (duplicate) {
      return {
        ok: false,
        error: `Der Name „${duplicate.name}“ ist bereits vergeben. Nutze „In ‚${duplicate.name}‘ speichern“ zum Überschreiben oder wähle einen anderen Namen.`,
      }
    }
  }
  const profile: UserFilament = {
    id: target?.id ?? `my-${Date.now().toString(36)}`,
    name: target?.name ?? clean,
    material: target?.material ?? materialFromName(clean),
    baseId: target?.baseId ?? baseId,
    settings,
    savedAt: Date.now(),
  }
  return {
    ok: true,
    profiles: persist(target ? list.map((f) => (f.id === target.id ? profile : f)) : [...list, profile]),
    profile,
  }
}

/** Kopiert den aktiven Platten-Override auf eine neue Profil-ID. */
export function copyFilamentPlateOverride(
  plateProfiles: Record<string, PlateProfile> | undefined,
  plateId: string,
  fromFilamentId: string,
  toFilamentId: string,
): Record<string, PlateProfile> | undefined {
  if (!plateProfiles || !plateId || !fromFilamentId || !toFilamentId || fromFilamentId === toFilamentId) {
    return plateProfiles
  }
  const source = plateProfiles[plateId]?.filamentTemps?.[fromFilamentId]
  if (!source) return plateProfiles
  const temps = { ...source }
  if (temps.bedTemp == null) delete temps.bedTemp
  if (temps.firstLayerBed == null) delete temps.firstLayerBed
  if (!Object.keys(temps).length) return plateProfiles
  const profile = plateProfiles[plateId] ?? {}
  return {
    ...plateProfiles,
    [plateId]: {
      ...profile,
      filamentTemps: { ...(profile.filamentTemps ?? {}), [toFilamentId]: temps },
    },
  }
}

/** Entfernt alle Platten-Overrides eines gelöschten Filamentprofils. */
export function removeFilamentPlateOverrides(
  plateProfiles: Record<string, PlateProfile> | undefined,
  filamentId: string,
): Record<string, PlateProfile> | undefined {
  if (!plateProfiles || !filamentId) return plateProfiles
  let changed = false
  const next: Record<string, PlateProfile> = {}
  for (const [plateId, profile] of Object.entries(plateProfiles)) {
    if (!profile.filamentTemps || !(filamentId in profile.filamentTemps)) {
      next[plateId] = profile
      continue
    }
    changed = true
    const filamentTemps = { ...profile.filamentTemps }
    delete filamentTemps[filamentId]
    const nextProfile = { ...profile }
    if (Object.keys(filamentTemps).length) nextProfile.filamentTemps = filamentTemps
    else delete nextProfile.filamentTemps
    if (Object.keys(nextProfile).length) next[plateId] = nextProfile
  }
  if (!changed) return plateProfiles
  return Object.keys(next).length ? next : undefined
}

export function deleteUserFilament(id: string): UserFilament[] {
  return persist(loadUserFilaments().filter((f) => f.id !== id))
}

function materialFromName(name: string): string {
  const upper = name.toUpperCase()
  for (const m of ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'NYLON', 'PC']) if (upper.includes(m)) return m
  return 'PLA'
}

/**
 * Baut aus dem gespeicherten Profil ein Filamentprofil für die Auswahl.
 * `custom: true` sorgt dafür, dass die absoluten Temperaturen ohne
 * Platten-Offset übernommen werden.
 */
export function userFilamentProfile(u: UserFilament, base?: FilamentProfile): FilamentProfile {
  const s = u.settings
  return {
    id: u.id,
    name: u.name,
    material: u.material,
    density: base?.density ?? 1.24,
    nozzle: s.temps.nozzle,
    bed: s.temps.bed,
    firstLayerNozzle: s.temps.firstLayerNozzle,
    firstLayerBed: s.temps.firstLayerBed,
    fanSpeed: s.fanSpeed,
    flow: s.flow,
    retraction: s.retraction,
    maxVolumetricFlow: s.maxVolumetricFlow,
    pricePerKg: base?.pricePerKg ?? 25,
    note: 'Eigenes Profil — Temperatur, Kühlung, Retract und Schrumpfung aus deinen Einstellungen.',
    shrinkage: s.shrinkage,
    cooling: s.cooling,
    custom: true,
  }
}
