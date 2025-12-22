import { useState, useRef, useEffect, useMemo } from 'react'
import type { Notebook, SmartViewId } from '../types/note'
import { useTranslations } from '../i18n'
import { isMacOS } from '../utils/platform'
import notesLogo from '../assets/notes-logo.png'
import todolistLogo from '../assets/todolist-logo.png'
import sanqianLogo from '../assets/sanqian-logo.svg'
import yinianLogo from '../assets/yinian-logo.svg'

// 检测是否为 macOS
const isMac = isMacOS()

// 修饰键符号
const MOD = isMac ? '⌘' : 'Ctrl'
const SHIFT = isMac ? '⇧' : 'Shift'

// 快捷键帮助弹窗组件
function ShortcutsPopover({ isOpen, t }: { isOpen: boolean; t: ReturnType<typeof useTranslations> }) {
  const shortcuts = useMemo(() => [
    { category: t.shortcuts.textFormat, items: [
      { label: t.shortcuts.bold, key: `${MOD} B` },
      { label: t.shortcuts.italic, key: `${MOD} I` },
      { label: t.shortcuts.underline, key: `${MOD} U` },
      { label: t.shortcuts.strikethrough, key: `${MOD} ${SHIFT} S` },
      { label: t.shortcuts.highlight, key: `${MOD} ${SHIFT} H` },
      { label: t.shortcuts.inlineCode, key: `${MOD} ${SHIFT} E` },
    ]},
    { category: t.shortcuts.blocks, items: [
      { label: t.shortcuts.slashCommand, key: '/ 、' },
      { label: t.shortcuts.codeBlock, key: '```' },
      { label: t.shortcuts.mathFormula, key: '$...$' },
      { label: t.shortcuts.noteLink, key: '[[' },
    ]},
    { category: t.shortcuts.editing, items: [
      { label: t.shortcuts.newNote, key: `${MOD} N` },
      { label: t.shortcuts.undo, key: `${MOD} Z` },
      { label: t.shortcuts.redo, key: `${MOD} ${SHIFT} Z` },
      { label: t.shortcuts.save, key: `${MOD} S` },
    ]},
  ], [t])

  if (!isOpen) return null

  return (
    <div className="absolute top-0 left-full ml-2 w-52 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg shadow-lg py-2 z-50">
      <div className="px-3 pb-1.5 text-[0.733rem] font-medium text-[var(--color-muted)] uppercase tracking-wider">
        {t.shortcuts.title}
      </div>
      {shortcuts.map((section, idx) => (
        <div key={section.category}>
          {idx > 0 && <div className="my-1.5 border-t border-[var(--color-border)]" />}
          <div className="px-3 py-1 text-[0.7rem] text-[var(--color-muted)]">{section.category}</div>
          {section.items.map((item) => (
            <div key={item.label} className="px-3 py-1 flex items-center justify-between text-[0.8rem]">
              <span className="text-[var(--color-text-secondary)]">{item.label}</span>
              <span className="text-[var(--color-muted)] font-mono text-[0.7rem]">{item.key}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// Logo icons mapping
const LOGO_MAP: Record<string, string> = {
  'logo:notes': notesLogo,
  'logo:todolist': todolistLogo,
  'logo:sanqian': sanqianLogo,
  'logo:yinian': yinianLogo,
}

// Notebook icon component
function NotebookIcon({ icon, className = '' }: { icon?: string; className?: string }) {
  const iconValue = icon || 'logo:notes'

  if (iconValue.startsWith('logo:')) {
    const logoSrc = LOGO_MAP[iconValue] || LOGO_MAP['logo:notes']
    return (
      <img
        src={logoSrc}
        alt=""
        className={`w-4 h-4 object-contain dark:invert select-none ${className}`}
        draggable={false}
      />
    )
  }

  // It's an emoji
  return <span className={`text-sm select-none ${className}`}>{iconValue}</span>
}

interface SidebarProps {
  notebooks: Notebook[]
  selectedNotebookId: string | null
  selectedSmartView: SmartViewId | null
  onSelectNotebook: (id: string | null) => void
  onSelectSmartView: (view: SmartViewId) => void
  onAddNotebook: () => void
  onEditNotebook: (notebook: Notebook) => void
  onDeleteNotebook: (notebook: Notebook) => void
  onOpenSettings: () => void
  noteCounts: {
    all: number
    daily: number
    recent: number
    favorites: number
    trash: number
    notebooks: Record<string, number>
  }
  onCollapsedChange?: (collapsed: boolean) => void
}

interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  notebook: Notebook | null
}

// localStorage key for sidebar collapsed state
const SIDEBAR_COLLAPSED_KEY = 'sanqian-notes-sidebar-collapsed'

export function Sidebar({
  notebooks,
  selectedNotebookId,
  selectedSmartView,
  onSelectNotebook,
  onSelectSmartView,
  onAddNotebook,
  onEditNotebook,
  onDeleteNotebook,
  onOpenSettings,
  noteCounts,
  onCollapsedChange,
}: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_COLLAPSED_KEY)
      return saved === 'true'
    } catch {
      return false
    }
  })

  // 通知父组件折叠状态变化，并持久化到 localStorage
  const handleCollapsedChange = (collapsed: boolean) => {
    setIsCollapsed(collapsed)
    onCollapsedChange?.(collapsed)
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed))
    } catch {
      // ignore storage errors
    }
  }

  // 初始化时通知父组件当前的折叠状态
  useEffect(() => {
    onCollapsedChange?.(isCollapsed)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [showShortcuts, setShowShortcuts] = useState(false)
  const shortcutsTimerRef = useRef<NodeJS.Timeout | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    notebook: null,
  })
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const t = useTranslations()

  // Handle right click on notebook
  const handleContextMenu = (e: React.MouseEvent, notebook: Notebook) => {
    e.preventDefault()
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      notebook,
    })
  }

  const closeContextMenu = () => {
    setContextMenu(prev => ({ ...prev, visible: false }))
  }

  // Close context menu on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        closeContextMenu()
      }
    }
    if (contextMenu.visible) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [contextMenu.visible])

  // Cleanup shortcuts timer on unmount
  useEffect(() => {
    return () => {
      if (shortcutsTimerRef.current) {
        clearTimeout(shortcutsTimerRef.current)
      }
    }
  }, [])

  const smartViews: { id: SmartViewId; label: string; icon: React.ReactNode }[] = [
    { id: 'all', label: t.sidebar.all, icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    ) },
    { id: 'favorites', label: t.sidebar.favorites, icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
      </svg>
    ) },
  ]

  if (isCollapsed) {
    return (
      <div className="w-12 flex-shrink-0 h-full bg-[var(--color-card-solid)] flex flex-col">
        {/* Drag region - top 50px area for window dragging */}
        <div className="h-[50px] flex-shrink-0 drag-region" />

        {/* Smart Views 图标 */}
        <div className="flex flex-col items-center gap-1 px-2 py-2 no-drag">
          {smartViews.map((view) => (
            <button
              key={view.id}
              onClick={() => onSelectSmartView(view.id)}
              className={`p-2 rounded-md transition-all duration-150 ${
                selectedSmartView === view.id
                  ? 'text-[var(--color-text)] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)]'
              }`}
              title={view.label}
            >
              {view.icon}
            </button>
          ))}
        </div>

        {/* Notebooks 图标 */}
        <div className="flex flex-col items-center gap-1 px-2 py-2 flex-1 overflow-y-auto no-drag">
          {notebooks.map((notebook) => (
            <button
              key={notebook.id}
              onClick={() => onSelectNotebook(notebook.id)}
              className={`p-2 rounded-md transition-all duration-150 ${
                selectedNotebookId === notebook.id
                  ? 'text-[var(--color-text)] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)]'
              }`}
              title={notebook.name}
            >
              <NotebookIcon icon={notebook.icon} className="w-4 h-4" />
            </button>
          ))}
        </div>

        {/* 底部按钮 */}
        <div className="flex flex-col items-center gap-1 px-2 py-2 no-drag">
          {/* 回收站按钮 */}
          <button
            onClick={() => onSelectSmartView('trash')}
            className={`p-2 rounded-md transition-all duration-150 ${
              selectedSmartView === 'trash'
                ? 'text-[var(--color-text)] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)]'
                : 'text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)]'
            }`}
            title={t.sidebar.trash}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
          </button>

          {/* 展开按钮 */}
          <button
            onClick={() => handleCollapsedChange(false)}
            className="p-2 rounded-md text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-all duration-150"
            title={t.sidebar.expand}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          </button>

          {/* 设置按钮 */}
          <button
            onClick={onOpenSettings}
            className="p-2 rounded-md text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-all duration-150"
            title={t.sidebar.settings}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="w-52 flex-shrink-0 h-full bg-[var(--color-card-solid)] border-r border-[var(--color-border)] flex flex-col relative">
      {/* Drag region - top 50px area for window dragging */}
      <div className="h-[50px] flex-shrink-0 drag-region" />

      {/* Shortcuts help button - absolute top right in title bar area */}
      <div
        className="absolute top-[13px] right-2 z-10 no-drag"
        onMouseEnter={() => {
          // Clear any existing timer
          if (shortcutsTimerRef.current) {
            clearTimeout(shortcutsTimerRef.current)
          }
          // Show shortcuts after 300ms delay
          shortcutsTimerRef.current = setTimeout(() => {
            setShowShortcuts(true)
          }, 300)
        }}
        onMouseLeave={() => {
          // Clear timer and hide immediately
          if (shortcutsTimerRef.current) {
            clearTimeout(shortcutsTimerRef.current)
            shortcutsTimerRef.current = null
          }
          setShowShortcuts(false)
        }}
      >
        <button
          className="p-1 rounded text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-card)] transition-all duration-150"
          title="快捷键"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
          </svg>
        </button>
        <ShortcutsPopover isOpen={showShortcuts} t={t} />
      </div>

      {/* Sidebar content */}
      <div className="flex-1 overflow-y-auto px-2 pb-3 no-drag">
        {/* Smart Views */}
        <div className="mb-4">
          {smartViews.map((view) => (
            <button
              key={view.id}
              onClick={() => onSelectSmartView(view.id)}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-[0.867rem] transition-all duration-150 ${
                selectedSmartView === view.id
                  ? 'text-[var(--color-text)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-card)]'
              }`}
              style={selectedSmartView === view.id ? { backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' } : undefined}
            >
              <span className="flex items-center gap-2">
                <span className="text-[var(--color-muted)]">{view.icon}</span>
                <span>{view.label}</span>
              </span>
              <span className="text-[0.733rem] text-[var(--color-muted)] tabular-nums">
                {noteCounts[view.id]}
              </span>
            </button>
          ))}
        </div>

        {/* Notebooks Section */}
        <div>
          <div className="flex items-center justify-between px-2.5 mb-1.5">
            <span className="text-[0.733rem] font-medium text-[var(--color-muted)] uppercase tracking-wider">
              {t.sidebar.notebooks}
            </span>
            <button
              onClick={onAddNotebook}
              className="p-1 -mr-1.5 rounded text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-card)] transition-all duration-150"
              title={t.sidebar.addNotebook}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>

          {notebooks.length > 0 && (
            notebooks.map((notebook) => (
              <button
                key={notebook.id}
                onClick={() => onSelectNotebook(notebook.id)}
                onContextMenu={(e) => handleContextMenu(e, notebook)}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-[0.867rem] transition-all duration-150 ${
                  selectedNotebookId === notebook.id
                    ? 'text-[var(--color-text)]'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-card)]'
                }`}
                style={selectedNotebookId === notebook.id ? { backgroundColor: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' } : undefined}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <NotebookIcon icon={notebook.icon} className="flex-shrink-0" />
                  <span className="truncate">{notebook.name}</span>
                </span>
                <span className="text-[0.733rem] text-[var(--color-muted)] tabular-nums">
                  {noteCounts.notebooks[notebook.id] || 0}
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Bottom buttons - 回收站、收起、设置 */}
      <div className="px-2 py-2 flex flex-col gap-0.5 no-drag">
        {/* Trash button */}
        <button
          onClick={() => onSelectSmartView('trash')}
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md transition-colors duration-150 ${
            selectedSmartView === 'trash'
              ? 'text-[var(--color-text)] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)]'
              : 'text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-card)]'
          }`}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
          </svg>
          <span className="text-[0.867rem]">{t.sidebar.trash}</span>
        </button>

        {/* Collapse button */}
        <button
          onClick={() => handleCollapsedChange(true)}
          className="flex items-center gap-2 px-2.5 py-1.5 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors duration-150 rounded-md hover:bg-[var(--color-card)]"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
          <span className="text-[0.867rem]">{t.sidebar.collapse}</span>
        </button>

        {/* Settings button */}
        <button
          onClick={onOpenSettings}
          className="flex items-center gap-2 px-2.5 py-1.5 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors duration-150 rounded-md hover:bg-[var(--color-card)]"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-[0.867rem]">{t.sidebar.settings}</span>
        </button>
      </div>

      {/* Context Menu */}
      {contextMenu.visible && contextMenu.notebook && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg shadow-lg py-1 min-w-[120px] select-none"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => {
              onEditNotebook(contextMenu.notebook!)
              closeContextMenu()
            }}
            className="w-full px-3 py-1.5 text-left text-[0.867rem] text-[var(--color-text)] hover:bg-[var(--color-surface)] flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            {t.actions.edit}
          </button>
          <button
            onClick={() => {
              onDeleteNotebook(contextMenu.notebook!)
              closeContextMenu()
            }}
            className="w-full px-3 py-1.5 text-left text-[0.867rem] text-red-500 hover:bg-[var(--color-surface)] flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            {t.actions.delete}
          </button>
        </div>
      )}
    </div>
  )
}
