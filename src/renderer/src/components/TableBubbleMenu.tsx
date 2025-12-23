import type { Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { useTranslations } from '../i18n'

interface TableBubbleMenuProps {
  editor: Editor
}

export function TableBubbleMenu({ editor }: TableBubbleMenuProps) {
  const t = useTranslations()

  if (!editor) return null

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor }) => editor.isActive('table')}
      className="table-bubble-menu"
    >
      {/* Row operations */}
      <div className="table-bubble-group">
        <button
          onClick={() => editor.chain().focus().addRowBefore().run()}
          title={t.contextMenu.addRowBefore}
          className="table-bubble-btn"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 12h14" />
          </svg>
        </button>
        <button
          onClick={() => editor.chain().focus().addRowAfter().run()}
          title={t.contextMenu.addRowAfter}
          className="table-bubble-btn"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 12h14" />
          </svg>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <button
          onClick={() => editor.chain().focus().deleteRow().run()}
          title={t.contextMenu.deleteRow}
          className="table-bubble-btn table-bubble-btn-danger"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 12h14" />
          </svg>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="table-bubble-divider" />

      {/* Column operations */}
      <div className="table-bubble-group">
        <button
          onClick={() => editor.chain().focus().addColumnBefore().run()}
          title={t.contextMenu.addColumnBefore}
          className="table-bubble-btn"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14" />
          </svg>
        </button>
        <button
          onClick={() => editor.chain().focus().addColumnAfter().run()}
          title={t.contextMenu.addColumnAfter}
          className="table-bubble-btn"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14" />
          </svg>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <button
          onClick={() => editor.chain().focus().deleteColumn().run()}
          title={t.contextMenu.deleteColumn}
          className="table-bubble-btn table-bubble-btn-danger"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14" />
          </svg>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="table-bubble-divider" />

      {/* Delete table */}
      <button
        onClick={() => editor.chain().focus().deleteTable().run()}
        title={t.contextMenu.deleteTable}
        className="table-bubble-btn table-bubble-btn-danger"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      </button>
    </BubbleMenu>
  )
}
