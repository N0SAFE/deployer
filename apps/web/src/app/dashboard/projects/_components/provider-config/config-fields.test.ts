import { describe, expect, it } from 'vitest'
import { buildConfigFromFields, displayValue, entityToUiKey, initialFormValues, toEntityConfig } from './config-fields'

describe('config-fields', () => {
  it('displays values without [object Object]', () => {
    expect(displayValue(null)).toBe('')
    expect(displayValue(3)).toBe('3')
    expect(displayValue({ a: 1 })).toBe('{"a":1}')
  })

  it('maps keys both ways', () => {
    expect(toEntityConfig({ repositoryUrl: 'u', branch: 'main' })).toEqual({ sourceUrl: 'u', branch: 'main' })
    expect(entityToUiKey('sourceUrl')).toBe('repositoryUrl')
    expect(entityToUiKey('branch')).toBe('branch')
  })

  it('overlays persisted values on schema defaults', () => {
    const fields = [{ key: 'branch', defaultValue: 'main' }, { key: 'path', defaultValue: undefined }]
    expect(initialFormValues(fields, { branch: 'dev' })).toEqual({ branch: 'dev' })
    expect(initialFormValues(fields, null)).toEqual({ branch: 'main' })
  })

  it('builds config, filling defaults only for untouched keys', () => {
    const fields = [{ key: 'a', defaultValue: 1 }, { key: 'b', defaultValue: 2 }, { key: 'c', defaultValue: undefined }]
    expect(buildConfigFromFields(fields, { a: 5, c: '' })).toEqual({ a: 5, b: 2 })
  })
})
