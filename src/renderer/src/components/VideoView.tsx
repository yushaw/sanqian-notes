import { NodeViewWrapper, NodeViewProps } from '@tiptap/react'
import { useRef } from 'react'

interface VideoAttrs {
  src: string
  width?: number
  height?: number
}

export function VideoView({ node, selected }: NodeViewProps) {
  const attrs = node.attrs as VideoAttrs
  const videoRef = useRef<HTMLVideoElement>(null)

  return (
    <NodeViewWrapper className={`video-wrapper ${selected ? 'selected' : ''}`}>
      <video
        ref={videoRef}
        src={attrs.src}
        controls
        style={{
          width: attrs.width ? `${attrs.width}px` : '100%',
          maxWidth: '100%',
        }}
      />
    </NodeViewWrapper>
  )
}
