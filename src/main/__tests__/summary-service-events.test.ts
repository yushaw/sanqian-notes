import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getAllWebContentsMock,
  getNoteSummaryInfoMock,
  getLocalNoteSummaryInfoMock,
  updateLocalNoteSummaryMock,
  updateLocalAITagsMock,
  updateNoteSummaryMock,
  updateAITagsMock,
  jsonToMarkdownMock,
  getClientMock,
  resolveNoteResourceMock,
  buildNoteFromResolvedResourceMock,
} = vi.hoisted(() => ({
  getAllWebContentsMock: vi.fn(),
  getNoteSummaryInfoMock: vi.fn(),
  getLocalNoteSummaryInfoMock: vi.fn(),
  updateLocalNoteSummaryMock: vi.fn(),
  updateLocalAITagsMock: vi.fn(),
  updateNoteSummaryMock: vi.fn(),
  updateAITagsMock: vi.fn(),
  jsonToMarkdownMock: vi.fn(),
  getClientMock: vi.fn(),
  resolveNoteResourceMock: vi.fn(),
  buildNoteFromResolvedResourceMock: vi.fn(),
}))

vi.mock('electron', () => ({
  webContents: {
    getAllWebContents: getAllWebContentsMock,
  },
}))

vi.mock('../database', () => ({
  getNoteSummaryInfo: getNoteSummaryInfoMock,
  getLocalNoteSummaryInfo: getLocalNoteSummaryInfoMock,
  updateLocalNoteSummary: updateLocalNoteSummaryMock,
  updateLocalAITags: updateLocalAITagsMock,
  updateNoteSummary: updateNoteSummaryMock,
  updateAITags: updateAITagsMock,
}))

vi.mock('../markdown/tiptap-to-markdown', () => ({
  jsonToMarkdown: jsonToMarkdownMock,
}))

vi.mock('../sanqian-sdk', () => ({
  getClient: getClientMock,
}))

vi.mock('../note-gateway', () => ({
  resolveNoteResource: resolveNoteResourceMock,
  buildNoteFromResolvedResource: buildNoteFromResolvedResourceMock,
}))

vi.unmock('../summary-service')
import { generateSummary } from '../summary-service'

describe('summary-service event routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    jsonToMarkdownMock.mockReturnValue('a'.repeat(800))
    getNoteSummaryInfoMock.mockReturnValue(null)
    getLocalNoteSummaryInfoMock.mockReturnValue(null)
    updateLocalNoteSummaryMock.mockReturnValue(true)
    updateLocalAITagsMock.mockReturnValue(null)
    updateNoteSummaryMock.mockReturnValue(undefined)
    updateAITagsMock.mockReturnValue(undefined)
    getClientMock.mockReturnValue({
      _getSdk: () => ({
        ensureReady: vi.fn(async () => undefined),
        chat: vi.fn(async () => ({
          message: {
            content: 'Summary: long-term summary\nKeywords: alpha, beta',
          },
        })),
      }),
    })
  })

  it('emits summary updates for both incoming and canonical IDs for local notes', async () => {
    const sentA = vi.fn()
    const sentB = vi.fn()
    getAllWebContentsMock.mockReturnValue([
      { send: sentA },
      { send: sentB },
    ])
    resolveNoteResourceMock.mockReturnValue({
      ok: true,
      resource: {
        sourceType: 'local-folder',
        file: {
          notebook_id: 'nb-local',
          relative_path: 'docs/plan.md',
        },
      },
    })
    buildNoteFromResolvedResourceMock.mockReturnValue({
      id: 'local:nb-local:path:docs%2Fplan.md',
      content: '{"type":"doc","content":[]}',
    })

    const incomingId = 'local:uid:nb-local:uid-123'
    const ok = await generateSummary(incomingId)

    expect(ok).toBe(true)
    expect(sentA.mock.calls).toEqual([
      ['summary:updated', incomingId],
      ['summary:updated', 'local:nb-local:path:docs%2Fplan.md'],
      ['data:changed'],
    ])
    expect(sentB.mock.calls).toEqual([
      ['summary:updated', incomingId],
      ['summary:updated', 'local:nb-local:path:docs%2Fplan.md'],
      ['data:changed'],
    ])
    expect(updateLocalNoteSummaryMock).toHaveBeenCalledWith({
      notebook_id: 'nb-local',
      relative_path: 'docs/plan.md',
      summary: 'long-term summary',
      content_hash: expect.any(String),
    })
    expect(updateLocalAITagsMock).toHaveBeenCalledWith({
      notebook_id: 'nb-local',
      relative_path: 'docs/plan.md',
      tag_names: ['alpha', 'beta'],
    })
  })

  it('avoids duplicate summary event when incoming ID already matches canonical note ID', async () => {
    const send = vi.fn()
    getAllWebContentsMock.mockReturnValue([{ send }])
    resolveNoteResourceMock.mockReturnValue({
      ok: true,
      resource: {
        sourceType: 'internal',
      },
    })
    buildNoteFromResolvedResourceMock.mockReturnValue({
      id: 'note-1',
      content: '{"type":"doc","content":[]}',
    })

    const ok = await generateSummary('note-1')

    expect(ok).toBe(true)
    expect(send.mock.calls).toEqual([
      ['summary:updated', 'note-1'],
    ])
    expect(updateNoteSummaryMock).toHaveBeenCalledWith('note-1', 'long-term summary', expect.any(String))
    expect(updateAITagsMock).toHaveBeenCalledWith('note-1', ['alpha', 'beta'])
  })
})
