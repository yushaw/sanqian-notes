import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

interface SearchHelpers {
  requestVersion: number
  isCurrent: () => boolean
}

interface UseVersionedDebouncedSearchOptions<TResult> {
  execute: (query: string, helpers: SearchHelpers) => Promise<TResult | null | undefined>
  debounceMs?: number
  clearResultOnQueryChange?: boolean
  clearResultOnSearchStart?: boolean
  trimQuery?: boolean
  onError?: (error: unknown, query: string) => void
}

interface UseVersionedDebouncedSearchResult<TResult> {
  query: string
  result: TResult | null
  loading: boolean
  hasQuery: boolean
  handleQueryChange: (value: string) => void
  beginComposition: () => void
  endComposition: (value?: string) => void
  invalidate: () => void
  cancel: () => void
  reset: () => void
}

export function useVersionedDebouncedSearch<TResult>(
  options: UseVersionedDebouncedSearchOptions<TResult>
): UseVersionedDebouncedSearchResult<TResult> {
  const {
    execute,
    debounceMs = 150,
    clearResultOnQueryChange = false,
    clearResultOnSearchStart = false,
    trimQuery = true,
    onError,
  } = options

  const [query, setQuery] = useState('')
  const [result, setResult] = useState<TResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [isComposing, setIsComposing] = useState(false)
  const requestVersionRef = useRef(0)
  const queryRef = useRef(query)
  queryRef.current = query

  const normalizeQuery = useCallback((value: string) => {
    return trimQuery ? value.trim() : value
  }, [trimQuery])

  const invalidate = useCallback(() => {
    requestVersionRef.current += 1
  }, [])

  const cancel = useCallback(() => {
    invalidate()
    setLoading(false)
    setResult(null)
  }, [invalidate])

  const reset = useCallback(() => {
    setQuery('')
    cancel()
  }, [cancel])

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value)
    invalidate()

    if (isComposing) {
      // Defer search until composition commits to avoid querying intermediate IME text.
      if (!normalizeQuery(value)) {
        setLoading(false)
        setResult(null)
      } else {
        setLoading(false)
      }
      return
    }

    if (!normalizeQuery(value)) {
      setLoading(false)
      setResult(null)
      return
    }

    setLoading(true)
    if (clearResultOnQueryChange) {
      setResult(null)
    }
  }, [clearResultOnQueryChange, invalidate, isComposing, normalizeQuery])

  const beginComposition = useCallback(() => {
    setIsComposing(true)
    invalidate()
    setLoading(false)
  }, [invalidate])

  const endComposition = useCallback((value?: string) => {
    const nextValue = value ?? queryRef.current
    if (value !== undefined && value !== queryRef.current) {
      setQuery(value)
    }

    setIsComposing(false)

    if (!normalizeQuery(nextValue)) {
      setLoading(false)
      setResult(null)
      return
    }

    setLoading(true)
    if (clearResultOnQueryChange) {
      setResult(null)
    }
  }, [clearResultOnQueryChange, normalizeQuery])

  useEffect(() => {
    if (isComposing) return

    const normalizedQuery = normalizeQuery(query)
    if (!normalizedQuery) return

    const requestVersion = requestVersionRef.current + 1
    requestVersionRef.current = requestVersion
    if (clearResultOnSearchStart) {
      setResult(null)
    }
    setLoading(true)

    const timer = setTimeout(() => {
      void (async () => {
        const isCurrent = () => requestVersion === requestVersionRef.current
        try {
          const nextResult = await execute(normalizedQuery, { requestVersion, isCurrent })
          if (!isCurrent()) return
          if (nextResult !== undefined) {
            setResult(nextResult ?? null)
          }
        } catch (error) {
          if (!isCurrent()) return
          onError?.(error, normalizedQuery)
        } finally {
          if (isCurrent()) {
            setLoading(false)
          }
        }
      })()
    }, debounceMs)

    return () => clearTimeout(timer)
  }, [clearResultOnSearchStart, debounceMs, execute, isComposing, normalizeQuery, onError, query])

  const hasQuery = useMemo(() => normalizeQuery(query).length > 0, [normalizeQuery, query])

  return {
    query,
    result,
    loading,
    hasQuery,
    handleQueryChange,
    beginComposition,
    endComposition,
    invalidate,
    cancel,
    reset,
  }
}
