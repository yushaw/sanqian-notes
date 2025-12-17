import { createContext, useContext, useEffect, useState, useMemo, ReactNode } from 'react'
import { basePalettes, themes, DEFAULT_THEME, STORAGE_KEY, THEME_COLOR_STORAGE_KEY, type ThemeKey } from './config'
import { mixHexColors } from '../utils/color'

export type ColorModeSetting = 'light' | 'dark' | 'system'
type ResolvedColorMode = 'light' | 'dark'
export type FontSize = 'small' | 'normal' | 'large' | 'extra-large'

interface ThemeContextType {
  themeColor: ThemeKey
  setThemeColor: (color: ThemeKey) => void
  colorMode: ColorModeSetting
  setColorMode: (mode: ColorModeSetting) => void
  resolvedColorMode: ResolvedColorMode
  fontSize: FontSize
  setFontSize: (size: FontSize) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

function getInitialThemeColor(): ThemeKey {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem(THEME_COLOR_STORAGE_KEY)
    if (saved && saved in themes) {
      return saved as ThemeKey
    }
  }
  return DEFAULT_THEME
}

function getInitialColorMode(): ColorModeSetting {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark' || saved === 'system') {
      return saved
    }
  }
  return 'system'
}

function getInitialFontSize(): FontSize {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('sanqian-notes-font-size')
    if (saved === 'small' || saved === 'normal' || saved === 'large' || saved === 'extra-large') {
      return saved
    }
  }
  return 'normal'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeColor, setThemeColorState] = useState<ThemeKey>(getInitialThemeColor)
  const [colorMode, setColorModeState] = useState<ColorModeSetting>(getInitialColorMode)
  const [fontSize, setFontSizeState] = useState<FontSize>(getInitialFontSize)
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches
    }
    return false
  })

  // Compute resolved color mode
  const resolvedColorMode: ResolvedColorMode = useMemo(() => {
    if (colorMode === 'system') {
      return systemPrefersDark ? 'dark' : 'light'
    }
    return colorMode
  }, [colorMode, systemPrefersDark])

  const setThemeColor = (color: ThemeKey) => {
    setThemeColorState(color)
    localStorage.setItem(THEME_COLOR_STORAGE_KEY, color)
  }

  const setColorMode = (mode: ColorModeSetting) => {
    setColorModeState(mode)
    localStorage.setItem(STORAGE_KEY, mode)
  }

  const setFontSize = (size: FontSize) => {
    setFontSizeState(size)
    localStorage.setItem('sanqian-notes-font-size', size)
  }

  // Listen for system color scheme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches)
    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  }, [])

  // Apply theme colors to CSS variables
  useEffect(() => {
    const activeTheme = themes[themeColor] ?? themes[DEFAULT_THEME]
    const accent = activeTheme.accent
    const palette = basePalettes[resolvedColorMode]

    // Mix accent into bg/card/surface for subtle tinting
    const mix = resolvedColorMode === 'dark'
      ? { bg: 0.02, card: 0.03, surface: 0.04 }
      : { bg: 0.02, card: 0.03, surface: 0.04 }
    const bgTint = mixHexColors(palette.bg, accent, mix.bg)
    const cardTint = mixHexColors(palette.card, accent, mix.card)
    const surfaceTint = mixHexColors(palette.surface, accent, mix.surface)
    const accentSoft = mixHexColors(accent, resolvedColorMode === 'dark' ? '#000000' : '#FFFFFF', 0.18)
    const selectionBg = mixHexColors(cardTint, accent, resolvedColorMode === 'dark' ? 0.10 : 0.05)

    const docEl = document.documentElement
    docEl.style.setProperty('--color-bg', bgTint)
    docEl.style.setProperty('--color-card', cardTint)
    docEl.style.setProperty('--color-card-solid', palette.card)
    docEl.style.setProperty('--color-surface', surfaceTint)
    docEl.style.setProperty('--color-border', palette.border)
    docEl.style.setProperty('--color-divider', palette.divider)
    docEl.style.setProperty('--color-text', palette.text)
    docEl.style.setProperty('--color-muted', palette.muted)
    docEl.style.setProperty('--color-accent', accent)
    docEl.style.setProperty('--color-accent-soft', accentSoft)
    docEl.style.setProperty('--color-scrollbar', palette.scrollbar)
    docEl.style.setProperty('--color-selection', selectionBg)
    docEl.style.setProperty(
      '--shadow-soft',
      resolvedColorMode === 'dark'
        ? '0 6px 18px rgba(0,0,0,0.32), 0 1px 6px rgba(0,0,0,0.28)'
        : '0 4px 16px rgba(15,23,42,0.05), 0 1px 4px rgba(15,23,42,0.03)'
    )
    docEl.style.setProperty(
      '--shadow-elevated',
      resolvedColorMode === 'dark'
        ? '0 10px 28px rgba(0,0,0,0.5), 0 4px 12px rgba(0,0,0,0.3)'
        : '0 12px 28px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.08)'
    )

    // Toggle dark class
    docEl.classList.toggle('dark', resolvedColorMode === 'dark')
    docEl.style.setProperty('color-scheme', resolvedColorMode === 'dark' ? 'dark' : 'light')

    // Update Windows titlebar overlay colors
    window.electron?.window?.setTitleBarOverlay?.({
      color: bgTint,
      symbolColor: palette.text
    })
  }, [resolvedColorMode, themeColor])

  // Listen for system theme changes from electron
  useEffect(() => {
    const handleElectronThemeChange = (mode: string) => {
      if (mode === 'light' || mode === 'dark') {
        setSystemPrefersDark(mode === 'dark')
      }
    }

    window.electron?.theme?.get?.().then(handleElectronThemeChange)
    window.electron?.theme?.onChange?.(handleElectronThemeChange)
  }, [])

  // Apply font size class to document
  useEffect(() => {
    document.documentElement.classList.remove('text-small', 'text-large', 'text-extra-large')
    if (fontSize === 'small') {
      document.documentElement.classList.add('text-small')
    } else if (fontSize === 'large') {
      document.documentElement.classList.add('text-large')
    } else if (fontSize === 'extra-large') {
      document.documentElement.classList.add('text-extra-large')
    }
  }, [fontSize])

  return (
    <ThemeContext.Provider value={{
      themeColor,
      setThemeColor,
      colorMode,
      setColorMode,
      resolvedColorMode,
      fontSize,
      setFontSize
    }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}

export { themes, type ThemeKey }
