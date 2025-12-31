/**
 * Popup 内容存储层
 * 使用 localStorage 持久化 popup 数据
 */

export interface PopupData {
  popupId: string
  content: string // Markdown 内容
  prompt: string // 原始 prompt
  actionName?: string // AI 操作名称
  isStreaming?: boolean // 是否正在流式生成
  context: {
    targetText: string
    documentTitle?: string
  }
  windowState?: {
    x: number
    y: number
    width: number
    height: number
  }
  createdAt: number
  updatedAt: number
}

const STORAGE_PREFIX = 'popup:'
const POPUP_INDEX_KEY = 'popup:_index'

// 清理策略常量
const MAX_POPUP_COUNT = 50 // 最大存储数量
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 天过期

/**
 * 获取所有 popup ID 列表
 */
function getPopupIndex(): string[] {
  try {
    const index = localStorage.getItem(POPUP_INDEX_KEY)
    return index ? JSON.parse(index) : []
  } catch {
    return []
  }
}

/**
 * 更新 popup ID 索引
 */
function updatePopupIndex(ids: string[]): void {
  try {
    localStorage.setItem(POPUP_INDEX_KEY, JSON.stringify(ids))
  } catch {
    // ignore
  }
}

/**
 * 清理过期和超量的 popup 数据
 * 策略：删除超过 7 天的数据，保留最多 50 条
 */
export function cleanupPopups(): void {
  try {
    const index = getPopupIndex()
    const now = Date.now()
    const popupsWithTime: Array<{ id: string; createdAt: number }> = []

    // 收集所有 popup 的创建时间
    for (const id of index) {
      const data = getPopup(id)
      if (data) {
        // 删除过期数据
        if (now - data.createdAt > MAX_AGE_MS) {
          localStorage.removeItem(STORAGE_PREFIX + id)
        } else {
          popupsWithTime.push({ id, createdAt: data.createdAt })
        }
      } else {
        // 数据不存在，从索引中移除
        localStorage.removeItem(STORAGE_PREFIX + id)
      }
    }

    // 按创建时间降序排序（最新的在前）
    popupsWithTime.sort((a, b) => b.createdAt - a.createdAt)

    // 保留最多 MAX_POPUP_COUNT 条
    const toKeep = popupsWithTime.slice(0, MAX_POPUP_COUNT)
    const toRemove = popupsWithTime.slice(MAX_POPUP_COUNT)

    // 删除超量数据
    for (const { id } of toRemove) {
      localStorage.removeItem(STORAGE_PREFIX + id)
    }

    // 更新索引
    updatePopupIndex(toKeep.map((p) => p.id))
  } catch {
    // 静默失败
  }
}

/**
 * 保存 popup 数据
 */
export function savePopup(data: PopupData): void {
  try {
    const key = STORAGE_PREFIX + data.popupId
    localStorage.setItem(key, JSON.stringify(data))

    // 更新索引
    const index = getPopupIndex()
    if (!index.includes(data.popupId)) {
      index.push(data.popupId)
      updatePopupIndex(index)

      // 新增 popup 时触发清理检查
      if (index.length > MAX_POPUP_COUNT) {
        cleanupPopups()
      }
    }
  } catch {
    console.error('Failed to save popup data')
  }
}

/**
 * 获取 popup 数据
 */
export function getPopup(popupId: string): PopupData | null {
  try {
    const key = STORAGE_PREFIX + popupId
    const data = localStorage.getItem(key)
    return data ? JSON.parse(data) : null
  } catch {
    return null
  }
}

/**
 * 更新 popup 内容（增量更新，用于流式写入）
 */
export function updatePopupContent(popupId: string, content: string): void {
  const data = getPopup(popupId)
  if (data) {
    data.content = content
    data.updatedAt = Date.now()
    savePopup(data)
  }
}

/**
 * 更新 popup streaming 状态
 */
export function updatePopupStreaming(popupId: string, isStreaming: boolean): void {
  const data = getPopup(popupId)
  if (data) {
    data.isStreaming = isStreaming
    data.updatedAt = Date.now()
    savePopup(data)
  }
}

/**
 * 更新 popup 窗口状态
 */
export function updatePopupWindowState(
  popupId: string,
  windowState: PopupData['windowState']
): void {
  const data = getPopup(popupId)
  if (data) {
    data.windowState = windowState
    data.updatedAt = Date.now()
    savePopup(data)
  }
}

/**
 * 删除 popup 数据
 */
export function deletePopup(popupId: string): void {
  try {
    const key = STORAGE_PREFIX + popupId
    localStorage.removeItem(key)

    // 更新索引
    const index = getPopupIndex()
    const newIndex = index.filter((id) => id !== popupId)
    updatePopupIndex(newIndex)
  } catch {
    console.error('Failed to delete popup data')
  }
}

/**
 * 获取所有 popup 数据
 */
export function getAllPopups(): PopupData[] {
  const index = getPopupIndex()
  const popups: PopupData[] = []

  for (const id of index) {
    const data = getPopup(id)
    if (data) {
      popups.push(data)
    }
  }

  return popups.sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * 创建新的 popup 数据
 */
export function createPopup(params: {
  popupId: string
  prompt: string
  actionName?: string
  context: PopupData['context']
}): PopupData {
  const data: PopupData = {
    popupId: params.popupId,
    content: '',
    prompt: params.prompt,
    actionName: params.actionName,
    context: params.context,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  savePopup(data)
  return data
}
