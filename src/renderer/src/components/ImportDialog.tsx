/**
 * 导入对话框组件
 */

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../i18n'

type ImporterType = 'markdown' | 'notion' | 'obsidian'
type FolderStrategy = 'first-level' | 'flatten-path' | 'single-notebook'
type ConflictStrategy = 'skip' | 'rename' | 'overwrite'

interface ImportPreview {
  importerId: string
  importerName: string
  noteCount: number
  notebookNames: string[]
  attachmentCount: number
}

interface ImportResult {
  success: boolean
  importedNotes: Array<{ id: string; title: string }>
  skippedFiles: Array<{ path: string; reason: string }>
  errors: Array<{ path: string; error: string }>
  createdNotebooks: Array<{ id: string; name: string }>
  stats: {
    totalFiles: number
    importedNotes: number
    importedAttachments: number
    skippedFiles: number
    errorCount: number
    duration: number
  }
}

interface ImportDialogProps {
  importerType: ImporterType
  onClose: () => void
}

// 获取导入器的显示名称
function getImporterDisplayName(type: ImporterType, t: ReturnType<typeof useI18n>['t']): string {
  switch (type) {
    case 'markdown':
      return t.importExport.markdownImport
    case 'notion':
      return t.importExport.notionImport
    case 'obsidian':
      return t.importExport.obsidianImport
  }
}

// 获取选择来源的提示文字
function getSelectHint(type: ImporterType, t: ReturnType<typeof useI18n>['t']): string {
  switch (type) {
    case 'markdown':
      return t.importExport.markdownImportDesc
    case 'notion':
      return t.importExport.notionImportDesc
    case 'obsidian':
      return t.importExport.obsidianImportDesc
  }
}

