import { useRef, useCallback, useEffect } from 'react'

/**
 * Manages the SDK reconnect hold (acquire/release) lifecycle.
 *
 * Usage:
 *   const reconnect = useReconnectHold()
 *   // Before streaming: await reconnect.acquire()
 *   // On complete/error/cancel: reconnect.release()
 *   // Cleanup on unmount is automatic.
 */
export function useReconnectHold() {
  const heldRef = useRef(false)

  const acquire = useCallback(async () => {
    await window.electron.chat.acquireReconnect()
    heldRef.current = true
  }, [])

  const release = useCallback(() => {
    if (heldRef.current) {
      heldRef.current = false
      window.electron.chat.releaseReconnect()
    }
  }, [])

  useEffect(() => {
    return () => {
      if (heldRef.current) {
        heldRef.current = false
        window.electron.chat.releaseReconnect()
      }
    }
  }, [])

  return { acquire, release }
}
