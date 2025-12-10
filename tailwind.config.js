/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'app-bg': 'var(--color-bg)',
        'app-card': 'var(--color-card)',
        'app-card-solid': 'var(--color-card-solid)',
        'app-surface': 'var(--color-surface)',
        'app-border': 'var(--color-border)',
        'app-divider': 'var(--color-divider)',
        'app-selection': 'var(--color-selection)',
        'app-accent': 'var(--color-accent)',
        'app-accent-soft': 'var(--color-accent-soft)',
        'app-text': 'var(--color-text)',
        'app-muted': 'var(--color-muted)',
      },
      boxShadow: {
        'app-soft': 'var(--shadow-soft)',
        'app-elevated': 'var(--shadow-elevated)',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        fadeIn: 'fadeIn 0.2s ease-out',
        slideUp: 'slideUp 0.2s ease-out',
      },
    },
  },
  plugins: [],
}
