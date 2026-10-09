import { describe, expect, it } from 'vitest'
import { parseSubdomains } from './AddDomainDialog'

describe('parseSubdomains', () => {
  it('splits, trims and drops empties', () => {
    expect(parseSubdomains(' www, api ,, admin ')).toEqual(['www', 'api', 'admin'])
    expect(parseSubdomains('')).toEqual([])
  })
})
