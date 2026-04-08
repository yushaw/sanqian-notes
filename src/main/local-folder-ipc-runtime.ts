import { AsyncLocalStorage } from 'node:async_hooks'

export interface LocalFolderIpcConcurrencyRuntime {
  waitForLocalFolderMutationTails: (notebookIds?: string[]) => Promise<void> | null
  runWithLocalFolderTopologyReadScope: <T>(task: () => Promise<T>) => Promise<T>
  runWithLocalFolderConsistentRead: <T>(
    task: () => Promise<T>,
    notebookIds?: string[]
  ) => Promise<T>
  runLocalFolderGlobalMutationSerialized: <T>(task: () => Promise<T>) => Promise<T>
  runLocalFolderNotebookMutationSerialized: <T>(notebookId: string, task: () => Promise<T>) => Promise<T>
  tryAcquireLocalFolderNotebookSaveScope: (notebookId: string) => string | null
  waitAndAcquireLocalFolderNotebookSaveScope: (notebookId: string) => Promise<string>
  releaseLocalFolderNotebookSaveScope: (mutationKey: string) => void
  getWaitStatsSnapshot: () => LocalFolderIpcRuntimeWaitStatsSnapshot
  resetWaitStats: () => void
}

export interface LocalFolderIpcRuntimeSlowWaitEvent {
  operation: 'global_mutation' | 'notebook_mutation' | 'save_scope' | 'topology_read' | 'consistent_read'
  phase: string
  waitedMs: number
  notebookIds?: string[]
  mutationKey?: string
  suppressedCount?: number
}

export interface LocalFolderIpcRuntimeWaitStatsEntry {
  operation: LocalFolderIpcRuntimeSlowWaitEvent['operation']
  phase: string
  count: number
  slowCount: number
  totalWaitMs: number
  maxWaitMs: number
}

export interface LocalFolderIpcRuntimeWaitStatsSnapshot {
  collectedAt: number
  entries: LocalFolderIpcRuntimeWaitStatsEntry[]
}

export interface LocalFolderIpcConcurrencyRuntimeOptions {
  slowWaitThresholdMs?: number
  slowWaitLogWindowMs?: number
  slowWaitLogMaxSignatures?: number
  now?: () => number
  logSlowWait?: (event: LocalFolderIpcRuntimeSlowWaitEvent) => void
}

