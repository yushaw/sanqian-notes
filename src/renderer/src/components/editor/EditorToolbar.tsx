/**
 * Responsive floating editor toolbar with AI actions, text formatting,
 * paragraph types, lists, block elements, color picker, and typewriter mode.
 *
 * Includes ToolbarButton and ToolbarDropdown sub-components.
 */

import { useEffect, useState, useRef } from 'react'
import type { useEditor } from '@tiptap/react'
import type { useTranslations } from '../../i18n'
import { ColorPicker } from '../ColorPicker'
import { shortcuts } from '../../utils/shortcuts'
import { ScrollText } from 'lucide-react'
import { selectionHasNonCodeText, toTextSelectionRange } from './link-selection'

// SVG Icons for toolbar
const ToolbarIcons = {
  bold: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
      <path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
    </svg>
  ),
  italic: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="4" x2="10" y2="4" />
      <line x1="14" y1="20" x2="5" y2="20" />
      <line x1="15" y1="4" x2="9" y2="20" />
    </svg>
  ),
  strikethrough: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4H9a3 3 0 0 0-2.83 4" />
      <path d="M14 12a4 4 0 0 1 0 8H6" />
      <line x1="4" y1="12" x2="20" y2="12" />
    </svg>
  ),
  heading: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12h8" />
      <path d="M4 18V6" />
      <path d="M12 18V6" />
      <path d="M17 10v8" />
      <path d="M21 10v8" />
      <path d="M17 14h4" />
    </svg>
  ),
  list: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  ),
  bulletList: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  ),
  orderedList: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="10" y1="6" x2="21" y2="6" />
      <line x1="10" y1="12" x2="21" y2="12" />
      <line x1="10" y1="18" x2="21" y2="18" />
      <path d="M4 6h1v4" />
      <path d="M4 10h2" />
      <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
    </svg>
  ),
  taskList: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="6" height="6" rx="1" />
      <path d="m3 17 2 2 4-4" />
      <path d="M13 6h8" />
      <path d="M13 12h8" />
      <path d="M13 18h8" />
    </svg>
  ),
  block: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z" />
      <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z" />
    </svg>
  ),
  quote: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z" />
      <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z" />
    </svg>
  ),
  code: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  ),
  typewriter: <ScrollText size={16} />,
  focus: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M3 12h3m12 0h3M12 3v3m0 12v3" />
    </svg>
  ),
  chevronUp: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  ),
  highlight: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 11-6 6v3h9l3-3" />
      <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
    </svg>
  ),
  underline: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4v6a6 6 0 0 0 12 0V4" />
      <line x1="4" y1="20" x2="20" y2="20" />
    </svg>
  ),
  textColor: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h16" />
      <path d="m6 16 6-12 6 12" />
      <path d="M8 12h8" />
    </svg>
  ),
  sparkles: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      <path d="M5 3v4" />
      <path d="M19 17v4" />
      <path d="M3 5h4" />
      <path d="M17 19h4" />
    </svg>
  ),
}

// --- Sub-components ---

function ToolbarButton({
  icon,
  active,
  onClick,
  title,
  disabled = false,
}: {
  icon: React.ReactNode
  active?: boolean
  onClick: () => void
  title: string
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      data-tooltip={title}
      className={`zen-toolbar-btn ${active ? 'active' : ''}`}
      disabled={disabled}
    >
      {icon}
    </button>
  )
}

interface DropdownItem {
  label: string
  icon?: React.ReactNode
  active?: boolean
  onClick: () => void
  shortcut?: string
  disabled?: boolean
}

