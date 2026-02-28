export async function mapWithConcurrency<T, TResult>(
  items: readonly T[],
  concurrency: number,
  iteratee: (item: T, index: number) => Promise<TResult>
): Promise<TResult[]> {
  if (items.length === 0) return []

  const maxConcurrency = Math.max(1, Math.min(concurrency, items.length))
  const results = new Array<TResult>(items.length)
  let indexCursor = 0
  // SAFETY: indexCursor mutation is safe because Node.js is single-threaded --
  // the read+increment between two awaits cannot interleave.
  let firstError: unknown = undefined

  await Promise.allSettled(Array.from({ length: maxConcurrency }, async () => {
    while (true) {
      if (firstError !== undefined) return
      const currentIndex = indexCursor
      indexCursor += 1
      if (currentIndex >= items.length) return
      try {
        results[currentIndex] = await iteratee(items[currentIndex], currentIndex)
      } catch (error) {
        if (firstError === undefined) firstError = error
        return
      }
    }
  }))

  if (firstError !== undefined) throw firstError
  return results
}
