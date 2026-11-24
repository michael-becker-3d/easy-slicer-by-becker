export type UiScaleId =
  | 'auto'
  | '1024x768'
  | '1280x720'
  | '1280x800'
  | '1366x768'
  | '1440x900'
  | '1600x900'
  | '1680x1050'
  | '1920x1080'

export type UiScalePreset = {
  id: Exclude<UiScaleId, 'auto'>
  label: string
  scale: number
}

/**
 * Die Prozentwerte sind bewusst an die Auflösung gekoppelt: kleine Fenster
 * bekommen eine kompaktere Oberfläche, große Fenster etwas mehr Luft. Die
 * Skalierung wirkt über CSS-Zoom auf die gesamte App, nicht nur auf Schriften.
 */
export const UI_SCALE_PRESETS: readonly UiScalePreset[] = [
  { id: '1024x768', label: '1024 × 768', scale: 0.9 },
  { id: '1280x720', label: '1280 × 720', scale: 0.95 },
  { id: '1280x800', label: '1280 × 800', scale: 0.95 },
  { id: '1366x768', label: '1366 × 768', scale: 0.95 },
  { id: '1440x900', label: '1440 × 900', scale: 1 },
  { id: '1600x900', label: '1600 × 900', scale: 1.05 },
  { id: '1680x1050', label: '1680 × 1050', scale: 1.05 },
  { id: '1920x1080', label: '1920 × 1080', scale: 1.1 },
]

const KEY = 'kepler.uiScale.v1'
const PRESET_IDS = new Set<string>(UI_SCALE_PRESETS.map((preset) => preset.id))

export function isUiScaleId(value: string | null): value is UiScaleId {
  return value === 'auto' || (value !== null && PRESET_IDS.has(value))
}

export function loadUiScaleId(): UiScaleId {
  try {
    const value = localStorage.getItem(KEY)
    return isUiScaleId(value) ? value : 'auto'
  } catch {
    return 'auto'
  }
}

export function saveUiScaleId(id: UiScaleId): void {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    /* Speicher voll oder blockiert — nicht kritisch */
  }
}

/**
 * Automatisch passend zu Fensterbreite und -höhe. Die Breite bestimmt die
 * Grundgröße; eine niedrige Höhe begrenzt sie zusätzlich, damit Werkstatt,
 * Legende und Modell auf 16:9-Notebooks nicht gegeneinander laufen.
 */
export function automaticUiScale(width: number, height = window.innerHeight): number {
  const widthScale = width < 1200 ? 0.9 : width < 1400 ? 0.95 : width < 1600 ? 1 : width < 1800 ? 1.05 : 1.1
  const heightScale = height < 760 ? 0.85 : height < 860 ? 0.9 : height < 980 ? 0.95 : height < 1100 ? 1 : 1.05
  return Math.min(widthScale, heightScale)
}

export function resolveUiScale(
  id: UiScaleId,
  width = window.innerWidth,
  height = window.innerHeight,
): number {
  if (id === 'auto') return automaticUiScale(width, height)
  return UI_SCALE_PRESETS.find((preset) => preset.id === id)?.scale ?? automaticUiScale(width, height)
}

export function applyUiScale(scale: number): void {
  const root = document.documentElement
  root.style.setProperty('--ui-scale', scale.toFixed(4))
  root.dataset.uiScale = scale.toFixed(2)
}

/** Aktueller Zoomfaktor für Koordinaten, die außerhalb des CSS-Layouts anfallen. */
export function currentUiScale(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) && value > 0 ? value : 1
}

/** Vor dem ersten Rendern anwenden, damit die gespeicherte Größe nicht kurz aufblitzt. */
export function applyStoredUiScale(): number {
  const scale = resolveUiScale(loadUiScaleId())
  applyUiScale(scale)
  return scale
}