export function ImportDialog({ importerType, onClose }: ImportDialogProps) {
  const { t } = useI18n()

  // 状态
  const [step, setStep] = useState<'select' | 'configure' | 'importing' | 'result'>('select')
  const [sourcePath, setSourcePath] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')

  // 配置选项
  const [folderStrategy, setFolderStrategy] = useState<FolderStrategy>('first-level')
  const [conflictStrategy, setConflictStrategy] = useState<ConflictStrategy>('skip')
  const [importAttachments, setImportAttachments] = useState(true)
  const [parseFrontMatter, setParseFrontMatter] = useState(true)

  // 笔记本列表（用于 single-notebook 策略）
  const [notebooks, setNotebooks] = useState<Array<{ id: string; name: string }>>([])
  const [targetNotebookId, setTargetNotebookId] = useState<string>('')

  // 加载笔记本列表
  useEffect(() => {
    window.electron?.notebook?.getAll().then((nbs) => {
      setNotebooks(nbs as Array<{ id: string; name: string }>)
    })
  }, [])

  // 选择来源
  const handleSelectSource = async () => {
    // 传递 importerType 作为 importerId，让 main 进程使用正确的文件选择配置
    const path = await window.electron?.importExport?.selectSource(importerType)

    if (path) {
      setSourcePath(path)
      setError('')
    }
  }

  // loading 状态
  const [loading, setLoading] = useState(false)

  // 预览并进入配置步骤
  const handleNext = async () => {
    if (!sourcePath || loading) return

    setError('')
    setLoading(true)

    try {
      const previewResult = await window.electron?.importExport?.preview({
        sourcePath,
        folderStrategy,
        tagStrategy: 'keep-nested',  // 默认保持嵌套标签
        conflictStrategy,
        importAttachments,
        parseFrontMatter,
      })

      if (!previewResult) {
        setError('Failed to preview: No result returned')
        return
      }

      setPreview(previewResult)
      setStep('configure')
    } catch (err) {
      console.error('Preview error:', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  // 执行导入
  const handleImport = async () => {
    setStep('importing')
    setError('')

    try {
      const importResult = await window.electron?.importExport?.execute({
        sourcePath,
        folderStrategy,
        targetNotebookId: folderStrategy === 'single-notebook' ? targetNotebookId : undefined,
        tagStrategy: 'keep-nested',  // 默认保持嵌套标签
        conflictStrategy,
        importAttachments,
        parseFrontMatter,
      })
      setResult(importResult)
      setStep('result')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStep('configure')
    }
  }

  // ESC 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && step !== 'importing') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, step])

  // 判断是否显示文件夹策略选项
  const showFolderStrategy = importerType !== 'notion' || (preview && preview.noteCount > 0)

  return createPortal(
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/50">
      <div className="bg-[var(--color-card)] rounded-xl shadow-xl w-[500px] max-h-[80vh] flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <h2 className="text-base font-medium text-[var(--color-text)]">
            {t.importExport.import} - {getImporterDisplayName(importerType, t)}
          </h2>
          {step !== 'importing' && (
            <button
              onClick={onClose}
              className="p-1 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
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
          )}
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* 步骤 1: 选择来源 */}
          {step === 'select' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                  {t.importExport.selectSource}
                </label>
                <p className="text-xs text-[var(--color-muted)] mb-3">
                  {getSelectHint(importerType, t)}
                  {importerType === 'notion' && (
                    <>
                      {' '}
                      <a
                        href="https://www.notion.com/help/export-your-content#export-as-markdown-&-csv"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--color-accent)] hover:underline"
                      >
                        {t.importExport.notionExportGuide}
                      </a>
                    </>
                  )}
                  {importerType === 'obsidian' && (
                    <>
                      <br />
                      <span className="text-[var(--color-muted)]">
                        {t.importExport.obsidianImportHint}
                      </span>
                    </>
                  )}
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={sourcePath}
                    readOnly
                    placeholder={t.importExport.noSourceSelected}
                    className="flex-1 px-3 py-2 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
                  />
                  <button
                    onClick={handleSelectSource}
                    className="px-4 py-2 text-sm bg-[var(--color-accent)] text-white rounded-md hover:opacity-90 transition-opacity"
                  >
                    {t.importExport.browse}
                  </button>
                </div>
              </div>

              {error && (
                <div className="p-3 text-sm text-red-500 bg-red-500/10 rounded-md">{error}</div>
              )}
            </div>
          )}

          {/* 步骤 2: 配置选项 */}
          {step === 'configure' && preview && (
            <div className="space-y-5">
              {/* 预览信息 */}
              <div className="p-3 bg-[var(--color-surface)] rounded-md text-sm">
                <div className="font-medium text-[var(--color-text)] mb-1">
                  {t.importExport.detected}: {preview.importerName}
                </div>
                <div className="text-[var(--color-muted)]">
                  {t.importExport.noteCount.replace('{n}', String(preview.noteCount))}
                  {preview.attachmentCount > 0 && (
                    <span className="ml-2">
                      {t.importExport.attachmentCount.replace(
                        '{n}',
                        String(preview.attachmentCount)
                      )}
                    </span>
                  )}
                </div>
              </div>

              {/* 文件夹处理策略 */}
              {showFolderStrategy && (
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                    {t.importExport.folderStrategy}
                  </label>
                  <div className="space-y-2">
                    <label className="flex items-start gap-2 p-2 rounded-md hover:bg-[var(--color-surface)] cursor-pointer">
                      <input
                        type="radio"
                        name="folderStrategy"
                        value="first-level"
                        checked={folderStrategy === 'first-level'}
                        onChange={(e) => setFolderStrategy(e.target.value as FolderStrategy)}
                        className="mt-0.5"
                      />
                      <div>
                        <div className="text-sm text-[var(--color-text)]">
                          {t.importExport.folderStrategyFirstLevel}
                        </div>
                        <div className="text-xs text-[var(--color-muted)]">
                          {t.importExport.folderStrategyFirstLevelDesc}
                        </div>
                      </div>
                    </label>
                    <label className="flex items-start gap-2 p-2 rounded-md hover:bg-[var(--color-surface)] cursor-pointer">
                      <input
                        type="radio"
                        name="folderStrategy"
                        value="flatten-path"
                        checked={folderStrategy === 'flatten-path'}
                        onChange={(e) => setFolderStrategy(e.target.value as FolderStrategy)}
                        className="mt-0.5"
                      />
                      <div>
                        <div className="text-sm text-[var(--color-text)]">
                          {t.importExport.folderStrategyFlattenPath}
                        </div>
                        <div className="text-xs text-[var(--color-muted)]">
                          {t.importExport.folderStrategyFlattenPathDesc}
                        </div>
                      </div>
                    </label>
                    <label className="flex items-start gap-2 p-2 rounded-md hover:bg-[var(--color-surface)] cursor-pointer">
                      <input
                        type="radio"
                        name="folderStrategy"
                        value="single-notebook"
                        checked={folderStrategy === 'single-notebook'}
                        onChange={(e) => setFolderStrategy(e.target.value as FolderStrategy)}
                        className="mt-0.5"
                      />
                      <div className="flex-1">
                        <div className="text-sm text-[var(--color-text)]">
                          {t.importExport.folderStrategySingleNotebook}
                        </div>
                        <div className="text-xs text-[var(--color-muted)]">
                          {t.importExport.folderStrategySingleNotebookDesc}
                        </div>
                        {folderStrategy === 'single-notebook' && (
                          <select
                            value={targetNotebookId}
                            onChange={(e) => setTargetNotebookId(e.target.value)}
                            className="mt-2 w-full px-2 py-1 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded"
                          >
                            <option value="">{t.importExport.selectNotebook}</option>
                            {notebooks.map((nb) => (
                              <option key={nb.id} value={nb.id}>
                                {nb.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </label>
                  </div>
                </div>
              )}

              {/* 冲突处理 */}
              <div>
                <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                  {t.importExport.conflictStrategy}
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="conflictStrategy"
                      value="skip"
                      checked={conflictStrategy === 'skip'}
                      onChange={(e) => setConflictStrategy(e.target.value as ConflictStrategy)}
                    />
                    <span className="text-sm text-[var(--color-text)]">
                      {t.importExport.conflictSkip}
                    </span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="conflictStrategy"
                      value="rename"
                      checked={conflictStrategy === 'rename'}
                      onChange={(e) => setConflictStrategy(e.target.value as ConflictStrategy)}
                    />
                    <span className="text-sm text-[var(--color-text)]">
                      {t.importExport.conflictRename}
                    </span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="conflictStrategy"
                      value="overwrite"
                      checked={conflictStrategy === 'overwrite'}
                      onChange={(e) => setConflictStrategy(e.target.value as ConflictStrategy)}
                    />
                    <span className="text-sm text-[var(--color-text)]">
                      {t.importExport.conflictOverwrite}
                    </span>
                  </label>
                </div>
              </div>

              {/* 其他选项 */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={importAttachments}
                    onChange={(e) => setImportAttachments(e.target.checked)}
                  />
                  <span className="text-sm text-[var(--color-text)]">
                    {t.importExport.importAttachments}
                  </span>
                </label>
                {/* Front Matter 选项仅对 Markdown 显示 */}
                {importerType === 'markdown' && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={parseFrontMatter}
                      onChange={(e) => setParseFrontMatter(e.target.checked)}
                    />
                    <span className="text-sm text-[var(--color-text)]">
                      {t.importExport.parseFrontMatter}
                    </span>
                  </label>
                )}
              </div>

              {error && (
                <div className="p-3 text-sm text-red-500 bg-red-500/10 rounded-md">{error}</div>
              )}
            </div>
          )}

          {/* 步骤 3: 导入中 */}
          {step === 'importing' && (
            <div className="flex flex-col items-center justify-center py-10">
              <div className="w-8 h-8 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin mb-4" />
              <div className="text-sm text-[var(--color-text)]">{t.importExport.importing}</div>
            </div>
          )}

          {/* 步骤 4: 结果 */}
          {step === 'result' && result && (
            <div className="space-y-4">
              <div
                className={`p-4 rounded-md ${result.success ? 'bg-green-500/10' : 'bg-yellow-500/10'}`}
              >
                <div
                  className={`font-medium mb-2 ${result.success ? 'text-green-600' : 'text-yellow-600'}`}
                >
                  {t.importExport.importComplete}
                </div>
                <div className="text-sm text-[var(--color-text)] space-y-1">
                  <div>
                    {t.importExport.importedNotes.replace('{n}', String(result.stats.importedNotes))}
                  </div>
                  {result.stats.skippedFiles > 0 && (
                    <div className="text-[var(--color-muted)]">
                      {t.importExport.skippedFiles.replace(
                        '{n}',
                        String(result.stats.skippedFiles)
                      )}
                    </div>
                  )}
                  {result.createdNotebooks.length > 0 && (
                    <div className="text-[var(--color-muted)]">
                      {t.importExport.createdNotebooks.replace(
                        '{n}',
                        String(result.createdNotebooks.length)
                      )}
                    </div>
                  )}
                  {result.stats.errorCount > 0 && (
                    <div className="text-red-500">
                      {t.importExport.errors.replace('{n}', String(result.stats.errorCount))}
                    </div>
                  )}
                </div>
              </div>

              {/* 错误详情 */}
              {result.errors.length > 0 && (
                <div className="max-h-40 overflow-y-auto text-xs text-[var(--color-muted)] bg-[var(--color-surface)] p-3 rounded-md">
                  {result.errors.map((err, i) => (
                    <div key={i} className="mb-1">
                      <span className="text-red-500">{err.path}:</span> {err.error}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-[var(--color-border)]">
          {step === 'select' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-surface)] rounded-md transition-colors"
              >
                {t.actions.cancel}
              </button>
              {sourcePath && (
                <button
                  onClick={handleNext}
                  disabled={loading}
                  className="px-4 py-2 text-sm bg-[var(--color-accent)] text-white rounded-md hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {loading ? '...' : t.actions.next}
                </button>
              )}
            </>
          )}
          {step === 'configure' && (
            <>
              <button
                onClick={() => setStep('select')}
                className="px-4 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-surface)] rounded-md transition-colors"
              >
                {t.actions.cancel}
              </button>
              <button
                onClick={handleImport}
                disabled={folderStrategy === 'single-notebook' && !targetNotebookId}
                className="px-4 py-2 text-sm bg-[var(--color-accent)] text-white rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t.importExport.startImport}
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
