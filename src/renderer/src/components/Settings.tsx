import { useI18n } from '../i18n'
import { useTheme } from '../theme'

interface SettingsProps {
  onClose: () => void
}

export function Settings({ onClose }: SettingsProps) {
  const { language, setLanguage, t } = useI18n()
  const { colorMode, setColorMode, fontSize, setFontSize } = useTheme()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center animate-fade-in">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-[var(--color-card)] rounded-xl shadow-[var(--shadow-elevated)] overflow-hidden animate-fade-in-up">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <h2 className="text-[15px] font-semibold text-[var(--color-text)]">{t.settings.title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-all duration-150"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5">
          {/* Language */}
          <div>
            <label className="block text-[13px] font-medium text-[var(--color-text)] mb-1">
              {t.settings.language}
            </label>
            <p className="text-[12px] text-[var(--color-muted)] mb-2">{t.settings.languageDesc}</p>
            <div className="flex gap-2">
              <SettingButton
                active={language === 'system'}
                onClick={() => setLanguage('system')}
              >
                {t.settings.system}
              </SettingButton>
              <SettingButton
                active={language === 'zh'}
                onClick={() => setLanguage('zh')}
              >
                中文
              </SettingButton>
              <SettingButton
                active={language === 'en'}
                onClick={() => setLanguage('en')}
              >
                English
              </SettingButton>
            </div>
          </div>

          {/* Theme */}
          <div>
            <label className="block text-[13px] font-medium text-[var(--color-text)] mb-1">
              {t.settings.theme}
            </label>
            <p className="text-[12px] text-[var(--color-muted)] mb-2">{t.settings.themeDesc}</p>
            <div className="flex gap-2">
              <SettingButton
                active={colorMode === 'system'}
                onClick={() => setColorMode('system')}
              >
                {t.settings.system}
              </SettingButton>
              <SettingButton
                active={colorMode === 'light'}
                onClick={() => setColorMode('light')}
              >
                {t.settings.light}
              </SettingButton>
              <SettingButton
                active={colorMode === 'dark'}
                onClick={() => setColorMode('dark')}
              >
                {t.settings.dark}
              </SettingButton>
            </div>
          </div>

          {/* Font Size */}
          <div>
            <label className="block text-[13px] font-medium text-[var(--color-text)] mb-1">
              {t.settings.fontSize}
            </label>
            <p className="text-[12px] text-[var(--color-muted)] mb-2">{t.settings.fontSizeDesc}</p>
            <div className="flex gap-2">
              <SettingButton
                active={fontSize === 'small'}
                onClick={() => setFontSize('small')}
              >
                {t.settings.fontSizeSmall}
              </SettingButton>
              <SettingButton
                active={fontSize === 'normal'}
                onClick={() => setFontSize('normal')}
              >
                {t.settings.fontSizeNormal}
              </SettingButton>
              <SettingButton
                active={fontSize === 'large'}
                onClick={() => setFontSize('large')}
              >
                {t.settings.fontSizeLarge}
              </SettingButton>
              <SettingButton
                active={fontSize === 'extra-large'}
                onClick={() => setFontSize('extra-large')}
              >
                {t.settings.fontSizeExtraLarge}
              </SettingButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SettingButton({
  children,
  active,
  onClick
}: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-md text-[13px] transition-all duration-150 ${
        active
          ? 'bg-[var(--color-accent)] text-white'
          : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border)]'
      }`}
    >
      {children}
    </button>
  )
}
