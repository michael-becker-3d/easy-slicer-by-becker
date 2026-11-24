export type Theme = 'dark' | 'light'

const KEY = 'kepler.theme.v1'

export function loadTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* Speicher voll oder blockiert — nicht kritisch */
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  root.classList.toggle('light', theme === 'light')
  root.dataset.theme = theme
  root.style.colorScheme = theme
}
