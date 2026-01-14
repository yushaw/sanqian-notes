/**
 * TemplateSettings - Settings panel for managing templates
 *
 * Features:
 * - List all templates with drag-and-drop reordering
 * - Create, edit, delete templates
 * - Set daily default template
 * - Template content editor using Markdown textarea
 */

import { useState, useCallback, useEffect } from 'react'
import { useTranslations } from '../i18n'
import type { Template, TemplateInput } from '../../../shared/types'
import { getTemplateVariableHelp } from '../utils/templateVariables'

interface EditingTemplate {
  id: string | null // null for new template
  name: string
  description: string
  content: string // Markdown content
  isDailyDefault: boolean
}

const DEFAULT_NEW_TEMPLATE: EditingTemplate = {
  id: null,
  name: '',
  description: '',
  content: '',
  isDailyDefault: false,
}

export function TemplateSettings() {
  const t = useTranslations()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<EditingTemplate | null>(null)

  // Drag and drop state
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropPosition, setDropPosition] = useState<{ id: string; position: 'before' | 'after' } | null>(null)

  // Delete confirmation state
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null)

  // Reset confirmation state
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  // Load templates
  const loadTemplates = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.electron?.templates?.getAll()
      setTemplates(result || [])
    } catch (error) {
      console.error('Failed to load templates:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTemplates()
  }, [loadTemplates])

  // Start editing a template
  const handleEdit = useCallback((template: Template) => {
    setEditingTemplate({
      id: template.id,
      name: template.name,
      description: template.description,
      content: template.content,
      isDailyDefault: template.isDailyDefault,
    })
  }, [])

  // Start creating a new template
  const handleAdd = useCallback(() => {
    setEditingTemplate({ ...DEFAULT_NEW_TEMPLATE })
  }, [])

  // Save the editing template
  const handleSave = useCallback(async () => {
    if (!editingTemplate || !editingTemplate.name.trim()) return

    setSaving(true)
    try {
      const input: TemplateInput = {
        name: editingTemplate.name.trim(),
        description: editingTemplate.description.trim(),
        content: editingTemplate.content,
        isDailyDefault: editingTemplate.isDailyDefault,
      }

      if (editingTemplate.id) {
        await window.electron?.templates?.update(editingTemplate.id, input)
      } else {
        await window.electron?.templates?.create(input)
      }

      await loadTemplates()
      setEditingTemplate(null)
    } catch (error) {
      console.error('Failed to save template:', error)
    } finally {
      setSaving(false)
    }
  }, [editingTemplate, loadTemplates])

  // Cancel editing
  const handleCancel = useCallback(() => {
    setEditingTemplate(null)
  }, [])

  // Delete template (show confirmation first)
  const handleDelete = useCallback((template: Template) => {
    setConfirmDelete({ id: template.id, name: template.name })
  }, [])

  // Confirm and execute delete
  const confirmDeleteTemplate = useCallback(async () => {
    if (!confirmDelete) return
    try {
      await window.electron?.templates?.delete(confirmDelete.id)
      await loadTemplates()
    } catch (error) {
      console.error('Failed to delete template:', error)
    } finally {
      setConfirmDelete(null)
    }
  }, [confirmDelete, loadTemplates])

  // Toggle daily default
  const handleToggleDailyDefault = useCallback(async (template: Template) => {
    try {
      if (template.isDailyDefault) {
        await window.electron?.templates?.setDailyDefault(null)
      } else {
        await window.electron?.templates?.setDailyDefault(template.id)
      }
      await loadTemplates()
    } catch (error) {
      console.error('Failed to toggle daily default:', error)
    }
  }, [loadTemplates])

  // Reset to defaults
  const handleReset = useCallback(async () => {
    try {
      await window.electron?.templates?.reset()
      await loadTemplates()
      setShowResetConfirm(false)
    } catch (error) {
      console.error('Failed to reset templates:', error)
    }
  }, [loadTemplates])

  // Drag and drop handlers
  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    setDraggedId(id)
    e.dataTransfer.effectAllowed = 'move'
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

  const handleDragOver = useCallback(
    (e: React.DragEvent, id: string) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (id === draggedId) {
        setDropPosition(null)
        return
      }

      const rect = e.currentTarget.getBoundingClientRect()
      const midY = rect.top + rect.height / 2
      const position = e.clientY < midY ? 'before' : 'after'
      setDropPosition({ id, position })
    },
    [draggedId]
  )

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const relatedTarget = e.relatedTarget as HTMLElement
    if (!e.currentTarget.contains(relatedTarget)) {
      setDropPosition(null)
    }
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent, targetId: string) => {
      e.preventDefault()
      if (!draggedId || draggedId === targetId || !dropPosition) {
        setDraggedId(null)
        setDropPosition(null)
        return
      }

      const currentOrder = templates.map((t) => t.id)
      const draggedIndex = currentOrder.indexOf(draggedId)
      let targetIndex = currentOrder.indexOf(targetId)

      if (draggedIndex !== -1 && targetIndex !== -1) {
        currentOrder.splice(draggedIndex, 1)
        targetIndex = currentOrder.indexOf(targetId)
        const insertIndex = dropPosition.position === 'after' ? targetIndex + 1 : targetIndex
        currentOrder.splice(insertIndex, 0, draggedId)
        await window.electron?.templates?.reorder(currentOrder)
        await loadTemplates()
      }

      setDraggedId(null)
      setDropPosition(null)
    },
    [draggedId, dropPosition, templates, loadTemplates]
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-sm text-[var(--color-muted)]">{t.templates?.loading || 'Loading...'}</div>
      </div>
    )
  }

  // Editing form
  if (editingTemplate) {
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
            {editingTemplate.id ? (t.templates?.editTemplate || 'Edit Template') : (t.templates?.addTemplate || 'New Template')}
          </h4>
        </div>

        {/* Name */}
        <div>
          <label className="block text-xs text-[var(--color-muted)] mb-1.5">{t.templates?.name || 'Name'}</label>
          <input
            type="text"
            value={editingTemplate.name}
            onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
            placeholder={t.templates?.namePlaceholder || 'Template name'}
            className="w-full px-3 py-2 text-sm rounded-lg bg-black/5 dark:bg-white/5 border border-transparent focus:border-[var(--color-accent)] outline-none transition-colors"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs text-[var(--color-muted)] mb-1.5">{t.templates?.description || 'Description'}</label>
          <input
            type="text"
            value={editingTemplate.description}
            onChange={(e) => setEditingTemplate({ ...editingTemplate, description: e.target.value })}
            placeholder={t.templates?.descriptionPlaceholder || 'Optional description'}
            className="w-full px-3 py-2 text-sm rounded-lg bg-black/5 dark:bg-white/5 border border-transparent focus:border-[var(--color-accent)] outline-none transition-colors"
          />
        </div>

        {/* Content */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs text-[var(--color-muted)]">{t.templates?.content || 'Content'}</label>
            <div className="flex items-center gap-3">
              {/* Syntax help */}
              <div className="relative group">
                <span className="text-xs text-[var(--color-accent)] cursor-help">
                  {t.templates?.syntaxHelp || 'Syntax'}
                </span>
                <div className="absolute right-0 top-full mt-2 w-72 bg-[var(--color-card)] rounded-lg shadow-xl border border-[var(--color-border)] p-3 z-50 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150">
                  {/* Markdown syntax */}
                  <h5 className="text-xs font-medium text-[var(--color-text)] mb-2">{t.templates?.markdownSyntax || 'Markdown Syntax'}</h5>
                  <div className="space-y-1.5 text-xs font-mono mb-3">
                    <div className="flex justify-between">
                      <code className="text-[var(--color-accent)]">## </code>
                      <span className="text-[var(--color-muted)] font-sans">{t.templates?.syntaxHeading || 'Heading'}</span>
                    </div>
                    <div className="flex justify-between">
                      <code className="text-[var(--color-accent)]">- </code>
                      <span className="text-[var(--color-muted)] font-sans">{t.templates?.syntaxList || 'List'}</span>
                    </div>
                    <div className="flex justify-between">
                      <code className="text-[var(--color-accent)]">[ ] </code>
                      <span className="text-[var(--color-muted)] font-sans">{t.templates?.syntaxTask || 'Task'}</span>
                    </div>
                    <div className="flex justify-between">
                      <code className="text-[var(--color-accent)]">&gt; </code>
                      <span className="text-[var(--color-muted)] font-sans">{t.templates?.syntaxQuote || 'Quote'}</span>
                    </div>
                  </div>
                  {/* Special blocks */}
                  <div className="border-t border-[var(--color-border)] pt-3">
                    <h5 className="text-xs font-medium text-[var(--color-text)] mb-2">{t.templates?.specialBlocks || 'Special Blocks'}</h5>
                    <div className="space-y-2 text-xs font-mono">
                      <div>
                        <span className="text-[var(--color-muted)] font-sans">{t.templates?.syntaxDataview || 'Dataview'}</span>
                        <pre className="mt-1 p-1.5 rounded bg-black/5 dark:bg-white/5 text-[var(--color-accent)]">```dataview{'\n'}LIST WHERE created = today{'\n'}```</pre>
                      </div>
                      <div>
                        <span className="text-[var(--color-muted)] font-sans">{t.templates?.syntaxAgent || 'Agent'}</span>
                        <pre className="mt-1 p-1.5 rounded bg-black/5 dark:bg-white/5 text-[var(--color-accent)]">```agent{'\n'}{t.templates?.agentExample || 'Your prompt here'}{'\n'}```</pre>
                      </div>
                      <div>
                        <span className="text-[var(--color-muted)] font-sans">{t.templates?.syntaxToc || 'TOC'}</span>
                        <pre className="mt-1 p-1.5 rounded bg-black/5 dark:bg-white/5 text-[var(--color-accent)]">```toc{'\n'}```</pre>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              {/* Variables help */}
              <div className="relative group">
                <span className="text-xs text-[var(--color-accent)] cursor-help">
                  {t.templates?.variableHelp || 'Variables'}
                </span>
                <div className="absolute right-0 top-full mt-2 w-72 bg-[var(--color-card)] rounded-lg shadow-xl border border-[var(--color-border)] p-3 z-50 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150">
                  <h5 className="text-xs font-medium text-[var(--color-text)] mb-2">{t.templates?.availableVariables || 'Available Variables'}</h5>
                  <div className="space-y-1.5 text-xs">
                    {getTemplateVariableHelp().map((v) => (
                      <div key={v.variable} className="flex justify-between">
                        <code className="text-[var(--color-accent)] font-mono">{v.variable}</code>
                        <span className="text-[var(--color-muted)]">{v.example}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <textarea
            value={editingTemplate.content}
            onChange={(e) => setEditingTemplate({ ...editingTemplate, content: e.target.value })}
            placeholder={t.templates?.contentPlaceholder || 'Template content (Markdown supported)...'}
            className="w-full min-h-[200px] max-h-[400px] px-3 py-2 text-sm rounded-lg bg-black/5 dark:bg-white/5 border border-transparent focus:border-[var(--color-accent)] outline-none transition-colors resize-y font-mono"
          />
        </div>

        {/* Daily default toggle */}
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={editingTemplate.isDailyDefault}
            onChange={(e) => setEditingTemplate({ ...editingTemplate, isDailyDefault: e.target.checked })}
            className="w-4 h-4 rounded accent-[var(--color-accent)]"
          />
          <div>
            <span className="text-sm text-[var(--color-text)]">{t.templates?.setAsDailyDefault || 'Set as daily default'}</span>
            <p className="text-xs text-[var(--color-muted)] mt-0.5">{t.templates?.dailyDefaultHint || 'Apply this template when creating new daily notes'}</p>
          </div>
        </label>

        {/* Action buttons */}
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={handleCancel}
            className="px-3 py-1.5 text-sm rounded-lg text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          >
            {t.templates?.cancel || 'Cancel'}
          </button>
          <button
            onClick={handleSave}
            disabled={!editingTemplate.name.trim() || saving}
            className="px-4 py-1.5 text-sm font-medium rounded-lg bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent)]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (t.templates?.saving || 'Saving...') : (t.templates?.save || 'Save')}
          </button>
        </div>
      </div>
    )
  }

  // Templates list
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium text-[var(--color-text)]">{t.templates?.title || 'Templates'}</h4>
          <p className="text-xs text-[var(--color-muted)] mt-0.5">
            {t.templates?.description || 'Custom content templates for quick insertion'}
          </p>
        </div>
        <button
          onClick={handleAdd}
          className="px-3 py-1.5 text-sm font-medium rounded-lg bg-[var(--color-accent)]/10 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20 transition-colors"
        >
          + {t.templates?.add || 'Add'}
        </button>
      </div>

      {/* Templates list */}
      <div className="space-y-1">
        {templates.map((template) => (
          <div key={template.id} className="relative">
            {/* Drop indicator line - before */}
            {dropPosition?.id === template.id && dropPosition.position === 'before' && (
              <div className="absolute -top-0.5 left-0 right-0 h-0.5 bg-[var(--color-accent)] rounded-full" />
            )}

            <div
              draggable
              onDragStart={(e) => handleDragStart(e, template.id)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, template.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, template.id)}
              className="flex items-center gap-2 p-2.5 rounded-lg bg-black/5 dark:bg-white/5 transition-all cursor-grab active:cursor-grabbing"
            >
              {/* Drag handle */}
              <span className="text-[var(--color-muted)] flex-shrink-0 opacity-40 hover:opacity-100 transition-opacity">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="9" cy="6" r="1.5" />
                  <circle cx="15" cy="6" r="1.5" />
                  <circle cx="9" cy="12" r="1.5" />
                  <circle cx="15" cy="12" r="1.5" />
                  <circle cx="9" cy="18" r="1.5" />
                  <circle cx="15" cy="18" r="1.5" />
                </svg>
              </span>

              {/* Name and description */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[var(--color-text)] truncate">{template.name}</span>
                  {template.isDailyDefault && (
                    <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-[var(--color-accent)]/10 text-[var(--color-accent)]">
                      {t.templates?.dailyDefault || 'Daily'}
                    </span>
                  )}
                </div>
                {template.description && (
                  <div className="text-xs text-[var(--color-muted)] mt-0.5 truncate">{template.description}</div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 flex-shrink-0">
                {/* Toggle daily default */}
                <button
                  onClick={() => handleToggleDailyDefault(template)}
                  className={`p-1.5 rounded-lg transition-colors ${
                    template.isDailyDefault
                      ? 'text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10'
                      : 'text-[var(--color-muted)] hover:bg-black/5 dark:hover:bg-white/10'
                  }`}
                  title={template.isDailyDefault ? t.templates?.removeDailyDefault : t.templates?.setAsDailyDefault}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                </button>

                {/* Edit */}
                <button
                  onClick={() => handleEdit(template)}
                  className="p-1.5 rounded-lg text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                  title={t.actions?.edit}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>

                {/* Delete */}
                <button
                  onClick={() => handleDelete(template)}
                  className="p-1.5 rounded-lg text-[var(--color-muted)] hover:text-red-500 hover:bg-red-500/10 transition-colors"
                  title={t.actions?.delete}
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Drop indicator line - after */}
            {dropPosition?.id === template.id && dropPosition.position === 'after' && (
              <div className="absolute -bottom-0.5 left-0 right-0 h-0.5 bg-[var(--color-accent)] rounded-full" />
            )}
          </div>
        ))}

        {templates.length === 0 && (
          <div className="py-8 text-center text-sm text-[var(--color-muted)]">
            {t.templates?.empty || 'No templates yet. Click "Add" to create one.'}
          </div>
        )}
      </div>

      {/* Reset to defaults */}
      <div className="pt-3 border-t border-black/5 dark:border-white/10">
        {showResetConfirm ? (
          <div className="flex items-center justify-between p-3 rounded-lg bg-red-500/10">
            <span className="text-sm text-red-600 dark:text-red-400">
              {t.templates?.resetConfirm || 'This will remove all custom templates. Continue?'}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-2 py-1 text-xs rounded text-[var(--color-muted)] hover:text-[var(--color-text)]"
              >
                {t.templates?.cancel || 'Cancel'}
              </button>
              <button
                onClick={handleReset}
                className="px-2 py-1 text-xs rounded bg-red-500 text-white hover:bg-red-600"
              >
                {t.templates?.reset || 'Reset'}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowResetConfirm(true)}
            className="text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            {t.templates?.resetToDefaults || 'Reset to defaults'}
          </button>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {confirmDelete && (
        <>
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[1000]"
            onClick={() => setConfirmDelete(null)}
          />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-80 bg-[var(--color-card)] rounded-xl shadow-xl z-[1001]">
            <div className="p-5 space-y-2">
              <h2 className="text-base font-semibold text-[var(--color-text)] select-none">
                {t.templates?.deleteConfirmTitle || 'Delete Template'}
              </h2>
              <p className="text-[0.867rem] text-[var(--color-text-secondary)] select-none">
                {(t.templates?.deleteConfirmMessage || 'Are you sure you want to delete "{name}"?').replace('{name}', confirmDelete.name)}
              </p>
            </div>
            <div className="flex justify-end gap-2 px-5 pb-5">
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 text-[0.867rem] text-[var(--color-text)] hover:bg-black/5 dark:hover:bg-white/10 rounded-lg transition-all duration-150 select-none"
              >
                {t.templates?.cancel || 'Cancel'}
              </button>
              <button
                onClick={confirmDeleteTemplate}
                className="px-4 py-2 text-[0.867rem] text-white bg-red-500 hover:bg-red-600 rounded-lg transition-all duration-150 select-none"
              >
                {t.actions?.delete || 'Delete'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