function ToolbarDropdown({
  icon,
  active,
  items,
  forceClose
}: {
  icon: React.ReactNode
  active?: boolean
  items: DropdownItem[]
  forceClose?: boolean
}) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (forceClose) {
      setIsOpen(false)
    }
  }, [forceClose])

  return (
    <div className="zen-toolbar-dropdown" ref={dropdownRef}>
      <button
        className={`zen-toolbar-btn zen-toolbar-dropdown-trigger ${active ? 'active' : ''} ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        {icon}
        {ToolbarIcons.chevronUp}
      </button>
      {isOpen && (
        <div className="zen-toolbar-dropdown-menu">
          {items.map((item, index) => (
            <button
              key={index}
              className={`zen-toolbar-dropdown-item ${item.active ? 'active' : ''}`}
              disabled={item.disabled}
              onClick={() => {
                item.onClick()
                setIsOpen(false)
              }}
            >
              {item.icon && <span className="zen-toolbar-dropdown-icon">{item.icon}</span>}
              <span className="zen-toolbar-dropdown-label">{item.label}</span>
              {item.shortcut && <span className="zen-toolbar-dropdown-shortcut">{item.shortcut}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// --- Main toolbar component ---

export function EditorToolbar({
  editor,
  t,
  isFocusMode: _isFocusMode,
  isTypewriterMode,
  toggleFocusMode: _toggleFocusMode,
  toggleTypewriterMode,
  showToolbar,
  aiActions,
  onAIActionClick,
  isAIProcessing
}: {
  editor: ReturnType<typeof useEditor>
  t: ReturnType<typeof useTranslations>
  isFocusMode: boolean
  isTypewriterMode: boolean
  toggleFocusMode: () => void
  toggleTypewriterMode: () => void
  showToolbar: boolean
  aiActions: AIAction[]
  onAIActionClick: (action: AIAction) => void
  isAIProcessing: boolean
}) {
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [isCompact, setIsCompact] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [showAIMenu, setShowAIMenu] = useState(false)
  const colorPickerRef = useRef<HTMLDivElement>(null)
  const aiMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const checkWidth = () => {
      if (toolbarRef.current) {
        const parent = toolbarRef.current.parentElement
        if (parent) {
          setIsCompact(parent.clientWidth < 760)
        }
      }
    }

    checkWidth()
    window.addEventListener('resize', checkWidth)
    return () => window.removeEventListener('resize', checkWidth)
  }, [])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setShowColorPicker(false)
      }
      if (aiMenuRef.current && !aiMenuRef.current.contains(e.target as Node)) {
        setShowAIMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (!showToolbar) {
      setShowColorPicker(false)
      setShowAIMenu(false)
    }
  }, [showToolbar])

  if (!editor) return null

  const isBody = editor.isActive('paragraph') && !editor.isActive('heading')
  const currentTextSelection = toTextSelectionRange(editor.state.selection)
  const inlineMarksDisabled = editor.isActive('code')
    || (!!currentTextSelection && !selectionHasNonCodeText(editor.state.doc, currentTextSelection))
  const inlineMarksTitle = inlineMarksDisabled
    ? t.contextMenu.markUnavailableInCode
    : ''

  if (isCompact) {
    return (
      <div ref={toolbarRef} className={`zen-toolbar ${showToolbar ? 'visible' : ''}`}>
        {/* AI */}
        <div className="zen-toolbar-dropdown" ref={aiMenuRef}>
          <button
            className={`zen-toolbar-btn zen-toolbar-dropdown-trigger ${isAIProcessing ? 'active' : ''} ${showAIMenu ? 'open' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setShowAIMenu(!showAIMenu)}
          >
            {ToolbarIcons.sparkles}
            {ToolbarIcons.chevronUp}
          </button>
          {showAIMenu && aiActions.length > 0 && (
            <div className="zen-toolbar-dropdown-menu zen-toolbar-ai-menu">
              {aiActions.map((action) => (
                <button
                  key={action.id}
                  className="zen-toolbar-ai-menu-item"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onAIActionClick(action)
                    setShowAIMenu(false)
                  }}
                >
                  <span className="zen-toolbar-ai-menu-icon">{action.icon}</span>
                  <span className="zen-toolbar-ai-menu-label">{action.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="zen-toolbar-divider" />
        <ToolbarDropdown
          icon={ToolbarIcons.bold}
          active={editor.isActive('bold') || editor.isActive('italic') || editor.isActive('strike') || editor.isActive('highlight') || editor.isActive('underline')}
          forceClose={!showToolbar}
          items={[
            { label: t.toolbar.bold, icon: ToolbarIcons.bold, active: editor.isActive('bold'), onClick: () => editor.chain().focus().toggleBold().run(), shortcut: shortcuts.bold, disabled: inlineMarksDisabled },
            { label: t.toolbar.italic, icon: ToolbarIcons.italic, active: editor.isActive('italic'), onClick: () => editor.chain().focus().toggleItalic().run(), shortcut: shortcuts.italic, disabled: inlineMarksDisabled },
            { label: t.toolbar.strikethrough, icon: ToolbarIcons.strikethrough, active: editor.isActive('strike'), onClick: () => editor.chain().focus().toggleStrike().run(), shortcut: shortcuts.strike, disabled: inlineMarksDisabled },
            { label: t.toolbar.underline, icon: ToolbarIcons.underline, active: editor.isActive('underline'), onClick: () => editor.chain().focus().toggleUnderline().run(), shortcut: shortcuts.underline, disabled: inlineMarksDisabled },
            { label: t.toolbar.highlight, icon: ToolbarIcons.highlight, active: editor.isActive('highlight'), onClick: () => editor.chain().focus().toggleHighlight().run(), shortcut: shortcuts.highlight, disabled: inlineMarksDisabled },
          ]}
        />
        <ToolbarDropdown
          icon={ToolbarIcons.heading}
          active={editor.isActive('heading')}
          forceClose={!showToolbar}
          items={[
            { label: 'Body', active: isBody, onClick: () => editor.chain().focus().setParagraph().run(), shortcut: shortcuts.body },
            { label: 'H1', active: editor.isActive('heading', { level: 1 }), onClick: () => editor.chain().focus().toggleHeading({ level: 1 }).run(), shortcut: shortcuts.h1 },
            { label: 'H2', active: editor.isActive('heading', { level: 2 }), onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), shortcut: shortcuts.h2 },
            { label: 'H3', active: editor.isActive('heading', { level: 3 }), onClick: () => editor.chain().focus().toggleHeading({ level: 3 }).run(), shortcut: shortcuts.h3 },
            { label: 'H4', active: editor.isActive('heading', { level: 4 }), onClick: () => editor.chain().focus().toggleHeading({ level: 4 }).run(), shortcut: shortcuts.h4 },
          ]}
        />
        <ToolbarDropdown
          icon={ToolbarIcons.list}
          active={editor.isActive('bulletList') || editor.isActive('orderedList') || editor.isActive('taskList')}
          forceClose={!showToolbar}
          items={[
            { label: t.toolbar.bulletList, icon: ToolbarIcons.bulletList, active: editor.isActive('bulletList'), onClick: () => editor.chain().focus().toggleBulletList().run(), shortcut: shortcuts.bulletList },
            { label: t.toolbar.numberedList, icon: ToolbarIcons.orderedList, active: editor.isActive('orderedList'), onClick: () => editor.chain().focus().toggleOrderedList().run(), shortcut: shortcuts.orderedList },
            { label: t.toolbar.checklist, icon: ToolbarIcons.taskList, active: editor.isActive('taskList'), onClick: () => editor.chain().focus().toggleTaskList().run(), shortcut: shortcuts.taskList },
          ]}
        />
        <ToolbarDropdown
          icon={ToolbarIcons.block}
          active={editor.isActive('blockquote') || editor.isActive('code')}
          forceClose={!showToolbar}
          items={[
            { label: t.toolbar.quote, icon: ToolbarIcons.quote, active: editor.isActive('blockquote'), onClick: () => editor.chain().focus().toggleBlockquote().run(), shortcut: shortcuts.quote },
            { label: t.toolbar.code, icon: ToolbarIcons.code, active: editor.isActive('code'), onClick: () => editor.chain().focus().toggleCode().run(), shortcut: shortcuts.code },
          ]}
        />
        <div className="zen-toolbar-divider" />
        <div className="zen-toolbar-color-wrapper" ref={colorPickerRef}>
          <ToolbarButton
            active={showColorPicker}
            onClick={() => setShowColorPicker(!showColorPicker)}
            title={inlineMarksDisabled ? inlineMarksTitle : t.toolbar.color}
            icon={ToolbarIcons.textColor}
            disabled={inlineMarksDisabled}
          />
          {showColorPicker && (
            <div className="zen-toolbar-color-popup">
              <ColorPicker editor={editor} onClose={() => setShowColorPicker(false)} />
            </div>
          )}
        </div>
        <div className="zen-toolbar-divider" />
        <ToolbarButton active={isTypewriterMode} onClick={toggleTypewriterMode} title={t.typewriter.typewriterMode} icon={ToolbarIcons.typewriter} />
      </div>
    )
  }

  return (
    <div ref={toolbarRef} className={`zen-toolbar ${showToolbar ? 'visible' : ''}`}>
      {/* AI */}
      <div className="zen-toolbar-dropdown" ref={aiMenuRef}>
        <button
          className={`zen-toolbar-btn zen-toolbar-dropdown-trigger ${isAIProcessing ? 'active' : ''} ${showAIMenu ? 'open' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setShowAIMenu(!showAIMenu)}
        >
          {ToolbarIcons.sparkles}
          {ToolbarIcons.chevronUp}
        </button>
        {showAIMenu && aiActions.length > 0 && (
          <div className="zen-toolbar-dropdown-menu zen-toolbar-ai-menu">
            {aiActions.map((action) => (
              <button
                key={action.id}
                className="zen-toolbar-ai-menu-item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onAIActionClick(action)
                  setShowAIMenu(false)
                }}
              >
                <span className="zen-toolbar-ai-menu-icon">{action.icon}</span>
                <span className="zen-toolbar-ai-menu-label">{action.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="zen-toolbar-divider" />
      <ToolbarButton active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title={inlineMarksDisabled ? inlineMarksTitle : `${t.toolbar.bold} (${shortcuts.bold})`} icon={ToolbarIcons.bold} disabled={inlineMarksDisabled} />
      <ToolbarButton active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title={inlineMarksDisabled ? inlineMarksTitle : `${t.toolbar.italic} (${shortcuts.italic})`} icon={ToolbarIcons.italic} disabled={inlineMarksDisabled} />
      <ToolbarButton active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} title={inlineMarksDisabled ? inlineMarksTitle : `${t.toolbar.underline} (${shortcuts.underline})`} icon={ToolbarIcons.underline} disabled={inlineMarksDisabled} />
      <ToolbarButton active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} title={inlineMarksDisabled ? inlineMarksTitle : `${t.toolbar.strikethrough} (${shortcuts.strike})`} icon={ToolbarIcons.strikethrough} disabled={inlineMarksDisabled} />
      <ToolbarButton active={editor.isActive('highlight')} onClick={() => editor.chain().focus().toggleHighlight().run()} title={inlineMarksDisabled ? inlineMarksTitle : `${t.toolbar.highlight} (${shortcuts.highlight})`} icon={ToolbarIcons.highlight} disabled={inlineMarksDisabled} />
      <div className="zen-toolbar-color-wrapper" ref={colorPickerRef}>
        <ToolbarButton
          active={showColorPicker}
          onClick={() => setShowColorPicker(!showColorPicker)}
          title={inlineMarksDisabled ? inlineMarksTitle : t.toolbar.color}
          icon={ToolbarIcons.textColor}
          disabled={inlineMarksDisabled}
        />
        {showColorPicker && (
          <div className="zen-toolbar-color-popup">
            <ColorPicker editor={editor} onClose={() => setShowColorPicker(false)} />
          </div>
        )}
      </div>
      <div className="zen-toolbar-divider" />
      <ToolbarButton active={isBody} onClick={() => editor.chain().focus().setParagraph().run()} title={`${t.slashCommand.paragraph} (${shortcuts.body})`} icon={<span className="zen-toolbar-text">Body</span>} />
      <ToolbarButton active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title={`${t.toolbar.heading1} (${shortcuts.h1})`} icon={<span className="zen-toolbar-text">H1</span>} />
      <ToolbarButton active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title={`${t.toolbar.heading2} (${shortcuts.h2})`} icon={<span className="zen-toolbar-text">H2</span>} />
      <ToolbarButton active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title={`${t.toolbar.heading3} (${shortcuts.h3})`} icon={<span className="zen-toolbar-text">H3</span>} />
      <ToolbarButton active={editor.isActive('heading', { level: 4 })} onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()} title={`${t.toolbar.heading4} (${shortcuts.h4})`} icon={<span className="zen-toolbar-text">H4</span>} />
      <div className="zen-toolbar-divider" />
      <ToolbarButton active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title={`${t.toolbar.bulletList} (${shortcuts.bulletList})`} icon={ToolbarIcons.bulletList} />
      <ToolbarButton active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title={`${t.toolbar.numberedList} (${shortcuts.orderedList})`} icon={ToolbarIcons.orderedList} />
      <ToolbarButton active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()} title={`${t.toolbar.checklist} (${shortcuts.taskList})`} icon={ToolbarIcons.taskList} />
      <div className="zen-toolbar-divider" />
      <ToolbarButton active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} title={`${t.toolbar.quote} (${shortcuts.quote})`} icon={ToolbarIcons.quote} />
      <ToolbarButton active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()} title={`${t.toolbar.code} (${shortcuts.code})`} icon={ToolbarIcons.code} />
      <div className="zen-toolbar-divider" />
      <ToolbarButton active={isTypewriterMode} onClick={toggleTypewriterMode} title={t.typewriter.typewriterMode} icon={ToolbarIcons.typewriter} />
    </div>
  )
}