export function createLocalFolderIpcConcurrencyRuntime(
  options: LocalFolderIpcConcurrencyRuntimeOptions = {}
): LocalFolderIpcConcurrencyRuntime {
  const now = options.now ?? Date.now
  const slowWaitThresholdMs = Number.isFinite(options.slowWaitThresholdMs)
    ? Math.max(0, options.slowWaitThresholdMs as number)
    : 250
  const slowWaitLogWindowMs = Number.isFinite(options.slowWaitLogWindowMs)
    ? Math.max(0, options.slowWaitLogWindowMs as number)
    : 30_000
  const slowWaitLogMaxSignatures = Number.isFinite(options.slowWaitLogMaxSignatures)
    ? Math.max(1, Math.floor(options.slowWaitLogMaxSignatures as number))
    : 1024
  const logSlowWait = options.logSlowWait ?? ((event: LocalFolderIpcRuntimeSlowWaitEvent): void => {
    console.warn('[localFolder:ipcRuntime] slow wait detected:', event)
  })

  const localFolderMutationQueueTail = new Map<string, Promise<void>>()
  let localFolderGlobalMutationQueueTail: Promise<void> | null = null
  const localFolderGlobalMutationExecutionContext = new AsyncLocalStorage<boolean>()
  const localFolderNotebookMutationExecutionContext = new AsyncLocalStorage<string>()
  const localFolderNotebookActiveSaveCount = new Map<string, number>()
  const localFolderNotebookSaveDrainWaiters = new Map<string, Array<() => void>>()
  const localFolderGlobalSaveDrainWaiters: Array<() => void> = []
  let localFolderGlobalTopologyReadCount = 0
  const localFolderNotebookTopologyReadCount = new Map<string, number>()
  const localFolderGlobalTopologyReadDrainWaiters: Array<() => void> = []
  const localFolderNotebookTopologyReadDrainWaiters = new Map<string, Array<() => void>>()
  const slowWaitLogState = new Map<
    string,
    {
      lastLoggedAt: number
      lastObservedAt: number
      suppressedCount: number
      maxSuppressedWaitMs: number
    }
  >()
  const waitStatsBySignature = new Map<
    string,
    LocalFolderIpcRuntimeWaitStatsEntry
  >()

  function buildLocalFolderMutationKey(notebookId: string): string {
    return notebookId
  }

  function resolveLocalFolderMutationKeys(notebookIds?: string[]): string[] | null {
    if (!Array.isArray(notebookIds) || notebookIds.length === 0) {
      return null
    }
    const mutationKeys = new Set<string>()
    for (const notebookId of notebookIds) {
      const mutationKey = buildLocalFolderMutationKey(notebookId)
      if (mutationKey) {
        mutationKeys.add(mutationKey)
      }
    }
    if (mutationKeys.size === 0) {
      return null
    }
    return Array.from(mutationKeys)
  }

  function hasActiveLocalFolderTopologyReads(): boolean {
    if (localFolderGlobalTopologyReadCount > 0) {
      return true
    }
    for (const activeCount of localFolderNotebookTopologyReadCount.values()) {
      if (activeCount > 0) {
        return true
      }
    }
    return false
  }

  function waitForLocalFolderNotebookMutationTails(notebookIds?: string[]): Promise<void> | null {
    const tails = new Set<Promise<void>>()
    const mutationKeys = resolveLocalFolderMutationKeys(notebookIds)
    if (mutationKeys) {
      for (const mutationKey of mutationKeys) {
        const mutationTail = localFolderMutationQueueTail.get(mutationKey) ?? null
        if (mutationTail) {
          tails.add(mutationTail)
        }
      }
    } else {
      for (const mutationTail of localFolderMutationQueueTail.values()) {
        tails.add(mutationTail)
      }
    }
    if (tails.size === 0) {
      return null
    }
    return Promise.all(
      Array.from(tails, (tail) => tail.catch(() => undefined))
    ).then(() => undefined)
  }

  function waitForAllLocalFolderNotebookMutationTails(): Promise<void> | null {
    const tails = new Set<Promise<void>>()
    for (const mutationTail of localFolderMutationQueueTail.values()) {
      tails.add(mutationTail)
    }
    if (tails.size === 0) {
      return null
    }
    return Promise.all(
      Array.from(tails, (tail) => tail.catch(() => undefined))
    ).then(() => undefined)
  }

  function waitForLocalFolderGlobalMutationTail(): Promise<void> | null {
    const mutationTail = localFolderGlobalMutationQueueTail
    return mutationTail ? mutationTail.catch(() => undefined) : null
  }

  function waitForLocalFolderMutationTails(notebookIds?: string[]): Promise<void> | null {
    const tails = new Set<Promise<void>>()
    const notebookMutationTails = waitForLocalFolderNotebookMutationTails(notebookIds)
    if (notebookMutationTails) {
      tails.add(notebookMutationTails)
    }
    const globalMutationTail = waitForLocalFolderGlobalMutationTail()
    if (globalMutationTail) {
      tails.add(globalMutationTail)
    }
    if (tails.size === 0) {
      return null
    }
    return Promise.all(
      Array.from(tails, (tail) => tail.catch(() => undefined))
    ).then(() => undefined)
  }

  function waitForLocalFolderNotebookSavesDrained(mutationKey: string): Promise<void> | null {
    const activeSaveCount = localFolderNotebookActiveSaveCount.get(mutationKey) ?? 0
    if (activeSaveCount === 0) {
      return null
    }
    return new Promise<void>((resolve) => {
      const waiters = localFolderNotebookSaveDrainWaiters.get(mutationKey)
      if (waiters) {
        waiters.push(resolve)
      } else {
        localFolderNotebookSaveDrainWaiters.set(mutationKey, [resolve])
      }
    })
  }

  function waitForAllLocalFolderSavesDrained(): Promise<void> | null {
    for (const activeSaveCount of localFolderNotebookActiveSaveCount.values()) {
      if (activeSaveCount > 0) {
        return new Promise<void>((resolve) => {
          localFolderGlobalSaveDrainWaiters.push(resolve)
        })
      }
    }
    return null
  }

  function waitForAllLocalFolderTopologyReadsDrained(): Promise<void> | null {
    if (!hasActiveLocalFolderTopologyReads()) {
      return null
    }
    return new Promise<void>((resolve) => {
      localFolderGlobalTopologyReadDrainWaiters.push(resolve)
    })
  }

  function waitForLocalFolderNotebookTopologyReadsDrained(mutationKey: string): Promise<void> | null {
    const scopedTopologyReadCount = localFolderNotebookTopologyReadCount.get(mutationKey) ?? 0
    if (scopedTopologyReadCount === 0 && localFolderGlobalTopologyReadCount === 0) {
      return null
    }
    return new Promise<void>((resolve) => {
      const waiters = localFolderNotebookTopologyReadDrainWaiters.get(mutationKey)
      if (waiters) {
        waiters.push(resolve)
      } else {
        localFolderNotebookTopologyReadDrainWaiters.set(mutationKey, [resolve])
      }
    })
  }

  function notifyAllLocalFolderTopologyReadsDrainedIfNeeded(): void {
    if (hasActiveLocalFolderTopologyReads()) {
      return
    }
    if (localFolderGlobalTopologyReadDrainWaiters.length === 0) {
      return
    }
    const waiters = localFolderGlobalTopologyReadDrainWaiters.splice(
      0,
      localFolderGlobalTopologyReadDrainWaiters.length
    )
    for (const resolve of waiters) {
      resolve()
    }
  }

  function notifyLocalFolderNotebookTopologyReadsDrainedIfNeeded(mutationKey: string): void {
    const scopedTopologyReadCount = localFolderNotebookTopologyReadCount.get(mutationKey) ?? 0
    if (scopedTopologyReadCount > 0 || localFolderGlobalTopologyReadCount > 0) {
      return
    }
    const waiters = localFolderNotebookTopologyReadDrainWaiters.get(mutationKey)
    if (!waiters || waiters.length === 0) {
      return
    }
    localFolderNotebookTopologyReadDrainWaiters.delete(mutationKey)
    for (const resolve of waiters) {
      resolve()
    }
  }

  function notifyLocalFolderTopologyReadDrainsAfterRelease(mutationKeys: string[] | null): void {
    if (mutationKeys === null) {
      if (localFolderGlobalTopologyReadCount === 0) {
        for (const mutationKey of localFolderNotebookTopologyReadDrainWaiters.keys()) {
          notifyLocalFolderNotebookTopologyReadsDrainedIfNeeded(mutationKey)
        }
      }
      notifyAllLocalFolderTopologyReadsDrainedIfNeeded()
      return
    }

    for (const mutationKey of mutationKeys) {
      notifyLocalFolderNotebookTopologyReadsDrainedIfNeeded(mutationKey)
    }
    notifyAllLocalFolderTopologyReadsDrainedIfNeeded()
  }

  function notifyAllLocalFolderSavesDrainedIfNeeded(): void {
    for (const activeSaveCount of localFolderNotebookActiveSaveCount.values()) {
      if (activeSaveCount > 0) {
        return
      }
    }
    if (localFolderGlobalSaveDrainWaiters.length === 0) {
      return
    }
    const waiters = localFolderGlobalSaveDrainWaiters.splice(0, localFolderGlobalSaveDrainWaiters.length)
    for (const resolve of waiters) {
      resolve()
    }
  }

  function buildSlowWaitSignature(event: Omit<LocalFolderIpcRuntimeSlowWaitEvent, 'suppressedCount' | 'waitedMs'>): string {
    const notebookIds = Array.isArray(event.notebookIds)
      ? Array.from(new Set(event.notebookIds)).sort()
      : []
    return JSON.stringify([
      event.operation,
      event.phase,
      event.mutationKey ?? null,
      notebookIds,
    ])
  }

  function buildWaitStatsSignature(
    operation: LocalFolderIpcRuntimeSlowWaitEvent['operation'],
    phase: string
  ): string {
    return JSON.stringify([operation, phase])
  }

  function recordWaitStats(
    operation: LocalFolderIpcRuntimeSlowWaitEvent['operation'],
    phase: string,
    waitedMs: number,
    isSlow: boolean
  ): void {
    const signature = buildWaitStatsSignature(operation, phase)
    const existing = waitStatsBySignature.get(signature)
    if (!existing) {
      waitStatsBySignature.set(signature, {
        operation,
        phase,
        count: 1,
        slowCount: isSlow ? 1 : 0,
        totalWaitMs: waitedMs,
        maxWaitMs: waitedMs,
      })
      return
    }
    existing.count += 1
    if (isSlow) {
      existing.slowCount += 1
    }
    existing.totalWaitMs += waitedMs
    existing.maxWaitMs = Math.max(existing.maxWaitMs, waitedMs)
  }

  function trimSlowWaitLogStateIfNeeded(nowMs: number): void {
    if (slowWaitLogState.size <= slowWaitLogMaxSignatures) {
      return
    }
    const entriesByOldest = Array.from(slowWaitLogState.entries())
      .sort((a, b) => a[1].lastObservedAt - b[1].lastObservedAt)
    for (const [signature, state] of entriesByOldest) {
      const idleMs = nowMs - state.lastObservedAt
      if (slowWaitLogState.size <= slowWaitLogMaxSignatures) {
        break
      }
      if (idleMs < slowWaitLogWindowMs) {
        continue
      }
      slowWaitLogState.delete(signature)
    }
    if (slowWaitLogState.size <= slowWaitLogMaxSignatures) {
      return
    }
    for (const [signature] of entriesByOldest) {
      if (slowWaitLogState.size <= slowWaitLogMaxSignatures) {
        break
      }
      slowWaitLogState.delete(signature)
    }
  }

  function emitSlowWaitEvent(event: Omit<LocalFolderIpcRuntimeSlowWaitEvent, 'suppressedCount'>): void {
    const nowMs = now()
    const signature = buildSlowWaitSignature(event)
    const previousState = slowWaitLogState.get(signature)
    if (!previousState) {
      try {
        logSlowWait(event)
      } catch {
        // Observability callback must never affect runtime behavior.
      }
      slowWaitLogState.set(signature, {
        lastLoggedAt: nowMs,
        lastObservedAt: nowMs,
        suppressedCount: 0,
        maxSuppressedWaitMs: 0,
      })
      trimSlowWaitLogStateIfNeeded(nowMs)
      return
    }

    previousState.lastObservedAt = nowMs
    if (nowMs - previousState.lastLoggedAt < slowWaitLogWindowMs) {
      previousState.suppressedCount += 1
      previousState.maxSuppressedWaitMs = Math.max(previousState.maxSuppressedWaitMs, event.waitedMs)
      return
    }

    const suppressedCount = previousState.suppressedCount
    const mergedWaitedMs = Math.max(event.waitedMs, previousState.maxSuppressedWaitMs)
    try {
      logSlowWait({
        ...event,
        waitedMs: mergedWaitedMs,
        ...(suppressedCount > 0 ? { suppressedCount } : {}),
      })
    } catch {
      // Observability callback must never affect runtime behavior.
    }
    previousState.lastLoggedAt = nowMs
    previousState.suppressedCount = 0
    previousState.maxSuppressedWaitMs = 0
  }

  function logSlowWaitIfNeeded(
    operation: LocalFolderIpcRuntimeSlowWaitEvent['operation'],
    phase: string,
    startedAt: number,
    details?: { notebookIds?: string[]; mutationKey?: string }
  ): void {
    const waitedMs = Math.max(0, now() - startedAt)
    const isSlow = waitedMs >= slowWaitThresholdMs
    recordWaitStats(operation, phase, waitedMs, isSlow)
    if (!isSlow) {
      return
    }
    emitSlowWaitEvent({
      operation,
      phase,
      waitedMs,
      notebookIds: details?.notebookIds,
      mutationKey: details?.mutationKey,
    })
  }

  async function runLocalFolderGlobalMutationSerialized<T>(
    task: () => Promise<T>
  ): Promise<T> {
    if (localFolderGlobalMutationExecutionContext.getStore()) {
      throw new Error(
        '[localFolder:ipcRuntime] nested global mutation is not allowed inside global mutation scope'
      )
    }
    const notebookMutationKeyInScope = localFolderNotebookMutationExecutionContext.getStore()
    if (notebookMutationKeyInScope) {
      throw new Error(
        `[localFolder:ipcRuntime] nested global mutation is not allowed inside notebook mutation scope: ${notebookMutationKeyInScope}`
      )
    }

    const previousTail = localFolderGlobalMutationQueueTail ?? Promise.resolve()
    let releaseCurrent: () => void = () => {}
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve
    })
    const nextTail = previousTail.then(
      () => current,
      () => current
    )
    localFolderGlobalMutationQueueTail = nextTail

    {
      const startedAt = now()
      await previousTail.catch(() => undefined)
      logSlowWaitIfNeeded('global_mutation', 'wait_previous_global_mutation', startedAt)
    }
    const notebookMutationDrainTask = waitForAllLocalFolderNotebookMutationTails()
    if (notebookMutationDrainTask) {
      const startedAt = now()
      await notebookMutationDrainTask
      logSlowWaitIfNeeded('global_mutation', 'wait_all_notebook_mutations_drained', startedAt)
    }
    const saveDrainTask = waitForAllLocalFolderSavesDrained()
    if (saveDrainTask) {
      const startedAt = now()
      await saveDrainTask
      logSlowWaitIfNeeded('global_mutation', 'wait_all_notebook_saves_drained', startedAt)
    }
    const topologyReadDrainTask = waitForAllLocalFolderTopologyReadsDrained()
    if (topologyReadDrainTask) {
      const startedAt = now()
      await topologyReadDrainTask
      logSlowWaitIfNeeded('global_mutation', 'wait_all_topology_reads_drained', startedAt)
    }
    try {
      return await localFolderGlobalMutationExecutionContext.run(true, task)
    } finally {
      releaseCurrent()
      if (localFolderGlobalMutationQueueTail === nextTail) {
        localFolderGlobalMutationQueueTail = null
      }
    }
  }

  async function runLocalFolderNotebookMutationSerialized<T>(
    notebookId: string,
    task: () => Promise<T>
  ): Promise<T> {
    const mutationKey = buildLocalFolderMutationKey(notebookId)
    if (!mutationKey) {
      return task()
    }
    if (localFolderGlobalMutationExecutionContext.getStore()) {
      throw new Error(
        `[localFolder:ipcRuntime] nested notebook mutation is not allowed inside global mutation scope: ${mutationKey}`
      )
    }
    const notebookMutationKeyInScope = localFolderNotebookMutationExecutionContext.getStore()
    if (notebookMutationKeyInScope) {
      throw new Error(
        `[localFolder:ipcRuntime] nested notebook mutation is not allowed inside notebook mutation scope: ${notebookMutationKeyInScope} -> ${mutationKey}`
      )
    }
    while (localFolderGlobalMutationQueueTail) {
      const blockingGlobalTail = localFolderGlobalMutationQueueTail
      const startedAt = now()
      await blockingGlobalTail.catch(() => undefined)
      logSlowWaitIfNeeded(
        'notebook_mutation',
        'wait_global_mutation_tail',
        startedAt,
        { mutationKey }
      )
    }
    const previousTail = localFolderMutationQueueTail.get(mutationKey) ?? Promise.resolve()
    let releaseCurrent: () => void = () => {}
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve
    })
    const nextTail = previousTail.then(
      () => current,
      () => current
    )
    localFolderMutationQueueTail.set(mutationKey, nextTail)

    {
      const startedAt = now()
      await previousTail.catch(() => undefined)
      logSlowWaitIfNeeded(
        'notebook_mutation',
        'wait_previous_notebook_mutation',
        startedAt,
        { mutationKey }
      )
    }
    const saveDrainTask = waitForLocalFolderNotebookSavesDrained(mutationKey)
    if (saveDrainTask) {
      const startedAt = now()
      await saveDrainTask
      logSlowWaitIfNeeded(
        'notebook_mutation',
        'wait_notebook_saves_drained',
        startedAt,
        { mutationKey }
      )
    }
    const topologyReadDrainTask = waitForLocalFolderNotebookTopologyReadsDrained(mutationKey)
    if (topologyReadDrainTask) {
      const startedAt = now()
      await topologyReadDrainTask
      logSlowWaitIfNeeded(
        'notebook_mutation',
        'wait_notebook_topology_reads_drained',
        startedAt,
        { mutationKey }
      )
    }
    try {
      return await localFolderNotebookMutationExecutionContext.run(mutationKey, task)
    } finally {
      releaseCurrent()
      if (localFolderMutationQueueTail.get(mutationKey) === nextTail) {
        localFolderMutationQueueTail.delete(mutationKey)
      }
    }
  }

  function tryAcquireLocalFolderNotebookSaveScope(notebookId: string): string | null {
    const mutationKey = buildLocalFolderMutationKey(notebookId)
    if (!mutationKey) {
      return ''
    }
    if (localFolderGlobalMutationQueueTail) {
      return null
    }
    const mutationTail = localFolderMutationQueueTail.get(mutationKey)
    if (mutationTail) {
      return null
    }
    const nextActiveSaveCount = (localFolderNotebookActiveSaveCount.get(mutationKey) ?? 0) + 1
    localFolderNotebookActiveSaveCount.set(mutationKey, nextActiveSaveCount)
    return mutationKey
  }

  async function waitAndAcquireLocalFolderNotebookSaveScope(notebookId: string): Promise<string> {
    const mutationKey = buildLocalFolderMutationKey(notebookId)
    if (!mutationKey) {
      return ''
    }
    while (true) {
      const acquired = tryAcquireLocalFolderNotebookSaveScope(notebookId)
      if (acquired !== null) {
        return acquired
      }
      const mutationTail = localFolderMutationQueueTail.get(mutationKey)
      const blockingTail = mutationTail ?? localFolderGlobalMutationQueueTail
      if (!blockingTail) {
        continue
      }
      const startedAt = now()
      await blockingTail.catch(() => undefined)
      logSlowWaitIfNeeded(
        'save_scope',
        'wait_blocking_mutation_tail',
        startedAt,
        { mutationKey }
      )
    }
  }

  function releaseLocalFolderNotebookSaveScope(mutationKey: string): void {
    if (!mutationKey) {
      return
    }
    const activeSaveCount = localFolderNotebookActiveSaveCount.get(mutationKey) ?? 0
    if (activeSaveCount <= 1) {
      localFolderNotebookActiveSaveCount.delete(mutationKey)
      const waiters = localFolderNotebookSaveDrainWaiters.get(mutationKey)
      if (waiters && waiters.length > 0) {
        localFolderNotebookSaveDrainWaiters.delete(mutationKey)
        for (const resolve of waiters) {
          resolve()
        }
      }
      notifyAllLocalFolderSavesDrainedIfNeeded()
      return
    }
    localFolderNotebookActiveSaveCount.set(mutationKey, activeSaveCount - 1)
  }

  function hasBlockingLocalFolderNotebookMutation(mutationKeys: string[] | null): boolean {
    if (mutationKeys === null) {
      return localFolderMutationQueueTail.size > 0
    }
    for (const mutationKey of mutationKeys) {
      if (localFolderMutationQueueTail.has(mutationKey)) {
        return true
      }
    }
    return false
  }

  function tryAcquireLocalFolderTopologyReadScope(mutationKeys: string[] | null): boolean {
    if (localFolderGlobalMutationQueueTail) {
      return false
    }
    if (hasBlockingLocalFolderNotebookMutation(mutationKeys)) {
      return false
    }
    if (mutationKeys === null) {
      localFolderGlobalTopologyReadCount += 1
      return true
    }
    for (const mutationKey of mutationKeys) {
      const nextActiveCount = (localFolderNotebookTopologyReadCount.get(mutationKey) ?? 0) + 1
      localFolderNotebookTopologyReadCount.set(mutationKey, nextActiveCount)
    }
    return true
  }

  function collectBlockingMutationTailsForTopologyRead(mutationKeys: string[] | null): Promise<void>[] {
    const blockingTails = new Set<Promise<void>>()
    if (localFolderGlobalMutationQueueTail) {
      blockingTails.add(localFolderGlobalMutationQueueTail)
    }
    if (mutationKeys === null) {
      for (const mutationTail of localFolderMutationQueueTail.values()) {
        blockingTails.add(mutationTail)
      }
      return Array.from(blockingTails)
    }
    for (const mutationKey of mutationKeys) {
      const mutationTail = localFolderMutationQueueTail.get(mutationKey)
      if (mutationTail) {
        blockingTails.add(mutationTail)
      }
    }
    return Array.from(blockingTails)
  }

  async function waitAndAcquireLocalFolderTopologyReadScope(mutationKeys: string[] | null): Promise<void> {
    while (true) {
      if (tryAcquireLocalFolderTopologyReadScope(mutationKeys)) {
        return
      }
      const blockingTails = collectBlockingMutationTailsForTopologyRead(mutationKeys)
      if (blockingTails.length === 0) {
        continue
      }
      const startedAt = now()
      await Promise.all(
        blockingTails.map((tail) => tail.catch(() => undefined))
      )
      logSlowWaitIfNeeded(
        'topology_read',
        'wait_blocking_mutation_tails',
        startedAt,
        { notebookIds: mutationKeys ?? undefined }
      )
    }
  }

  function releaseLocalFolderTopologyReadScope(mutationKeys: string[] | null): void {
    if (mutationKeys === null) {
      if (localFolderGlobalTopologyReadCount <= 0) {
        return
      }
      localFolderGlobalTopologyReadCount -= 1
      notifyLocalFolderTopologyReadDrainsAfterRelease(null)
      return
    }
    for (const mutationKey of mutationKeys) {
      const activeCount = localFolderNotebookTopologyReadCount.get(mutationKey) ?? 0
      if (activeCount <= 1) {
        localFolderNotebookTopologyReadCount.delete(mutationKey)
      } else {
        localFolderNotebookTopologyReadCount.set(mutationKey, activeCount - 1)
      }
    }
    notifyLocalFolderTopologyReadDrainsAfterRelease(mutationKeys)
  }

  async function runWithLocalFolderTopologyReadScopeForMutationKeys<T>(
    task: () => Promise<T>,
    mutationKeys: string[] | null
  ): Promise<T> {
    if (tryAcquireLocalFolderTopologyReadScope(mutationKeys)) {
      try {
        return await task()
      } finally {
        releaseLocalFolderTopologyReadScope(mutationKeys)
      }
    }
    await waitAndAcquireLocalFolderTopologyReadScope(mutationKeys)
    try {
      return await task()
    } finally {
      releaseLocalFolderTopologyReadScope(mutationKeys)
    }
  }

  async function runWithLocalFolderTopologyReadScope<T>(task: () => Promise<T>): Promise<T> {
    return runWithLocalFolderTopologyReadScopeForMutationKeys(task, null)
  }

  async function runWithLocalFolderConsistentRead<T>(
    task: () => Promise<T>,
    notebookIds?: string[]
  ): Promise<T> {
    const mutationKeys = resolveLocalFolderMutationKeys(notebookIds)
    const mutationTail = waitForLocalFolderMutationTails(mutationKeys ?? undefined)
    if (mutationTail) {
      const startedAt = now()
      await mutationTail
      logSlowWaitIfNeeded(
        'consistent_read',
        'wait_mutation_tails',
        startedAt,
        { notebookIds: mutationKeys ?? undefined }
      )
    }
    return runWithLocalFolderTopologyReadScopeForMutationKeys(task, mutationKeys)
  }

  function getWaitStatsSnapshot(): LocalFolderIpcRuntimeWaitStatsSnapshot {
    return {
      collectedAt: now(),
      entries: Array.from(waitStatsBySignature.values(), (entry) => ({ ...entry }))
        .sort((a, b) => {
          const operationOrder = a.operation.localeCompare(b.operation)
          if (operationOrder !== 0) {
            return operationOrder
          }
          return a.phase.localeCompare(b.phase)
        }),
    }
  }

  function resetWaitStats(): void {
    waitStatsBySignature.clear()
  }

  return {
    waitForLocalFolderMutationTails,
    runWithLocalFolderTopologyReadScope,
    runWithLocalFolderConsistentRead,
    runLocalFolderGlobalMutationSerialized,
    runLocalFolderNotebookMutationSerialized,
    tryAcquireLocalFolderNotebookSaveScope,
    waitAndAcquireLocalFolderNotebookSaveScope,
    releaseLocalFolderNotebookSaveScope,
    getWaitStatsSnapshot,
    resetWaitStats,
  }
}
