// Theme color configuration

export const themes = {
  coral: { accent: '#FB7185' },
  blush: { accent: '#F472B6' },
  sunset: { accent: '#FB923C' },
  amber: { accent: '#FBBF24' },
  emerald: { accent: '#34D399' },
  cyan: { accent: '#22D3EE' },
  cobalt: { accent: '#2563EB' },
  indigo: { accent: '#8B5CF6' },
  magenta: { accent: '#C084FC' },
} as const

export const basePalettes = {
  light: {
    bg: '#F5F5F7',
    card: '#FFFFFF',
    surface: '#FBFBFD',
    border: '#E5E5EA',
    divider: '#E5E5EA',
    text: '#1D1D1F',
    muted: '#6E6E73',
    scrollbar: 'rgba(0,0,0,0.18)',
  },
  dark: {
    bg: '#1a1a1a',
    card: '#1F1F1F',
    surface: '#2d2d2d',
    border: '#333333',
    divider: '#333333',
    text: '#ffffff',
    muted: '#AEAEB2',
    scrollbar: 'rgba(255,255,255,0.18)',
  },
} as const

export type ThemeKey = keyof typeof themes
export const DEFAULT_THEME: ThemeKey = 'cobalt'

export const STORAGE_KEY = 'sanqian-notes-color-mode'
export const THEME_COLOR_STORAGE_KEY = 'sanqian-notes-theme-color'
