import { NodeViewWrapper, NodeViewProps } from '@tiptap/react'
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Play,
  Pencil,
  RefreshCw,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
} from 'lucide-react'
import { useTranslations } from '../i18n'
import { parseDataviewQuery, ParseResult } from '../utils/dataviewParser'
import { executeDataviewQuery, formatFieldValue, QueryResult } from '../utils/dataviewExecutor'
import { NotePreviewPopover } from './NotePreviewPopover'
import { isMacOS } from '../utils/platform'
import type { Note } from '../../../shared/types'

// Platform-specific modifier key
const MOD = isMacOS() ? '⌘' : 'Ctrl+'

interface DataviewAttrs {
  query: string
  isEditing: boolean
  lastExecuted: string | null
}

const PAGE_SIZE = 10

export function DataviewView({ node, updateAttributes, selected }: NodeViewProps) {
  const attrs = node.attrs as DataviewAttrs
  const { query, isEditing, lastExecuted } = attrs

  const t = useTranslations()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const [localQuery, setLocalQuery] = useState(query)
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(0)

  // Hover preview state
  const [hoveredNote, setHoveredNote] = useState<Note | null>(null)
  const [hoverAnchor, setHoverAnchor] = useState<HTMLElement | null>(null)
  const hoverTimerRef = useRef<number | null>(null)

  // Request ID for preventing race conditions
  const requestIdRef = useRef(0)

  // Parse query when it changes
  useEffect(() => {
    if (localQuery.trim()) {
      const result = parseDataviewQuery(localQuery)
      setParseResult(result)
    } else {
      setParseResult(null)
    }
  }, [localQuery])

  // Auto-execute when in result mode and parseResult is ready
  // This handles: 1) clicking Run 2) initial mount in result mode
  useEffect(() => {
    if (!isEditing && parseResult?.success) {
      executeQuery()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally exclude executeQuery to prevent infinite loops
  }, [isEditing, parseResult?.success])

  // Execute query
  const executeQuery = useCallback(async () => {
    if (!parseResult?.success || !parseResult.query) return

    const currentRequestId = ++requestIdRef.current
    setLoading(true)
    try {
      const result = await executeDataviewQuery(parseResult.query)
      // Discard result if a newer request has been made
      if (currentRequestId !== requestIdRef.current) return
      setQueryResult(result)
      setCurrentPage(0)
      updateAttributes({
        lastExecuted: new Date().toISOString(),
      })
    } catch (error) {
      // Discard error if a newer request has been made
      if (currentRequestId !== requestIdRef.current) return
      setQueryResult({
        columns: [],
        rows: [],
        total: 0,
        error: error instanceof Error ? error.message : 'Execution failed',
      })
    } finally {
      // Only clear loading if this is still the current request
      if (currentRequestId === requestIdRef.current) {
        setLoading(false)
      }
    }
  }, [parseResult, updateAttributes])

  // Run query (from edit mode)
  const handleRun = useCallback(() => {
    updateAttributes({
      query: localQuery,
      isEditing: false,
    })
  }, [localQuery, updateAttributes])

  // Switch to edit mode
  const handleEdit = useCallback(() => {
    updateAttributes({ isEditing: true })
    setTimeout(() => {
      textareaRef.current?.focus()
    }, 100)
  }, [updateAttributes])

  // Refresh query
  const handleRefresh = useCallback(() => {
    if (parseResult?.success) {
      executeQuery()
    }
  }, [parseResult, executeQuery])

  // Open note in new tab
  const handleNoteClick = useCallback(
    (noteId: string, event: React.MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()

      // Dispatch event to open note in new tab
      window.dispatchEvent(
        new CustomEvent('note:open-in-new-tab', {
          detail: { noteId },
        })
      )
    },
    []
  )

  // Hover preview handlers
  const handleNoteMouseEnter = useCallback(
    async (noteId: string, element: HTMLElement) => {
      // Clear any existing timer
      if (hoverTimerRef.current) {
        window.clearTimeout(hoverTimerRef.current)
      }

      // Delay showing preview to avoid flickering
      hoverTimerRef.current = window.setTimeout(async () => {
        try {
          const note = await window.electron.note.getById(noteId)
          if (note) {
            setHoveredNote(note as Note)
            setHoverAnchor(element)
          }
        } catch (error) {
          console.error('Failed to load note for preview:', error)
        }
      }, 300)
    },
    []
  )

  const handleNoteMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    setHoveredNote(null)
    setHoverAnchor(null)
  }, [])

  const handlePreviewMouseEnter = useCallback(() => {
    // Keep preview open when mouse enters it
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
  }, [])

  // Cleanup hover timer on unmount
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) {
        window.clearTimeout(hoverTimerRef.current)
      }
    }
  }, [])

  // Handle keyboard shortcuts in textarea
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Skip during IME composition
      if (e.nativeEvent.isComposing) return

      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleRun()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        if (queryResult) {
          updateAttributes({ isEditing: false })
        }
      }
    },
    [handleRun, queryResult, updateAttributes]
  )

  // Format summary text
  const getSummaryText = () => {
    if (!parseResult?.success || !parseResult.query) return ''
    const { type, from } = parseResult.query
    let text = type
    if (from.type === 'tag') {
      text += ` FROM #${from.value}`
    } else if (from.type === 'folder') {
      text += ` FROM "${from.value}"`
    }
    return text
  }

  // Pagination
  const totalPages = queryResult
    ? Math.ceil(queryResult.rows.length / PAGE_SIZE)
    : 0
  const paginatedRows = queryResult
    ? queryResult.rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
    : []

  // Render edit mode
  const renderEditMode = () => (
    <div className="dataview-editor">
      <div className="dataview-header">
        <div className="dataview-header-left">
          <span className="dataview-title">dataview</span>
          <div className="dataview-help-wrapper">
            <HelpCircle size={12} className="dataview-help-icon" />
            <div className="dataview-help-tooltip">
              <div className="dataview-help-section">
                <div className="dataview-help-title">{t.dataview?.syntaxHelp || 'Syntax'}</div>
                <code>LIST</code> <span>{t.dataview?.syntaxList || 'List all notes'}</span>
                <code>TABLE title, tags</code> <span>{t.dataview?.syntaxTable || 'Table with columns'}</span>
                <code>FROM #tag</code> <span>{t.dataview?.syntaxFrom || 'Filter by tag'}</span>
                <code>FROM "Notebook"</code> <span>{t.dataview?.syntaxFromFolder || 'Filter by notebook'}</span>
                <code>WHERE field = value</code> <span>{t.dataview?.syntaxWhere || 'Filter condition'}</span>
                <code>WHERE created {'>'} "2024-01"</code> <span>{t.dataview?.syntaxWhereDate || 'Date filter'}</span>
                <code>SORT updated DESC</code> <span>{t.dataview?.syntaxSort || 'Sort results'}</span>
                <code>LIMIT 10</code> <span>{t.dataview?.syntaxLimit || 'Limit count'}</span>
              </div>
              <div className="dataview-help-section">
                <div className="dataview-help-title">{t.dataview?.fieldsTitle || 'Fields'}</div>
                <code>title</code> <span>{t.dataview?.fieldTitle || 'Note title'}</span>
                <code>created</code> <span>{t.dataview?.fieldCreated || 'Created date'}</span>
                <code>updated</code> <span>{t.dataview?.fieldUpdated || 'Updated date'}</span>
                <code>tags</code> <span>{t.dataview?.fieldTags || 'Tags list'}</span>
                <code>folder</code> <span>{t.dataview?.fieldFolder || 'Notebook name'}</span>
                <code>is_daily</code> <span>{t.dataview?.fieldIsDaily || 'Is daily note'}</span>
                <code>is_favorite</code> <span>{t.dataview?.fieldIsFavorite || 'Is favorite'}</span>
                <code>is_pinned</code> <span>{t.dataview?.fieldIsPinned || 'Is pinned'}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="dataview-header-right">
          <button
            className="dataview-action dataview-run-btn"
            onClick={handleRun}
            disabled={!parseResult?.success}
            title={t.dataview?.run || `Run (${MOD}Enter)`}
            aria-label={t.dataview?.run || 'Run query'}
          >
            <Play size={12} />
          </button>
        </div>
      </div>
      <div className="dataview-code">
        <textarea
          ref={textareaRef}
          className="dataview-textarea"
          value={localQuery}
          onChange={(e) => setLocalQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t.dataview?.placeholder || 'LIST FROM #tag\nWHERE field = "value"\nSORT updated DESC\nLIMIT 10'}
          spellCheck={false}
        />
        {parseResult?.error && (
          <div className="dataview-parse-error">
            <AlertTriangle size={12} />
            <span>{parseResult.error.message}</span>
          </div>
        )}
      </div>
    </div>
  )

  // Render result mode - LIST
  const renderListResult = () => (
    <div className="dataview-list">
      {paginatedRows.map((row) => (
        <div
          key={row.noteId}
          className="dataview-list-item"
          onMouseEnter={(e) => handleNoteMouseEnter(row.noteId, e.currentTarget)}
          onMouseLeave={handleNoteMouseLeave}
        >
          <a
            href="#"
            className="dataview-note-link"
            onClick={(e) => handleNoteClick(row.noteId, e)}
          >
            {row.noteTitle}
          </a>
        </div>
      ))}
    </div>
  )

  // Render result mode - TABLE
  const renderTableResult = () => (
    <div className="dataview-table-container">
      <table className="dataview-table" role="grid" aria-label={t.dataview?.titleColumn || 'Query results'}>
        <thead>
          <tr>
            <th>{t.dataview?.titleColumn || 'Title'}</th>
            {queryResult?.columns.filter(c => c !== 'title').map((col) => (
              <th key={col}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {paginatedRows.map((row) => (
            <tr
              key={row.noteId}
              onMouseEnter={(e) => handleNoteMouseEnter(row.noteId, e.currentTarget)}
              onMouseLeave={handleNoteMouseLeave}
            >
              <td>
                <a
                  href="#"
                  className="dataview-note-link"
                  onClick={(e) => handleNoteClick(row.noteId, e)}
                >
                  {row.noteTitle}
                </a>
              </td>
              {queryResult?.columns.filter(c => c !== 'title').map((col) => (
                <td key={col}>{formatFieldValue(row[col], col)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  // Render result mode
  const renderResultMode = () => (
    <div className="dataview-result">
      <div className="dataview-header">
        <div className="dataview-header-left">
          <span className="dataview-summary">
            {getSummaryText()}
            {queryResult && !queryResult.error && (
              <span className="dataview-count">· {queryResult.total}</span>
            )}
          </span>
        </div>
        <div className="dataview-header-right">
          <button
            className="dataview-action"
            onClick={handleRefresh}
            disabled={loading}
            title={t.dataview?.refresh || 'Refresh'}
            aria-label={t.dataview?.refresh || 'Refresh'}
          >
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
          </button>
          <button
            className="dataview-action"
            onClick={handleEdit}
            title={t.dataview?.edit || 'Edit'}
            aria-label={t.dataview?.edit || 'Edit'}
          >
            <Pencil size={12} />
          </button>
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="dataview-loading">
          <div className="dataview-spinner" />
          <span>{t.dataview?.querying || 'Querying...'}</span>
        </div>
      )}

      {/* Error state */}
      {queryResult?.error && (
        <div className="dataview-error">
          <AlertTriangle size={14} />
          <span>{queryResult.error}</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && queryResult && !queryResult.error && queryResult.rows.length === 0 && (
        <div className="dataview-empty">
          <span>{t.dataview?.noResults || 'No matching notes'}</span>
        </div>
      )}

      {/* Results */}
      {!loading && queryResult && !queryResult.error && queryResult.rows.length > 0 && (
        <>
          {parseResult?.query?.type === 'TABLE' ? renderTableResult() : renderListResult()}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="dataview-pagination">
              <button
                className="dataview-page-btn"
                onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                disabled={currentPage === 0}
              >
                <ChevronLeft size={12} />
              </button>
              <span className="dataview-page-info">
                {currentPage + 1} / {totalPages}
              </span>
              <button
                className="dataview-page-btn"
                onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={currentPage >= totalPages - 1}
              >
                <ChevronRight size={12} />
              </button>
            </div>
          )}

          {/* Footer */}
          <div className="dataview-footer">
            <span>
              {t.dataview?.totalResults?.replace('{count}', String(queryResult.total)) ||
                `${queryResult.total} results`}
            </span>
            {lastExecuted && (
              <span className="dataview-last-updated">
                {t.dataview?.lastUpdated || 'Updated'}{' '}
                {new Date(lastExecuted).toLocaleTimeString()}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )

  return (
    <NodeViewWrapper className={`dataview-block-wrapper ${selected ? 'selected' : ''}`} data-drag-handle>
      <div className={`dataview-block ${isEditing ? 'editing' : 'result'}`}>
        {isEditing ? renderEditMode() : renderResultMode()}
      </div>

      {/* Hover preview popover */}
      {hoveredNote && hoverAnchor && (
        <NotePreviewPopover
          note={hoveredNote}
          anchorEl={hoverAnchor}
          onClose={handleNoteMouseLeave}
          onMouseEnter={handlePreviewMouseEnter}
        />
      )}
    </NodeViewWrapper>
  )
}
