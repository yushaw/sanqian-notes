import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import { Language, Translations, getTranslations, getSystemLanguage } from './translations'
import { useTheme, themes } from '../theme'

interface I18nContextType {
  language: Language
  setLanguage: (lang: Language) => void
  t: Translations
}

const I18nContext = createContext<I18nContextType | null>(null)

const STORAGE_KEY = 'sanqian-notes-language'

export function I18nProvider({ children }: { children: ReactNode }) {
  const { resolvedColorMode, themeColor, fontSize } = useTheme()

  const [language, setLanguageState] = useState<Language>(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'zh' || stored === 'en' || stored === 'system') {
      return stored
    }
    return 'system'
  })

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang)
    localStorage.setItem(STORAGE_KEY, lang)

    // Sync locale to main process (for chat window)
    // Use theme values from useTheme() - consistent with ThemeProvider's sync
    const resolvedLocale: 'en' | 'zh' = lang === 'system' ? getSystemLanguage() : lang
    const accentColor = themes[themeColor]?.accent || '#2563EB'

    window.electron?.theme?.sync?.({
      colorMode: resolvedColorMode,
      accentColor,
      locale: resolvedLocale,
      fontSize
    })
  }, [resolvedColorMode, themeColor, fontSize])

  const t = getTranslations(language)

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider')
  }
  return context
}

export function useTranslations() {
  const { t } = useI18n()
  return t
}
