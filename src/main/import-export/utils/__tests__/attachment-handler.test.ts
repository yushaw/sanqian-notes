import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PendingAttachment } from '../../types'

vi.mock('../../../attachment', () => ({
  saveAttachmentBuffer: vi.fn(async () => ({ relativePath: 'attachments/copied.png' })),
}))

import { saveAttachmentBuffer } from '../../../attachment'
import { copyAttachmentsAndUpdateContent } from '../attachment-handler'

describe('copyAttachmentsAndUpdateContent', () => {
  let tempDir = ''

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
      tempDir = ''
    }
    vi.clearAllMocks()
  })

  it('keeps malformed URI references non-fatal and still updates attachment links', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'attachment-handler-'))
    const sourcePath = join(tempDir, 'demo.png')
    writeFileSync(sourcePath, Buffer.from('image'))

    const content = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: {
            src: 'assets/%ZZ.png',
          },
        },
      ],
    })

    const attachments: PendingAttachment[] = [
      {
        originalRef: '![demo](assets/%ZZ.png)',
        sourcePath,
      },
    ]

    const result = await copyAttachmentsAndUpdateContent(content, attachments)

    expect(result.copiedCount).toBe(1)
    expect(result.failed).toEqual([])
    expect(result.updatedContent).toContain('attachment://attachments/copied.png')
    expect(attachments[0].newRelativePath).toBe('attachments/copied.png')
    expect(saveAttachmentBuffer).toHaveBeenCalledTimes(1)
  })

  it('normalizes uppercase file extensions without duplicating suffix', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'attachment-handler-'))
    const sourcePath = join(tempDir, 'Figure.PNG')
    writeFileSync(sourcePath, Buffer.from('image'))

    const content = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: {
            src: 'assets/Figure.PNG',
          },
        },
      ],
    })

    const attachments: PendingAttachment[] = [
      {
        originalRef: '![figure](assets/Figure.PNG)',
        sourcePath,
      },
    ]

    await copyAttachmentsAndUpdateContent(content, attachments)

    expect(saveAttachmentBuffer).toHaveBeenCalledWith(expect.any(Buffer), 'png', 'Figure.png')
  })
})
