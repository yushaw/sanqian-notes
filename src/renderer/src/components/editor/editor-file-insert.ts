import type { Editor as TiptapEditor } from '@tiptap/core'
import { getFileCategory, getExtensionFromMime } from '../../utils/fileCategory'

const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100MB

export interface FileInsertErrorMessages {
  fileTooLarge: (fileName: string, sizeMB: string) => string
  insertFailed: (fileName: string, error: unknown) => string
}

/**
 * Handle inserting a file into a TipTap editor instance.
 *
 * Saves the file as an attachment via electron, then inserts the appropriate
 * node type (image/video/audio/fileAttachment) at the given position or cursor.
 *
 * Shared between Editor.tsx and TypewriterMode.tsx.
 */
export async function handleEditorFileInsert(
  editorInstance: TiptapEditor,
  file: File,
  errorMessages: FileInsertErrorMessages,
  pos?: number
): Promise<void> {
  if (!editorInstance) return

  const docSize = editorInstance.state.doc.content.size
  let insertPos: number | undefined = pos
  if (pos !== undefined && (pos < 0 || pos > docSize)) {
    insertPos = docSize
  }

  if (file.size > MAX_FILE_SIZE) {
    const sizeInMB = (file.size / 1024 / 1024).toFixed(1)
    alert(errorMessages.fileTooLarge(file.name, sizeInMB))
    return
  }

  try {
    const arrayBuffer = await file.arrayBuffer()
    const buffer = new Uint8Array(arrayBuffer)

    const ext = file.name.includes('.')
      ? file.name.split('.').pop()!.toLowerCase()
      : getExtensionFromMime(file.type)

    const result = await window.electron.attachment.saveBuffer(buffer, ext, file.name)
    const category = getFileCategory(file.name) || getFileCategory(`.${ext}`)
    const attachmentUrl = `attachment://${result.relativePath}`

    switch (category) {
      case 'image':
        if (insertPos !== undefined) {
          editorInstance.chain().focus().insertContentAt(insertPos, {
            type: 'resizableImage',
            attrs: { src: attachmentUrl, alt: result.name },
          }).run()
        } else {
          editorInstance.chain().focus().setImage({
            src: attachmentUrl,
            alt: result.name,
          }).run()
        }
        break

      case 'video':
        if (insertPos !== undefined) {
          editorInstance.chain().focus().insertContentAt(insertPos, {
            type: 'video',
            attrs: { src: attachmentUrl },
          }).run()
        } else {
          editorInstance.commands.setVideo({ src: attachmentUrl })
        }
        break

      case 'audio':
        if (insertPos !== undefined) {
          editorInstance.chain().focus().insertContentAt(insertPos, {
            type: 'audio',
            attrs: { src: attachmentUrl, title: result.name },
          }).run()
        } else {
          editorInstance.commands.setAudio({ src: attachmentUrl, title: result.name })
        }
        break

      default:
        if (insertPos !== undefined) {
          editorInstance.chain().focus().insertContentAt(insertPos, {
            type: 'fileAttachment',
            attrs: {
              src: attachmentUrl,
              name: result.name,
              size: result.size,
              type: result.type,
            },
          }).run()
        } else {
          editorInstance.commands.setFileAttachment({
            src: attachmentUrl,
            name: result.name,
            size: result.size,
            type: result.type,
          })
        }
    }
  } catch (error) {
    console.error('Failed to insert file:', error)
    alert(errorMessages.insertFailed(file.name, error))
  }
}
