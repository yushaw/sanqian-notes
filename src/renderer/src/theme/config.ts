// Theme color configuration

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
    card: '#242424',
    surface: '#2d2d2d',
    border: '#333333',
    divider: '#333333',
    text: '#ffffff',
    muted: '#AEAEB2',
    scrollbar: 'rgba(255,255,255,0.18)',
  },
} as const

// Accent color - using a calm blue
export const ACCENT_COLOR = '#3B82F6'

export const STORAGE_KEY = 'sanqian-notes-color-mode'
