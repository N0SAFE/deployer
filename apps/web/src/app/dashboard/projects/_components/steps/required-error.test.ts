import { describe, expect, it } from 'vitest'
import { requiredMessage } from './required-error'

describe('requiredMessage', () => {
  it('stays silent until the field was touched', () => {
    expect(requiredMessage(false, '', 'Required')).toBeNull()
  })
  it('reports empty and whitespace-only strings once touched', () => {
    expect(requiredMessage(true, '', 'Required')).toBe('Required')
    expect(requiredMessage(true, '   ', 'Required')).toBe('Required')
  })
  it('reports missing values', () => {
    expect(requiredMessage(true, undefined, 'Required')).toBe('Required')
  })
  it('accepts filled values', () => {
    expect(requiredMessage(true, 'x', 'Required')).toBeNull()
    expect(requiredMessage(true, 0, 'Required')).toBeNull()
  })
})
