import { DEFAULT_SETTINGS, mergeSettings, type PrintSettings } from '../shared/types.ts'
import { readLocal, writeLocal } from './persist.ts'

/** Vom Nutzer gespeicherter Qualitätsstand — gilt für genau einen Drucker. */
export type UserQualityProfile = {
  id: string
  name: string
  printerId: string
  settings: PrintSettings
  savedAt: number
}

export type RenameQualityProfileResult =
  | { ok: true; profiles: UserQualityProfile[]; profile: UserQualityProfile }
  | { ok: false; reason: 'not-found' | 'name-exists' }

const KEY = 'kepler.quality-profiles.v1'
const MAX_NAME_LENGTH = 48

function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH) || 'Mein Profil'
}

export function loadUserQualityProfiles(): UserQualityProfile[] {
  try {
    const raw = readLocal(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    const out: UserQualityProfile[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const value = item as Partial<UserQualityProfile>
      if (
        typeof value.id !== 'string' ||
        typeof value.name !== 'string' ||
        typeof value.printerId !== 'string' ||
        !value.settings
      ) {
        continue
      }
      out.push({
        id: value.id,
        name: cleanName(value.name),
        printerId: value.printerId,
        settings: mergeSettings(DEFAULT_SETTINGS, value.settings),
        savedAt: typeof value.savedAt === 'number' ? value.savedAt : Date.now(),
      })
    }
    return out
  } catch {
    return []
  }
}

function persist(list: UserQualityProfile[]): UserQualityProfile[] {
  try {
    writeLocal(KEY, JSON.stringify(list))
  } catch {
    /* Speicher voll oder blockiert — nicht kritisch */
  }
  return list
}

/**
 * Speichert die aktuellen Qualitätswerte unter dem Namen. Ein gleicher Name
 * beim selben Drucker überschreibt das vorhandene Profil.
 */
export function saveUserQualityProfile(
  name: string,
  printerId: string,
  settings: PrintSettings,
): { profiles: UserQualityProfile[]; profile: UserQualityProfile } {
  const clean = cleanName(name)
  const list = loadUserQualityProfiles()
  const existing = list.find(
    (profile) => profile.printerId === printerId && profile.name.toLowerCase() === clean.toLowerCase(),
  )
  const profile: UserQualityProfile = {
    id: existing?.id ?? `quality-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: clean,
    printerId,
    settings: { ...settings },
    savedAt: Date.now(),
  }
  const profiles = existing
    ? list.map((item) => (item.id === existing.id ? profile : item))
    : [...list, profile]
  return { profiles: persist(profiles), profile }
}

/** Benennt ein eigenes Profil um, ohne ein anderes Profil zu überschreiben. */
export function renameUserQualityProfile(id: string, name: string): RenameQualityProfileResult {
  const clean = cleanName(name)
  const list = loadUserQualityProfiles()
  const current = list.find((profile) => profile.id === id)
  if (!current) return { ok: false, reason: 'not-found' }

  const conflict = list.some(
    (profile) =>
      profile.id !== id &&
      profile.printerId === current.printerId &&
      profile.name.toLowerCase() === clean.toLowerCase(),
  )
  if (conflict) return { ok: false, reason: 'name-exists' }

  const profile: UserQualityProfile = { ...current, name: clean }
  const profiles = list.map((item) => (item.id === id ? profile : item))
  return { ok: true, profiles: persist(profiles), profile }
}

/** Entfernt ein eigenes Profil. Andere Profile und Drucker bleiben unberührt. */
export function deleteUserQualityProfile(id: string): UserQualityProfile[] {
  return persist(loadUserQualityProfiles().filter((profile) => profile.id !== id))
}
