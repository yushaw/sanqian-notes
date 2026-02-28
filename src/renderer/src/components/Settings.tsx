import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../i18n'
import type { Language } from '../i18n'
import { useTheme, themes, type ThemeKey, type FontSize, type ColorModeSetting } from '../theme'
import { useUpdate } from '../contexts/UpdateContext'
import { AIActionsSettings } from './AIActionsSettings'
import { KnowledgeBaseSettings } from './KnowledgeBaseSettings'
import { DataSettings } from './DataSettings'
import { TemplateSettings } from './TemplateSettings'
import { DEFAULT_CHAT_SHORTCUT, CHAT_SHORTCUT_CHANGE_EVENT, formatShortcut } from '../utils/shortcut'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

const themeColorOrder: ThemeKey[] = ['coral', 'blush', 'sunset', 'amber', 'emerald', 'cyan', 'cobalt', 'indigo', 'magenta']

type SettingsTab = 'general' | 'appearance' | 'ai-actions' | 'templates' | 'knowledge-base' | 'data' | 'about'

// Resizable modal constants
const STORAGE_KEY = 'sanqian-notes-settings-size'
const MIN_WIDTH = 420
const MIN_HEIGHT = 320
const DEFAULT_RATIO = 0.7

interface SettingsProps {
  onClose: () => void
  initialTab?: string
}

