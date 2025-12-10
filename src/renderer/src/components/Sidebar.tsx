import { useState } from 'react'
import type { Notebook, SmartViewId } from '../types/note'
import { useTranslations } from '../i18n'

interface SidebarProps {
  notebooks: Notebook[]
  selectedNotebookId: string | null
  selectedSmartView: SmartViewId | null
  onSelectNotebook: (id: string | null) => void
  onSelectSmartView: (view: SmartViewId) => void
  onAddNotebook: () => void
  onEditNotebook: (notebook: Notebook) => void
  onOpenSettings: () => void
  noteCounts: {
    all: number
    daily: number
    recent: number
    favorites: number
    notebooks: Record<string, number>
  }
}

export function Sidebar({
  notebooks,
  selectedNotebookId,
  selectedSmartView,
  onSelectNotebook,
  onSelectSmartView,
  onAddNotebook,
  onEditNotebook,
  onOpenSettings,
  noteCounts,
}: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const t = useTranslations()

  const smartViews: { id: SmartViewId; label: string; icon: string }[] = [
    { id: 'all', label: t.sidebar.all, icon: '📝' },
    { id: 'daily', label: t.sidebar.daily, icon: '📅' },
    { id: 'recent', label: t.sidebar.recent, icon: '🕐' },
    { id: 'favorites', label: t.sidebar.favorites, icon: '⭐' },
  ]

  if (isCollapsed) {
    return (
      <div className="w-12 h-full bg-[var(--color-surface)] border-r border-[var(--color-border)] flex flex-col">
        <div className="h-12 drag-region flex-shrink-0" />
        <button
          onClick={() => setIsCollapsed(false)}
          className="p-3 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors duration-150"
          title={t.sidebar.expand}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <div className="w-52 h-full bg-[var(--color-surface)] border-r border-[var(--color-border)] flex flex-col">
      {/* Drag region for macOS traffic lights */}
      <div className="h-12 drag-region flex-shrink-0" />

      {/* Sidebar content */}
      <div className="flex-1 overflow-y-auto px-2 pb-3 no-drag">
        {/* Smart Views */}
        <div className="mb-4">
          {smartViews.map((view) => (
            <button
              key={view.id}
              onClick={() => onSelectSmartView(view.id)}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-[13px] transition-all duration-150 ${
                selectedSmartView === view.id
                  ? 'bg-[var(--color-accent-soft)] text-[var(--color-text)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-card)]'
              }`}
            >
              <span className="flex items-center gap-2">
                <span className="text-sm">{view.icon}</span>
                <span>{view.label}</span>
              </span>
              <span className="text-[11px] text-[var(--color-muted)] tabular-nums">
                {noteCounts[view.id]}
              </span>
            </button>
          ))}
        </div>

        {/* Notebooks Section */}
        <div>
          <div className="flex items-center justify-between px-2.5 mb-1.5">
            <span className="text-[11px] font-medium text-[var(--color-muted)] uppercase tracking-wider">
              {t.sidebar.notebooks}
            </span>
            <button
              onClick={onAddNotebook}
              className="p-1 rounded text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-card)] transition-all duration-150"
              title={t.sidebar.addNotebook}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>

          {notebooks.length === 0 ? (
            <p className="px-2.5 py-2 text-[12px] text-[var(--color-muted)]">{t.noteList.empty}</p>
          ) : (
            notebooks.map((notebook) => (
              <div
                key={notebook.id}
                className={`group w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-[13px] transition-all duration-150 ${
                  selectedNotebookId === notebook.id
                    ? 'bg-[var(--color-accent-soft)] text-[var(--color-text)]'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-card)]'
                }`}
              >
                <button
                  onClick={() => onSelectNotebook(notebook.id)}
                  className="flex-1 flex items-center gap-2 text-left min-w-0"
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: notebook.color }}
                  />
                  <span className="truncate">{notebook.name}</span>
                </button>
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-[var(--color-muted)] tabular-nums">
                    {noteCounts.notebooks[notebook.id] || 0}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onEditNotebook(notebook)
                    }}
                    className="p-0.5 rounded opacity-0 group-hover:opacity-100 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-all duration-150"
                    title={t.actions.edit}
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                    </svg>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Bottom buttons */}
      <div className="p-2 border-t border-[var(--color-border)] flex items-center gap-1">
        {/* Settings button */}
        <button
          onClick={onOpenSettings}
          className="flex-1 flex items-center justify-center p-2 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors duration-150 rounded-md hover:bg-[var(--color-card)]"
          title={t.settings.title}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>

        {/* Collapse button */}
        <button
          onClick={() => setIsCollapsed(true)}
          className="flex-1 flex items-center justify-center p-2 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors duration-150 rounded-md hover:bg-[var(--color-card)]"
          title={t.sidebar.collapse}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </button>
      </div>
    </div>
  )
}
