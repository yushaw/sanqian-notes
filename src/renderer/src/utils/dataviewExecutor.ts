/**
 * Dataview Query Executor
 *
 * Executes parsed queries against the note database
 */

import type { ParsedQuery, WhereClause, SortClause, DateExpression, FieldFunction } from './dataviewParser'
import dayjs from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'

dayjs.extend(isoWeek)
import type { Note, Notebook } from '../../../shared/types'
import { parseDateKeyword, getDateRange, isDateInRange } from './dateExpressions'

export interface QueryResultRow {
  noteId: string
  noteTitle: string
  [key: string]: unknown
}

export interface QueryResult {
  columns: string[]
  rows: QueryResultRow[]
  total: number // Total before LIMIT
  error?: string
}

// Built-in field names
const BUILTIN_FIELDS = new Set([
  'title',
  'created',
  'updated',
  'tags',
  'folder',
  'notebook',
  'is_daily',
  'is_favorite',
  'is_pinned',
  'summary',
  'daily_date',
])

/**
 * Execute a Dataview query
 */
export async function executeDataviewQuery(query: ParsedQuery): Promise<QueryResult> {
  try {
    // 1. Fetch all notes and notebooks
    const [notes, notebooks] = await Promise.all([
      window.electron.note.getAll() as Promise<Note[]>,
      window.electron.notebook.getAll() as Promise<Notebook[]>,
    ])

    // Create notebook lookup map
    const notebookMap = new Map<string, Notebook>()
    for (const notebook of notebooks) {
      notebookMap.set(notebook.id, notebook)
    }

    // 2. Filter by FROM clause
    let filteredNotes = filterByFrom(notes, query.from, notebookMap)

    // 3. Apply WHERE conditions
    filteredNotes = filterByWhere(filteredNotes, query.where, notebookMap)

    // Record total before limit
    const total = filteredNotes.length

    // 4. Apply SORT
    if (query.sort.length > 0) {
      filteredNotes = sortNotes(filteredNotes, query.sort, notebookMap)
    } else {
      // Default sort: updated DESC
      filteredNotes = filteredNotes.sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      )
    }

    // 5. Apply LIMIT
    if (query.limit !== undefined && query.limit > 0) {
      filteredNotes = filteredNotes.slice(0, query.limit)
    }

    // 6. Build result rows
    const columns = query.type === 'TABLE' && query.fields.length > 0 ? query.fields : ['title']

    const rows: QueryResultRow[] = filteredNotes.map((note) => {
      const row: QueryResultRow = {
        noteId: note.id,
        noteTitle: note.title || 'Untitled',
      }

      // Add requested fields
      for (const field of columns) {
        row[field] = getFieldValue(note, field, notebookMap)
      }

      return row
    })

    return {
      columns,
      rows,
      total,
    }
  } catch (error) {
    return {
      columns: [],
      rows: [],
      total: 0,
      error: error instanceof Error ? error.message : 'Query execution failed',
    }
  }
}

/**
 * Filter notes by FROM clause
 */
function filterByFrom(
  notes: Note[],
  from: ParsedQuery['from'],
  notebookMap: Map<string, Notebook>
): Note[] {
  // Exclude deleted notes
  notes = notes.filter((n) => !n.deleted_at)

  switch (from.type) {
    case 'tag':
      return notes.filter((note) =>
        note.tags?.some((t) => t.name.toLowerCase() === from.value.toLowerCase())
      )

    case 'folder': {
      // Match by notebook name or ID
      const targetNotebook = Array.from(notebookMap.values()).find(
        (nb) => nb.name.toLowerCase() === from.value.toLowerCase() || nb.id === from.value
      )
      if (targetNotebook) {
        return notes.filter((note) => note.notebook_id === targetNotebook.id)
      }
      return []
    }

    case 'all':
    default:
      return notes
  }
}

/**
 * Filter notes by WHERE conditions
 */
function filterByWhere(
  notes: Note[],
  where: WhereClause[],
  notebookMap: Map<string, Notebook>
): Note[] {
  if (where.length === 0) return notes

  return notes.filter((note) => {
    let result = evaluateCondition(note, where[0], notebookMap)

    for (let i = 1; i < where.length; i++) {
      const logic = where[i - 1].logic || 'AND'
      const conditionResult = evaluateCondition(note, where[i], notebookMap)

      if (logic === 'AND') {
        result = result && conditionResult
      } else {
        result = result || conditionResult
      }
    }

    return result
  })
}

/**
 * Check if a value is a DateExpression
 */
function isDateExpression(value: unknown): value is DateExpression {
  return typeof value === 'object' && value !== null && 'type' in value && (value as DateExpression).type === 'date'
}

