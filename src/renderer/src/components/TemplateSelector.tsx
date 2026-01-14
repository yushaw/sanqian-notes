/**
 * TemplateSelector - Modal for selecting and inserting templates
 *
 * Shows a list of available templates and inserts the selected one
 * into the editor at the current cursor position.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslations } from '../i18n'
import type { Template } from '../../../shared/types'
import { parseTemplateContent, type TemplateContext } from '../utils/templateVariables'

interface TemplateSelectorProps {
  onClose: () => void
  onInsert: (content: string) => void
  context: TemplateContext
  onOpenSettings?: () => void
}

export function TemplateSelector({ onClose, onInsert, context, onOpenSettings }: TemplateSelectorProps) {
  const t = useTranslations()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  // Load templates
  useEffect(() => {
    const loadTemplates = async () => {
      setLoading(true)
      try {
        const result = await window.electron?.templates?.getAll()
        setTemplates(result || [])
      } catch (error) {
        console.error('Failed to load templates:', error)
      } finally {
        setLoading(false)
      }
    }
    loadTemplates()
  }, [])

  // Handle template selection
  const handleSelect = useCallback(
    (template: Template) => {
      // Parse template variables
      const { content } = parseTemplateContent(template.content, context)
      onInsert(content)
      onClose()
    },
    [context, onInsert, onClose]
  )

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (templates.length === 0) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((prev) => (prev + 1) % templates.length)
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((prev) => (prev - 1 + templates.length) % templates.length)
          break
        case 'Enter':
          e.preventDefault()
          if (templates[selectedIndex]) {
            handleSelect(templates[selectedIndex])
          }
          break
        case 'Escape':
          e.preventDefault()
          onClose()
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [templates, selectedIndex, handleSelect, onClose])

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current && templates.length > 0) {
      const items = listRef.current.querySelectorAll('[data-template-item]')
      const selectedItem = items[selectedIndex]
      if (selectedItem) {
        selectedItem.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [selectedIndex, templates.length])

  return (
    <div className="template-selector-overlay" onClick={onClose}>
      <div className="template-selector-dialog" onClick={(e) => e.stopPropagation()}>
        {/* Close button */}
        <button className="template-selector-close" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Content */}
        {loading ? (
          <div className="template-selector-loading">
            <span>{t.templates?.loading || 'Loading...'}</span>
          </div>
        ) : templates.length === 0 ? (
          <div className="template-selector-empty">
            <div className="template-selector-empty-icon">📄</div>
            <div className="template-selector-empty-text">{t.templates?.noTemplates || 'No templates yet'}</div>
            {onOpenSettings && (
              <button className="template-selector-empty-btn" onClick={() => { onClose(); onOpenSettings(); }}>
                {t.templates?.goToSettings || 'Create in Settings'}
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="template-selector-list" ref={listRef}>
              {templates.map((template, index) => (
                <button
                  key={template.id}
                  data-template-item
                  className={`template-selector-item ${index === selectedIndex ? 'selected' : ''}`}
                  onClick={() => handleSelect(template)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <div className="template-selector-item-content">
                    <div className="template-selector-item-name">{template.name}</div>
                    {template.description && (
                      <div className="template-selector-item-desc">{template.description}</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
            {onOpenSettings && (
              <div className="template-selector-footer">
                <button className="template-selector-manage" onClick={() => { onClose(); onOpenSettings(); }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  <span>{t.templates?.manageTemplates || 'Manage Templates'}</span>
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <style>{`
        .template-selector-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
          backdrop-filter: blur(2px);
        }

        .template-selector-dialog {
          position: relative;
          width: 280px;
          max-height: 400px;
          background: var(--color-card);
          border-radius: 10px;
          box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);
          display: flex;
          flex-direction: column;
        }

        .template-selector-close {
          position: absolute;
          top: -12px;
          right: -12px;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: none;
          background: rgba(255, 255, 255, 0.9);
          border-radius: 50%;
          color: var(--color-text-secondary);
          cursor: pointer;
          transition: all 0.15s ease;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
          z-index: 1;
        }

        .template-selector-close:hover {
          background: white;
          color: var(--color-text);
          transform: scale(1.05);
        }

        :root[data-theme="dark"] .template-selector-close,
        .dark .template-selector-close {
          background: rgba(60, 60, 60, 0.9);
        }

        :root[data-theme="dark"] .template-selector-close:hover,
        .dark .template-selector-close:hover {
          background: rgba(80, 80, 80, 1);
        }

        .template-selector-loading {
          padding: 40px 20px;
          text-align: center;
          color: var(--color-muted);
          font-size: 13px;
        }

        .template-selector-empty {
          padding: 40px 20px;
          text-align: center;
        }

        .template-selector-empty-icon {
          font-size: 32px;
          margin-bottom: 8px;
        }

        .template-selector-empty-text {
          color: var(--color-muted);
          font-size: 13px;
          margin-bottom: 16px;
        }

        .template-selector-empty-btn {
          padding: 8px 16px;
          border: none;
          background: var(--color-accent);
          color: white;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.15s ease;
        }

        .template-selector-empty-btn:hover {
          background: var(--color-accent-hover, var(--color-accent));
          opacity: 0.9;
        }

        .template-selector-list {
          flex: 1;
          overflow-y: auto;
          overflow-x: hidden;
          padding: 6px;
          border-radius: 0 0 10px 10px;
        }

        .template-selector-item {
          display: block;
          width: 100%;
          padding: 10px 12px;
          border: none;
          background: transparent;
          border-radius: 6px;
          text-align: left;
          cursor: pointer;
          transition: background 0.15s ease;
        }

        .template-selector-item:hover,
        .template-selector-item.selected {
          background: var(--color-hover, rgba(0, 0, 0, 0.05));
        }

        :root[data-theme="dark"] .template-selector-item:hover,
        :root[data-theme="dark"] .template-selector-item.selected,
        .dark .template-selector-item:hover,
        .dark .template-selector-item.selected {
          background: var(--color-hover, rgba(255, 255, 255, 0.1));
        }

        .template-selector-item-content {
          flex: 1;
          min-width: 0;
        }

        .template-selector-item-name {
          font-size: 13px;
          font-weight: 500;
          color: var(--color-text);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .template-selector-item-desc {
          font-size: 11px;
          color: var(--color-muted);
          margin-top: 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .template-selector-footer {
          border-top: 1px solid var(--color-border);
          padding: 6px;
        }

        .template-selector-manage {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 8px 12px;
          border: none;
          background: transparent;
          border-radius: 6px;
          font-size: 12px;
          color: var(--color-muted);
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .template-selector-manage:hover {
          background: var(--color-hover, rgba(0, 0, 0, 0.05));
          color: var(--color-text);
        }

        :root[data-theme="dark"] .template-selector-manage:hover,
        .dark .template-selector-manage:hover {
          background: var(--color-hover, rgba(255, 255, 255, 0.1));
        }
      `}</style>
    </div>
  )
}
