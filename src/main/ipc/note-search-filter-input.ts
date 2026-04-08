import type { NoteSearchFilter, SmartViewId } from '../../shared/types'
import { parseRequiredNotebookIdInput } from '../notebook-id'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseOptionalNotebookIdInput(input: unknown): string | undefined | null {
  if (input === undefined) return undefined
  return parseRequiredNotebookIdInput(input)
}

export function parseSmartViewIdInput(input: unknown): SmartViewId | undefined {
  return input === 'all'
    || input === 'daily'
    || input === 'recent'
    || input === 'favorites'
    || input === 'trash'
    ? input
    : undefined
}

export function parseNoteSearchFilterInput(input: unknown): NoteSearchFilter | undefined | null {
  if (input === undefined) return undefined
  if (!isRecord(input) || Array.isArray(input)) return null

  const notebookId = parseOptionalNotebookIdInput(input.notebookId)
  if (input.notebookId !== undefined && notebookId === null) return null

  const viewType = input.viewType === undefined ? undefined : parseSmartViewIdInput(input.viewType)
  if (input.viewType !== undefined && !viewType) return null

  const filter: NoteSearchFilter = {}
  if (Object.prototype.hasOwnProperty.call(input, 'notebookId')) {
    filter.notebookId = notebookId ?? undefined
  }
  if (viewType !== undefined) {
    filter.viewType = viewType
  }
  return filter
}
