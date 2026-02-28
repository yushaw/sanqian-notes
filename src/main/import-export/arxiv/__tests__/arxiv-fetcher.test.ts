import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchMetadata, parseArxivInput } from '../arxiv-fetcher'

describe('parseArxivInput', () => {
  it('parses strict new-format IDs and URL forms', () => {
    expect(parseArxivInput('2401.00001')).toEqual({ id: '2401.00001', version: undefined })
    expect(parseArxivInput('2401.00001v3')).toEqual({ id: '2401.00001', version: 3 })
    expect(parseArxivInput('arxiv:2401.00001v2')).toEqual({ id: '2401.00001', version: 2 })
    expect(parseArxivInput('https://arxiv.org/abs/2401.00001')).toEqual({ id: '2401.00001', version: undefined })
    expect(parseArxivInput('https://arxiv.org/pdf/2401.00001v4.pdf')).toEqual({ id: '2401.00001', version: 4 })
    expect(parseArxivInput('ar5iv.labs.arxiv.org/html/2401.00001v5')).toEqual({ id: '2401.00001', version: 5 })
  })

  it('parses old-format IDs with dotted categories', () => {
    expect(parseArxivInput('math.GT/0309136')).toEqual({ id: 'math.GT/0309136', version: undefined })
    expect(parseArxivInput('https://arxiv.org/abs/math.GT/0309136v2')).toEqual({ id: 'math.GT/0309136', version: 2 })
  })

  it('rejects partial or malformed matches', () => {
    expect(parseArxivInput('foo2401.00001bar')).toBeNull()
    expect(parseArxivInput('https://arxiv.org/abs/2401.00001/extra')).toBeNull()
    expect(parseArxivInput('https://example.com/abs/2401.00001')).toBeNull()
    expect(parseArxivInput('https://arxiv.org/abs/2401.00001%ZZ')).toBeNull()
  })
})

describe('fetchMetadata abort behavior', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes an already-aborted signal through to fetch', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal | undefined
      if (signal?.aborted) {
        const abortError = new Error('Aborted')
        abortError.name = 'AbortError'
        throw abortError
      }
      return new Response('<html></html>', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const controller = new AbortController()
    controller.abort()

    await expect(fetchMetadata('2401.00001', undefined, controller.signal)).rejects.toThrow('Aborted')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const callInit = fetchMock.mock.calls[0][1] as RequestInit | undefined
    expect((callInit?.signal as AbortSignal).aborted).toBe(true)
  })
})
