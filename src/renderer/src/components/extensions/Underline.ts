import Underline from '@tiptap/extension-underline'

export const CustomUnderline = Underline.configure({
  HTMLAttributes: {
    class: 'underline',
  },
})
