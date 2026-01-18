/**
 * PDF 导入对话框组件
 * 支持多文件导入、服务配置、进度显示
 */

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../i18n'

interface PdfServiceInfo {
  id: string
  name: string
  description: string
  configUrl: string
  configFields: Array<{
    key: string
    label: string
    type: 'text' | 'password'
    placeholder?: string
    required: boolean
  }>
}

interface PdfImportProgress {
  stage: string
  message: string
  currentFile?: number
  totalFiles?: number
  fileName?: string
  percent?: number
}

interface PdfImportResult {
  results: Array<{
    path: string
    success: boolean
    noteId?: string
    noteTitle?: string
    imageCount?: number
    error?: string
  }>
  successCount: number
  failCount: number
}

interface PdfImportDialogProps {
  onClose: () => void
}

export function PdfImportDialog({ onClose }: PdfImportDialogProps) {
  const { t } = useI18n()

  // 服务配置
  const [services, setServices] = useState<PdfServiceInfo[]>([])
  const [activeServiceId, setActiveServiceId] = useState('textin')
  const [serviceConfig, setServiceConfig] = useState<Record<string, string>>({})
  const [rememberConfig, setRememberConfig] = useState(true)

  // 文件选择
  const [selectedFiles, setSelectedFiles] = useState<string[]>([])

  // 目标笔记本
  const [notebooks, setNotebooks] = useState<Array<{ id: string; name: string }>>([])
  const [targetNotebookId, setTargetNotebookId] = useState<string>('')

  // 选项
  const [importImages, setImportImages] = useState(true)
  const [buildEmbedding, setBuildEmbedding] = useState(false)
  const [embeddingEnabled, setEmbeddingEnabled] = useState(false)

  // 状态
  const [step, setStep] = useState<'config' | 'importing' | 'result'>('config')
  const [progress, setProgress] = useState<PdfImportProgress | null>(null)
  const [result, setResult] = useState<PdfImportResult | null>(null)
  const [error, setError] = useState('')
  const [isCancelling, setIsCancelling] = useState(false)

  // 加载服务列表和配置
  useEffect(() => {
    const loadData = async () => {
      // 加载服务列表
      const svcList = await window.electron?.pdfImport?.getServices()
      if (svcList) {
        setServices(svcList)
      }

      // 加载保存的配置
      const config = await window.electron?.pdfImport?.getConfig()
      if (config) {
        setActiveServiceId(config.activeService || 'textin')
        setRememberConfig(config.rememberConfig !== false)
        if (config.services?.[config.activeService]) {
          setServiceConfig(config.services[config.activeService])
        }
      }

      // 加载笔记本列表
      const nbs = await window.electron?.notebook?.getAll()
      if (nbs) {
        setNotebooks(nbs as Array<{ id: string; name: string }>)
      }

      // 加载 embedding 配置
      const embeddingConfig = await window.electron?.knowledgeBase?.getConfig()
      setEmbeddingEnabled(embeddingConfig?.enabled ?? false)
    }
    loadData()
  }, [])

  // 监听进度
  useEffect(() => {
    const unsubscribe = window.electron?.pdfImport?.onProgress((prog) => {
      setProgress(prog)
    })
    return () => unsubscribe?.()
  }, [])

  // 切换服务时加载对应配置
  useEffect(() => {
    const loadServiceConfig = async () => {
      const config = await window.electron?.pdfImport?.getServiceConfig(activeServiceId)
      if (config) {
        setServiceConfig(config)
      } else {
        setServiceConfig({})
      }
    }
    loadServiceConfig()
  }, [activeServiceId])

  // 获取当前服务
  const currentService = services.find((s) => s.id === activeServiceId)

  // 验证配置是否完整
  const isConfigValid = useCallback(() => {
    if (!currentService) return false
    return currentService.configFields
      .filter((f) => f.required)
      .every((f) => serviceConfig[f.key]?.trim())
  }, [currentService, serviceConfig])

  // 选择文件
  const handleSelectFiles = async () => {
    const files = await window.electron?.pdfImport?.selectFiles()
    if (files && files.length > 0) {
      setSelectedFiles(files)
    }
  }

  // 移除文件
  const handleRemoveFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index))
  }

  // 开始导入
  const handleImport = async () => {
    if (!isConfigValid() || selectedFiles.length === 0) return

    // 保存配置（如果勾选了记住）
    if (rememberConfig) {
      await window.electron?.pdfImport?.setServiceConfig(activeServiceId, serviceConfig)
      await window.electron?.pdfImport?.setConfig({
        activeService: activeServiceId,
        services: { [activeServiceId]: serviceConfig },
        rememberConfig: true,
      })
    }

    setStep('importing')
    setError('')
    setProgress(null)
    setIsCancelling(false)

    try {
      const importResult = await window.electron?.pdfImport?.import({
        pdfPaths: selectedFiles,
        serviceId: activeServiceId,
        serviceConfig,
        targetNotebookId: targetNotebookId || undefined,
        importImages,
        buildEmbedding,
      })

      if (importResult) {
        setResult(importResult)
        setStep('result')
      } else {
        throw new Error('Import failed: no result returned')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStep('config')
    }
  }

  // 取消导入
  const handleCancel = useCallback(async () => {
    if (isCancelling) return
    setIsCancelling(true)
    await window.electron?.pdfImport?.cancel()
    // The import promise will resolve/reject and handle the state change
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

  // 获取文件名（兼容 Windows 和 Unix 路径）
  const getFileName = (path: string) => path.split(/[/\\]/).pop() || path

  return createPortal(
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/50">
      <div className="bg-[var(--color-card)] rounded-xl shadow-xl w-[520px] max-h-[85vh] flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <h2 className="text-base font-medium text-[var(--color-text)]">
            {t.pdfImport?.title || 'Import PDF'}
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
          {/* 配置界面 */}
          {step === 'config' && (
            <div className="space-y-5">
              {/* 服务配置区 */}
              <div className="p-4 bg-[var(--color-surface)] rounded-lg">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-[var(--color-text)]">
                    {t.pdfImport?.parseService || 'Parse Service'}
                  </h3>
                  {currentService && (
                    <a
                      href={currentService.configUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[var(--color-accent)] hover:underline"
                      onClick={(e) => {
                        e.preventDefault()
                        window.electron?.shell?.openExternal(currentService.configUrl)
                      }}
                    >
                      {t.pdfImport?.getApiKey || 'Get API Key'}
                    </a>
                  )}
                </div>

                {/* 服务选择（目前只有一个，但保留扩展性） */}
                {services.length > 1 && (
                  <select
                    value={activeServiceId}
                    onChange={(e) => setActiveServiceId(e.target.value)}
                    className="w-full px-3 py-2 mb-3 text-sm bg-[var(--color-card)] border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
                  >
                    {services.map((svc) => (
                      <option key={svc.id} value={svc.id}>
                        {svc.name}
                      </option>
                    ))}
                  </select>
                )}

                {/* 配置字段 */}
                {currentService && (
                  <div className="space-y-3">
                    {currentService.configFields.map((field) => (
                      <div key={field.key}>
                        <label className="block text-xs text-[var(--color-muted)] mb-1">
                          {field.label}
                          {field.required && <span className="text-red-500 ml-0.5">*</span>}
                        </label>
                        <input
                          type={field.type}
                          value={serviceConfig[field.key] || ''}
                          onChange={(e) =>
                            setServiceConfig((prev) => ({
                              ...prev,
                              [field.key]: e.target.value,
                            }))
                          }
                          placeholder={field.placeholder}
                          className="w-full px-3 py-2 text-sm bg-[var(--color-card)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] placeholder:text-[var(--color-muted)]"
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* 记住配置 */}
                <label className="flex items-center gap-2 mt-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={rememberConfig}
                    onChange={(e) => setRememberConfig(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-xs text-[var(--color-muted)]">
                    {t.pdfImport?.rememberConfig || 'Remember configuration'}
                  </span>
                </label>
              </div>

              {/* 文件选择 */}
              <div>
                <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                  {t.pdfImport?.selectFile || 'PDF Files'}
                </label>
                <div className="flex gap-2 mb-2">
                  <button
                    onClick={handleSelectFiles}
                    className="px-4 py-2 text-sm bg-[var(--color-accent)] text-white rounded-md hover:opacity-90 transition-opacity"
                  >
                    {t.pdfImport?.browse || 'Select Files'}
                  </button>
                  {selectedFiles.length > 0 && (
                    <span className="flex items-center text-sm text-[var(--color-muted)]">
                      {t.pdfImport?.filesSelected?.replace('{n}', String(selectedFiles.length)) ||
                        `${selectedFiles.length} file(s) selected`}
                    </span>
                  )}
                </div>

                {/* 文件列表 */}
                {selectedFiles.length > 0 && (
                  <div className="max-h-32 overflow-y-auto border border-[var(--color-border)] rounded-md">
                    {selectedFiles.map((file, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between px-3 py-2 hover:bg-[var(--color-surface)] border-b border-[var(--color-border)] last:border-b-0"
                      >
                        <span className="text-sm text-[var(--color-text)] truncate flex-1 mr-2">
                          {getFileName(file)}
                        </span>
                        <button
                          onClick={() => handleRemoveFile(index)}
                          className="p-1 text-[var(--color-muted)] hover:text-red-500 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 目标笔记本 */}
              <div>
                <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                  {t.pdfImport?.targetNotebook || 'Target Notebook'}
                </label>
                <select
                  value={targetNotebookId}
                  onChange={(e) => setTargetNotebookId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md text-[var(--color-text)]"
                >
                  <option value="">{t.pdfImport?.noNotebook || 'None (use default)'}</option>
                  {notebooks.map((nb) => (
                    <option key={nb.id} value={nb.id}>
                      {nb.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* 选项 */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={importImages}
                    onChange={(e) => setImportImages(e.target.checked)}
                  />
                  <span className="text-sm text-[var(--color-text)]">
                    {t.pdfImport?.importImages || 'Import images as attachments'}
                  </span>
                </label>
                {/* 向量索引选项 */}
                <div>
                  <label className={`flex items-center gap-2 ${embeddingEnabled ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                    <input
                      type="checkbox"
                      checked={buildEmbedding}
                      onChange={(e) => setBuildEmbedding(e.target.checked)}
                      disabled={!embeddingEnabled}
                    />
                    <span className={`text-sm ${embeddingEnabled ? 'text-[var(--color-text)]' : 'text-[var(--color-muted)]'}`}>
                      {t.importExport.buildEmbedding}
                    </span>
                  </label>
                  {!embeddingEnabled && (
                    <span className="text-xs text-[var(--color-muted)] ml-6">
                      {t.importExport.embeddingDisabledHint}
                    </span>
                  )}
                </div>
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
                  ? (t.pdfImport?.importCancelled || 'Cancelling...')
                  : (progress?.message || t.pdfImport?.parsing || 'Processing...')}
              </div>
              {progress?.totalFiles && progress.totalFiles > 1 && !isCancelling && (
                <div className="text-xs text-[var(--color-muted)]">
                  {progress.currentFile}/{progress.totalFiles} - {progress.fileName}
                </div>
              )}
              <p className="text-xs text-[var(--color-muted)] mt-4 text-center max-w-xs">
                {t.pdfImport?.parsingHint || 'Parsing may take 10-60 seconds depending on file size'}
              </p>
              <button
                onClick={handleCancel}
                disabled={isCancelling}
                className="mt-4 px-4 py-2 text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] rounded-md transition-colors disabled:opacity-50"
              >
                {t.pdfImport?.cancelImport || 'Cancel'}
              </button>
            </div>
          )}

          {/* 结果 */}
          {step === 'result' && result && (
            <div className="space-y-4">
              <div
                className={`p-4 rounded-md ${
                  result.failCount === 0 ? 'bg-green-500/10' : 'bg-yellow-500/10'
                }`}
              >
                <div
                  className={`font-medium mb-2 ${
                    result.failCount === 0 ? 'text-green-600' : 'text-yellow-600'
                  }`}
                >
                  {result.failCount === 0
                    ? t.pdfImport?.importSuccess || 'Import Successful!'
                    : t.pdfImport?.importPartial || 'Import Completed with Errors'}
                </div>
                <div className="text-sm text-[var(--color-text)]">
                  {t.pdfImport?.successCount?.replace('{n}', String(result.successCount)) ||
                    `${result.successCount} files imported`}
                  {result.failCount > 0 && (
                    <span className="text-red-500 ml-2">
                      {t.pdfImport?.failCount?.replace('{n}', String(result.failCount)) ||
                        `${result.failCount} failed`}
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
                      r.success ? '' : 'bg-red-500/5'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {r.success ? (
                        <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                      <span className="text-sm text-[var(--color-text)] truncate">
                        {r.noteTitle || getFileName(r.path)}
                      </span>
                      {r.success && r.imageCount !== undefined && r.imageCount > 0 && (
                        <span className="text-xs text-[var(--color-muted)]">
                          ({r.imageCount} images)
                        </span>
                      )}
                    </div>
                    {!r.success && r.error && (
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
          {step === 'config' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-surface)] rounded-md transition-colors"
              >
                {t.actions.cancel}
              </button>
              <button
                onClick={handleImport}
                disabled={!isConfigValid() || selectedFiles.length === 0}
                className="px-4 py-2 text-sm bg-[var(--color-accent)] text-white rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t.pdfImport?.startImport || 'Start Import'}
              </button>
            </>
          )}
          {step === 'result' && (
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm bg-[var(--color-accent)] text-white rounded-md hover:opacity-90 transition-opacity"
            >
              {t.pdfImport?.close || 'Done'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