/**
 * Check if a field is a FieldFunction
 */
function isFieldFunction(field: string | FieldFunction): field is FieldFunction {
  return typeof field === 'object' && field.type === 'field_function'
}

/**
 * Extract week or year number from a date value
 */
function extractDateComponent(
  note: Note,
  fieldFunc: FieldFunction,
  notebookMap: Map<string, Notebook>
): number | null {
  const fieldValue = getFieldValue(note, fieldFunc.field, notebookMap)
  if (fieldValue === null || fieldValue === undefined) return null

  const date = dayjs(fieldValue as string)
  if (!date.isValid()) return null

  switch (fieldFunc.function) {
    case 'week':
      return date.isoWeek() // ISO week number (1-53)
    case 'year':
      return date.year()
    default:
      return null
  }
}

/**
 * Evaluate a single WHERE condition
 */
function evaluateCondition(
  note: Note,
  condition: WhereClause,
  notebookMap: Map<string, Notebook>
): boolean {
  let fieldValue: unknown

  // Handle FieldFunction (e.g., week(created), year(created))
  if (isFieldFunction(condition.field)) {
    fieldValue = extractDateComponent(note, condition.field, notebookMap)
    // For field functions, compare as numbers
    const compareValue = typeof condition.value === 'number' ? condition.value : parseInt(String(condition.value), 10)
    if (fieldValue === null || isNaN(compareValue)) return false

    switch (condition.operator) {
      case '=':
        return fieldValue === compareValue
      case '!=':
        return fieldValue !== compareValue
      case '>':
        return (fieldValue as number) > compareValue
      case '<':
        return (fieldValue as number) < compareValue
      case '>=':
        return (fieldValue as number) >= compareValue
      case '<=':
        return (fieldValue as number) <= compareValue
      default:
        return false
    }
  }

  fieldValue = getFieldValue(note, condition.field, notebookMap)
  const compareValue = condition.value

  // Handle DateExpression specially
  if (isDateExpression(compareValue)) {
    return evaluateDateCondition(fieldValue, condition.operator, compareValue)
  }

  switch (condition.operator) {
    case '=':
      return compareEqual(fieldValue, compareValue)
    case '!=':
      return !compareEqual(fieldValue, compareValue)
    case '>':
      return compareNumeric(fieldValue, compareValue) > 0
    case '<':
      return compareNumeric(fieldValue, compareValue) < 0
    case '>=':
      return compareNumeric(fieldValue, compareValue) >= 0
    case '<=':
      return compareNumeric(fieldValue, compareValue) <= 0
    case 'contains':
      return compareContains(fieldValue, compareValue)
    default:
      return false
  }
}

/**
 * Evaluate date-based condition
 */
function evaluateDateCondition(
  fieldValue: unknown,
  operator: WhereClause['operator'],
  dateExpr: DateExpression
): boolean {
  if (fieldValue === null || fieldValue === undefined) return false

  const fieldDate = new Date(fieldValue as string)
  if (isNaN(fieldDate.getTime())) return false

  // For = operator with range keywords (today, yesterday, this_week, etc.),
  // check if field value is within the range
  if (operator === '=' && dateExpr.isRange) {
    try {
      const range = getDateRange(dateExpr.keyword)
      return isDateInRange(fieldDate, range)
    } catch {
      // Fallback to point comparison if range keyword is invalid
      console.debug(`[Dataview] Range keyword "${dateExpr.keyword}" not supported, falling back to point comparison`)
    }
  }

  // For != operator with range keywords, check if NOT in range
  if (operator === '!=' && dateExpr.isRange) {
    try {
      const range = getDateRange(dateExpr.keyword)
      return !isDateInRange(fieldDate, range)
    } catch {
      // Fallback to point comparison if range keyword is invalid
      console.debug(`[Dataview] Range keyword "${dateExpr.keyword}" not supported, falling back to point comparison`)
    }
  }

  // For other operators or non-range keywords, compare as points
  try {
    const compareDate = parseDateKeyword(dateExpr.keyword)
    const fieldTime = fieldDate.getTime()
    const compareTime = compareDate.getTime()

    switch (operator) {
      case '=':
        // For point comparison, compare date part only
        return fieldDate.toDateString() === compareDate.toDateString()
      case '!=':
        return fieldDate.toDateString() !== compareDate.toDateString()
      case '>':
        return fieldTime > compareTime
      case '<':
        return fieldTime < compareTime
      case '>=':
        return fieldTime >= compareTime
      case '<=':
        return fieldTime <= compareTime
      default:
        return false
    }
  } catch {
    return false
  }
}

