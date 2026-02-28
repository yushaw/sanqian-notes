import { NodeViewWrapper, NodeViewContent, NodeViewProps } from '@tiptap/react'
import { CALLOUT_TYPES, CalloutType } from './extensions/Callout'
import { useTranslations } from '../i18n'

export function CalloutView({ node, updateAttributes }: NodeViewProps) {
  const { type, title, collapsed } = node.attrs as { type: CalloutType; title: string | null; collapsed: boolean }
  const config = CALLOUT_TYPES[type] || CALLOUT_TYPES.note
  const t = useTranslations()

  const toggleCollapse = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    updateAttributes({ collapsed: !collapsed })
  }

  return (
    <NodeViewWrapper
      className={`callout callout-${type}`}
      style={{
        '--callout-color': config.color,
      } as React.CSSProperties}
    >
      <div className="callout-header" onClick={toggleCollapse}>
        <span className="callout-icon">{config.icon}</span>
        <span className="callout-title">{title || t.callout[type as keyof typeof t.callout]}</span>
        <span className={`callout-collapse-icon ${collapsed ? 'collapsed' : ''}`}>▼</span>
      </div>
      <div className={`callout-content ${collapsed ? 'hidden' : ''}`}>
        <NodeViewContent />
      </div>
    </NodeViewWrapper>
  )
}
