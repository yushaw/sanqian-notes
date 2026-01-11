/**
 * 编辑器更多菜单组件
 *
 * 提供导出等功能入口，后续可扩展更多操作
 */

import { useState, useEffect, useRef } from 'react'
import { useTranslations } from '../i18n'
import { toast } from '../utils/toast'

interface ExportMenuProps {
  noteId?: string
  onSplitHorizontal?: () => void
  onSplitVertical?: () => void
}

type ExportFormat = 'pdf' | 'markdown'

// SVG Icons
const Icons = {
  more: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </svg>
  ),
  export: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  ),
  splitHorizontal: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="12" y1="3" x2="12" y2="21" />
    </svg>
  ),
  splitVertical: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="12" x2="21" y2="12" />
    </svg>
  ),
}

export function ExportMenu({ noteId, onSplitHorizontal, onSplitVertical }: ExportMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [exportModalOpen, setExportModalOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [format, setFormat] = useState<ExportFormat>('pdf')
  const menuRef = useRef<HTMLDivElement>(null)

  // PDF 配置
  const [pageSize, setPageSize] = useState<'A4' | 'Letter'>('A4')
  const [includeBackground, setIncludeBackground] = useState(true)

  // Markdown 配置
  const [includeAttachments, setIncludeAttachments] = useState(true)
  const [includeFrontMatter, setIncludeFrontMatter] = useState(true)

  const t = useTranslations()

  // 点击外部关闭菜单（使用 capture 阶段，避免被 drag region 阻止）
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }

    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside, true)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside, true)
  }, [menuOpen])

  // ESC 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (exportModalOpen) {
          setExportModalOpen(false)
        } else if (menuOpen) {
          setMenuOpen(false)
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [menuOpen, exportModalOpen])

  const openExportModal = () => {
    setMenuOpen(false)
    setExportModalOpen(true)
  }

  const handleExport = async () => {
    if (!noteId) return
    setIsExporting(true)

    try {
      if (format === 'pdf') {
        const result = await window.electron.importExport.noteAsPDF(noteId, {
          pageSize,
          includeBackground,
        })

        if (result.success) {
          toast(t.export?.success || 'Export successful')
          setExportModalOpen(false)
        } else if (result.error !== 'canceled') {
          toast(result.error || 'Export failed', { type: 'error' })
        }
      } else {
        const result = await window.electron.importExport.noteAsMarkdown(noteId, {
          includeAttachments,
          includeFrontMatter,
        })

        if (result.success) {
          toast(t.export?.success || 'Export successful')
          setExportModalOpen(false)
        } else if (result.error !== 'canceled') {
          toast(result.error || 'Export failed', { type: 'error' })
        }
      }
    } catch (error) {
      toast(String(error), { type: 'error' })
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <>
      {/* 更多按钮 + 下拉菜单 */}
      <div className="more-menu-wrapper" ref={menuRef}>
        <button
          className="more-menu-trigger"
          onClick={() => setMenuOpen(!menuOpen)}
          disabled={isExporting}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {isExporting ? <span className="more-menu-spinner" /> : Icons.more}
        </button>

        {menuOpen && (
          <>
            <div className="more-menu-backdrop" onClick={() => setMenuOpen(false)} />
            <div className="more-menu-dropdown">
              {onSplitHorizontal && (
                <button className="more-menu-item" onClick={() => { setMenuOpen(false); onSplitHorizontal() }}>
                  {Icons.splitHorizontal}
                  <span>{t.paneControls?.splitHorizontal || 'Split Right'}</span>
                </button>
              )}
              {onSplitVertical && (
                <button className="more-menu-item" onClick={() => { setMenuOpen(false); onSplitVertical() }}>
                  {Icons.splitVertical}
                  <span>{t.paneControls?.splitVertical || 'Split Down'}</span>
                </button>
              )}
              {(onSplitHorizontal || onSplitVertical) && noteId && <div className="more-menu-divider" />}
              {noteId && (
                <button className="more-menu-item" onClick={openExportModal}>
                  {Icons.export}
                  <span>{t.export?.title || 'Export'}</span>
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* 导出配置弹窗 */}
      {exportModalOpen && (
        <div className="export-overlay" onClick={() => setExportModalOpen(false)}>
          <div className="export-dialog" onClick={(e) => e.stopPropagation()}>
            {/* 格式切换 */}
            <div className="export-tabs">
              <button
                className={`export-tab ${format === 'pdf' ? 'active' : ''}`}
                onClick={() => setFormat('pdf')}
              >
                PDF
              </button>
              <button
                className={`export-tab ${format === 'markdown' ? 'active' : ''}`}
                onClick={() => setFormat('markdown')}
              >
                Markdown
              </button>
            </div>

            {/* 配置项 */}
            <div className="export-options">
              {format === 'pdf' && (
                <>
                  <div className="export-row">
                    <span className="export-row-label">{t.export?.pageSize || 'Page Size'}</span>
                    <select
                      className="export-row-select"
                      value={pageSize}
                      onChange={(e) => setPageSize(e.target.value as 'A4' | 'Letter')}
                    >
                      <option value="A4">A4</option>
                      <option value="Letter">Letter</option>
                    </select>
                  </div>
                  <label className="export-row">
                    <input
                      type="checkbox"
                      checked={includeBackground}
                      onChange={(e) => setIncludeBackground(e.target.checked)}
                    />
                    <span>{t.export?.includeBackground || 'Include background'}</span>
                  </label>
                </>
              )}

              {format === 'markdown' && (
                <>
                  <label className="export-row">
                    <input
                      type="checkbox"
                      checked={includeAttachments}
                      onChange={(e) => setIncludeAttachments(e.target.checked)}
                    />
                    <span>{t.export?.includeAttachments || 'Copy attachments'}</span>
                  </label>
                  <label className="export-row">
                    <input
                      type="checkbox"
                      checked={includeFrontMatter}
                      onChange={(e) => setIncludeFrontMatter(e.target.checked)}
                    />
                    <span>{t.export?.includeFrontMatter || 'Include Front Matter'}</span>
                  </label>
                </>
              )}
            </div>

            {/* 导出按钮 */}
            <div className="export-footer">
              <button
                className="export-submit-btn"
                onClick={handleExport}
                disabled={isExporting}
              >
                {isExporting ? (
                  <span className="export-submit-spinner" />
                ) : (
                  <>
                    {Icons.export}
                    <span>{t.export?.exportBtn || 'Export'}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .more-menu-wrapper {
          position: relative;
        }

        .more-menu-trigger {
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: none;
          background: transparent;
          border-radius: 4px;
          color: var(--color-text-tertiary, var(--color-text-secondary));
          opacity: 0.5;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .more-menu-trigger:hover {
          background: var(--color-hover);
          color: var(--color-text);
          opacity: 1;
        }

        .more-menu-trigger:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .more-menu-spinner {
          width: 14px;
          height: 14px;
          border: 2px solid var(--color-border);
          border-top-color: var(--color-text);
          border-radius: 50%;
          animation: menu-spin 0.6s linear infinite;
        }

        @keyframes menu-spin {
          to { transform: rotate(360deg); }
        }

        .more-menu-backdrop {
          position: fixed;
          inset: 0;
          z-index: 999;
          -webkit-app-region: no-drag;
        }

        .more-menu-dropdown {
          position: absolute;
          top: 100%;
          right: 0;
          margin-top: 4px;
          min-width: 120px;
          background: var(--color-card);
          border: 1px solid var(--color-border);
          border-radius: 6px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
          padding: 3px;
          z-index: 1000;
        }

        .more-menu-item {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 5px 10px;
          border: none;
          background: transparent;
          border-radius: 4px;
          font-size: 12px;
          color: var(--color-text);
          cursor: pointer;
          transition: background 0.15s ease;
          text-align: left;
        }

        .more-menu-item:hover {
          background: var(--color-hover, rgba(0, 0, 0, 0.05));
        }

        :root[data-theme="dark"] .more-menu-item:hover,
        .dark .more-menu-item:hover {
          background: var(--color-hover, rgba(255, 255, 255, 0.1));
        }

        .more-menu-item svg {
          flex-shrink: 0;
          width: 14px;
          height: 14px;
          color: var(--color-text-secondary);
        }

        .more-menu-divider {
          height: 1px;
          background: var(--color-border);
          margin: 3px 0;
        }

        .export-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
          backdrop-filter: blur(2px);
        }

        .export-dialog {
          width: 260px;
          background: var(--color-card);
          border-radius: 10px;
          box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);
          padding: 12px;
        }

        .export-tabs {
          display: flex;
          gap: 4px;
          padding: 3px;
          background: var(--color-bg);
          border-radius: 6px;
          margin-bottom: 12px;
        }

        .export-tab {
          flex: 1;
          padding: 6px 0;
          border: none;
          background: transparent;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 500;
          color: var(--color-text-secondary);
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .export-tab:hover {
          color: var(--color-text);
        }

        .export-tab.active {
          background: var(--color-card);
          color: var(--color-text);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
        }

        .export-options {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-bottom: 12px;
        }

        .export-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          font-size: 12px;
          color: var(--color-text);
          cursor: pointer;
        }

        .export-row-label {
          color: var(--color-text-secondary);
        }

        .export-row-select {
          padding: 4px 8px;
          border: 1px solid var(--color-border);
          border-radius: 4px;
          background: var(--color-bg);
          color: var(--color-text);
          font-size: 12px;
          cursor: pointer;
        }

        .export-row-select:focus {
          outline: none;
          border-color: var(--color-primary);
        }

        .export-row input[type="checkbox"] {
          width: 14px;
          height: 14px;
          margin: 0;
          cursor: pointer;
          accent-color: var(--color-primary);
        }

        .export-footer {
          display: flex;
          justify-content: flex-end;
        }

        .export-submit-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          padding: 6px 14px;
          border: none;
          background: var(--color-accent);
          border-radius: 5px;
          font-size: 12px;
          font-weight: 500;
          color: white;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .export-submit-btn:hover {
          background: var(--color-accent-hover);
        }

        .export-submit-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .export-submit-btn svg {
          width: 12px;
          height: 12px;
        }

        .export-submit-spinner {
          width: 12px;
          height: 12px;
          border: 1.5px solid currentColor;
          border-top-color: transparent;
          border-radius: 50%;
          animation: menu-spin 0.6s linear infinite;
        }

      `}</style>
    </>
  )
}
