import { NodeViewWrapper, NodeViewProps } from '@tiptap/react'
import { useRef } from 'react'
import { useTranslations } from '../i18n'

interface AudioAttrs {
  src: string
  title?: string
}

export function AudioView({ node, selected }: NodeViewProps) {
  const attrs = node.attrs as AudioAttrs
  const audioRef = useRef<HTMLAudioElement>(null)
  const t = useTranslations()

  return (
    <NodeViewWrapper className={`audio-wrapper ${selected ? 'selected' : ''}`}>
      <div className="audio-container">
        <div className="audio-icon">🎵</div>
        <div className="audio-info">
          <div className="audio-title">{attrs.title || t.media.audio}</div>
          <audio ref={audioRef} src={attrs.src} controls />
        </div>
      </div>
    </NodeViewWrapper>
  )
}