/**
 * Compare values for equality
 */
function compareEqual(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined) return b === null || b === undefined

  // Handle arrays (tags)
  if (Array.isArray(a)) {
    const strB = String(b).toLowerCase()
    return a.some((item) => {
      if (typeof item === 'object' && item !== null && 'name' in item) {
        return (item as { name: string }).name.toLowerCase() === strB
      }
      return String(item).toLowerCase() === strB
    })
  }

  // Handle boolean
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    return Boolean(a) === Boolean(b)
  }

  // String comparison (case insensitive)
  return String(a).toLowerCase() === String(b).toLowerCase()
}

/**
 * Compare values numerically or by date
 */
function compareNumeric(a: unknown, b: unknown): number {
  // Handle dates
  if (typeof a === 'string' && /^\d{4}-\d{2}-\d{2}/.test(a)) {
    const dateA = new Date(a).getTime()
    const dateB = typeof b === 'string' ? new Date(b).getTime() : Number(b)
    return dateA - dateB
  }

  // Handle numbers
  const numA = Number(a)
  const numB = Number(b)
  if (!isNaN(numA) && !isNaN(numB)) {
    return numA - numB
  }

  // Fallback to string comparison
  return String(a).localeCompare(String(b))
}

/**
 * Check if value contains search term
 */
function compareContains(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined) return false

  const searchTerm = String(b).toLowerCase()

  // Handle arrays
  if (Array.isArray(a)) {
    return a.some((item) => {
      if (typeof item === 'object' && item !== null && 'name' in item) {
        return (item as { name: string }).name.toLowerCase().includes(searchTerm)
      }
      return String(item).toLowerCase().includes(searchTerm)
    })
  }

  return String(a).toLowerCase().includes(searchTerm)
}

/**
 * Sort notes by sort clauses
 */
function sortNotes(
  notes: Note[],
  sort: SortClause[],
  notebookMap: Map<string, Notebook>
): Note[] {
  return [...notes].sort((a, b) => {
    for (const clause of sort) {
      const valueA = getFieldValue(a, clause.field, notebookMap)
      const valueB = getFieldValue(b, clause.field, notebookMap)

      let comparison = compareNumeric(valueA, valueB)
      if (clause.direction === 'DESC') {
        comparison = -comparison
      }

      if (comparison !== 0) return comparison
    }
    return 0
  })
}

/**
 * Get field value from note
 */
function getFieldValue(
  note: Note,
  field: string,
  notebookMap: Map<string, Notebook>
): unknown {
  const fieldLower = field.toLowerCase()

  // Built-in fields
  switch (fieldLower) {
    case 'title':
      return note.title || 'Untitled'
    case 'created':
      return note.created_at
    case 'updated':
      return note.updated_at
    case 'tags':
      return note.tags?.map((t) => t.name) || []
    case 'folder':
    case 'notebook': {
      if (note.notebook_id) {
        const notebook = notebookMap.get(note.notebook_id)
        return notebook?.name || note.notebook_id
      }
      return null
    }
    case 'is_daily':
      return note.is_daily
    case 'is_favorite':
      return note.is_favorite
    case 'is_pinned':
      return note.is_pinned
    case 'summary':
      return note.ai_summary || ''
    case 'daily_date':
      return note.daily_date
  }

  // Try to get frontmatter field from content
  // For MVP, we don't parse frontmatter - return undefined
  return undefined
}

/**
 * Format field value for display
 */
export function formatFieldValue(value: unknown, field: string): string {
  if (value === null || value === undefined) return '-'

  const fieldLower = field.toLowerCase()

  // Date formatting (uses browser locale for i18n)
  if (fieldLower === 'created' || fieldLower === 'updated') {
    try {
      const date = new Date(value as string)
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

      if (diffDays === 0) {
        return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      } else if (diffDays < 7) {
        // Use Intl.RelativeTimeFormat for locale-aware relative dates
        const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
        return rtf.format(-diffDays, 'day')
      } else {
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      }
    } catch {
      return String(value)
    }
  }

  // Boolean formatting
  if (typeof value === 'boolean') {
    return value ? '✓' : '✗'
  }

  // Array formatting (tags)
  if (Array.isArray(value)) {
    return value.join(', ')
  }

  return String(value)
}

/**
 * Check if a field is a built-in field
 */
export function isBuiltinField(field: string): boolean {
  return BUILTIN_FIELDS.has(field.toLowerCase())
}

/**
 * Get all available built-in fields
 */
export function getBuiltinFields(): string[] {
  return Array.from(BUILTIN_FIELDS)
}
