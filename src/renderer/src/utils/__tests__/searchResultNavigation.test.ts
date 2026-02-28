import { describe, expect, it } from 'vitest'
import { resolveSearchResultNavigationTarget } from '../searchResultNavigation'

describe('resolveSearchResultNavigationTarget', () => {
  it('resolves local resource ids to notebook/path target', () => {
    const target = resolveSearchResultNavigationTarget('local:nb-1:docs%2Fplan.md')
    expect(target).toEqual({
      type: 'local',
      notebookId: 'nb-1',
      relativePath: 'docs/plan.md',
    })
  })

  it('falls back to internal note target for normal ids', () => {
    const target = resolveSearchResultNavigationTarget('note-123')
    expect(target).toEqual({
      type: 'internal',
      noteId: 'note-123',
    })
  })

  it('falls back to internal target for local uid references without path', () => {
    const target = resolveSearchResultNavigationTarget('local:nb-1:uid:ef84fb2a-8f5e-4e21-bd24-e1d6f2627d53')
    expect(target).toEqual({
      type: 'internal',
      noteId: 'local:nb-1:uid:ef84fb2a-8f5e-4e21-bd24-e1d6f2627d53',
    })
  })
})
