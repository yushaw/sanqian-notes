/**
 * useAIActions Hook
 *
 * Fetches and manages AI actions from the database.
 * Used by context menu, slash commands, and shortcuts.
 */

import { useState, useEffect, useCallback } from 'react'
import { invalidateAIActionsCache } from '../components/extensions/SlashCommand'

// Custom event for AI actions change notification
const AI_ACTIONS_CHANGED_EVENT = 'ai-actions-changed'

export function notifyAIActionsChanged() {
  invalidateAIActionsCache() // 清除 SlashCommand 缓存
  window.dispatchEvent(new CustomEvent(AI_ACTIONS_CHANGED_EVENT))
}

export function useAIActions() {
  const [actions, setActions] = useState<AIAction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchActions = useCallback(async () => {
    try {
      setLoading(true)
      const data = await window.electron.aiAction.getAll()
      setActions(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch AI actions')
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch actions on mount and listen for changes
  useEffect(() => {
    fetchActions()

    // Listen for changes from other components
    const handleChange = () => {
      fetchActions()
    }
    window.addEventListener(AI_ACTIONS_CHANGED_EVENT, handleChange)

    return () => {
      window.removeEventListener(AI_ACTIONS_CHANGED_EVENT, handleChange)
    }
  }, [fetchActions])

  // Get actions filtered by context
  const getContextMenuActions = useCallback(() => {
    return actions.filter(a => a.showInContextMenu)
  }, [actions])

  const getSlashCommandActions = useCallback(() => {
    return actions.filter(a => a.showInSlashCommand)
  }, [actions])

  const getShortcutActions = useCallback(() => {
    return actions.filter(a => a.showInShortcut)
  }, [actions])

  return {
    actions,
    loading,
    error,
    refetch: fetchActions,
    getContextMenuActions,
    getSlashCommandActions,
    getShortcutActions
  }
}

/**
 * useAIActionsManager Hook
 *
 * Full CRUD for AI actions (used in settings)
 */
export function useAIActionsManager() {
  const [actions, setActions] = useState<AIAction[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const fetchActions = useCallback(async () => {
    try {
      setLoading(true)
      const data = await window.electron.aiAction.getAllIncludingDisabled()
      setActions(data)
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch all actions including disabled
  useEffect(() => {
    fetchActions()
  }, [fetchActions])

  const createAction = useCallback(async (input: AIActionInput) => {
    setSaving(true)
    try {
      const newAction = await window.electron.aiAction.create(input)
      setActions(prev => [...prev, newAction])
      notifyAIActionsChanged()
      return newAction
    } finally {
      setSaving(false)
    }
  }, [])

  const updateAction = useCallback(async (id: string, updates: Partial<AIActionInput> & { enabled?: boolean }) => {
    setSaving(true)
    try {
      const updated = await window.electron.aiAction.update(id, updates)
      if (updated) {
        setActions(prev => prev.map(a => a.id === id ? updated : a))
        notifyAIActionsChanged()
      }
      return updated
    } finally {
      setSaving(false)
    }
  }, [])

  const deleteAction = useCallback(async (id: string) => {
    setSaving(true)
    try {
      const success = await window.electron.aiAction.delete(id)
      if (success) {
        setActions(prev => prev.filter(a => a.id !== id))
        notifyAIActionsChanged()
      }
      return success
    } finally {
      setSaving(false)
    }
  }, [])

  const reorderActions = useCallback(async (orderedIds: string[]) => {
    setSaving(true)
    try {
      await window.electron.aiAction.reorder(orderedIds)
      // Re-fetch to get updated order
      await fetchActions()
      notifyAIActionsChanged()
    } finally {
      setSaving(false)
    }
  }, [fetchActions])

  const resetToDefaults = useCallback(async () => {
    setSaving(true)
    try {
      await window.electron.aiAction.reset()
      await fetchActions()
      notifyAIActionsChanged()
    } finally {
      setSaving(false)
    }
  }, [fetchActions])

  return {
    actions,
    loading,
    saving,
    refetch: fetchActions,
    createAction,
    updateAction,
    deleteAction,
    reorderActions,
    resetToDefaults
  }
}
