/**
 * Popup 内容存储层
 * 使用数据库持久化 popup 数据（通过 IPC）
 * Streaming 状态仅在内存中维护
 */

export interface PopupData {
  id: string
  content: string
  prompt: string
  actionName: string
  targetText: string
  documentTitle: string
  createdAt: string
  updatedAt: string
  // Transient UI state (not persisted)
  isStreaming?: boolean
}

export interface PopupCreateParams {
  popupId: string
  prompt: string
  actionName?: string
  context: {
    targetText: string
    documentTitle?: string
  }
}

// Cache configuration
const MAX_CACHE_SIZE = 50

// In-memory cache for streaming updates and state
const streamingCache = new Map<string, string>()
const streamingState = new Map<string, boolean>()
const popupCache = new Map<string, PopupData>()
const loadingSet = new Set<string>() // Track in-flight async loads

/**
 * Enforce cache size limit (simple LRU by removing oldest entries)
 */
function enforcePopupCacheLimit(): void {
  if (popupCache.size > MAX_CACHE_SIZE) {
    // Remove oldest entries (first inserted)
    const keysToRemove = Array.from(popupCache.keys()).slice(0, popupCache.size - MAX_CACHE_SIZE)
    for (const key of keysToRemove) {
      popupCache.delete(key)
    }
  }
}

/**
 * 获取 popup 数据（异步，从数据库）
 */
export async function getPopupAsync(popupId: string): Promise<PopupData | null> {
  const dbData = await window.electron.popup.get(popupId)
  if (!dbData) return null

  // Merge with in-memory state
  const cachedContent = streamingCache.get(popupId)
  const isStreaming = streamingState.get(popupId) ?? false

  const data: PopupData = {
    ...dbData,
    content: cachedContent ?? dbData.content,
    isStreaming
  }

  popupCache.set(popupId, data)
  enforcePopupCacheLimit()
  return data
}

/**
 * 获取 popup 数据（同步，从缓存）
 * 用于需要同步访问的场景（如 React 组件中的轮询检查）
 */
export function getPopup(popupId: string): PopupData | null {
  const cached = popupCache.get(popupId)
  if (cached) {
    // Update with latest streaming cache
    const cachedContent = streamingCache.get(popupId)
    const isStreaming = streamingState.get(popupId) ?? false
    return {
      ...cached,
      content: cachedContent ?? cached.content,
      isStreaming
    }
  }

  // Trigger async load for next time (avoid duplicate requests)
  if (!loadingSet.has(popupId)) {
    loadingSet.add(popupId)
    getPopupAsync(popupId).finally(() => {
      loadingSet.delete(popupId)
    })
  }
  return null
}

/**
 * 预加载 popup 数据到缓存
 */
export async function preloadPopup(popupId: string): Promise<PopupData | null> {
  // Skip if already loading
  if (loadingSet.has(popupId)) {
    return popupCache.get(popupId) ?? null
  }
  return getPopupAsync(popupId)
}

/**
 * 创建新的 popup 数据
 */
export async function createPopup(params: PopupCreateParams): Promise<PopupData> {
  const dbData = await window.electron.popup.create({
    id: params.popupId,
    prompt: params.prompt,
    actionName: params.actionName,
    targetText: params.context.targetText,
    documentTitle: params.context.documentTitle
  })

  const data: PopupData = {
    ...dbData,
    isStreaming: false
  }

  popupCache.set(params.popupId, data)
  enforcePopupCacheLimit()
  return data
}

/**
 * 更新 popup 内容（增量更新，用于流式写入）
 * 使用内存缓存减少 IPC 调用
 */
export function updatePopupContent(popupId: string, content: string): void {
  streamingCache.set(popupId, content)
  // Update local cache
  const cached = popupCache.get(popupId)
  if (cached) {
    cached.content = content
    cached.updatedAt = new Date().toISOString()
  }
}

/**
 * 更新 popup streaming 状态（仅内存）
 */
export function updatePopupStreaming(popupId: string, isStreaming: boolean): void {
  streamingState.set(popupId, isStreaming)
  const cached = popupCache.get(popupId)
  if (cached) {
    cached.isStreaming = isStreaming
  }

  // When streaming ends, flush content to database
  if (!isStreaming) {
    flushPopupContent(popupId).catch((err) => {
      console.error('[popupStorage] Failed to flush popup content:', err)
    })
  }
}

/**
 * 刷新 streaming 缓存到数据库
 */
export async function flushPopupContent(popupId: string): Promise<boolean> {
  const content = streamingCache.get(popupId)
  if (content !== undefined) {
    streamingCache.delete(popupId)
    streamingState.delete(popupId)
    return window.electron.popup.updateContent(popupId, content)
  }
  return false
}

/**
 * 删除 popup 数据
 */
export async function deletePopup(popupId: string): Promise<boolean> {
  streamingCache.delete(popupId)
  streamingState.delete(popupId)
  popupCache.delete(popupId)
  loadingSet.delete(popupId)
  return window.electron.popup.delete(popupId)
}

/**
 * 清理过期 popup 数据
 */
export async function cleanupPopups(maxAgeDays = 30): Promise<number> {
  return window.electron.popup.cleanup(maxAgeDays)
}
