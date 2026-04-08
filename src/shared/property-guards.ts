/**
 * Shared property guards to keep "omitted vs explicit undefined" semantics consistent.
 */

type UnknownRecord = Record<PropertyKey, unknown>

export function hasOwnPropertyKey(value: unknown, key: PropertyKey): value is UnknownRecord {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
    return false
  }
  return Object.prototype.hasOwnProperty.call(value, key)
}

export function hasOwnDefinedProperty(value: unknown, key: PropertyKey): value is UnknownRecord {
  if (!hasOwnPropertyKey(value, key)) {
    return false
  }
  return value[key] !== undefined
}
