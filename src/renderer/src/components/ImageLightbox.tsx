import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { IMAGE_LIGHTBOX_EVENT } from './ResizableImageView'

export function ImageLightbox() {
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [imageAlt, setImageAlt] = useState<string>('')
  const [scale, setScale] = useState(1)
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null)
  const [isReady, setIsReady] = useState(false)

  const calculateFitScale = useCallback((naturalWidth: number, naturalHeight: number) => {
    const maxWidth = window.innerWidth * 0.9
    const maxHeight = window.innerHeight * 0.9
    const fitScale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight)
    return Math.min(fitScale, 2)
  }, [])

  useEffect(() => {
    const handleOpen = (e: CustomEvent<{ src: string; alt?: string }>) => {
      const { src, alt } = e.detail
      setImageAlt(alt || '')

      const img = new Image()
      img.onload = () => {
        const initialScale = calculateFitScale(img.naturalWidth, img.naturalHeight)
        setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight })
        setScale(initialScale)
        setImageSrc(src)
        requestAnimationFrame(() => setIsReady(true))
      }
      img.onerror = () => {
        console.error('Failed to load image:', src)
        setImageSrc(null)
        setIsReady(false)
      }
      img.src = src
    }

    window.addEventListener(IMAGE_LIGHTBOX_EVENT, handleOpen as EventListener)
    return () => window.removeEventListener(IMAGE_LIGHTBOX_EVENT, handleOpen as EventListener)
  }, [calculateFitScale])

  const handleZoomIn = useCallback(() => {
    setScale((value) => Math.min(value + 0.25, 3))
  }, [])

  const handleZoomOut = useCallback(() => {
    setScale((value) => Math.max(value - 0.25, 0.25))
  }, [])

  const handleResetZoom = useCallback(() => {
    if (naturalSize) {
      setScale(calculateFitScale(naturalSize.width, naturalSize.height))
    }
  }, [naturalSize, calculateFitScale])

  const handleClose = useCallback(() => {
    setImageSrc(null)
    setImageAlt('')
    setScale(1)
    setNaturalSize(null)
    setIsReady(false)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!imageSrc) return
      if (e.key === 'Escape') {
        handleClose()
      } else if (e.key === '+' || e.key === '=') {
        handleZoomIn()
      } else if (e.key === '-') {
        handleZoomOut()
      } else if (e.key === '0') {
        handleResetZoom()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [imageSrc, handleClose, handleZoomIn, handleZoomOut, handleResetZoom])

  if (!imageSrc || !isReady) return null

  return createPortal(
    <div className="lightbox-overlay" role="dialog" aria-modal="true" aria-label="Image preview" onClick={handleClose}>
      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        <img
          src={imageSrc}
          alt={imageAlt}
          className="lightbox-image"
          style={{ transform: `scale(${scale})` }}
        />
      </div>

      <div className="lightbox-controls" onClick={(e) => e.stopPropagation()}>
        <button className="lightbox-control-btn" onClick={handleZoomOut} aria-label="Zoom out">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="8" y1="11" x2="14" y2="11" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
        <span className="lightbox-scale">{Math.round(scale * 100)}%</span>
        <button className="lightbox-control-btn" onClick={handleZoomIn} aria-label="Zoom in">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="11" y1="8" x2="11" y2="14" />
            <line x1="8" y1="11" x2="14" y2="11" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
      </div>

      <button className="lightbox-close" onClick={handleClose} aria-label="Close">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>,
    document.body
  )
}
