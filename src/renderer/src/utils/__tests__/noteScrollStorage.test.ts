import { beforeEach, describe, expect, it, vi } from 'vitest'

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} },
  }
})()

vi.stubGlobal('localStorage', localStorageMock)

describe('noteScrollStorage', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
  })

  it('更新后可立即从内存读取（无需先持久化）', async () => {
    const storage = await import('../noteScrollStorage')

    storage.updateNoteScrollPosition('note-1', 128.9, 'pane-a')

    expect(storage.getSavedNoteScrollPosition('note-1', 'pane-a')).toBe(128)
  })

  it('持久化后重新加载模块仍可恢复', async () => {
    const storage = await import('../noteScrollStorage')
    storage.updateNoteScrollPosition('note-1', 320, 'pane-a')
    storage.persistNoteScrollPositions()

    vi.resetModules()
    const reloaded = await import('../noteScrollStorage')

    expect(reloaded.getSavedNoteScrollPosition('note-1', 'pane-a')).toBe(320)
  })

  it('滚动为 0 时会移除该笔记记录', async () => {
    const storage = await import('../noteScrollStorage')
    storage.setAndPersistNoteScrollPosition('note-1', 200, 'pane-a')
    storage.setAndPersistNoteScrollPosition('note-1', 0, 'pane-a')

    expect(storage.getSavedNoteScrollPosition('note-1', 'pane-a')).toBe(0)
  })

  it('超过上限时按最近写入保留（淘汰最旧）', async () => {
    const storage = await import('../noteScrollStorage')

    for (let i = 1; i <= 201; i += 1) {
      storage.updateNoteScrollPosition(`note-${i}`, i, 'pane-a')
    }
    storage.persistNoteScrollPositions()

    expect(storage.getSavedNoteScrollPosition('note-1', 'pane-a')).toBe(0)
    expect(storage.getSavedNoteScrollPosition('note-2', 'pane-a')).toBe(2)
    expect(storage.getSavedNoteScrollPosition('note-201', 'pane-a')).toBe(201)
  })

  it('同一笔记在不同 pane 互不影响', async () => {
    const storage = await import('../noteScrollStorage')

    storage.setAndPersistNoteScrollPosition('note-1', 120, 'pane-a')
    storage.setAndPersistNoteScrollPosition('note-1', 360, 'pane-b')

    expect(storage.getSavedNoteScrollPosition('note-1', 'pane-a')).toBe(120)
    expect(storage.getSavedNoteScrollPosition('note-1', 'pane-b')).toBe(360)
  })

  it('pane 记录缺失时回退到 legacy note 记录', async () => {
    localStorage.setItem('sanqian-notes-note-scroll-positions', JSON.stringify({
      'note-legacy': 222
    }))

    vi.resetModules()
    const storage = await import('../noteScrollStorage')

    expect(storage.getSavedNoteScrollPosition('note-legacy', 'pane-a')).toBe(222)
  })

  it('写入 pane 记录后会清理 legacy note 记录，避免陈旧回退', async () => {
    localStorage.setItem('sanqian-notes-note-scroll-positions', JSON.stringify({
      'note-legacy': 222
    }))

    vi.resetModules()
    const storage = await import('../noteScrollStorage')
    storage.setAndPersistNoteScrollPosition('note-legacy', 80, 'pane-a')

    const persisted = JSON.parse(localStorage.getItem('sanqian-notes-note-scroll-positions') || '{}') as Record<string, number>
    expect(persisted['note-legacy']).toBeUndefined()
    expect(persisted['note-legacy::pane-a']).toBe(80)
    expect(storage.getSavedNoteScrollPosition('note-legacy', 'pane-b')).toBe(0)
  })

  it('加载时会清理和 pane 记录冲突的 legacy 记录', async () => {
    localStorage.setItem('sanqian-notes-note-scroll-positions', JSON.stringify({
      'note-1': 111,
      'note-1::pane-a': 222,
      'note-2': 50,
    }))

    vi.resetModules()
    const storage = await import('../noteScrollStorage')

    expect(storage.getSavedNoteScrollPosition('note-1', 'pane-b')).toBe(0)
    expect(storage.getSavedNoteScrollPosition('note-1', 'pane-a')).toBe(222)
    expect(storage.getSavedNoteScrollPosition('note-2', 'pane-x')).toBe(50)

    const persisted = JSON.parse(localStorage.getItem('sanqian-notes-note-scroll-positions') || '{}') as Record<string, number>
    expect(persisted['note-1']).toBeUndefined()
    expect(persisted['note-1::pane-a']).toBe(222)
    expect(persisted['note-2']).toBe(50)
  })

  it('加载时会裁剪超出上限的历史记录', async () => {
    const entries: Record<string, number> = {}
    for (let i = 1; i <= 205; i += 1) {
      entries[`note-${i}::pane-a`] = i
    }
    localStorage.setItem('sanqian-notes-note-scroll-positions', JSON.stringify(entries))

    vi.resetModules()
    const storage = await import('../noteScrollStorage')

    expect(storage.getSavedNoteScrollPosition('note-1', 'pane-a')).toBe(0)
    expect(storage.getSavedNoteScrollPosition('note-6', 'pane-a')).toBe(6)
    expect(storage.getSavedNoteScrollPosition('note-205', 'pane-a')).toBe(205)

    const persisted = JSON.parse(localStorage.getItem('sanqian-notes-note-scroll-positions') || '{}') as Record<string, number>
    expect(Object.keys(persisted)).toHaveLength(200)
  })
})