export function Settings({ onClose, initialTab }: SettingsProps) {
  const { language, setLanguage, t } = useI18n()
  const { themeColor, setThemeColor, colorMode, setColorMode, fontSize, setFontSize } = useTheme()
  const {
    status: updateStatus,
    version: updateVersion,
    progress: updateProgress,
    releaseNotes: updateReleaseNotes,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
  } = useUpdate()
  const [activeTab, setActiveTab] = useState<SettingsTab>((initialTab as SettingsTab) || 'general')
  const [appVersion, setAppVersion] = useState<string>('')
  const [syncSelectionToChat, setSyncSelectionToChat] = useState<boolean>(true)
  const [chatShortcut, setChatShortcut] = useState<string>(DEFAULT_CHAT_SHORTCUT)
  const [isRecordingShortcut, setIsRecordingShortcut] = useState(false)
  const [shortcutError, setShortcutError] = useState<string | null>(null)

  // Load sync selection setting
  useEffect(() => {
    let mounted = true
    window.electron?.appSettings?.get('syncSelectionToChat').then((value) => {
      // Default to true if not set
      if (mounted) setSyncSelectionToChat(value !== 'false')
    })
    window.electron?.appSettings?.get('chatShortcut').then((value) => {
      // Default to CommandOrControl+K if not set
      if (mounted && value) setChatShortcut(value)
    })
    return () => { mounted = false }
  }, [])

  const handleSyncSelectionChange = async (enabled: boolean) => {
    setSyncSelectionToChat(enabled)
    try {
      await window.electron?.appSettings?.set('syncSelectionToChat', enabled ? 'true' : 'false')
    } catch {
      // Rollback UI state on error
      setSyncSelectionToChat(!enabled)
    }
  }

  // Fetch app version
  useEffect(() => {
    window.electron?.app?.getVersion().then((version) => {
      setAppVersion(version)
    })
  }, [])

  // Resizable modal state
  const getSavedRatio = useCallback(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const { widthRatio, heightRatio } = JSON.parse(saved)
        if (typeof widthRatio === 'number' && typeof heightRatio === 'number') {
          return {
            widthRatio: Math.min(0.95, Math.max(0.3, widthRatio)),
            heightRatio: Math.min(0.95, Math.max(0.3, heightRatio))
          }
        }
      }
    } catch {
      // ignore parse errors
    }
    return { widthRatio: DEFAULT_RATIO, heightRatio: DEFAULT_RATIO }
  }, [])

  const ratioToSize = useCallback((ratio: { widthRatio: number; heightRatio: number }) => {
    return {
      width: Math.max(MIN_WIDTH, window.innerWidth * ratio.widthRatio),
      height: Math.max(MIN_HEIGHT, window.innerHeight * ratio.heightRatio)
    }
  }, [])

  const [modalSize, setModalSize] = useState(() => ratioToSize(getSavedRatio()))
  const [isResizing, setIsResizing] = useState<string | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const resizeSizeRef = useRef(modalSize)

  // Update modal size when opening or window resizes
  useEffect(() => {
    const updateSize = () => {
      setModalSize(ratioToSize(getSavedRatio()))
    }

    updateSize()
    window.addEventListener('resize', updateSize)
    return () => window.removeEventListener('resize', updateSize)
  }, [getSavedRatio, ratioToSize])

  // ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Handle resize
  const handleMouseDown = useCallback((direction: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(direction)
  }, [])

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!modalRef.current) return

      const rect = modalRef.current.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2

      const maxWidth = window.innerWidth * 0.95
      const maxHeight = window.innerHeight * 0.95

      let newWidth = modalSize.width
      let newHeight = modalSize.height

      if (isResizing.includes('e')) {
        newWidth = Math.min(maxWidth, Math.max(MIN_WIDTH, (e.clientX - centerX) * 2))
      }
      if (isResizing.includes('w')) {
        newWidth = Math.min(maxWidth, Math.max(MIN_WIDTH, (centerX - e.clientX) * 2))
      }
      if (isResizing.includes('s')) {
        newHeight = Math.min(maxHeight, Math.max(MIN_HEIGHT, (e.clientY - centerY) * 2))
      }
      if (isResizing.includes('n')) {
        newHeight = Math.min(maxHeight, Math.max(MIN_HEIGHT, (centerY - e.clientY) * 2))
      }

      const newSize = { width: newWidth, height: newHeight }
      resizeSizeRef.current = newSize
      setModalSize(newSize)
    }

    const handleMouseUp = () => {
      const size = resizeSizeRef.current
      const ratio = {
        widthRatio: size.width / window.innerWidth,
        heightRatio: size.height / window.innerHeight
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ratio))
      setIsResizing(null)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, modalSize])

  const tabs: Array<{ key: SettingsTab; label: string }> = [
    { key: 'general', label: t.settings.general },
    { key: 'appearance', label: t.settings.appearance },
    { key: 'ai-actions', label: t.settings.aiActions.title },
    { key: 'templates', label: t.templates?.title || 'Templates' },
    { key: 'knowledge-base', label: t.settings.knowledgeBase.title },
    { key: 'data', label: t.settings.data },
    { key: 'about', label: t.settings.about },
  ]

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[1000]"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        ref={modalRef}
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[var(--color-card)] border border-black/5 dark:border-white/10 rounded-2xl shadow-[var(--shadow-elevated)] z-[1001] overflow-hidden flex flex-col no-drag"
        style={{
          width: modalSize.width,
          height: modalSize.height,
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 flex-shrink-0">
          <h2 className="text-lg font-semibold text-[var(--color-text)]">{t.settings.title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex flex-1 min-h-0 relative z-30">
          {/* Left Tabs */}
          <div className="w-28 flex-shrink-0 border-r border-black/5 dark:border-white/10 px-2 pb-5">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`
                  w-full px-3 py-2 rounded-lg text-sm text-left transition-all mb-1
                  ${activeTab === tab.key
                    ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)] font-medium'
                    : 'text-[var(--color-text)]/70 hover:bg-black/5 dark:hover:bg-white/5'
                  }
                `}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Right Content */}
          <div className="flex-1 px-5 py-2 overflow-y-auto [scrollbar-gutter:stable]">
            {/* General Tab */}
            {activeTab === 'general' && (
              <div className="space-y-5">
                {/* Language */}
                <div>
                  <h4 className="text-sm font-medium text-[var(--color-text)] mb-1">
                    {t.settings.language}
                  </h4>
                  <p className="text-xs text-[var(--color-muted)] mb-3">{t.settings.languageDesc}</p>
                  <div className="flex gap-1 p-1 bg-black/5 dark:bg-white/5 rounded-xl">
                    {(['zh', 'en', 'system'] as Language[]).map((lang) => (
                      <button
                        key={lang}
                        onClick={() => setLanguage(lang)}
                        className={`
                          flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-all
                          ${language === lang
                            ? 'bg-white dark:bg-white/15 text-[var(--color-text)] shadow-sm'
                            : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
                          }
                        `}
                      >
                        {lang === 'zh' ? t.language.chinese : lang === 'en' ? t.language.english : t.language.system}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Sync Selection to Chat */}
                <div>
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-medium text-[var(--color-text)] mb-1">
                        {t.settings.syncSelectionToChat}
                      </h4>
                      <p className="text-xs text-[var(--color-muted)]">{t.settings.syncSelectionToChatDesc}</p>
                    </div>
                    <button
                      role="switch"
                      aria-checked={syncSelectionToChat}
                      onClick={() => handleSyncSelectionChange(!syncSelectionToChat)}
                      className={`
                        relative w-11 h-6 rounded-full transition-colors
                        ${syncSelectionToChat
                          ? 'bg-[var(--color-accent)]'
                          : 'bg-black/10 dark:bg-white/10'
                        }
                      `}
                    >
                      <span
                        className={`
                          absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform
                          ${syncSelectionToChat ? 'left-6' : 'left-1'}
                        `}
                      />
                    </button>
                  </div>
                </div>

                {/* Chat Shortcut */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <h4 className="text-sm font-medium text-[var(--color-text)] mb-1">
                        {t.settings.chatShortcut}
                      </h4>
                      <p className="text-xs text-[var(--color-muted)]">{t.settings.chatShortcutDesc}</p>
                    </div>
                    {chatShortcut && (
                      <button
                        onClick={async () => {
                          setChatShortcut('')
                          setShortcutError(null)
                          await window.electron?.appSettings?.set('chatShortcut', '')
                          window.dispatchEvent(new CustomEvent(CHAT_SHORTCUT_CHANGE_EVENT, { detail: '' }))
                        }}
                        className="text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
                      >
                        {t.settings.chatShortcutClear}
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      setIsRecordingShortcut(true)
                      setShortcutError(null)
                    }}
                    onKeyDown={async (e) => {
                      if (!isRecordingShortcut) return

                      e.preventDefault()
                      e.stopPropagation()

                      // Ignore modifier-only keys
                      if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) {
                        return
                      }

                      // Build shortcut string (Electron format)
                      const parts: string[] = []
                      if (e.metaKey) parts.push('Command')
                      if (e.ctrlKey) parts.push('Control')
                      if (e.altKey) parts.push('Alt')
                      if (e.shiftKey) parts.push('Shift')

                      let key = e.key
                      if (key === ' ') key = 'Space'
                      else if (key.length === 1) key = key.toUpperCase()
                      parts.push(key)

                      const shortcut = parts.join('+')

                      // Require at least one modifier
                      if (!e.metaKey && !e.ctrlKey) {
                        setShortcutError(t.settings.chatShortcutNeedModifier)
                        return
                      }

                      // Save the shortcut
                      setChatShortcut(shortcut)
                      setShortcutError(null)
                      setIsRecordingShortcut(false)
                      await window.electron?.appSettings?.set('chatShortcut', shortcut)
                      // Notify App.tsx about the change
                      window.dispatchEvent(new CustomEvent(CHAT_SHORTCUT_CHANGE_EVENT, { detail: shortcut }))
                    }}
                    onBlur={() => {
                      setIsRecordingShortcut(false)
                    }}
                    className={`w-full px-3 py-2 rounded-xl border text-sm font-mono transition-all ${
                      isRecordingShortcut
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-text)]'
                        : 'border-black/10 dark:border-white/10 bg-white/50 dark:bg-white/5 text-[var(--color-text)]'
                    }`}
                  >
                    {isRecordingShortcut
                      ? t.settings.chatShortcutRecording
                      : chatShortcut
                        ? formatShortcut(chatShortcut)
                        : t.settings.chatShortcutNotSet}
                  </button>
                  {shortcutError && (
                    <p className="mt-2 text-xs text-red-500">{shortcutError}</p>
                  )}
                </div>
              </div>
            )}

            {/* Appearance Tab */}
            {activeTab === 'appearance' && (
              <div className="space-y-5">
                {/* Theme Color */}
                <div>
                  <h4 className="text-sm font-medium text-[var(--color-text)] mb-1">
                    {t.settings.themeColor}
                  </h4>
                  <p className="text-xs text-[var(--color-muted)] mb-3">{t.settings.themeColorDesc}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {themeColorOrder.map((key) => (
                      <button
                        key={key}
                        onClick={() => setThemeColor(key)}
                        className={`
                          w-5 h-5 rounded-full transition-all
                          ${themeColor === key
                            ? 'ring-2 ring-offset-1 ring-offset-[var(--color-card)] ring-[var(--color-text)]/30 scale-110'
                            : 'hover:scale-105'
                          }
                        `}
                        style={{ backgroundColor: themes[key].accent }}
                        title={key}
                      />
                    ))}
                  </div>
                </div>

                {/* Theme Mode */}
                <div>
                  <h4 className="text-sm font-medium text-[var(--color-text)] mb-1">
                    {t.settings.theme}
                  </h4>
                  <p className="text-xs text-[var(--color-muted)] mb-3">{t.settings.themeDesc}</p>
                  <div className="flex gap-1 p-1 bg-black/5 dark:bg-white/5 rounded-xl">
                    {([
                      {
                        key: 'light', label: t.settings.light, icon: (
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="5" />
                            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                          </svg>
                        )
                      },
                      {
                        key: 'dark', label: t.settings.dark, icon: (
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                          </svg>
                        )
                      },
                      {
                        key: 'system', label: t.settings.system, icon: (
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                            <line x1="8" y1="21" x2="16" y2="21" />
                            <line x1="12" y1="17" x2="12" y2="21" />
                          </svg>
                        )
                      },
                    ] as Array<{ key: ColorModeSetting; label: string; icon: React.ReactNode }>).map((option) => (
                      <button
                        key={option.key}
                        onClick={() => setColorMode(option.key)}
                        className={`
                          flex-1 py-2 px-2 text-sm font-medium rounded-lg transition-all flex items-center justify-center gap-1.5
                          ${colorMode === option.key
                            ? 'bg-white dark:bg-white/15 text-[var(--color-text)] shadow-sm'
                            : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
                          }
                        `}
                      >
                        {option.icon}
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Font Size */}
                <div>
                  <h4 className="text-sm font-medium text-[var(--color-text)] mb-1">
                    {t.settings.fontSize}
                  </h4>
                  <p className="text-xs text-[var(--color-muted)] mb-3">{t.settings.fontSizeDesc}</p>
                  <div className="flex gap-1 p-1 bg-black/5 dark:bg-white/5 rounded-xl">
                    {([
                      { key: 'small', label: t.settings.fontSizeSmall },
                      { key: 'normal', label: t.settings.fontSizeNormal },
                      { key: 'large', label: t.settings.fontSizeLarge },
                      { key: 'extra-large', label: t.settings.fontSizeExtraLarge },
                    ] as Array<{ key: FontSize; label: string }>).map((option) => (
                      <button
                        key={option.key}
                        onClick={() => setFontSize(option.key)}
                        className={`
                          flex-1 py-2 px-2 text-sm font-medium rounded-lg transition-all
                          ${fontSize === option.key
                            ? 'bg-white dark:bg-white/15 text-[var(--color-text)] shadow-sm'
                            : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
                          }
                        `}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* AI Actions Tab */}
            {activeTab === 'ai-actions' && (
              <AIActionsSettings />
            )}

            {/* Templates Tab */}
            {activeTab === 'templates' && (
              <TemplateSettings />
            )}

            {/* Knowledge Base Tab */}
            {activeTab === 'knowledge-base' && (
              <KnowledgeBaseSettings />
            )}

            {/* Data Tab */}
            {activeTab === 'data' && (
              <DataSettings />
            )}

            {/* About Tab */}
            {activeTab === 'about' && (
              <div className="space-y-5">
                <div className="flex flex-col items-center py-6">
                  {/* App Icon */}
                  <img
                    src={new URL('../assets/notes-logo.png', import.meta.url).href}
                    alt={t.app.name}
                    className="w-16 h-16 mb-3 dark:invert select-none"
                  />
                  <h3 className="text-lg font-semibold text-[var(--color-text)]">{t.app.name}</h3>
                  <p className="text-sm text-[var(--color-muted)] mt-1">{t.settings.version} {appVersion || '0.1.0'}</p>
                </div>

                {/* Update Status Card */}
                <div className="p-4 rounded-xl bg-black/5 dark:bg-white/5">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      {updateStatus === 'checking' && (
                        <p className="text-sm text-[var(--color-muted)]">{t.settings.updating.checking}</p>
                      )}
                      {updateStatus === 'available' && (
                        <p className="text-sm text-[var(--color-text)]">{t.settings.updating.available(updateVersion || '')}</p>
                      )}
                      {updateStatus === 'downloading' && (
                        <div className="space-y-2">
                          <p className="text-sm text-[var(--color-text)]">{t.settings.updating.downloading(updateProgress)}</p>
                          <div className="w-full h-1.5 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[var(--color-accent)] transition-all"
                              style={{ width: `${updateProgress}%` }}
                            />
                          </div>
                        </div>
                      )}
                      {updateStatus === 'ready' && (
                        <p className="text-sm text-green-600 dark:text-green-400">{t.settings.updating.ready}</p>
                      )}
                      {(updateStatus === 'idle' || updateStatus === 'not-available') && (
                        <p className="text-sm text-[var(--color-muted)]">{t.settings.updating.upToDate}</p>
                      )}
                      {updateStatus === 'error' && (
                        <p className="text-sm text-red-500">{t.settings.updating.error}</p>
                      )}
                    </div>
                    <div className="ml-4 flex-shrink-0">
                      {(updateStatus === 'idle' || updateStatus === 'not-available') && (
                        <button
                          onClick={checkForUpdates}
                          className="px-3 py-1.5 text-sm font-medium rounded-lg bg-[var(--color-accent)]/10 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20 transition-colors"
                        >
                          {t.settings.checkUpdate}
                        </button>
                      )}
                      {updateStatus === 'available' && (
                        <button
                          onClick={downloadUpdate}
                          className="px-3 py-1.5 text-sm font-medium rounded-lg bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent)]/90 transition-colors"
                        >
                          {t.settings.buttons.download}
                        </button>
                      )}
                      {updateStatus === 'ready' && (
                        <button
                          onClick={installUpdate}
                          className="px-3 py-1.5 text-sm font-medium rounded-lg bg-green-500 text-white hover:bg-green-600 transition-colors"
                        >
                          {t.settings.buttons.restart}
                        </button>
                      )}
                      {updateStatus === 'error' && (
                        <button
                          onClick={checkForUpdates}
                          className="px-3 py-1.5 text-sm font-medium rounded-lg bg-[var(--color-accent)]/10 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20 transition-colors"
                        >
                          {t.settings.buttons.retry}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Release Notes */}
                {updateReleaseNotes && (updateStatus === 'available' || updateStatus === 'downloading' || updateStatus === 'ready') && (
                  <div className="p-4 rounded-xl bg-black/5 dark:bg-white/5">
                    <p className="text-xs text-[var(--color-muted)] mb-2">{t.settings.updating.releaseNotes}</p>
                    <div
                      className="prose prose-sm dark:prose-invert max-w-none max-h-64 overflow-y-auto text-[var(--color-text)]/80"
                      onClick={(e) => {
                        const target = e.target as HTMLElement
                        if (target.tagName === 'A') {
                          e.preventDefault()
                          const href = target.getAttribute('href')
                          if (href) {
                            window.electron?.shell?.openExternal(href)
                          }
                        }
                      }}
                      dangerouslySetInnerHTML={{
                        __html: DOMPurify.sanitize(marked.parse(updateReleaseNotes, { async: false }) as string)
                      }}
                    />
                  </div>
                )}

                {/* Links */}
                <div className="flex justify-center gap-4 pt-2">
                  <a
                    href="https://github.com/yushaw/sanqian-notes-releases/discussions"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-[var(--color-accent)] hover:underline"
                  >
                    {t.settings.feedback}
                  </a>
                  <a
                    href="https://github.com/yushaw/sanqian-notes-releases"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-[var(--color-accent)] hover:underline"
                  >
                    {t.settings.github}
                  </a>
                  <a
                    href="http://sanqian.io/discord"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-[var(--color-accent)] hover:underline"
                  >
                    {t.settings.discord}
                  </a>
                </div>

                <p className="text-xs text-[var(--color-muted)] text-center pt-4 border-t border-black/5 dark:border-white/10">
                  {t.settings.copyright}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Resize handles */}
        {/* Edges */}
        <div className="absolute top-0 left-2 right-2 h-1 cursor-n-resize z-10" onMouseDown={handleMouseDown('n')} />
        <div className="absolute bottom-0 left-2 right-2 h-1 cursor-s-resize z-10" onMouseDown={handleMouseDown('s')} />
        <div className="absolute left-0 top-2 bottom-2 w-1 cursor-w-resize z-10" onMouseDown={handleMouseDown('w')} />
        <div className="absolute right-0 top-2 bottom-2 w-1 cursor-e-resize z-10" onMouseDown={handleMouseDown('e')} />
        {/* Corners */}
        <div className="absolute top-0 left-0 w-3 h-3 cursor-nw-resize z-20" onMouseDown={handleMouseDown('nw')} />
        <div className="absolute top-0 right-0 w-3 h-3 cursor-ne-resize z-20" onMouseDown={handleMouseDown('ne')} />
        <div className="absolute bottom-0 left-0 w-3 h-3 cursor-sw-resize z-20" onMouseDown={handleMouseDown('sw')} />
        <div className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize z-20" onMouseDown={handleMouseDown('se')} />
      </div>
    </>,
    document.body
  )
}
