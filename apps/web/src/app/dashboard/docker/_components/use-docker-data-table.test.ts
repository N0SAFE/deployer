import { describe, expect, it } from 'vitest'
import { sortAndPage } from './use-docker-data-table'

const rows = [{ n: 'b10', c: 2 }, { n: 'B2', c: 1 }, { n: 'a', c: 3 }]

describe('sortAndPage', () => {
  it('sorts strings naturally and case-insensitively', () => {
    expect(sortAndPage(rows, (r) => r.n, 'asc', 1, 10).map((r) => r.n)).toEqual(['a', 'B2', 'b10'])
  })
  it('sorts numbers descending', () => {
    expect(sortAndPage(rows, (r) => r.c, 'desc', 1, 10).map((r) => r.c)).toEqual([3, 2, 1])
  })
  it('pages the sorted rows', () => {
    expect(sortAndPage(rows, (r) => r.c, 'asc', 2, 2).map((r) => r.c)).toEqual([3])
  })
  it('keeps input order for ties', () => {
    const ties = [{ k: 1, id: 'x' }, { k: 1, id: 'y' }]
    expect(sortAndPage(ties, (r) => r.k, 'desc', 1, 10).map((r) => r.id)).toEqual(['x', 'y'])
  })
})
