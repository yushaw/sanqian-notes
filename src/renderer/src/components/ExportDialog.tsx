/**
 * 导出对话框组件
 */

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../i18n'

type ExportFormat = 'markdown' | 'json'

interface ExportResult {
  success: boolean
  outputPath: string
  stats: {
    exportedNotes: number
    exportedAttachments: number
    totalSize: number
  }
  errors: Array<{ noteId: string; title: string; error: string }>
}

interface ExportDialogProps {
  onClose: () => void
}

export function ExportDialog({ onClose }: ExportDialogProps) {
  const { t } = useI18n()

  // 状态
  const [step, setStep] = useState<'configure' | 'exporting' | 'result'>('configure')
  const [result, setResult] = useState<ExportResult | null>(null)
  const [error, setError] = useState('')

  // 配置选项
  const [outputPath, setOutputPath] = useState('')
  const [format, setFormat] = useState<ExportFormat>('markdown')
  const [groupByNotebook, setGroupByNotebook] = useState(true)
  const [includeAttachments, setIncludeAttachments] = useState(true)
  const [includeFrontMatter, setIncludeFrontMatter] = useState(true)
  const [asZip, setAsZip] = useState(false)

  // 笔记统计
  const [noteCount, setNoteCount] = useState(0)

  // 加载笔记数量
  useEffect(() => {
    window.electron?.note?.getAll().then((notes) => {
      const activeNotes = (notes as Array<{ deleted_at: string | null }>).filter(n => !n.deleted_at)
      setNoteCount(activeNotes.length)
    })
  }, [])

  // 选择输出目录
  const handleSelectTarget = async () => {
    const path = await window.electron?.importExport?.selectTarget()
    if (path) {
      setOutputPath(path)
      setError('')
    }
  }

  // 执行导出
  const handleExport = async () => {
    if (!outputPath) {
      setError(t.importExport.noTargetSelected)
      return
    }

    setStep('exporting')
    setError('')

    try {
      const exportResult = await window.electron?.importExport?.export({
        noteIds: [],
        notebookIds: [],
        format,
        outputPath,
        groupByNotebook,
        includeAttachments,
        includeFrontMatter,
        asZip,
      })
      setResult(exportResult)
      setStep('result')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStep('configure')
    }
  }

  // ESC 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && step !== 'exporting') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, step])

  // 格式化文件大小
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return createPortal(
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/50">
      <div className="bg-[var(--color-card)] rounded-xl shadow-xl w-[450px] max-h-[80vh] flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <h2 className="text-base font-medium text-[var(--color-text)]">
            {t.importExport.export}
          </h2>
          {step !== 'exporting' && (
            <button
              onClick={onClose}
              className="p-1 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* 配置 */}
          {step === 'configure' && (
            <div className="space-y-5">
              {/* 导出范围 */}
              <div>
                <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                  {t.importExport.exportRange}
                </label>
                <div className="p-3 bg-[var(--color-surface)] rounded-md text-sm text-[var(--color-text)]">
                  {t.importExport.exportAll} ({noteCount})
                </div>
              </div>

              {/* 导出格式 */}
              <div>
                <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                  {t.importExport.exportFormat}
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="format"
                      value="markdown"
                      checked={format === 'markdown'}
                      onChange={(e) => setFormat(e.target.value as ExportFormat)}
                    />
                    <span className="text-sm text-[var(--color-text)]">{t.importExport.formatMarkdown}</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="format"
                      value="json"
                      checked={format === 'json'}
                      onChange={(e) => setFormat(e.target.value as ExportFormat)}
                    />
                    <span className="text-sm text-[var(--color-text)]">{t.importExport.formatJson}</span>
                  </label>
                </div>
              </div>

              {/* 选项 */}
              {format === 'markdown' && (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={groupByNotebook}
                      onChange={(e) => setGroupByNotebook(e.target.checked)}
                    />
                    <span className="text-sm text-[var(--color-text)]">{t.importExport.groupByNotebook}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeAttachments}
                      onChange={(e) => setIncludeAttachments(e.target.checked)}
                    />
                    <span className="text-sm text-[var(--color-text)]">{t.importExport.includeAttachments}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeFrontMatter}
                      onChange={(e) => setIncludeFrontMatter(e.target.checked)}
                    />
                    <span className="text-sm text-[var(--color-text)]">{t.importExport.includeFrontMatter}</span>
                  </label>
                </div>
              )}

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={asZip}
                  onChange={(e) => setAsZip(e.target.checked)}
                />
                <span className="text-sm text-[var(--color-text)]">{t.importExport.asZip}</span>
              </label>

              {/* 输出位置 */}
              <div>
                <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                  {t.importExport.outputLocation}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={outputPath}
                    readOnly
                    placeholder={t.importExport.noTargetSelected}
                    className="flex-1 px-3 py-2 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
                  />
                  <button
                    onClick={handleSelectTarget}
                    className="px-4 py-2 text-sm bg-[var(--color-accent)] text-white rounded-md hover:opacity-90 transition-opacity"
                  >
                    {t.importExport.browse}
                  </button>
                </div>
              </div>

              {error && (
                <div className="p-3 text-sm text-red-500 bg-red-500/10 rounded-md">
                  {error}
                </div>
              )}
            </div>
          )}

          {/* 导出中 */}
          {step === 'exporting' && (
            <div className="flex flex-col items-center justify-center py-10">
              <div className="w-8 h-8 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin mb-4" />
              <div className="text-sm text-[var(--color-text)]">{t.importExport.exporting}</div>
            </div>
          )}

          {/* 结果 */}
          {step === 'result' && result && (
            <div className="space-y-4">
              <div className={`p-4 rounded-md ${result.success ? 'bg-green-500/10' : 'bg-yellow-500/10'}`}>
                <div className={`font-medium mb-2 ${result.success ? 'text-green-600' : 'text-yellow-600'}`}>
                  {t.importExport.exportComplete}
                </div>
                <div className="text-sm text-[var(--color-text)] space-y-1">
                  <div>{t.importExport.exportedNotes.replace('{n}', String(result.stats.exportedNotes))}</div>
                  {result.stats.exportedAttachments > 0 && (
                    <div className="text-[var(--color-muted)]">
                      {t.importExport.attachmentCount.replace('{n}', String(result.stats.exportedAttachments))}
                    </div>
                  )}
                  <div className="text-[var(--color-muted)]">
                    {formatSize(result.stats.totalSize)}
                  </div>
                </div>
              </div>

              {/* 输出路径 */}
              <div className="text-xs text-[var(--color-muted)] bg-[var(--color-surface)] p-3 rounded-md font-mono break-all">
                {result.outputPath}
              </div>

              {/* 错误详情 */}
              {result.errors.length > 0 && (
                <div className="max-h-40 overflow-y-auto text-xs text-[var(--color-muted)] bg-[var(--color-surface)] p-3 rounded-md">
                  {result.errors.map((err, i) => (
                    <div key={i} className="mb-1">
                      <span className="text-red-500">{err.title}:</span> {err.error}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-[var(--color-border)]">
          {step === 'configure' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-surface)] rounded-md transition-colors"
              >
                {t.actions.cancel}
              </button>
              <button
                onClick={handleExport}
                disabled={!outputPath}
                className="px-4 py-2 text-sm bg-[var(--color-accent)] text-white rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t.importExport.startExport}
              </button>
            </>
          )}
          {step === 'result' && (
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm bg-[var(--color-accent)] text-white rounded-md hover:opacity-90 transition-opacity"
            >
              {t.importExport.close}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
