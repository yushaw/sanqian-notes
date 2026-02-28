import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'ready' | 'error'

interface UpdateState {
  status: UpdateStatus
  version: string | null
  progress: number
  error: string | null
  releaseNotes: string | null
}

interface UpdateContextValue extends UpdateState {
  checkForUpdates: () => Promise<void>
  downloadUpdate: () => Promise<void>
  installUpdate: () => void
}

const UpdateContext = createContext<UpdateContextValue | null>(null)

export function UpdateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<UpdateState>({
    status: 'idle',
    version: null,
    progress: 0,
    error: null,
    releaseNotes: null
  })

  useEffect(() => {
    window.electron?.updater?.getStatus().then((status) => {
      if (status) {
        setState(prev => ({
          ...prev,
          ...status,
          status: status.status as UpdateStatus,
          releaseNotes: status.releaseNotes ?? null
        }))
      }
    }).catch(() => {
      // Updater may be unavailable in dev mode
    })

    const cleanup = window.electron?.updater?.onStatus((status) => {
      setState(prev => ({
        ...prev,
        ...status,
        status: status.status as UpdateStatus,
        releaseNotes: status.releaseNotes ?? null
      }))
    })

    return () => {
      cleanup?.()
    }
  }, [])

  const checkForUpdates = useCallback(async () => {
    await window.electron?.updater?.check()
  }, [])

  const downloadUpdate = useCallback(async () => {
    await window.electron?.updater?.download()
  }, [])

  const installUpdate = useCallback(() => {
    window.electron?.updater?.install()
  }, [])

  const value = useMemo<UpdateContextValue>(() => ({
    ...state,
    checkForUpdates,
    downloadUpdate,
    installUpdate
  }), [state, checkForUpdates, downloadUpdate, installUpdate])

  return (
    <UpdateContext.Provider value={value}>
      {children}
    </UpdateContext.Provider>
  )
}

export function useUpdate(): UpdateContextValue {
  const context = useContext(UpdateContext)
  if (!context) {
    throw new Error('useUpdate must be used within an UpdateProvider')
  }
  return context
}
