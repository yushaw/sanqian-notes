import { app } from 'electron'

export interface ThemeSettings {
  colorMode: 'light' | 'dark'
  accentColor: string
  locale: 'en' | 'zh'
  fontSize?: 'small' | 'normal' | 'large' | 'extra-large'
}

let currentThemeSettings: ThemeSettings = {
  colorMode: 'light',
  accentColor: '#2563EB', // default cobalt
  locale: app.getLocale().toLowerCase().startsWith('zh') ? 'zh' : 'en', // use system locale as initial
  fontSize: 'normal'
}

export function getThemeSettings(): ThemeSettings {
  return currentThemeSettings
}

export function setThemeSettings(settings: ThemeSettings): void {
  currentThemeSettings = settings
}
