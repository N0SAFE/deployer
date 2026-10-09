import { describe, expect, it } from 'vitest'
import { countOwners, isSoleOwner, memberState, memberSummary } from './team'

describe('team helpers', () => {
  it('derives pending vs active from acceptedAt', () => {
    expect(memberState({ acceptedAt: null })).toBe('pending')
    expect(memberState({ acceptedAt: '2026-01-01T00:00:00Z' })).toBe('active')
  })

  it('counts owners and flags the sole owner', () => {
    const members = [{ role: 'owner' }, { role: 'viewer' }]
    expect(countOwners(members)).toBe(1)
    expect(isSoleOwner(members[0]!, 1)).toBe(true)
    expect(isSoleOwner(members[0]!, 2)).toBe(false)
    expect(isSoleOwner(members[1]!, 1)).toBe(false)
  })

  it('summarises members and pending invites', () => {
    expect(memberSummary([{ acceptedAt: 'x' }])).toBe('1 member')
    expect(memberSummary([{ acceptedAt: 'x' }, { acceptedAt: null }])).toBe('2 members (1 pending invite)')
  })
})
