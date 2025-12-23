import { ReactRenderer } from '@tiptap/react'
import tippy, { Instance } from 'tippy.js'
import { SlashCommandList } from '../SlashCommandList'
import type { SlashCommandItem } from './SlashCommand'
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'

export const slashCommandSuggestion = {
  render: () => {
    let component: ReactRenderer
    let popup: Instance[]

    return {
      onStart: (props: SuggestionProps<SlashCommandItem>) => {
        component = new ReactRenderer(SlashCommandList, {
          props,
          editor: props.editor,
        })

        if (!props.clientRect) return

        popup = tippy('body', {
          getReferenceClientRect: props.clientRect as () => DOMRect,
          appendTo: () => document.body,
          content: component.element,
          showOnCreate: true,
          interactive: true,
          trigger: 'manual',
          placement: 'bottom-start',
          popperOptions: {
            strategy: 'fixed',
            modifiers: [
              {
                name: 'flip',
                options: {
                  fallbackPlacements: ['top-start', 'bottom-end', 'top-end'],
                },
              },
              {
                name: 'preventOverflow',
                options: {
                  boundary: 'viewport',
                  padding: 8,
                },
              },
            ],
          },
        })
      },

      onUpdate: (props: SuggestionProps<SlashCommandItem>) => {
        component.updateProps(props)

        if (!props.clientRect) return

        popup[0].setProps({
          getReferenceClientRect: props.clientRect as () => DOMRect,
        })
      },

      onKeyDown: (props: SuggestionKeyDownProps) => {
        if (props.event.key === 'Escape') {
          popup[0].hide()
          return true
        }
        return (component.ref as { onKeyDown?: (props: SuggestionKeyDownProps) => boolean })?.onKeyDown?.(props) ?? false
      },

      onExit: () => {
        popup?.[0]?.destroy()
        component?.destroy()
      },
    }
  },
}
