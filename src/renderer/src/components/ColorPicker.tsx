import { useState } from 'react'
import type { Editor } from '@tiptap/react'
import { useI18n } from '../i18n/context'

const COLOR_VALUES = {
  text: [
    { key: 'default', value: null },
    { key: 'gray', value: '#6b7280' },
    { key: 'red', value: '#ef4444' },
    { key: 'orange', value: '#f97316' },
    { key: 'yellow', value: '#eab308' },
    { key: 'green', value: '#22c55e' },
    { key: 'blue', value: '#3b82f6' },
    { key: 'purple', value: '#a855f7' },
    { key: 'pink', value: '#ec4899' },
  ],
  background: [
    { key: 'default', value: null },
    { key: 'gray', value: '#f3f4f6' },
    { key: 'red', value: '#fecaca' },
    { key: 'orange', value: '#fed7aa' },
    { key: 'yellow', value: '#fef08a' },
    { key: 'green', value: '#bbf7d0' },
    { key: 'blue', value: '#bfdbfe' },
    { key: 'purple', value: '#e9d5ff' },
    { key: 'pink', value: '#fbcfe8' },
  ],
}

interface ColorPickerProps {
  editor: Editor
  onClose: () => void
}

export function ColorPicker({ editor, onClose }: ColorPickerProps) {
  const { t } = useI18n()
  const [activeTab, setActiveTab] = useState<'text' | 'background'>('text')

  const handleColorSelect = (color: string | null) => {
    if (activeTab === 'text') {
      if (color) {
        editor.chain().focus().setColor(color).run()
      } else {
        editor.chain().focus().unsetColor().run()
      }
    } else {
      if (color) {
        editor.chain().focus().setHighlight({ color }).run()
      } else {
        editor.chain().focus().unsetHighlight().run()
      }
    }
    onClose()
  }

  const colors = activeTab === 'text' ? COLOR_VALUES.text : COLOR_VALUES.background

  const getColorName = (key: string): string => {
    return t.colors[key as keyof typeof t.colors] || key
  }

  return (
    <div className="color-picker">
      <div className="color-picker-tabs">
        <button
          className={`color-picker-tab ${activeTab === 'text' ? 'active' : ''}`}
          onClick={() => setActiveTab('text')}
        >
          {t.colors.textColor}
        </button>
        <button
          className={`color-picker-tab ${activeTab === 'background' ? 'active' : ''}`}
          onClick={() => setActiveTab('background')}
        >
          {t.colors.backgroundColor}
        </button>
      </div>
      <div className="color-picker-grid">
        {colors.map((color) => (
          <button
            key={color.key}
            className="color-picker-item"
            style={{
              backgroundColor: color.value || 'transparent',
              border: color.value ? 'none' : '1px dashed var(--color-border)',
            }}
            onClick={() => handleColorSelect(color.value)}
            title={getColorName(color.key)}
          >
            {!color.value && <span className="color-picker-clear">✕</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
