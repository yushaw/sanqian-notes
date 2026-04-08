/**
 * Notebook ID parsing helpers.
 *
 * Semantics:
 * - notebook IDs are opaque strings
 * - surrounding spaces are preserved when the value is accepted
 * - only "blank" values are rejected
 */
const NOTEBOOK_ID_MAX_LENGTH = 1024
const NOTEBOOK_ID_ARRAY_MAX_ITEMS = 10000

export function parseRequiredNotebookIdInput(notebookIdInput: unknown): string | null {
  if (typeof notebookIdInput !== 'string') return null
  if (!notebookIdInput.trim()) return null
  if (notebookIdInput.includes('\0')) return null
  if (notebookIdInput.length > NOTEBOOK_ID_MAX_LENGTH) return null
  return notebookIdInput
}

export function parseNotebookIdArrayInput(notebookIdsInput: unknown): string[] {
  if (!Array.isArray(notebookIdsInput)) return []
  if (notebookIdsInput.length > NOTEBOOK_ID_ARRAY_MAX_ITEMS) return []
  const notebookIds: string[] = []
  for (const notebookIdInput of notebookIdsInput) {
    const notebookId = parseRequiredNotebookIdInput(notebookIdInput)
    if (notebookId) {
      notebookIds.push(notebookId)
    }
  }
  return notebookIds
}

export function parseNotebookIdArrayInputOrUndefined(notebookIdsInput: unknown): string[] | undefined {
  if (!Array.isArray(notebookIdsInput)) return undefined
  return parseNotebookIdArrayInput(notebookIdsInput)
}
