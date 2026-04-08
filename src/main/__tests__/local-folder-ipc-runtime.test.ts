import { describe, expect, it } from 'vitest'
import { createLocalFolderIpcConcurrencyRuntime } from '../local-folder-ipc-runtime'

describe('local-folder-ipc-runtime', () => {
  it('global mutation waits for in-flight notebook mutation', async () => {
    const runtime = createLocalFolderIpcConcurrencyRuntime()
    let resolveNotebookMutation: () => void = () => {}
    let globalMutationStarted = false

    const notebookMutationTask = runtime.runLocalFolderNotebookMutationSerialized('nb-1', async () => {
      await new Promise<void>((resolve) => {
        resolveNotebookMutation = resolve
      })
    })
    await Promise.resolve()
    await Promise.resolve()

    const globalMutationTask = runtime.runLocalFolderGlobalMutationSerialized(async () => {
      globalMutationStarted = true
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(globalMutationStarted).toBe(false)

    resolveNotebookMutation()
    await Promise.all([notebookMutationTask, globalMutationTask])
    expect(globalMutationStarted).toBe(true)
  })

  it('global mutation waits for in-flight topology read scope', async () => {
    const runtime = createLocalFolderIpcConcurrencyRuntime()
    let resolveRead: () => void = () => {}
    let mutationStarted = false

    const readTask = runtime.runWithLocalFolderTopologyReadScope(async () => {
      await new Promise<void>((resolve) => {
        resolveRead = resolve
      })
    })
    await Promise.resolve()
    await Promise.resolve()

    const mutationTask = runtime.runLocalFolderGlobalMutationSerialized(async () => {
      mutationStarted = true
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(mutationStarted).toBe(false)

    resolveRead()
    await Promise.all([readTask, mutationTask])
    expect(mutationStarted).toBe(true)
  })

  it('new topology read waits while global mutation is queued', async () => {
    const runtime = createLocalFolderIpcConcurrencyRuntime()
    let resolveMutation: () => void = () => {}
    let readStarted = false

    const mutationTask = runtime.runLocalFolderGlobalMutationSerialized(async () => {
      await new Promise<void>((resolve) => {
        resolveMutation = resolve
      })
    })
    await Promise.resolve()
    await Promise.resolve()

    const readTask = runtime.runWithLocalFolderTopologyReadScope(async () => {
      readStarted = true
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(readStarted).toBe(false)

    resolveMutation()
    await Promise.all([mutationTask, readTask])
    expect(readStarted).toBe(true)
  })

  it('new notebook mutation waits while global mutation is queued', async () => {
    const runtime = createLocalFolderIpcConcurrencyRuntime()
    let resolveGlobalMutation: () => void = () => {}
    let notebookMutationStarted = false

    const globalMutationTask = runtime.runLocalFolderGlobalMutationSerialized(async () => {
      await new Promise<void>((resolve) => {
        resolveGlobalMutation = resolve
      })
    })
    await Promise.resolve()
    await Promise.resolve()

    const notebookMutationTask = runtime.runLocalFolderNotebookMutationSerialized('nb-1', async () => {
      notebookMutationStarted = true
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(notebookMutationStarted).toBe(false)

    resolveGlobalMutation()
    await Promise.all([globalMutationTask, notebookMutationTask])
    expect(notebookMutationStarted).toBe(true)
  })

  it('consistent read waits while global mutation is queued', async () => {
    const runtime = createLocalFolderIpcConcurrencyRuntime()
    let resolveMutation: () => void = () => {}
    let readStarted = false

    const mutationTask = runtime.runLocalFolderGlobalMutationSerialized(async () => {
      await new Promise<void>((resolve) => {
        resolveMutation = resolve
      })
    })
    await Promise.resolve()
    await Promise.resolve()

    const readTask = runtime.runWithLocalFolderConsistentRead(async () => {
      readStarted = true
    }, ['nb-1'])
    await Promise.resolve()
    await Promise.resolve()
    expect(readStarted).toBe(false)

    resolveMutation()
    await Promise.all([mutationTask, readTask])
    expect(readStarted).toBe(true)
  })

  it('notebook mutation waits for in-flight scoped consistent read on the same notebook', async () => {
    const runtime = createLocalFolderIpcConcurrencyRuntime()
    let resolveRead: () => void = () => {}
    let mutationStarted = false

    const readTask = runtime.runWithLocalFolderConsistentRead(async () => {
      await new Promise<void>((resolve) => {
        resolveRead = resolve
      })
    }, ['nb-1'])
    await Promise.resolve()
    await Promise.resolve()

    const mutationTask = runtime.runLocalFolderNotebookMutationSerialized('nb-1', async () => {
      mutationStarted = true
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(mutationStarted).toBe(false)

    resolveRead()
    await Promise.all([readTask, mutationTask])
    expect(mutationStarted).toBe(true)
  })

  it('scoped consistent read waits while notebook mutation is queued for the same notebook', async () => {
    const runtime = createLocalFolderIpcConcurrencyRuntime()
    let resolveMutation: () => void = () => {}
    let readStarted = false

    const mutationTask = runtime.runLocalFolderNotebookMutationSerialized('nb-1', async () => {
      await new Promise<void>((resolve) => {
        resolveMutation = resolve
      })
    })
    await Promise.resolve()
    await Promise.resolve()

    const readTask = runtime.runWithLocalFolderConsistentRead(async () => {
      readStarted = true
    }, ['nb-1'])
    await Promise.resolve()
    await Promise.resolve()
    expect(readStarted).toBe(false)

    resolveMutation()
    await Promise.all([mutationTask, readTask])
    expect(readStarted).toBe(true)
  })

  it('scoped consistent read does not wait for unrelated notebook mutation', async () => {
    const runtime = createLocalFolderIpcConcurrencyRuntime()
    let resolveMutation: () => void = () => {}
    let readStarted = false

    const mutationTask = runtime.runLocalFolderNotebookMutationSerialized('nb-1', async () => {
      await new Promise<void>((resolve) => {
        resolveMutation = resolve
      })
    })
    await Promise.resolve()
    await Promise.resolve()

    await runtime.runWithLocalFolderConsistentRead(async () => {
      readStarted = true
    }, ['nb-2'])
    expect(readStarted).toBe(true)

    resolveMutation()
    await mutationTask
  })

  it('emits slow-wait diagnostics for blocked consistent reads', async () => {
    const events: Array<{
      operation: string
      phase: string
      notebookIds?: string[]
    }> = []
    const runtime = createLocalFolderIpcConcurrencyRuntime({
      slowWaitThresholdMs: 0,
      logSlowWait: (event) => {
        events.push({
          operation: event.operation,
          phase: event.phase,
          notebookIds: event.notebookIds,
        })
      },
    })
    let resolveMutation: () => void = () => {}

    const mutationTask = runtime.runLocalFolderGlobalMutationSerialized(async () => {
      await new Promise<void>((resolve) => {
        resolveMutation = resolve
      })
    })
    await Promise.resolve()
    await Promise.resolve()

    const readTask = runtime.runWithLocalFolderConsistentRead(async () => undefined, ['nb-1'])
    await Promise.resolve()
    await Promise.resolve()

    resolveMutation()
    await Promise.all([mutationTask, readTask])
    expect(events.some((event) => {
      return (
        event.operation === 'consistent_read'
        && event.phase === 'wait_mutation_tails'
        && event.notebookIds?.[0] === 'nb-1'
      )
    })).toBe(true)
  })

  it('coalesces duplicate slow-wait logs within the configured window', async () => {
    let currentTimeMs = 10_000
    const events: Array<{
      operation: string
      phase: string
      waitedMs: number
      suppressedCount?: number
    }> = []
    const runtime = createLocalFolderIpcConcurrencyRuntime({
      slowWaitThresholdMs: 0,
      slowWaitLogWindowMs: 100,
      now: () => currentTimeMs,
      logSlowWait: (event) => {
        events.push({
          operation: event.operation,
          phase: event.phase,
          waitedMs: event.waitedMs,
          suppressedCount: event.suppressedCount,
        })
      },
    })

    const runBlockedConsistentRead = async (waitedMs: number): Promise<void> => {
      let resolveMutation: () => void = () => {}
      const mutationTask = runtime.runLocalFolderGlobalMutationSerialized(async () => {
        await new Promise<void>((resolve) => {
          resolveMutation = resolve
        })
      })
      await Promise.resolve()
      await Promise.resolve()

      const readTask = runtime.runWithLocalFolderConsistentRead(async () => undefined, ['nb-1'])
      await Promise.resolve()
      await Promise.resolve()

      currentTimeMs += waitedMs
      resolveMutation()
      await Promise.all([mutationTask, readTask])
    }

    await runBlockedConsistentRead(12)
    currentTimeMs += 20
    await runBlockedConsistentRead(7)
    currentTimeMs += 120
    await runBlockedConsistentRead(20)

    const consistentReadEvents = events.filter((event) => {
      return event.operation === 'consistent_read' && event.phase === 'wait_mutation_tails'
    })
    expect(consistentReadEvents).toHaveLength(2)
    expect(consistentReadEvents[0]).toMatchObject({
      waitedMs: 12,
    })
    expect(consistentReadEvents[1]).toMatchObject({
      waitedMs: 20,
      suppressedCount: 1,
    })
  })

  it('evicts oldest slow-wait signature state when max signatures is exceeded', async () => {
    let currentTimeMs = 40_000
    const events: Array<{
      operation: string
      phase: string
      waitedMs: number
      notebookIds?: string[]
      suppressedCount?: number
    }> = []
    const runtime = createLocalFolderIpcConcurrencyRuntime({
      slowWaitThresholdMs: 0,
      slowWaitLogWindowMs: 1_000,
      slowWaitLogMaxSignatures: 1,
      now: () => currentTimeMs,
      logSlowWait: (event) => {
        events.push({
          operation: event.operation,
          phase: event.phase,
          waitedMs: event.waitedMs,
          notebookIds: event.notebookIds,
          suppressedCount: event.suppressedCount,
        })
      },
    })

    const runBlockedConsistentRead = async (notebookId: string, waitedMs: number): Promise<void> => {
      let resolveMutation: () => void = () => {}
      const mutationTask = runtime.runLocalFolderGlobalMutationSerialized(async () => {
        await new Promise<void>((resolve) => {
          resolveMutation = resolve
        })
      })
      await Promise.resolve()
      await Promise.resolve()

      const readTask = runtime.runWithLocalFolderConsistentRead(async () => undefined, [notebookId])
      await Promise.resolve()
      await Promise.resolve()

      currentTimeMs += waitedMs
      resolveMutation()
      await Promise.all([mutationTask, readTask])
    }

    await runBlockedConsistentRead('nb-1', 8)
    currentTimeMs += 10
    await runBlockedConsistentRead('nb-2', 6)
    currentTimeMs += 10
    await runBlockedConsistentRead('nb-1', 5)

    const consistentReadEvents = events.filter((event) => {
      return event.operation === 'consistent_read' && event.phase === 'wait_mutation_tails'
    })
    expect(consistentReadEvents).toHaveLength(3)
    expect(consistentReadEvents.map((event) => event.notebookIds?.[0])).toEqual([
      'nb-1',
      'nb-2',
      'nb-1',
    ])
    expect(consistentReadEvents.every((event) => event.suppressedCount === undefined)).toBe(true)
  })

  it('aggregates wait stats and tracks slow-count separately', async () => {
    let currentTimeMs = 20_000
    const runtime = createLocalFolderIpcConcurrencyRuntime({
      slowWaitThresholdMs: 10,
      now: () => currentTimeMs,
      logSlowWait: () => {},
    })

    const runBlockedConsistentRead = async (waitedMs: number): Promise<void> => {
      let resolveMutation: () => void = () => {}
      const mutationTask = runtime.runLocalFolderGlobalMutationSerialized(async () => {
        await new Promise<void>((resolve) => {
          resolveMutation = resolve
        })
      })
      await Promise.resolve()
      await Promise.resolve()

      const readTask = runtime.runWithLocalFolderConsistentRead(async () => undefined, ['nb-1'])
      await Promise.resolve()
      await Promise.resolve()

      currentTimeMs += waitedMs
      resolveMutation()
      await Promise.all([mutationTask, readTask])
    }

    await runBlockedConsistentRead(25)
    currentTimeMs += 5
    await runBlockedConsistentRead(7)

    const snapshot = runtime.getWaitStatsSnapshot()
    const entry = snapshot.entries.find((item) => {
      return item.operation === 'consistent_read' && item.phase === 'wait_mutation_tails'
    })
    expect(entry).toMatchObject({
      count: 2,
      slowCount: 1,
      totalWaitMs: 32,
      maxWaitMs: 25,
    })
  })

  it('resetWaitStats clears accumulated wait metrics', async () => {
    let currentTimeMs = 30_000
    const runtime = createLocalFolderIpcConcurrencyRuntime({
      slowWaitThresholdMs: 0,
      now: () => currentTimeMs,
      logSlowWait: () => {},
    })

    let resolveMutation: () => void = () => {}
    const mutationTask = runtime.runLocalFolderGlobalMutationSerialized(async () => {
      await new Promise<void>((resolve) => {
        resolveMutation = resolve
      })
    })
    await Promise.resolve()
    await Promise.resolve()

    const readTask = runtime.runWithLocalFolderConsistentRead(async () => undefined, ['nb-1'])
    await Promise.resolve()
    await Promise.resolve()
    currentTimeMs += 3
    resolveMutation()
    await Promise.all([mutationTask, readTask])

    expect(runtime.getWaitStatsSnapshot().entries.length).toBeGreaterThan(0)
    runtime.resetWaitStats()
    expect(runtime.getWaitStatsSnapshot().entries).toEqual([])
  })

  it('save scope acquisition waits while global mutation is queued', async () => {
    const runtime = createLocalFolderIpcConcurrencyRuntime()
    let resolveMutation: () => void = () => {}
    let acquired = ''

    const mutationTask = runtime.runLocalFolderGlobalMutationSerialized(async () => {
      await new Promise<void>((resolve) => {
        resolveMutation = resolve
      })
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(runtime.tryAcquireLocalFolderNotebookSaveScope('nb-1')).toBeNull()

    const acquireTask = runtime.waitAndAcquireLocalFolderNotebookSaveScope('nb-1').then((key) => {
      acquired = key
      runtime.releaseLocalFolderNotebookSaveScope(key)
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(acquired).toBe('')

    resolveMutation()
    await Promise.all([mutationTask, acquireTask])
    expect(acquired).toBe('nb-1')
  })

  it('serializes notebook mutations per notebook key', async () => {
    const runtime = createLocalFolderIpcConcurrencyRuntime()
    const executionOrder: string[] = []
    let resolveFirst: () => void = () => {}

    const first = runtime.runLocalFolderNotebookMutationSerialized('nb-1', async () => {
      executionOrder.push('first-start')
      await new Promise<void>((resolve) => {
        resolveFirst = resolve
      })
      executionOrder.push('first-end')
    })
    await Promise.resolve()
    await Promise.resolve()

    const second = runtime.runLocalFolderNotebookMutationSerialized('nb-1', async () => {
      executionOrder.push('second-start')
      executionOrder.push('second-end')
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(executionOrder).toEqual(['first-start'])

    resolveFirst()
    await Promise.all([first, second])
    expect(executionOrder).toEqual([
      'first-start',
      'first-end',
      'second-start',
      'second-end',
    ])
  })

  it('treats whitespace-padded notebook ids as distinct mutation keys', async () => {
    const runtime = createLocalFolderIpcConcurrencyRuntime()
    let resolveFirst: () => void = () => {}
    let secondStarted = false

    const first = runtime.runLocalFolderNotebookMutationSerialized('nb-1', async () => {
      await new Promise<void>((resolve) => {
        resolveFirst = resolve
      })
    })
    await Promise.resolve()
    await Promise.resolve()

    const second = runtime.runLocalFolderNotebookMutationSerialized(' nb-1 ', async () => {
      secondStarted = true
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(secondStarted).toBe(true)

    resolveFirst()
    await Promise.all([first, second])
  })

  it('throws when nested global mutation is invoked within notebook mutation scope', async () => {
    const runtime = createLocalFolderIpcConcurrencyRuntime()

    await expect(runtime.runLocalFolderNotebookMutationSerialized('nb-1', async () => {
      return runtime.runLocalFolderGlobalMutationSerialized(async () => undefined)
    })).rejects.toThrow('nested global mutation is not allowed')
  })

  it('throws when nested global mutation is invoked within global mutation scope', async () => {
    const runtime = createLocalFolderIpcConcurrencyRuntime()

    await expect(runtime.runLocalFolderGlobalMutationSerialized(async () => {
      return runtime.runLocalFolderGlobalMutationSerialized(async () => undefined)
    })).rejects.toThrow('nested global mutation is not allowed inside global mutation scope')
  })

  it('throws when nested notebook mutation is invoked within notebook mutation scope', async () => {
    const runtime = createLocalFolderIpcConcurrencyRuntime()

    await expect(runtime.runLocalFolderNotebookMutationSerialized('nb-1', async () => {
      return runtime.runLocalFolderNotebookMutationSerialized('nb-1', async () => undefined)
    })).rejects.toThrow('nested notebook mutation is not allowed')
  })

  it('throws when nested notebook mutation is invoked within global mutation scope', async () => {
    const runtime = createLocalFolderIpcConcurrencyRuntime()

    await expect(runtime.runLocalFolderGlobalMutationSerialized(async () => {
      return runtime.runLocalFolderNotebookMutationSerialized('nb-1', async () => undefined)
    })).rejects.toThrow('nested notebook mutation is not allowed inside global mutation scope')
  })
})
