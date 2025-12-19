import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { common, createLowlight } from 'lowlight'
import { CodeBlockView } from '../CodeBlockView'

// Create lowlight instance with common languages
const lowlight = createLowlight(common)

export const CustomCodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView)
  },
}).configure({
  lowlight,
  defaultLanguage: 'plaintext',
})

// Export lowlight for use in the view component
export { lowlight }
