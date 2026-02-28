import { app } from 'electron'
import { translations } from '../../renderer/src/i18n/translations'

type Language = 'system' | 'en' | 'zh'
type ResolvedLanguage = 'en' | 'zh'

let currentLanguage: Language = 'system'
let resolvedLanguage: ResolvedLanguage = 'en'

function getSystemLanguage(): ResolvedLanguage {
  const locale = app.getLocale().toLowerCase()
  if (locale.startsWith('zh')) return 'zh'
  return 'en'
}

function resolveLanguage(lang: Language): ResolvedLanguage {
  if (lang === 'system') {
    return getSystemLanguage()
  }
  return lang
}

export function initializeLanguage(): void {
  currentLanguage = 'system'
  resolvedLanguage = resolveLanguage(currentLanguage)
}

export function getTranslations() {
  return translations[resolvedLanguage]
}

export function getCurrentLanguage(): Language {
  return currentLanguage
}

export function getResolvedLanguage(): ResolvedLanguage {
  return resolvedLanguage
}

export function setLanguage(lang: Language): void {
  currentLanguage = lang
  resolvedLanguage = resolveLanguage(lang)
}
