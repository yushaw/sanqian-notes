/**
 * KnowledgeBaseSettings - 知识库设置组件
 *
 * 功能：
 * - 开启/关闭知识库
 * - 选择 Embedding 模型预设
 * - 配置 API Key
 * - 测试连接
 * - 查看索引状态
 * - 重建索引
 * - 清空索引
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslations } from '../i18n'

// Embedding 配置类型（与后端 types.ts 保持一致）
interface EmbeddingConfig {
  enabled: boolean
  source: 'sanqian' | 'custom'
  apiType: 'openai' | 'zhipu' | 'local' | 'custom'
  apiUrl: string
  apiKey: string
  modelName: string
  dimensions: number
}

// 索引统计类型
interface IndexStats {
  totalChunks: number
  totalEmbeddings: number
  indexedNotes: number
  pendingNotes: number
  errorNotes: number
  lastIndexedTime: string | null
}

// 队列状态类型
interface QueueStatus {
  pending: number
  queue: number
  processing: boolean
}

// 索引进度类型
interface IndexingProgress {
  type: 'start' | 'progress' | 'complete' | 'error'
  total?: number
  current?: number
  noteId?: string
  error?: string
}

// 预设配置
interface PresetConfig {
  labelKey: 'openaiSmall' | 'openaiLarge' | 'zhipu' | 'custom'
  apiKeyUrl?: string
  config: Partial<EmbeddingConfig>
}

const PRESETS: Record<string, PresetConfig> = {
  'openai-small': {
    labelKey: 'openaiSmall',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    config: {
      apiType: 'openai',
      apiUrl: 'https://api.openai.com/v1/embeddings',
      modelName: 'text-embedding-3-small',
      dimensions: 1536
    }
  },
  'openai-large': {
    labelKey: 'openaiLarge',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    config: {
      apiType: 'openai',
      apiUrl: 'https://api.openai.com/v1/embeddings',
      modelName: 'text-embedding-3-large',
      dimensions: 3072
    }
  },
  zhipu: {
    labelKey: 'zhipu',
    apiKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    config: {
      apiType: 'zhipu',
      apiUrl: 'https://open.bigmodel.cn/api/paas/v4/embeddings',
      modelName: 'embedding-3',
      dimensions: 2048
    }
  },
  custom: {
    labelKey: 'custom',
    config: {
      apiType: 'custom'
    }
  }
}

export function KnowledgeBaseSettings() {
  const t = useTranslations()
  const [config, setConfig] = useState<EmbeddingConfig | null>(null)
  const [stats, setStats] = useState<IndexStats | null>(null)
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [selectedPreset, setSelectedPreset] = useState<string>('openai-small')
  const [rebuilding, setRebuilding] = useState(false)
  const [rebuildProgress, setRebuildProgress] = useState<{ current: number; total: number } | null>(null)
  const [sanqianConfig, setSanqianConfig] = useState<{
    available: boolean
    apiUrl?: string
    apiKey?: string // 不在 UI 显示，但保存时需要
    modelName?: string
    dimensions?: number
  } | null>(null)
  const [sanqianError, setSanqianError] = useState<'timeout' | 'not_configured' | null>(null)
  const [fetchingSanqian, setFetchingSanqian] = useState(false)
  const rebuildCheckTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  // 清理 rebuild 检查 timer
  useEffect(() => {
    return () => {
      if (rebuildCheckTimer.current) {
        clearInterval(rebuildCheckTimer.current)
      }
    }
  }, [])

  // 加载配置
  useEffect(() => {
    const loadData = async () => {
      try {
        const [configResult, statsResult, queueResult] = await Promise.all([
          window.electron.knowledgeBase.getConfig(),
          window.electron.knowledgeBase.getStats(),
          window.electron.knowledgeBase.getQueueStatus()
        ])

        // 兼容旧版本配置
        if (!configResult.source) {
          configResult.source = 'custom'
        }

        setConfig(configResult)
        setStats(statsResult)
        setQueueStatus(queueResult)

        // 根据配置确定当前预设（仅 custom 模式）
        if (configResult.source === 'custom') {
          const preset = Object.entries(PRESETS).find(
            ([, p]) => p.config.apiType === configResult.apiType && p.config.modelName === configResult.modelName
          )
          if (preset) {
            setSelectedPreset(preset[0])
          } else {
            setSelectedPreset('custom')
          }
        }

        // 如果是 sanqian 模式，尝试获取 sanqian 配置
        if (configResult.source === 'sanqian') {
          fetchSanqianConfig()
        }
      } catch (error) {
        console.error('Failed to load knowledge base config:', error)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  // 获取 Sanqian 配置
  const fetchSanqianConfig = useCallback(async () => {
    setFetchingSanqian(true)
    setSanqianError(null)
    try {
      const result = await window.electron.knowledgeBase.fetchFromSanqian()
      if (result.success && result.config.available) {
        setSanqianConfig(result.config)
        setSanqianError(null)
      } else {
        setSanqianConfig({ available: false })
        // 区分超时（版本过低）和未配置
        setSanqianError(result.error || 'not_configured')
      }
    } catch (error) {
      console.error('Failed to fetch sanqian config:', error)
      setSanqianConfig({ available: false })
      setSanqianError('timeout')
    } finally {
      setFetchingSanqian(false)
    }
  }, [])

  // 监听索引进度
  useEffect(() => {
    const cleanup = window.electron.knowledgeBase.onProgress((progress: IndexingProgress) => {
      if (progress.type === 'start') {
        setRebuilding(true)
        setRebuildProgress({ current: 0, total: progress.total || 0 })
      } else if (progress.type === 'progress') {
        // 只在有有效 total 时更新进度（indexNote 内部发送的 progress 没有 total）
        if (progress.total !== undefined && progress.total > 0) {
          setRebuildProgress({ current: progress.current || 0, total: progress.total })
        }
      } else if (progress.type === 'complete') {
        // 清理轮询 timer，避免与 complete 事件竞争
        if (rebuildCheckTimer.current) {
          clearInterval(rebuildCheckTimer.current)
          rebuildCheckTimer.current = null
        }
        setRebuilding(false)
        setRebuildProgress(null)
        // 刷新统计
        window.electron.knowledgeBase.getStats().then(setStats)
      } else if (progress.type === 'error') {
        console.error('Indexing error:', progress.error)
      }
    })
    return cleanup
  }, [])

  // 定期刷新队列状态
  useEffect(() => {
    if (!config?.enabled) return

    const interval = setInterval(async () => {
      try {
        const [statsResult, queueResult] = await Promise.all([
          window.electron.knowledgeBase.getStats(),
          window.electron.knowledgeBase.getQueueStatus()
        ])
        setStats(statsResult)
        setQueueStatus(queueResult)
      } catch (error) {
        console.error('Failed to refresh status:', error)
      }
    }, 5000) // 每 5 秒刷新

    return () => clearInterval(interval)
  }, [config?.enabled])

  // 切换预设
  const handlePresetChange = useCallback((presetKey: string) => {
    setSelectedPreset(presetKey)
    const preset = PRESETS[presetKey]
    if (preset && config) {
      setConfig({
        ...config,
        ...preset.config,
        apiKey: config.apiKey // 保留 API Key
      })
    }
    setTestResult(null)
  }, [config])

  // 更新配置字段
  const updateConfig = useCallback((updates: Partial<EmbeddingConfig>) => {
    if (config) {
      setConfig({ ...config, ...updates })
      setTestResult(null)
    }
  }, [config])

  // 测试连接
  const handleTest = useCallback(async () => {
    if (!config) return
    setTesting(true)
    setTestResult(null)

    try {
      const result = await window.electron.knowledgeBase.testAPI(config)
      if (result.success) {
        setTestResult({
          success: true,
          message: t.settings.knowledgeBase.testSuccess(result.dimensions || 0)
        })
      } else {
        setTestResult({
          success: false,
          message: result.error || t.settings.knowledgeBase.testFailed
        })
      }
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : t.common.unknownError
      })
    } finally {
      setTesting(false)
    }
  }, [config, t])

  // 重建索引（定义在 handleSave 之前，因为 handleSave 依赖它）
  const handleRebuild = useCallback(async () => {
    try {
      // 清理之前的 timer
      if (rebuildCheckTimer.current) {
        clearInterval(rebuildCheckTimer.current)
        rebuildCheckTimer.current = null
      }

      setRebuilding(true)
      const result = await window.electron.knowledgeBase.rebuildIndex()
      // 用返回的 total 初始化进度条
      setRebuildProgress({ current: 0, total: result.total || 0 })

      // 兜底：轮询检查队列状态，如果不再处理中就重置
      // 用于处理 complete 事件丢失的情况
      rebuildCheckTimer.current = setInterval(async () => {
        try {
          const status = await window.electron.knowledgeBase.getQueueStatus()
          if (!status.processing && status.queue === 0) {
            if (rebuildCheckTimer.current) {
              clearInterval(rebuildCheckTimer.current)
              rebuildCheckTimer.current = null
            }
            setRebuilding(false)
            setRebuildProgress(null)
            const newStats = await window.electron.knowledgeBase.getStats()
            setStats(newStats)
          }
        } catch {
          // 忽略错误，继续轮询
        }
      }, 1000) // 每秒检查一次
    } catch (error) {
      console.error('Failed to rebuild index:', error)
      setRebuilding(false)
      setRebuildProgress(null)
    }
  }, [])

  // 保存配置
  const handleSave = useCallback(async () => {
    if (!config) return
    setSaving(true)

    try {
      // 如果是 sanqian 模式，使用 sanqian 的配置（包括 apiKey）
      let configToSave = config
      if (config.source === 'sanqian' && sanqianConfig?.available) {
        configToSave = {
          ...config,
          apiUrl: sanqianConfig.apiUrl || '',
          apiKey: sanqianConfig.apiKey || '', // 保存从 sanqian 获取的 apiKey
          modelName: sanqianConfig.modelName || '',
          dimensions: sanqianConfig.dimensions || 1536
        }
      }

      const result = await window.electron.knowledgeBase.setConfig(configToSave)
      setConfig(configToSave)
      // 刷新统计
      const statsResult = await window.electron.knowledgeBase.getStats()
      setStats(statsResult)

      // 如果模型变更，自动触发 rebuild
      if (result.modelChanged && !result.indexCleared) {
        setTestResult({
          success: true,
          message: t.settings.knowledgeBase.modelChangedRebuild
        })
        // 自动触发 rebuild
        handleRebuild()
      } else if (result.indexCleared) {
        setTestResult({
          success: true,
          message: t.settings.knowledgeBase.dimensionsChangedWarning
        })
      }
    } catch (error) {
      console.error('Failed to save config:', error)
    } finally {
      setSaving(false)
    }
  }, [config, sanqianConfig, t, handleRebuild])

  // 切换来源
  const handleSourceChange = useCallback((newSource: 'sanqian' | 'custom') => {
    if (!config) return

    setConfig({ ...config, source: newSource })
    setTestResult(null)

    if (newSource === 'sanqian') {
      fetchSanqianConfig()
    }
  }, [config, fetchSanqianConfig])

  // 清空索引
  const handleClearIndex = useCallback(async () => {
    try {
      await window.electron.knowledgeBase.clearIndex()
      const statsResult = await window.electron.knowledgeBase.getStats()
      setStats(statsResult)
      setShowClearConfirm(false)
    } catch (error) {
      console.error('Failed to clear index:', error)
    }
  }, [])

  if (loading || !config) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="w-5 h-5 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-medium text-[var(--color-text)]">{t.settings.knowledgeBase.title}</h3>
          <p className="text-xs text-[var(--color-muted)] mt-0.5">
            {t.settings.knowledgeBase.description}
          </p>
        </div>
        {/* 开关 */}
        <button
          onClick={() => updateConfig({ enabled: !config.enabled })}
          className={`
            relative w-11 h-6 rounded-full transition-colors
            ${config.enabled ? 'bg-[var(--color-accent)]' : 'bg-black/20 dark:bg-white/20'}
          `}
        >
          <div
            className={`
              absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform
              ${config.enabled ? 'translate-x-5.5 left-0.5' : 'translate-x-0.5 left-0'}
            `}
            style={{ transform: config.enabled ? 'translateX(22px)' : 'translateX(2px)' }}
          />
        </button>
      </div>

      {config.enabled && (
        <>
          {/* 来源选择 */}
          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
              {t.settings.knowledgeBase.source}
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => handleSourceChange('sanqian')}
                className={`flex-1 px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${
                  config.source === 'sanqian'
                    ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]'
                    : 'bg-black/5 dark:bg-white/5 text-[var(--color-text)] border-black/10 dark:border-white/10 hover:bg-black/10 dark:hover:bg-white/10'
                }`}
              >
                {t.settings.knowledgeBase.sourceSanqian}
              </button>
              <button
                onClick={() => handleSourceChange('custom')}
                className={`flex-1 px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${
                  config.source === 'custom'
                    ? 'bg-[var(--color-accent)] text-white border-[var(--color-accent)]'
                    : 'bg-black/5 dark:bg-white/5 text-[var(--color-text)] border-black/10 dark:border-white/10 hover:bg-black/10 dark:hover:bg-white/10'
                }`}
              >
                {t.settings.knowledgeBase.sourceCustom}
              </button>
            </div>
          </div>

          {/* Sanqian 模式 */}
          {config.source === 'sanqian' && (
            <div className="p-4 rounded-xl bg-black/5 dark:bg-white/5">
              {fetchingSanqian ? (
                <div className="flex items-center justify-center py-4">
                  <div className="w-5 h-5 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
                  <span className="ml-2 text-sm text-[var(--color-muted)]">
                    {t.settings.knowledgeBase.fetchingSanqian}
                  </span>
                </div>
              ) : sanqianConfig?.available ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                    <span className="text-sm text-[var(--color-text)]">
                      {t.settings.knowledgeBase.sanqianConnected}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-[var(--color-muted)]">{t.settings.knowledgeBase.modelName}:</span>
                      <span className="ml-2 text-[var(--color-text)]">{sanqianConfig.modelName || '-'}</span>
                    </div>
                    <div>
                      <span className="text-[var(--color-muted)]">{t.settings.knowledgeBase.dimensions}:</span>
                      <span className="ml-2 text-[var(--color-text)]">{sanqianConfig.dimensions || '-'}</span>
                    </div>
                  </div>
                  <button
                    onClick={fetchSanqianConfig}
                    className="text-xs text-[var(--color-accent)] hover:underline"
                  >
                    {t.settings.knowledgeBase.refreshSanqian}
                  </button>
                </div>
              ) : (
                <div className="text-center py-4">
                  <div className="flex items-center justify-center gap-2 text-amber-500 mb-2">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <span className="text-sm font-medium">
                      {sanqianError === 'timeout'
                        ? t.settings.knowledgeBase.sanqianVersionTooOld
                        : t.settings.knowledgeBase.sanqianNotConfigured}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--color-muted)]">
                    {sanqianError === 'timeout'
                      ? t.settings.knowledgeBase.sanqianVersionTooOldHint
                      : t.settings.knowledgeBase.sanqianNotConfiguredHint}
                  </p>
                  {sanqianError === 'timeout' && (
                    <a
                      href="https://sanqian.io"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-block text-xs text-[var(--color-accent)] hover:underline"
                    >
                      Sanqian.io ↗
                    </a>
                  )}
                  <button
                    onClick={fetchSanqianConfig}
                    className="mt-3 ml-3 text-xs text-[var(--color-accent)] hover:underline"
                  >
                    {t.settings.knowledgeBase.retryFetch}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 自定义模式 - 模型选择 */}
          {config.source === 'custom' && (
          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
              {t.settings.knowledgeBase.provider}
            </label>
            <select
              value={selectedPreset}
              onChange={(e) => handlePresetChange(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50"
            >
              {Object.entries(PRESETS).map(([key, preset]) => (
                <option key={key} value={key}>
                  {t.settings.knowledgeBase.presets[preset.labelKey]}
                </option>
              ))}
            </select>
          </div>
          )}

          {/* API Key - 仅自定义模式 */}
          {config.source === 'custom' && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-[var(--color-text)]">
                {t.settings.knowledgeBase.apiKey}
              </label>
              {PRESETS[selectedPreset]?.apiKeyUrl && (
                <a
                  href={PRESETS[selectedPreset].apiKeyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[var(--color-accent)] hover:underline"
                >
                  {t.settings.knowledgeBase.getApiKey} ↗
                </a>
              )}
            </div>
            <input
              type="password"
              value={config.apiKey}
              onChange={(e) => updateConfig({ apiKey: e.target.value })}
              placeholder={t.settings.knowledgeBase.apiKeyPlaceholder}
              className="w-full px-3 py-2 text-sm bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50"
            />
          </div>
          )}

          {/* 自定义配置 - 仅自定义模式且选择 custom 预设 */}
          {config.source === 'custom' && selectedPreset === 'custom' && (
            <>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                  {t.settings.knowledgeBase.apiUrl}
                </label>
                <input
                  type="text"
                  value={config.apiUrl}
                  onChange={(e) => updateConfig({ apiUrl: e.target.value })}
                  placeholder="https://api.example.com/v1/embeddings"
                  className="w-full px-3 py-2 text-sm bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                    {t.settings.knowledgeBase.modelName}
                  </label>
                  <input
                    type="text"
                    value={config.modelName}
                    onChange={(e) => updateConfig({ modelName: e.target.value })}
                    placeholder="text-embedding-3-small"
                    className="w-full px-3 py-2 text-sm bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
                    {t.settings.knowledgeBase.dimensions}
                  </label>
                  <input
                    type="number"
                    value={config.dimensions}
                    onChange={(e) => updateConfig({ dimensions: parseInt(e.target.value) || 1536 })}
                    placeholder="1536"
                    className="w-full px-3 py-2 text-sm bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg text-[var(--color-text)] placeholder:text-[var(--color-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50"
                  />
                </div>
              </div>
            </>
          )}

          {/* 测试连接 & 保存 */}
          <div className="flex items-center gap-3">
            {/* 自定义模式显示测试按钮 */}
            {config.source === 'custom' && (
              <button
                onClick={handleTest}
                disabled={testing || !config.apiKey}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-black/5 dark:bg-white/5 text-[var(--color-text)] hover:bg-black/10 dark:hover:bg-white/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {testing ? t.settings.knowledgeBase.testing : t.settings.knowledgeBase.testConnection}
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={saving || (config.source === 'sanqian' && !sanqianConfig?.available)}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent)]/90 transition-colors disabled:opacity-50"
            >
              {saving ? t.settings.aiActions.saving : t.actions.save}
            </button>
            {testResult && (
              <span className={`text-sm ${testResult.success ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                {testResult.message}
              </span>
            )}
          </div>

          {/* 索引状态 */}
          {stats && (
            <div className="p-4 rounded-xl bg-black/5 dark:bg-white/5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-medium text-[var(--color-text)]">
                    {t.settings.knowledgeBase.stats}
                  </h4>
                  {stats.lastIndexedTime && (
                    <span className="text-xs text-[var(--color-muted)]">
                      · {new Date(stats.lastIndexedTime).toLocaleString('zh-CN', { hour12: false })}
                    </span>
                  )}
                </div>
                {queueStatus && (queueStatus.pending > 0 || queueStatus.queue > 0) && (
                  <span className="text-xs text-[var(--color-muted)]">
                    {queueStatus.processing ? t.settings.knowledgeBase.processing : `${queueStatus.pending + queueStatus.queue} ${t.settings.knowledgeBase.waiting}`}
                  </span>
                )}
              </div>

              {/* 重建进度条 */}
              {rebuilding && rebuildProgress && (
                <div className="mb-3">
                  <div className="flex items-center justify-between text-xs text-[var(--color-muted)] mb-1">
                    <span>{t.settings.knowledgeBase.rebuilding}</span>
                    <span>{t.settings.knowledgeBase.rebuildProgress(rebuildProgress.current, rebuildProgress.total)}</span>
                  </div>
                  <div className="h-2 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[var(--color-accent)] transition-all duration-300"
                      style={{ width: `${rebuildProgress.total > 0 ? (rebuildProgress.current / rebuildProgress.total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-2xl font-semibold text-[var(--color-text)]">
                    {stats.indexedNotes}
                  </div>
                  <div className="text-xs text-[var(--color-muted)]">{t.settings.knowledgeBase.indexedNotes}</div>
                </div>
                <div>
                  <div className="text-2xl font-semibold text-[var(--color-text)]">
                    {stats.totalChunks}
                  </div>
                  <div className="text-xs text-[var(--color-muted)]">{t.settings.knowledgeBase.totalChunks}</div>
                </div>
                <div>
                  <div className="text-2xl font-semibold text-[var(--color-text)]">
                    {stats.totalEmbeddings}
                  </div>
                  <div className="text-xs text-[var(--color-muted)]">{t.settings.knowledgeBase.totalEmbeddings}</div>
                </div>
              </div>
            </div>
          )}

          {/* 索引操作 */}
          <div className="pt-4 border-t border-black/5 dark:border-white/10 flex items-center justify-between">
            <button
              onClick={handleRebuild}
              disabled={rebuilding}
              className="text-sm text-[var(--color-accent)] hover:text-[var(--color-accent)]/80 transition-colors disabled:opacity-50"
            >
              {rebuilding ? t.settings.knowledgeBase.rebuilding : t.settings.knowledgeBase.rebuildIndex}
            </button>

            {!showClearConfirm ? (
              <button
                onClick={() => setShowClearConfirm(true)}
                className="text-sm text-red-500 hover:text-red-600 transition-colors"
              >
                {t.settings.knowledgeBase.clearIndex}
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm text-red-500">{t.settings.knowledgeBase.clearConfirm}</span>
                <button
                  onClick={handleClearIndex}
                  className="px-2 py-1 text-xs font-medium rounded bg-red-500 text-white hover:bg-red-600 transition-colors"
                >
                  {t.actions.delete}
                </button>
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="px-2 py-1 text-xs font-medium rounded bg-black/5 dark:bg-white/5 text-[var(--color-text)] hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                >
                  {t.actions.cancel}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
