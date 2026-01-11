import { NodeViewWrapper, NodeViewProps } from '@tiptap/react'
import { useState, useRef, useCallback, useEffect } from 'react'
import { RefreshCw, Globe, FolderOpen, AlertTriangle, GripHorizontal, Pencil } from 'lucide-react'
import { useTranslations } from '../i18n'
import { convertToEmbedUrl, disableAutoplay } from '../utils/embedUrl'
import type { EmbedMode } from './extensions/EmbedBlock'

interface EmbedAttrs {
  mode: EmbedMode
  url: string | null
  localPath: string | null
  title: string
  height: number
  loading: boolean
  error: string | null
}

export function EmbedView({ node, updateAttributes }: NodeViewProps) {
  const attrs = node.attrs as EmbedAttrs
  const { mode, url, localPath, title, height } = attrs

  const t = useTranslations()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const refreshTimerRef = useRef<number | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  const [resizeHeight, setResizeHeight] = useState(height)
  const [isEditing, setIsEditing] = useState(false)
  const [editUrl, setEditUrl] = useState(url || '')

  // 计算显示的源地址
  const displaySource = mode === 'url' ? url : localPath

  // 计算 iframe src（视频 URL 添加 autoplay=0）
  const iframeSrc = mode === 'url' && url ? disableAutoplay(url) : localPath ? `file://${localPath}` : null

  // 处理 iframe 加载完成
  const handleLoad = useCallback(() => {
    setLoading(false)
    setError(null)
  }, [])

  // 处理 iframe 加载错误
  const handleError = useCallback(() => {
    setLoading(false)
    setError(t.embed?.loadError || 'Failed to load content')
  }, [t])

  // 刷新 iframe
  const handleRefresh = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (iframeRef.current) {
      setLoading(true)
      setError(null)
      // 重新加载 iframe
      const src = iframeRef.current.src
      iframeRef.current.src = ''
      // Clear existing timer if any
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current)
      }
      refreshTimerRef.current = window.setTimeout(() => {
        if (iframeRef.current) {
          iframeRef.current.src = src
        }
        refreshTimerRef.current = null
      }, 100)
    }
  }, [])

  // Cleanup refresh timer on unmount
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current)
      }
    }
  }, [])

  // 在新窗口打开
  const handleOpenExternal = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (mode === 'url' && url) {
      window.electron.shell.openExternal(url)
    } else if (mode === 'local' && localPath) {
      window.electron.attachment.open(localPath)
    }
  }, [mode, url, localPath])

  // 在 Finder 中显示（仅 local 模式）
  const handleShowInFolder = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (localPath) {
      window.electron.attachment.showInFolder(localPath)
    }
  }, [localPath])

  // 拖拽调整高度
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(true)

    const startY = e.clientY
    const startHeight = resizeHeight
    let currentHeight = startHeight

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientY - startY
      // Limit max height to 800px or 80% of viewport, whichever is smaller
      const maxAllowed = Math.min(800, window.innerHeight * 0.8)
      currentHeight = Math.max(200, Math.min(maxAllowed, startHeight + delta))
      setResizeHeight(currentHeight)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      updateAttributes({ height: currentHeight })
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [resizeHeight, updateAttributes])

  // 同步外部高度变化
  useEffect(() => {
    setResizeHeight(height)
  }, [height])

  // 同步外部 URL 变化
  useEffect(() => {
    setEditUrl(url || '')
  }, [url])

  // 保存编辑的 URL（自动转换为 embed 格式）
  const handleSaveUrl = useCallback(() => {
    if (editUrl.trim()) {
      // 自动补全协议
      let urlToUse = editUrl.trim()
      if (!/^https?:\/\//i.test(urlToUse)) {
        urlToUse = 'https://' + urlToUse
      }
      const convertedUrl = convertToEmbedUrl(urlToUse)
      updateAttributes({ url: convertedUrl })
      setEditUrl(convertedUrl) // 更新输入框显示转换后的 URL
      setLoading(true)
      setError(null)
    }
    setIsEditing(false)
  }, [editUrl, updateAttributes])

  // 渲染空状态（无 URL 或路径）
  if (!iframeSrc) {
    return (
      <NodeViewWrapper className="embed-block-wrapper" data-drag-handle>
        <div className="embed-block embed-block-empty">
          <div className="embed-empty-content">
            <Globe size={32} />
            <span>{t.embed?.noSource || 'No URL or file path specified'}</span>
          </div>
        </div>
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper className="embed-block-wrapper" data-drag-handle>
      <div ref={containerRef} className={`embed-block ${error ? 'has-error' : ''}`}>
        {/* 工具栏 */}
        <div className="embed-header">
          <div className="embed-header-left">
            {mode === 'url' ? (
              <Globe className="embed-icon" size={14} />
            ) : (
              <FolderOpen className="embed-icon" size={14} />
            )}
            <span className="embed-source" title={displaySource || ''}>
              {title || displaySource || (t.embed?.untitled || 'Untitled')}
            </span>
          </div>
          <div className="embed-header-right">
            <button
              className="embed-action"
              onClick={handleRefresh}
              title={t.embed?.refresh || 'Refresh'}
            >
              <RefreshCw size={14} />
            </button>
            {mode === 'local' && (
              <button
                className="embed-action"
                onClick={handleShowInFolder}
                title={t.embed?.showInFolder || 'Show in Folder'}
              >
                <FolderOpen size={14} />
              </button>
            )}
            <button
              className="embed-action"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setIsEditing(!isEditing)
              }}
              title={t.embed?.editUrl || 'Edit URL'}
            >
              <Pencil size={14} />
            </button>
          </div>
        </div>

        {/* 编辑 URL 面板 */}
        {isEditing && mode === 'url' && (
          <div className="embed-edit-panel">
            <input
              type="text"
              className="embed-edit-input"
              value={editUrl}
              onChange={(e) => setEditUrl(e.target.value)}
              onKeyDown={(e) => {
                // IME 输入法组合状态时不响应
                if (e.nativeEvent.isComposing) return
                if (e.key === 'Enter') {
                  handleSaveUrl()
                } else if (e.key === 'Escape') {
                  setEditUrl(url || '')
                  setIsEditing(false)
                }
              }}
              placeholder={t.embed?.urlPlaceholder || 'Enter URL...'}
              autoFocus
            />
            <button className="embed-edit-save" onClick={handleSaveUrl}>
              {t.common?.save || 'Save'}
            </button>
          </div>
        )}

        {/* iframe 内容区 */}
        <div className="embed-content" style={{ height: resizeHeight }}>
          {loading && (
            <div className="embed-loading">
              <div className="embed-spinner" />
              <span>{t.embed?.loading || 'Loading...'}</span>
            </div>
          )}
          {error && (
            <div className="embed-error">
              <AlertTriangle size={24} />
              <span>{error}</span>
              <div className="embed-error-actions">
                <button onClick={handleRefresh}>
                  {t.embed?.retry || 'Retry'}
                </button>
                <button onClick={handleOpenExternal}>
                  {t.embed?.openInBrowser || 'Open in Browser'}
                </button>
              </div>
            </div>
          )}
          <iframe
            ref={iframeRef}
            src={iframeSrc}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            onLoad={handleLoad}
            onError={handleError}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              display: loading || error ? 'none' : 'block',
              pointerEvents: isResizing ? 'none' : 'auto',
            }}
            title={title || displaySource || 'Embedded content'}
          />
        </div>

        {/* 拖拽调整高度的手柄 */}
        <div
          className={`embed-resize-handle ${isResizing ? 'resizing' : ''}`}
          onMouseDown={handleResizeStart}
        >
          <GripHorizontal size={16} />
          {isResizing && <span className="embed-resize-value">{resizeHeight}px</span>}
        </div>
      </div>
    </NodeViewWrapper>
  )
}
