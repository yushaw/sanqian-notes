export function collectOffsetPagedRows<T>(
  targetCount: number,
  pageSize: number,
  fetchPage: (limit: number, offset: number) => T[]
): T[] {
  if (targetCount <= 0) {
    return []
  }
  if (pageSize <= 0) {
    throw new Error('pageSize must be greater than 0')
  }

  const rows: T[] = []
  let offset = 0

  while (rows.length < targetCount) {
    const remaining = targetCount - rows.length
    const limit = Math.min(pageSize, remaining)
    const page = fetchPage(limit, offset)

    if (page.length === 0) {
      break
    }

    rows.push(...page)
    offset += page.length

    if (page.length < limit) {
      break
    }
  }

  return rows
}
