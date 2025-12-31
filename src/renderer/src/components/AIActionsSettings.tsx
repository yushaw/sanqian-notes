/**
 * AIActionsSettings - Settings panel for managing AI actions
 *
 * Features:
 * - List all AI actions (builtin and custom)
 * - Toggle enabled/disabled
 * - Edit action properties
 * - Add new custom actions
 * - Reorder actions
 * - Reset to defaults
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { EmojiPicker } from 'frimousse'
import { useAIActionsManager } from '../hooks/useAIActions'
import { useTranslations } from '../i18n'

interface EditingAction {
  id: string | null // null for new action
  name: string
  icon: string
  prompt: string
  mode: 'replace' | 'insert' | 'popup'
  showInContextMenu: boolean
  showInSlashCommand: boolean
  showInShortcut: boolean
  shortcutKey: string
}

const DEFAULT_NEW_ACTION: EditingAction = {
  id: null,
  name: '',
  icon: '✨',
  prompt: '',
  mode: 'replace',
  showInContextMenu: true,
  showInSlashCommand: true,
  showInShortcut: true,
  shortcutKey: '',
}

export function AIActionsSettings() {
  const t = useTranslations()
  const { actions, loading, saving, createAction, updateAction, deleteAction, reorderActions, resetToDefaults } = useAIActionsManager()
  const [editingAction, setEditingAction] = useState<EditingAction | null>(null)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [isRecordingShortcut, setIsRecordingShortcut] = useState(false)
  const emojiButtonRef = useRef<HTMLButtonElement>(null)
  const emojiPickerRef = useRef<HTMLDivElement>(null)
  const [emojiPickerPosition, setEmojiPickerPosition] = useState({ top: 0, left: 0 })

  // Drag and drop state
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropPosition, setDropPosition] = useState<{ id: string; position: 'before' | 'after' } | null>(null)

  // Close emoji picker on click outside
  useEffect(() => {
    if (!showEmojiPicker) return
    const handleClick = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node) &&
          emojiButtonRef.current && !emojiButtonRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showEmojiPicker])

  // Save a single field immediately for existing actions
  // Takes actionId as parameter to avoid stale closure issues
  const saveFieldImmediately = useCallback(async (actionId: string, field: string, value: any) => {
    try {
      await updateAction(actionId, { [field]: value })
    } catch (error) {
      console.error(`Failed to save ${field}:`, error)
    }
  }, [updateAction])

  // Start editing an action
  const handleEdit = useCallback((action: AIAction) => {
    setShortcutConflict(null)
    setEditingAction({
      id: action.id,
      name: action.name,
      icon: action.icon,
      prompt: action.prompt,
      mode: action.mode,
      showInContextMenu: action.showInContextMenu,
      showInSlashCommand: action.showInSlashCommand,
      showInShortcut: action.showInShortcut,
      shortcutKey: action.shortcutKey || '',
    })
  }, [])

  // Start creating a new action
  const handleAdd = useCallback(() => {
    setShortcutConflict(null)
    setEditingAction({ ...DEFAULT_NEW_ACTION })
  }, [])

  // Save the editing action
  const handleSave = useCallback(async () => {
    if (!editingAction) return

    if (editingAction.id) {
      // Update existing
      await updateAction(editingAction.id, {
        name: editingAction.name,
        icon: editingAction.icon,
        prompt: editingAction.prompt,
        mode: editingAction.mode,
        showInContextMenu: editingAction.showInContextMenu,
        showInSlashCommand: editingAction.showInSlashCommand,
        showInShortcut: editingAction.showInShortcut,
        shortcutKey: editingAction.shortcutKey,
      })
    } else {
      // Create new
      await createAction({
        name: editingAction.name,
        icon: editingAction.icon,
        prompt: editingAction.prompt,
        mode: editingAction.mode,
        showInContextMenu: editingAction.showInContextMenu,
        showInSlashCommand: editingAction.showInSlashCommand,
        showInShortcut: editingAction.showInShortcut,
        shortcutKey: editingAction.shortcutKey,
      })
    }
    setEditingAction(null)
    setShowEmojiPicker(false)
  }, [editingAction, updateAction, createAction])

  // Cancel editing
  const handleCancel = useCallback(() => {
    setEditingAction(null)
    setShowEmojiPicker(false)
    setIsRecordingShortcut(false)
  }, [])

  // Toggle emoji picker
  const handleToggleEmojiPicker = useCallback(() => {
    if (emojiButtonRef.current) {
      const rect = emojiButtonRef.current.getBoundingClientRect()
      setEmojiPickerPosition({
        top: rect.bottom + 8,
        left: rect.left,
      })
    }
    setShowEmojiPicker(prev => !prev)
  }, [])

  // Handle emoji select
  const handleEmojiSelect = useCallback((emoji: string) => {
    if (editingAction) {
      setEditingAction({ ...editingAction, icon: emoji })
      // Save immediately for existing actions
      if (editingAction.id) {
        saveFieldImmediately(editingAction.id, 'icon', emoji)
      }
    }
    setShowEmojiPicker(false)
  }, [editingAction, saveFieldImmediately])

  // Check for shortcut key conflicts with other actions
  const [shortcutConflict, setShortcutConflict] = useState<string | null>(null)

  const checkShortcutConflict = useCallback((shortcut: string, currentActionId: string | null): string | null => {
    if (!shortcut) return null
    const conflict = actions.find(a =>
      a.shortcutKey === shortcut &&
      a.id !== currentActionId &&
      a.enabled
    )
    return conflict ? conflict.name : null
  }, [actions])

  // Handle shortcut key recording
  const handleShortcutKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isRecordingShortcut || !editingAction) return
    e.preventDefault()

    // Ignore modifier-only keys
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return

    const parts: string[] = []
    if (e.metaKey) parts.push('⌘')
    if (e.ctrlKey) parts.push('⌃')
    if (e.altKey) parts.push('⌥')
    if (e.shiftKey) parts.push('⇧')

    // Get the key
    let key = e.key.toUpperCase()
    if (key === ' ') key = 'Space'
    if (key === 'ESCAPE') {
      // ESC clears the shortcut
      setEditingAction({ ...editingAction, shortcutKey: '' })
      setShortcutConflict(null)
      setIsRecordingShortcut(false)
      // Save immediately for existing actions
      if (editingAction.id) {
        saveFieldImmediately(editingAction.id, 'shortcutKey', '')
      }
      return
    }
    parts.push(key)

    const newShortcut = parts.join('')
    const conflict = checkShortcutConflict(newShortcut, editingAction.id)
    setShortcutConflict(conflict)
    setEditingAction({ ...editingAction, shortcutKey: newShortcut })
    setIsRecordingShortcut(false)
    // Save immediately for existing actions (only if no conflict)
    if (editingAction.id && !conflict) {
      saveFieldImmediately(editingAction.id, 'shortcutKey', newShortcut)
    }
  }, [isRecordingShortcut, editingAction, checkShortcutConflict, saveFieldImmediately])

  // Toggle enabled
  const handleToggleEnabled = useCallback(async (action: AIAction) => {
    await updateAction(action.id, { enabled: !action.enabled })
  }, [updateAction])

  // Delete action
  const handleDelete = useCallback(async (id: string) => {
    await deleteAction(id)
  }, [deleteAction])

  // Reset to defaults
  const handleReset = useCallback(async () => {
    await resetToDefaults()
    setShowResetConfirm(false)
  }, [resetToDefaults])

  // Drag and drop handlers
  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    setDraggedId(id)
    e.dataTransfer.effectAllowed = 'move'
    // Add a slight delay to show the drag effect
    const target = e.currentTarget as HTMLElement
    setTimeout(() => {
      target.style.opacity = '0.4'
    }, 0)
  }, [])

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    const target = e.currentTarget as HTMLElement
    target.style.opacity = '1'
    setDraggedId(null)
    setDropPosition(null)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (id === draggedId) {
      setDropPosition(null)
      return
    }

    // Determine if cursor is in top or bottom half
    const rect = e.currentTarget.getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    const position = e.clientY < midY ? 'before' : 'after'
    setDropPosition({ id, position })
  }, [draggedId])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if leaving the container entirely
    const relatedTarget = e.relatedTarget as HTMLElement
    if (!e.currentTarget.contains(relatedTarget)) {
      setDropPosition(null)
    }
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    if (!draggedId || draggedId === targetId || !dropPosition) {
      setDraggedId(null)
      setDropPosition(null)
      return
    }

    // Reorder actions
    const currentOrder = actions.map(a => a.id)
    const draggedIndex = currentOrder.indexOf(draggedId)
    let targetIndex = currentOrder.indexOf(targetId)

    if (draggedIndex !== -1 && targetIndex !== -1) {
      // Remove dragged item
      currentOrder.splice(draggedIndex, 1)
      // Recalculate target index after removal
      targetIndex = currentOrder.indexOf(targetId)
      // Insert at correct position
      const insertIndex = dropPosition.position === 'after' ? targetIndex + 1 : targetIndex
      currentOrder.splice(insertIndex, 0, draggedId)
      await reorderActions(currentOrder)
    }

    setDraggedId(null)
    setDropPosition(null)
  }, [draggedId, dropPosition, actions, reorderActions])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-sm text-[var(--color-muted)]">{t.settings.aiActions?.loading || 'Loading...'}</div>
      </div>
    )
  }

  // Editing form
  if (editingAction) {
    return (
      <div className="space-y-4">
        {/* Header with back button */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleCancel}
            className="p-1 rounded-lg text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <h4 className="text-sm font-medium text-[var(--color-text)]">
            {editingAction.id ? (t.settings.aiActions?.editAction || 'Edit Action') : (t.settings.aiActions?.addAction || 'Add Action')}
          </h4>
        </div>

        {/* Icon */}
        <div>
          <label className="block text-xs text-[var(--color-muted)] mb-1.5">{t.settings.aiActions?.icon || 'Icon'}</label>
          <button
            ref={emojiButtonRef}
            onClick={handleToggleEmojiPicker}
            className={`w-12 h-12 rounded-xl text-2xl flex items-center justify-center transition-all
              ${showEmojiPicker
                ? 'bg-[var(--color-accent)]/20 ring-2 ring-[var(--color-accent)]'
                : 'bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10'
              }
            `}
          >
            {editingAction.icon}
          </button>
          {/* Emoji Picker */}
          {showEmojiPicker && (
            <div
              ref={emojiPickerRef}
              className="fixed z-[1100] bg-[var(--color-card)] rounded-xl shadow-xl border border-[var(--color-border)] overflow-hidden"
              style={{ top: emojiPickerPosition.top, left: emojiPickerPosition.left }}
            >
              <EmojiPicker.Root
                onEmojiSelect={(data) => handleEmojiSelect(data.emoji)}
                columns={8}
              >
                <EmojiPicker.Viewport className="h-[280px] overflow-y-auto">
                  <EmojiPicker.Loading>
                    <div className="flex items-center justify-center h-full text-[var(--color-muted)] text-sm select-none">
                      {t.emoji?.loading || 'Loading...'}
                    </div>
                  </EmojiPicker.Loading>
                  <EmojiPicker.Empty>
                    <div className="flex items-center justify-center h-full text-[var(--color-muted)] text-sm select-none">
                      {t.emoji?.noResults || 'No emoji found'}
                    </div>
                  </EmojiPicker.Empty>
                  <EmojiPicker.List
                    className="select-none p-1"
                    components={{
                      CategoryHeader: ({ category }) => (
                        <div className="text-[0.733rem] text-[var(--color-muted)] font-medium px-2 py-1.5 sticky top-0 bg-[var(--color-card)] border-b border-[var(--color-border)] select-none">
                          {category.label}
                        </div>
                      ),
                      Row: ({ children }) => (
                        <div className="flex">{children}</div>
                      ),
                      Emoji: ({ emoji: emojiData, ...props }) => (
                        <button
                          type="button"
                          {...props}
                          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-xl transition-colors"
                        >
                          {emojiData.emoji}
                        </button>
                      ),
                    }}
                  />
                </EmojiPicker.Viewport>
              </EmojiPicker.Root>
            </div>
          )}
        </div>

        {/* Name */}
        <div>
          <label className="block text-xs text-[var(--color-muted)] mb-1.5">{t.settings.aiActions?.name || 'Name'}</label>
          <input
            type="text"
            value={editingAction.name}
            onChange={(e) => setEditingAction({ ...editingAction, name: e.target.value })}
            onBlur={(e) => editingAction.id && e.target.value.trim() && saveFieldImmediately(editingAction.id, 'name', e.target.value)}
            placeholder={t.settings.aiActions?.namePlaceholder || 'Action name'}
            className="w-full px-3 py-2 text-sm rounded-lg bg-black/5 dark:bg-white/5 border border-transparent focus:border-[var(--color-accent)] outline-none transition-colors"
          />
        </div>

        {/* Prompt */}
        <div>
          <label className="block text-xs text-[var(--color-muted)] mb-1.5">{t.settings.aiActions?.prompt || 'Prompt'}</label>
          <textarea
            value={editingAction.prompt}
            onChange={(e) => setEditingAction({ ...editingAction, prompt: e.target.value })}
            onBlur={(e) => editingAction.id && e.target.value.trim() && saveFieldImmediately(editingAction.id, 'prompt', e.target.value)}
            placeholder={t.settings.aiActions?.promptPlaceholder || 'Instructions for AI...'}
            rows={5}
            className="w-full px-3 py-2 text-sm rounded-lg bg-black/5 dark:bg-white/5 border border-transparent focus:border-[var(--color-accent)] outline-none transition-colors resize-none"
          />
        </div>

        {/* Mode */}
        <div>
          <label className="block text-xs text-[var(--color-muted)] mb-1.5">{t.settings.aiActions?.mode || 'Mode'}</label>
          <div className="flex gap-1 p-1 bg-black/5 dark:bg-white/5 rounded-xl">
            {(['replace', 'insert', 'popup'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => {
                  setEditingAction({ ...editingAction, mode })
                  if (editingAction.id) saveFieldImmediately(editingAction.id, 'mode', mode)
                }}
                className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all
                  ${editingAction.mode === mode
                    ? 'bg-white dark:bg-white/15 text-[var(--color-text)] shadow-sm'
                    : 'text-[var(--color-muted)] hover:text-[var(--color-text)]'
                  }
                `}
              >
                {mode === 'replace' ? (t.settings.aiActions?.modeReplace || 'Replace') :
                 mode === 'insert' ? (t.settings.aiActions?.modeInsert || 'Insert') :
                 (t.settings.aiActions?.modePopup || 'Popup')}
              </button>
            ))}
          </div>
        </div>

        {/* Show in options */}
        <div className="space-y-2">
          <label className="block text-xs text-[var(--color-muted)] mb-1">{t.settings.aiActions?.showIn || 'Show in'}</label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={editingAction.showInContextMenu}
              onChange={(e) => {
                setEditingAction({ ...editingAction, showInContextMenu: e.target.checked })
                if (editingAction.id) saveFieldImmediately(editingAction.id, 'showInContextMenu', e.target.checked)
              }}
              className="w-4 h-4 rounded accent-[var(--color-accent)]"
            />
            <span className="text-sm text-[var(--color-text)]">{t.settings.aiActions?.contextMenu || 'Context menu'}</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={editingAction.showInSlashCommand}
              onChange={(e) => {
                setEditingAction({ ...editingAction, showInSlashCommand: e.target.checked })
                if (editingAction.id) saveFieldImmediately(editingAction.id, 'showInSlashCommand', e.target.checked)
              }}
              className="w-4 h-4 rounded accent-[var(--color-accent)]"
            />
            <span className="text-sm text-[var(--color-text)]">{t.settings.aiActions?.slashCommand || 'Slash command'}</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={editingAction.showInShortcut}
              onChange={(e) => {
                setEditingAction({ ...editingAction, showInShortcut: e.target.checked })
                if (editingAction.id) saveFieldImmediately(editingAction.id, 'showInShortcut', e.target.checked)
              }}
              className="w-4 h-4 rounded accent-[var(--color-accent)]"
            />
            <span className="text-sm text-[var(--color-text)]">{t.settings.aiActions?.shortcut || 'Shortcut panel'}</span>
          </label>
        </div>

        {/* Shortcut Key */}
        <div>
          <label className="block text-xs text-[var(--color-muted)] mb-1.5">{t.settings.aiActions?.shortcutKey || 'Shortcut Key'}</label>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsRecordingShortcut(true)}
              onKeyDown={handleShortcutKeyDown}
              onBlur={() => setIsRecordingShortcut(false)}
              className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-colors text-left
                ${isRecordingShortcut
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5'
                  : shortcutConflict
                    ? 'border-orange-500/50 bg-orange-500/5'
                    : 'border-transparent bg-black/5 dark:bg-white/5'
                }
              `}
            >
              {isRecordingShortcut ? (
                <span className="text-[var(--color-accent)]">{t.settings.aiActions?.pressKey || 'Press a key...'}</span>
              ) : editingAction.shortcutKey ? (
                <span className="font-mono">{editingAction.shortcutKey}</span>
              ) : (
                <span className="text-[var(--color-muted)]">{t.settings.aiActions?.noShortcut || 'Click to set'}</span>
              )}
            </button>
            {editingAction.shortcutKey && (
              <button
                onClick={() => {
                  setEditingAction({ ...editingAction, shortcutKey: '' })
                  setShortcutConflict(null)
                  if (editingAction.id) saveFieldImmediately(editingAction.id, 'shortcutKey', '')
                }}
                className="p-2 rounded-lg text-[var(--color-muted)] hover:text-red-500 hover:bg-red-500/10 transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
          {shortcutConflict && (
            <p className="mt-1.5 text-xs text-orange-500">
              {t.settings.aiActions?.shortcutConflict?.replace('{name}', shortcutConflict) || `Conflicts with "${shortcutConflict}"`}
            </p>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex justify-end gap-2 pt-2">
          {editingAction.id ? (
            // For existing actions, just show Done button (changes are saved automatically)
            <button
              onClick={handleCancel}
              className="px-4 py-1.5 text-sm font-medium rounded-lg bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent)]/90 transition-colors"
            >
              {t.settings.aiActions?.done || 'Done'}
            </button>
          ) : (
            // For new actions, show Cancel and Save buttons
            <>
              <button
                onClick={handleCancel}
                className="px-3 py-1.5 text-sm rounded-lg text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
              >
                {t.settings.aiActions?.cancel || 'Cancel'}
              </button>
              <button
                onClick={handleSave}
                disabled={!editingAction.name.trim() || !editingAction.prompt.trim() || saving}
                className="px-4 py-1.5 text-sm font-medium rounded-lg bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent)]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? (t.settings.aiActions?.saving || 'Saving...') : (t.settings.aiActions?.save || 'Save')}
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  // Actions list
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium text-[var(--color-text)]">{t.settings.aiActions?.title || 'AI Actions'}</h4>
          <p className="text-xs text-[var(--color-muted)] mt-0.5">{t.settings.aiActions?.description || 'Customize AI operations for selected text'}</p>
        </div>
        <button
          onClick={handleAdd}
          className="px-3 py-1.5 text-sm font-medium rounded-lg bg-[var(--color-accent)]/10 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20 transition-colors"
        >
          + {t.settings.aiActions?.add || 'Add'}
        </button>
      </div>

      {/* Actions list */}
      <div className="space-y-1">
        {actions.map((action) => (
          <div key={action.id} className="relative">
            {/* Drop indicator line - before */}
            {dropPosition?.id === action.id && dropPosition.position === 'before' && (
              <div className="absolute -top-0.5 left-0 right-0 h-0.5 bg-[var(--color-accent)] rounded-full" />
            )}

            <div
              draggable
              onDragStart={(e) => handleDragStart(e, action.id)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, action.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, action.id)}
              className={`flex items-center gap-2 p-2.5 rounded-lg transition-all cursor-grab active:cursor-grabbing ${
                action.enabled ? 'bg-black/5 dark:bg-white/5' : 'bg-black/[0.02] dark:bg-white/[0.02] opacity-60'
              }`}
            >
              {/* Drag handle */}
              <span className="text-[var(--color-muted)] flex-shrink-0 opacity-40 hover:opacity-100 transition-opacity">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="9" cy="6" r="1.5"/>
                  <circle cx="15" cy="6" r="1.5"/>
                  <circle cx="9" cy="12" r="1.5"/>
                  <circle cx="15" cy="12" r="1.5"/>
                  <circle cx="9" cy="18" r="1.5"/>
                  <circle cx="15" cy="18" r="1.5"/>
                </svg>
              </span>

              {/* Icon */}
              <span className="text-lg w-6 text-center flex-shrink-0">{action.icon}</span>

            {/* Name and badges */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-[var(--color-text)] truncate">{action.name}</span>
                {action.isBuiltin && (
                  <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-[var(--color-accent)]/10 text-[var(--color-accent)]">
                    {t.settings.aiActions?.builtin || 'Builtin'}
                  </span>
                )}
              </div>
              <div className="text-xs text-[var(--color-muted)] mt-0.5">
                {action.mode === 'replace' ? (t.settings.aiActions?.modeReplace || 'Replace') :
                 action.mode === 'insert' ? (t.settings.aiActions?.modeInsert || 'Insert') :
                 (t.settings.aiActions?.modePopup || 'Popup')}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 flex-shrink-0">
              {/* Toggle enabled */}
              <button
                onClick={() => handleToggleEnabled(action)}
                className={`p-1.5 rounded-lg transition-colors ${
                  action.enabled
                    ? 'text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10'
                    : 'text-[var(--color-muted)] hover:bg-black/5 dark:hover:bg-white/10'
                }`}
                title={action.enabled ? t.actions.disable : t.actions.enable}
              >
                {action.enabled ? (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                  </svg>
                ) : (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                  </svg>
                )}
              </button>

              {/* Edit */}
              <button
                onClick={() => handleEdit(action)}
                className="p-1.5 rounded-lg text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                title={t.actions.edit}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>

              {/* Delete (only for non-builtin) */}
              {!action.isBuiltin && (
                <button
                  onClick={() => handleDelete(action.id)}
                  className="p-1.5 rounded-lg text-[var(--color-muted)] hover:text-red-500 hover:bg-red-500/10 transition-colors"
                  title={t.actions.delete}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  </svg>
                </button>
              )}
            </div>
            </div>

            {/* Drop indicator line - after */}
            {dropPosition?.id === action.id && dropPosition.position === 'after' && (
              <div className="absolute -bottom-0.5 left-0 right-0 h-0.5 bg-[var(--color-accent)] rounded-full" />
            )}
          </div>
        ))}

        {actions.length === 0 && (
          <div className="py-8 text-center text-sm text-[var(--color-muted)]">
            {t.settings.aiActions?.empty || 'No AI actions configured'}
          </div>
        )}
      </div>

      {/* Reset to defaults */}
      <div className="pt-3 border-t border-black/5 dark:border-white/10">
        {showResetConfirm ? (
          <div className="flex items-center justify-between p-3 rounded-lg bg-red-500/10">
            <span className="text-sm text-red-600 dark:text-red-400">
              {t.settings.aiActions?.resetConfirm || 'This will remove all custom actions. Continue?'}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-2 py-1 text-xs rounded text-[var(--color-muted)] hover:text-[var(--color-text)]"
              >
                {t.settings.aiActions?.cancel || 'Cancel'}
              </button>
              <button
                onClick={handleReset}
                className="px-2 py-1 text-xs rounded bg-red-500 text-white hover:bg-red-600"
              >
                {t.settings.aiActions?.reset || 'Reset'}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowResetConfirm(true)}
            className="text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            {t.settings.aiActions?.resetToDefaults || 'Reset to defaults'}
          </button>
        )}
      </div>
    </div>
  )
}
