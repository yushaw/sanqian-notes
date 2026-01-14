/**
 * 编辑器更多菜单组件
 *
 * 提供导出等功能入口，后续可扩展更多操作
 */

import { useState, useEffect, useRef } from 'react'
import { useTranslations } from '../i18n'
import { toast } from '../utils/toast'
import { formatShortcut, useChatShortcut } from '../utils/shortcut'
import { TemplateSelector } from './TemplateSelector'
import type { TemplateContext } from '../utils/templateVariables'

interface ExportMenuProps {
  noteId?: string
  noteTitle?: string
  notebookName?: string
  onSplitHorizontal?: () => void
  onSplitVertical?: () => void
  onInsertContent?: (content: string) => void
  onOpenSearch?: () => void
  onOpenSettings?: (tab?: string) => void
}

type ExportFormat = 'pdf' | 'markdown'
type ImportType = 'markdown' | 'pdf' | 'arxiv'

// SVG Icons
const Icons = {
  more: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </svg>
  ),
  chat: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  close: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
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
  import: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  ),
  search: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  template: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18" />
      <path d="M9 21V9" />
    </svg>
  ),
}

export function ExportMenu({ noteId, noteTitle, notebookName, onSplitHorizontal, onSplitVertical, onInsertContent, onOpenSearch, onOpenSettings }: ExportMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [exportModalOpen, setExportModalOpen] = useState(false)
  const [templateSelectorOpen, setTemplateSelectorOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [format, setFormat] = useState<ExportFormat>('pdf')
  const menuRef = useRef<HTMLDivElement>(null)
  const arxivInputRef = useRef<HTMLInputElement>(null)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; right: number } | null>(null)
  const chatShortcut = useChatShortcut()

  // PDF 配置
  const [pageSize, setPageSize] = useState<'A4' | 'Letter'>('A4')
  const [includeBackground, setIncludeBackground] = useState(true)

  // Markdown 配置
  const [includeAttachments, setIncludeAttachments] = useState(true)
  const [includeFrontMatter, setIncludeFrontMatter] = useState(true)

  // Import 状态
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importType, setImportType] = useState<ImportType>('markdown')
  const [isImporting, setIsImporting] = useState(false)
  const [arxivInput, setArxivInput] = useState('')
  const [importProgress, setImportProgress] = useState<string>('')

  const t = useTranslations()

  // 监听 PDF 导入进度
  useEffect(() => {
    const unsubscribe = window.electron?.pdfImport?.onProgress?.((progress: { message?: string }) => {
      if (progress.message) {
        setImportProgress(progress.message)
      }
    })
    return () => unsubscribe?.()
  }, [])

  // arXiv 输入框聚焦（tab 切换时也生效）
  useEffect(() => {
    if (importModalOpen && importType === 'arxiv') {
      // 延迟聚焦，确保 DOM 已渲染
      setTimeout(() => arxivInputRef.current?.focus(), 0)
    }
  }, [importModalOpen, importType])

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
        } else if (importModalOpen) {
          setImportModalOpen(false)
        } else if (menuOpen) {
          setMenuOpen(false)
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [menuOpen, exportModalOpen, importModalOpen])

  const openExportModal = () => {
    setMenuOpen(false)
    setExportModalOpen(true)
  }

  const openImportModal = () => {
    setMenuOpen(false)
    setImportModalOpen(true)
  }

  // Import handlers
  const handleImportMarkdown = async () => {
    if (!onInsertContent) return
    setIsImporting(true)

    try {
      const result = await window.electron?.importInline?.selectMarkdown()
      if (result?.content) {
        onInsertContent(result.content)
        setImportModalOpen(false)
        toast(t.export?.importSuccess || 'Import successful')
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), { type: 'error' })
    } finally {
      setIsImporting(false)
    }
  }

  const handleImportPdf = async () => {
    if (!onInsertContent) return
    setIsImporting(true)
    setImportProgress('')

    try {
      const result = await window.electron?.importInline?.selectAndParsePdf()
      if (result?.content) {
        onInsertContent(result.content)
        setImportModalOpen(false)
        toast(t.export?.importSuccess || 'Import successful')
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      if (errorMsg.includes('not configured')) {
        toast(t.export?.pdfNotConfigured || 'Please configure PDF service in Settings first', { type: 'error' })
      } else {
        toast(errorMsg, { type: 'error' })
      }
    } finally {
      setIsImporting(false)
      setImportProgress('')
    }
  }

  const handleImportArxiv = async () => {
    if (!onInsertContent || !arxivInput.trim()) return
    setIsImporting(true)

    try {
      const result = await window.electron?.importInline?.arxiv(arxivInput.trim())
      if (result) {
        onInsertContent(result.content)
        setImportModalOpen(false)
        setArxivInput('')
        toast(t.export?.importSuccess || 'Import successful')
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), { type: 'error' })
    } finally {
      setIsImporting(false)
    }
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
      toast(error instanceof Error ? error.message : String(error), { type: 'error' })
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
          onClick={(e) => {
            if (!menuOpen) {
              const rect = e.currentTarget.getBoundingClientRect()
              setDropdownPos({
                top: rect.bottom + 4,
                right: window.innerWidth - rect.right
              })
            }
            setMenuOpen(!menuOpen)
          }}
          disabled={isExporting || isImporting}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {(isExporting || isImporting) ? <span className="more-menu-spinner" /> : Icons.more}
        </button>

        {menuOpen && dropdownPos && (
          <>
            <div className="more-menu-backdrop" onClick={() => setMenuOpen(false)} />
            <div
              className="more-menu-dropdown"
              style={{ top: dropdownPos.top, right: dropdownPos.right }}
            >
              {/* Open Chat */}
              <button className="more-menu-item" onClick={() => { setMenuOpen(false); window.electron.chatWindow.toggle() }}>
                {Icons.chat}
                <span>{t.settings?.openChatTooltip || 'Open Chat'}</span>
                {chatShortcut && <span className="more-menu-shortcut">{formatShortcut(chatShortcut)}</span>}
              </button>
              {(onOpenSearch || onSplitHorizontal || onSplitVertical || onInsertContent || noteId) && <div className="more-menu-divider" />}
              {onOpenSearch && (
                <button className="more-menu-item" onClick={() => { setMenuOpen(false); onOpenSearch() }}>
                  {Icons.search}
                  <span>{t.search?.title || 'Find'}</span>
                  <span className="more-menu-shortcut">⌘F</span>
                </button>
              )}
              {onOpenSearch && (onSplitHorizontal || onSplitVertical || onInsertContent || noteId) && <div className="more-menu-divider" />}
              {onSplitHorizontal && (
                <button className="more-menu-item" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onSplitHorizontal() }}>
                  {Icons.splitHorizontal}
                  <span>{t.paneControls?.splitHorizontal || 'Split Right'}</span>
                </button>
              )}
              {onSplitVertical && (
                <button className="more-menu-item" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onSplitVertical() }}>
                  {Icons.splitVertical}
                  <span>{t.paneControls?.splitVertical || 'Split Down'}</span>
                </button>
              )}
              {(onSplitHorizontal || onSplitVertical) && (onInsertContent || noteId) && <div className="more-menu-divider" />}
              {onInsertContent && (
                <button className="more-menu-item" onClick={openImportModal}>
                  {Icons.import}
                  <span>{t.export?.import || 'Import'}</span>
                </button>
              )}
              {noteId && (
                <button className="more-menu-item" onClick={openExportModal}>
                  {Icons.export}
                  <span>{t.export?.title || 'Export'}</span>
                </button>
              )}
              {onInsertContent && (
                <>
                  <div className="more-menu-divider" />
                  <button className="more-menu-item" onClick={() => { setMenuOpen(false); setTemplateSelectorOpen(true); }}>
                    {Icons.template}
                    <span>{t.templates?.insertTemplate || 'Insert Template'}</span>
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* 导出配置弹窗 */}
      {exportModalOpen && (
        <div className="export-overlay" onClick={() => setExportModalOpen(false)}>
          <div className="export-dialog" onClick={(e) => e.stopPropagation()}>
            {/* 关闭按钮 */}
            <button className="dialog-close-btn" onClick={() => setExportModalOpen(false)}>
              {Icons.close}
            </button>
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
                    <span>{t.export?.includeBackground || 'Include background'}</span>
                    <input
                      type="checkbox"
                      checked={includeBackground}
                      onChange={(e) => setIncludeBackground(e.target.checked)}
                    />
                  </label>
                </>
              )}

              {format === 'markdown' && (
                <>
                  <label className="export-row">
                    <span>{t.export?.includeAttachments || 'Copy attachments'}</span>
                    <input
                      type="checkbox"
                      checked={includeAttachments}
                      onChange={(e) => setIncludeAttachments(e.target.checked)}
                    />
                  </label>
                  <label className="export-row">
                    <span>{t.export?.includeFrontMatter || 'Include Front Matter'}</span>
                    <input
                      type="checkbox"
                      checked={includeFrontMatter}
                      onChange={(e) => setIncludeFrontMatter(e.target.checked)}
                    />
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

      {/* 导入弹窗 */}
      {importModalOpen && (
        <div className="export-overlay" onClick={() => !isImporting && setImportModalOpen(false)}>
          <div className="export-dialog" onClick={(e) => e.stopPropagation()}>
            {/* 关闭按钮 */}
            <button
              className="dialog-close-btn"
              onClick={() => setImportModalOpen(false)}
              disabled={isImporting}
            >
              {Icons.close}
            </button>
            {/* 类型切换 */}
            <div className="export-tabs">
              <button
                className={`export-tab ${importType === 'markdown' ? 'active' : ''}`}
                onClick={() => setImportType('markdown')}
                disabled={isImporting}
              >
                Markdown
              </button>
              <button
                className={`export-tab ${importType === 'pdf' ? 'active' : ''}`}
                onClick={() => setImportType('pdf')}
                disabled={isImporting}
              >
                PDF
              </button>
              <button
                className={`export-tab ${importType === 'arxiv' ? 'active' : ''}`}
                onClick={() => setImportType('arxiv')}
                disabled={isImporting}
              >
                arXiv
              </button>
            </div>

            {/* 导入内容区 */}
            <div className="export-options import-content">
              {importType === 'markdown' && (
                <button
                  className="import-file-btn"
                  onClick={handleImportMarkdown}
                  disabled={isImporting}
                >
                  {isImporting ? (
                    <>
                      <span className="export-submit-spinner" />
                      <span>{t.export?.importing || 'Importing...'}</span>
                    </>
                  ) : (
                    t.export?.selectFile || 'Select File'
                  )}
                </button>
              )}

              {importType === 'pdf' && (
                <button
                  className="import-file-btn"
                  onClick={handleImportPdf}
                  disabled={isImporting}
                >
                  {isImporting ? (
                    <>
                      <span className="export-submit-spinner" />
                      {importProgress && <span className="import-progress-text">{importProgress}</span>}
                    </>
                  ) : (
                    t.export?.selectFile || 'Select File'
                  )}
                </button>
              )}

              {importType === 'arxiv' && (
                <div className="import-arxiv-form">
                  <input
                    ref={arxivInputRef}
                    className="import-arxiv-input"
                    type="text"
                    placeholder={t.export?.arxivPlaceholder || 'arXiv ID or URL (e.g. 2301.00001)'}
                    value={arxivInput}
                    onChange={(e) => setArxivInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && arxivInput.trim() && !isImporting) {
                        handleImportArxiv()
                      }
                    }}
                    disabled={isImporting}
                  />
                  <button
                    className="export-submit-btn"
                    onClick={handleImportArxiv}
                    disabled={isImporting || !arxivInput.trim()}
                  >
                    {isImporting ? (
                      <span className="export-submit-spinner" />
                    ) : (
                      t.export?.importBtn || 'Import'
                    )}
                  </button>
                </div>
              )}
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
          position: fixed;
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

        .more-menu-shortcut {
          margin-left: auto;
          font-size: 10px;
          color: var(--color-text-tertiary);
          opacity: 0.7;
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
          position: relative;
          width: 260px;
          background: var(--color-card);
          border-radius: 10px;
          box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);
          padding: 12px;
          overflow: visible;
        }

        .dialog-close-btn {
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
        }

        .dialog-close-btn:hover {
          background: white;
          color: var(--color-text);
          transform: scale(1.05);
        }

        .dialog-close-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        :root[data-theme="dark"] .dialog-close-btn,
        .dark .dialog-close-btn {
          background: rgba(60, 60, 60, 0.9);
        }

        :root[data-theme="dark"] .dialog-close-btn:hover,
        .dark .dialog-close-btn:hover {
          background: rgba(80, 80, 80, 1);
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

        .export-tab:disabled {
          opacity: 0.5;
          cursor: not-allowed;
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

        :root[data-theme="dark"] .export-submit-btn,
        .dark .export-submit-btn {
          background: #57534E;
          color: #FAFAF9;
        }

        :root[data-theme="dark"] .export-submit-btn:hover,
        .dark .export-submit-btn:hover {
          background: #78716C;
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

        /* Import styles */
        .import-content {
          min-height: 60px;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }

        .import-file-btn {
          width: 100%;
          padding: 10px 16px;
          border: 1px dashed var(--color-border);
          background: var(--color-bg);
          border-radius: 6px;
          font-size: 12px;
          color: var(--color-text-secondary);
          cursor: pointer;
          transition: all 0.15s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }

        .import-file-btn:hover:not(:disabled) {
          border-color: var(--color-accent);
          color: var(--color-accent);
          background: var(--color-hover);
        }

        .import-file-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .import-arxiv-form {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .import-arxiv-input {
          width: 100%;
          padding: 8px 10px;
          border: 1px solid var(--color-border);
          border-radius: 5px;
          background: var(--color-bg);
          color: var(--color-text);
          font-size: 12px;
          box-sizing: border-box;
        }

        .import-arxiv-input:focus {
          outline: none;
          border-color: var(--color-accent);
        }

        .import-arxiv-input::placeholder {
          color: var(--color-text-tertiary);
        }

        .import-arxiv-input:disabled {
          opacity: 0.5;
        }

        .import-progress-text {
          font-size: 11px;
          color: var(--color-text-secondary);
          margin-left: 4px;
        }

      `}</style>

      {/* Template Selector */}
      {templateSelectorOpen && onInsertContent && (
        <TemplateSelector
          onClose={() => setTemplateSelectorOpen(false)}
          onInsert={(content) => {
            try {
              JSON.parse(content) // Validate JSON format
              onInsertContent(content)
            } catch {
              onInsertContent(content)
            }
          }}
          context={{ title: noteTitle || '', notebookName: notebookName || '' } as TemplateContext}
          onOpenSettings={onOpenSettings ? () => onOpenSettings('templates') : undefined}
        />
      )}
    </>
  )
}
