/**
 * Custom hook encapsulating the embed popup state and logic.
 *
 * Owns: showEmbedPopup, embedUrl
 *
 * Manages: embed:select window event listener.
 */

import { useState, useCallback, useEffect } from 'react'
import type { useEditor } from '@tiptap/react'
import { convertToEmbedUrl } from '../../utils/embedUrl'

export function useEditorEmbedPopup({
  editor,
  t,
}: {
  editor: ReturnType<typeof useEditor>
  t: { embed?: { invalidUrl?: string } }
}) {
  const [showEmbedPopup, setShowEmbedPopup] = useState(false)
  const [embedUrl, setEmbedUrl] = useState('')

  // Listen for embed:select event from SlashCommand
  useEffect(() => {
    const handleEmbedSelect = () => {
      setShowEmbedPopup(true)
      setEmbedUrl('')
    }

    window.addEventListener('embed:select', handleEmbedSelect)
    return () => {
      window.removeEventListener('embed:select', handleEmbedSelect)
    }
  }, [])

  const handleInsertEmbed = useCallback(() => {
    if (!editor || !embedUrl.trim()) return

    let urlToUse = embedUrl.trim()
    if (!/^https?:\/\//i.test(urlToUse)) {
      urlToUse = 'https://' + urlToUse
    }

    try {
      new URL(urlToUse)
    } catch {
      alert(t.embed?.invalidUrl || 'Invalid URL')
      return
    }

    const convertedUrl = convertToEmbedUrl(urlToUse)

    editor.chain().focus().setEmbed({
      mode: 'url',
      url: convertedUrl,
      title: '',
      height: 400,
    }).run()

    setShowEmbedPopup(false)
    setEmbedUrl('')
  }, [editor, embedUrl, t])

  const handleCloseEmbedPopup = useCallback(() => {
    setShowEmbedPopup(false)
    setEmbedUrl('')
  }, [])

  return {
    showEmbedPopup,
    embedUrl,
    setEmbedUrl,
    handleInsertEmbed,
    handleCloseEmbedPopup,
  }
}
