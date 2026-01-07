/**
 * Agent Task 存储层
 * 使用数据库持久化 agent task 数据（通过 IPC）
 * 提供内存缓存以减少 IPC 调用
 */

import type { AgentTaskRecord, AgentTaskStatus, AgentMode } from '../../../shared/types'

export interface AgentTaskCache {
  id: string
  blockId: string
  status: AgentTaskStatus
  agentName: string | null
  completedAt: string | null
  durationMs: number | null
  // Transient state (not persisted)
  currentStep?: string
}

export interface AgentTaskCreateParams {
  blockId: string
  pageId: string
  notebookId?: string | null
  content: string
  additionalPrompt?: string
  agentMode?: AgentMode
  agentId?: string
  agentName?: string
}

// Cache configuration
const MAX_CACHE_SIZE = 50

// In-memory cache
const taskCache = new Map<string, AgentTaskCache>()
const blockToTaskMap = new Map<string, string>() // blockId -> taskId
const loadingSet = new Set<string>()

/**
 * Enforce cache size limit (simple LRU by removing oldest entries)
 */
function enforceCacheLimit(): void {
  if (taskCache.size > MAX_CACHE_SIZE) {
    const keysToRemove = Array.from(taskCache.keys()).slice(0, taskCache.size - MAX_CACHE_SIZE)
    for (const key of keysToRemove) {
      const task = taskCache.get(key)
      if (task) {
        blockToTaskMap.delete(task.blockId)
      }
      taskCache.delete(key)
    }
  }
}

/**
 * Convert full record to cache entry
 */
function toCache(record: AgentTaskRecord): AgentTaskCache {
  return {
    id: record.id,
    blockId: record.blockId,
    status: record.status,
    agentName: record.agentName,
    completedAt: record.completedAt,
    durationMs: record.durationMs,
  }
}

/**
 * Get task by ID (async, from database)
 */
export async function getTaskAsync(taskId: string): Promise<AgentTaskRecord | null> {
  const record = await window.electron.agentTask.get(taskId)
  if (!record) return null

  // Update cache
  taskCache.set(taskId, toCache(record))
  blockToTaskMap.set(record.blockId, taskId)
  enforceCacheLimit()

  return record
}

/**
 * Get task by ID (sync, from cache only)
 * Returns null if not in cache
 */
export function getTask(taskId: string): AgentTaskCache | null {
  const cached = taskCache.get(taskId)
  if (cached) return cached

  // Trigger async load for next time
  if (!loadingSet.has(taskId)) {
    loadingSet.add(taskId)
    getTaskAsync(taskId).finally(() => {
      loadingSet.delete(taskId)
    })
  }
  return null
}

/**
 * Get task by block ID (async, from database)
 */
export async function getTaskByBlockIdAsync(blockId: string): Promise<AgentTaskRecord | null> {
  const record = await window.electron.agentTask.getByBlockId(blockId)
  if (!record) return null

  // Update cache
  taskCache.set(record.id, toCache(record))
  blockToTaskMap.set(blockId, record.id)
  enforceCacheLimit()

  return record
}

/**
 * Get task by block ID (sync, from cache only)
 */
export function getTaskByBlockId(blockId: string): AgentTaskCache | null {
  const taskId = blockToTaskMap.get(blockId)
  if (taskId) {
    return taskCache.get(taskId) ?? null
  }

  // Trigger async load
  if (!loadingSet.has(`block:${blockId}`)) {
    loadingSet.add(`block:${blockId}`)
    getTaskByBlockIdAsync(blockId).finally(() => {
      loadingSet.delete(`block:${blockId}`)
    })
  }
  return null
}

/**
 * Preload task into cache
 */
export async function preloadTask(taskId: string): Promise<AgentTaskRecord | null> {
  if (loadingSet.has(taskId)) {
    const cached = taskCache.get(taskId)
    if (cached) {
      return getTaskAsync(taskId)
    }
    return null
  }
  return getTaskAsync(taskId)
}

/**
 * Create a new agent task
 */
export async function createTask(params: AgentTaskCreateParams): Promise<AgentTaskRecord> {
  const record = await window.electron.agentTask.create(params)

  // Update cache
  taskCache.set(record.id, toCache(record))
  blockToTaskMap.set(record.blockId, record.id)
  enforceCacheLimit()

  return record
}

/**
 * Update task status and other fields
 */
export async function updateTask(
  taskId: string,
  updates: Partial<AgentTaskRecord>
): Promise<AgentTaskRecord | null> {
  const record = await window.electron.agentTask.update(taskId, updates)
  if (!record) return null

  // Update cache
  taskCache.set(taskId, toCache(record))
  blockToTaskMap.set(record.blockId, taskId)

  return record
}

/**
 * Update task status (convenience method)
 */
export async function updateTaskStatus(
  taskId: string,
  status: AgentTaskStatus,
  additionalUpdates?: Partial<AgentTaskRecord>
): Promise<AgentTaskRecord | null> {
  return updateTask(taskId, { status, ...additionalUpdates })
}

/**
 * Update cache only (for transient state like currentStep)
 * Does not persist to database
 */
export function updateTaskCache(taskId: string, updates: Partial<AgentTaskCache>): void {
  const cached = taskCache.get(taskId)
  if (cached) {
    Object.assign(cached, updates)
  }
}

/**
 * Delete task by ID
 */
export async function deleteTask(taskId: string): Promise<boolean> {
  const cached = taskCache.get(taskId)
  if (cached) {
    blockToTaskMap.delete(cached.blockId)
  }
  taskCache.delete(taskId)
  loadingSet.delete(taskId)

  return window.electron.agentTask.delete(taskId)
}

/**
 * Delete task by block ID
 */
export async function deleteTaskByBlockId(blockId: string): Promise<boolean> {
  const taskId = blockToTaskMap.get(blockId)
  if (taskId) {
    taskCache.delete(taskId)
    loadingSet.delete(taskId)
  }
  blockToTaskMap.delete(blockId)
  loadingSet.delete(`block:${blockId}`)

  return window.electron.agentTask.deleteByBlockId(blockId)
}

/**
 * Clear all cache (useful for cleanup)
 */
export function clearCache(): void {
  taskCache.clear()
  blockToTaskMap.clear()
  loadingSet.clear()
}

/**
 * Check if a block has an associated task (sync, cache only)
 */
export function hasTask(blockId: string): boolean {
  return blockToTaskMap.has(blockId)
}

/**
 * Get all cached tasks (for debugging)
 */
export function getAllCachedTasks(): AgentTaskCache[] {
  return Array.from(taskCache.values())
}

/**
 * Initialize task cache (clear old data, prepare for new note)
 * Cache is populated lazily when decorations access tasks
 */
export async function initTaskCache(): Promise<void> {
  // Clear existing cache to prepare for new note
  clearCache()
}

/**
 * Refresh task cache by reloading all cached tasks from the database
 */
export async function refreshTaskCache(): Promise<void> {
  const taskIds = Array.from(taskCache.keys())

  // Clear loading flags and reload all cached tasks in parallel
  taskIds.forEach((taskId) => loadingSet.delete(taskId))
  await Promise.all(taskIds.map((taskId) => preloadTask(taskId)))
}

/**
 * Preload tasks by block IDs (for initial page load)
 */
export async function preloadTasksByBlockIds(blockIds: string[]): Promise<void> {
  await Promise.all(
    blockIds.map(blockId => getTaskByBlockIdAsync(blockId))
  )
}
