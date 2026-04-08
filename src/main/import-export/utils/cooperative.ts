const DEFAULT_ENV_MAX = 8192

export function resolvePositiveIntegerEnv(
  key: string,
  fallback: number,
  options?: { min?: number; max?: number }
): number {
  const raw = process.env[key]
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  const min = options?.min ?? 1
  const max = options?.max ?? DEFAULT_ENV_MAX
  return Math.min(max, Math.max(min, Math.floor(parsed)))
}

export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

export async function yieldEvery(count: number, interval: number): Promise<void> {
  if (interval <= 0) return
  if (count % interval !== 0) return
  await yieldToEventLoop()
}

export async function forEachWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (items.length === 0) return

  const actualConcurrency = Math.max(1, Math.min(concurrency, items.length))
  let cursor = 0

  const runners = Array.from({ length: actualConcurrency }, async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= items.length) {
        return
      }
      await worker(items[index], index)
    }
  })

  await Promise.all(runners)
}
