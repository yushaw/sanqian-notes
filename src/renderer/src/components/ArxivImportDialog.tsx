/**
 * arXiv 导入对话框组件
 * 支持输入 arXiv ID 或 URL，批量导入论文
 */

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../i18n'

interface ArxivProgress {
  current: number
  total: number
  currentPaper: {
    paperId: string
    stage: string
    message: string
    percent: number
  }
}

interface ArxivResult {
  success: boolean
  imported: number
  failed: number
  results: Array<{
    input: string
    noteId?: string
    title?: string
    error?: string
    source: 'html' | 'pdf'
  }>
}

interface ArxivImportDialogProps {
  onClose: () => void
}

export function ArxivImportDialog({ onClose }: ArxivImportDialogProps) {
  const { t } = useI18n()

  // 输入
  const [inputText, setInputText] = useState('')
  const [validatedInputs, setValidatedInputs] = useState<Array<{ input: string; id: string }>>([])
  const [invalidInputs, setInvalidInputs] = useState<string[]>([])

  // 目标笔记本
  const [notebooks, setNotebooks] = useState<Array<{ id: string; name: string }>>([])
  const [targetNotebookId, setTargetNotebookId] = useState<string>('')

  // 选项
  const [includeAbstract, setIncludeAbstract] = useState(true)
  const [includeReferences, setIncludeReferences] = useState(false)
  const [downloadFigures, setDownloadFigures] = useState(true)
  const [preferHtml, setPreferHtml] = useState(true)

  // 状态
  const [step, setStep] = useState<'input' | 'importing' | 'result'>('input')
  const [progress, setProgress] = useState<ArxivProgress | null>(null)
  const [result, setResult] = useState<ArxivResult | null>(null)
  const [error, setError] = useState('')
  const [isCancelling, setIsCancelling] = useState(false)

  // 加载笔记本列表
  useEffect(() => {
    const loadNotebooks = async () => {
      const nbs = await window.electron?.notebook?.getAll()
      if (nbs) {
        setNotebooks(nbs as Array<{ id: string; name: string }>)
      }
    }
    loadNotebooks()
  }, [])

  // 监听进度
  useEffect(() => {
    const unsubscribe = window.electron?.arxiv?.onProgress((prog) => {
      setProgress(prog)
    })
    return () => unsubscribe?.()
  }, [])

  // 验证输入
  const validateInputs = useCallback(async () => {
    const lines = inputText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    const valid: Array<{ input: string; id: string }> = []
    const invalid: string[] = []
    const seenIds = new Set<string>()

    for (const line of lines) {
      const parsed = await window.electron?.arxiv?.parseInput(line)
      if (parsed) {
        // Dedupe by parsed ID (e.g., "1706.03762" and "https://arxiv.org/abs/1706.03762" are the same)
        if (!seenIds.has(parsed.id)) {
          seenIds.add(parsed.id)
          valid.push({ input: line, id: parsed.id })
        }
      } else {
        invalid.push(line)
      }
    }

    setValidatedInputs(valid)
    setInvalidInputs(invalid)
  }, [inputText])

  // 输入变化时验证
  useEffect(() => {
    const timer = setTimeout(() => {
      if (inputText.trim()) {
        validateInputs()
      } else {
        setValidatedInputs([])
        setInvalidInputs([])
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [inputText, validateInputs])

  // 开始导入
  const handleImport = async () => {
    if (validatedInputs.length === 0) return

    setStep('importing')
    setError('')
    setProgress(null)
    setIsCancelling(false)

    try {
      const importResult = await window.electron?.arxiv?.import({
        inputs: validatedInputs.map((v) => v.input),
        notebookId: targetNotebookId || undefined,
        includeAbstract,
        includeReferences,
        downloadFigures,
        preferHtml,
      })

      if (importResult) {
        setResult(importResult)
        setStep('result')
      } else {
        throw new Error('Import failed: no result returned')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStep('input')
    }
  }

  // 取消导入
  const handleCancel = useCallback(async () => {
    if (isCancelling) return
    setIsCancelling(true)
    await window.electron?.arxiv?.cancel()
  }, [isCancelling])

  // ESC 关闭或取消
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (step === 'importing') {
          handleCancel()
        } else {
          onClose()
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, step, handleCancel])

  // 获取阶段的中文描述
  const getStageMessage = (stage: string) => {
    const messages: Record<string, string> = {
      fetching_metadata: t.arxivImport?.stageFetchingMetadata || 'Fetching metadata...',
      fetching_html: t.arxivImport?.stageFetchingHtml || 'Fetching HTML...',
      parsing: t.arxivImport?.stageParsing || 'Parsing content...',
      downloading_images: t.arxivImport?.stageDownloadingImages || 'Downloading images...',
      converting: t.arxivImport?.stageConverting || 'Converting to note...',
      fallback_pdf: t.arxivImport?.stageFallbackPdf || 'Using PDF fallback...',
      done: t.arxivImport?.stageDone || 'Done',
    }
    return messages[stage] || stage
  }

  return createPortal(
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/50">
      <div className="bg-[var(--color-card)] rounded-xl shadow-xl w-[520px] max-h-[85vh] flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <h2 className="text-base font-medium text-[var(--color-text)]">
            {t.arxivImport?.title || 'Import from arXiv'}
          </h2>
          <button
            onClick={() => {
              if (step === 'importing') {
                handleCancel()
              } else {
                onClose()
              }
            }}
            disabled={isCancelling}
            className="p-1 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors disabled:opacity-50"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* 输入界面 */}
          {step === 'input' && (
            <div className="space-y-5">
              {/* 输入区 */}
              <div>
                <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                  {t.arxivImport?.inputLabel || 'arXiv IDs or URLs'}
                </label>
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={t.arxivImport?.inputPlaceholder || 'Enter arXiv IDs or URLs, one per line\n\nExamples:\n2301.00001\narxiv:2301.00001\nhttps://arxiv.org/abs/2301.00001'}
                  className="w-full h-32 px-3 py-2 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] placeholder:text-[var(--color-muted)] resize-none"
                />
                {/* 验证结果 */}
                {(validatedInputs.length > 0 || invalidInputs.length > 0) && (
                  <div className="mt-2 space-y-1">
                    {validatedInputs.length > 0 && (
                      <div className="text-xs text-green-600">
                        {t.arxivImport?.validCount?.replace('{n}', String(validatedInputs.length)) ||
                          `${validatedInputs.length} valid input(s)`}
                      </div>
                    )}
                    {invalidInputs.length > 0 && (
                      <div className="text-xs text-red-500">
                        {t.arxivImport?.invalidCount?.replace('{n}', String(invalidInputs.length)) ||
                          `${invalidInputs.length} invalid: ${invalidInputs.join(', ')}`}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 目标笔记本 */}
              <div>
                <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                  {t.arxivImport?.targetNotebook || 'Target Notebook'}
                </label>
                <select
                  value={targetNotebookId}
                  onChange={(e) => setTargetNotebookId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
                >
                  <option value="">{t.arxivImport?.noNotebook || 'None (use default)'}</option>
                  {notebooks.map((nb) => (
                    <option key={nb.id} value={nb.id}>
                      {nb.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* 选项 */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeAbstract}
                    onChange={(e) => setIncludeAbstract(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm text-[var(--color-text)]">
                    {t.arxivImport?.includeAbstract || 'Include abstract'}
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={downloadFigures}
                    onChange={(e) => setDownloadFigures(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm text-[var(--color-text)]">
                    {t.arxivImport?.downloadFigures || 'Download figures'}
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeReferences}
                    onChange={(e) => setIncludeReferences(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm text-[var(--color-text)]">
                    {t.arxivImport?.includeReferences || 'Include references'}
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={preferHtml}
                    onChange={(e) => setPreferHtml(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm text-[var(--color-text)]">
                    {t.arxivImport?.preferHtml || 'Prefer HTML format (falls back to PDF if unavailable)'}
                  </span>
                </label>
              </div>

              {/* 错误信息 */}
              {error && (
                <div className="p-3 text-sm text-red-500 bg-red-500/10 rounded-md">{error}</div>
              )}
            </div>
          )}

          {/* 导入中 */}
          {step === 'importing' && (
            <div className="flex flex-col items-center justify-center py-10">
              <div className="w-8 h-8 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin mb-4" />
              <div className="text-sm text-[var(--color-text)] mb-2">
                {isCancelling
                  ? (t.arxivImport?.cancelling || 'Cancelling...')
                  : progress?.currentPaper
                    ? getStageMessage(progress.currentPaper.stage)
                    : (t.arxivImport?.starting || 'Starting...')}
              </div>
              {progress && !isCancelling && (
                <>
                  <div className="text-xs text-[var(--color-muted)] mb-2">
                    {progress.currentPaper?.paperId}
                  </div>
                  {progress.total > 1 && (
                    <div className="text-xs text-[var(--color-muted)]">
                      {t.arxivImport?.progressCount
                        ?.replace('{current}', String(progress.current))
                        .replace('{total}', String(progress.total)) ||
                        `${progress.current} / ${progress.total}`}
                    </div>
                  )}
                  {/* 进度条 */}
                  <div className="w-48 h-1 bg-[var(--color-surface)] rounded-full mt-3 overflow-hidden">
                    <div
                      className="h-full bg-[var(--color-accent)] transition-all duration-300"
                      style={{ width: `${progress.currentPaper?.percent || 0}%` }}
                    />
                  </div>
                </>
              )}
              <button
                onClick={handleCancel}
                disabled={isCancelling}
                className="mt-6 px-4 py-2 text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] rounded-md transition-colors disabled:opacity-50"
              >
                {t.arxivImport?.cancel || 'Cancel'}
              </button>
            </div>
          )}

          {/* 结果 */}
          {step === 'result' && result && (
            <div className="space-y-4">
              <div
                className={`p-4 rounded-md ${
                  result.failed === 0 ? 'bg-green-500/10' : 'bg-yellow-500/10'
                }`}
              >
                <div
                  className={`font-medium mb-2 ${
                    result.failed === 0 ? 'text-green-600' : 'text-yellow-600'
                  }`}
                >
                  {result.failed === 0
                    ? (t.arxivImport?.importSuccess || 'Import Successful!')
                    : (t.arxivImport?.importPartial || 'Import Completed with Errors')}
                </div>
                <div className="text-sm text-[var(--color-text)]">
                  {t.arxivImport?.successCount?.replace('{n}', String(result.imported)) ||
                    `${result.imported} paper(s) imported`}
                  {result.failed > 0 && (
                    <span className="text-red-500 ml-2">
                      {t.arxivImport?.failCount?.replace('{n}', String(result.failed)) ||
                        `${result.failed} failed`}
                    </span>
                  )}
                </div>
              </div>

              {/* 详细结果 */}
              <div className="max-h-48 overflow-y-auto border border-[var(--color-border)] rounded-md">
                {result.results.map((r, i) => (
                  <div
                    key={i}
                    className={`px-3 py-2 border-b border-[var(--color-border)] last:border-b-0 ${
                      r.noteId ? '' : 'bg-red-500/5'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {r.noteId ? (
                        <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                      <span className="text-sm text-[var(--color-text)] truncate flex-1">
                        {r.title || r.input}
                      </span>
                      {r.noteId && (
                        <span className="text-xs text-[var(--color-muted)] flex-shrink-0">
                          {r.source === 'html' ? 'HTML' : 'PDF'}
                        </span>
                      )}
                    </div>
                    {r.error && (
                      <div className="text-xs text-red-500 mt-1 ml-6">{r.error}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-[var(--color-border)]">
          {step === 'input' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-surface)] rounded-md transition-colors"
              >
                {t.actions.cancel}
              </button>
              <button
                onClick={handleImport}
                disabled={validatedInputs.length === 0}
                className="px-4 py-2 text-sm bg-[var(--color-accent)] text-white rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t.arxivImport?.startImport || 'Start Import'}
              </button>
            </>
          )}
          {step === 'result' && (
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm bg-[var(--color-accent)] text-white rounded-md hover:opacity-90 transition-opacity"
            >
              {t.arxivImport?.done || 'Done'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
