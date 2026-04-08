import { describe, expect, it } from 'vitest'
import { hasOwnDefinedProperty, hasOwnPropertyKey } from '../../shared/property-guards'

describe('property guards', () => {
  it('detects own property safely for plain objects', () => {
    expect(hasOwnPropertyKey({ notebook_id: 'nb-1' }, 'notebook_id')).toBe(true)
    expect(hasOwnPropertyKey({ notebook_id: 'nb-1' }, 'missing')).toBe(false)
  })

  it('rejects inherited properties', () => {
    const proto = { notebook_id: 'nb-inherited' }
    const value = Object.create(proto) as Record<string, unknown>
    expect(hasOwnPropertyKey(value, 'notebook_id')).toBe(false)
  })

  it('treats explicit undefined as not-defined while preserving explicit null', () => {
    expect(hasOwnDefinedProperty({ notebook_id: undefined }, 'notebook_id')).toBe(false)
    expect(hasOwnDefinedProperty({ notebook_id: null }, 'notebook_id')).toBe(true)
    expect(hasOwnDefinedProperty({}, 'notebook_id')).toBe(false)
  })

  it('is resilient to non-object inputs', () => {
    expect(hasOwnPropertyKey(null, 'x')).toBe(false)
    expect(hasOwnPropertyKey(undefined, 'x')).toBe(false)
    expect(hasOwnPropertyKey('text', 'length')).toBe(false)
    expect(hasOwnDefinedProperty(42, 'x')).toBe(false)
  })
})
