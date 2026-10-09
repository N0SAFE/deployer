import { describe, expect, it } from 'vitest'
import { devConveniencesEnabled, signInErrorHint } from './dev-only'

describe('devConveniencesEnabled', () => {
  it('is off in production and on elsewhere', () => {
    expect(devConveniencesEnabled('production')).toBe(false)
    expect(devConveniencesEnabled('development')).toBe(true)
    expect(devConveniencesEnabled('test')).toBe(true)
  })
})

describe('signInErrorHint', () => {
  it('explains bad credentials, rate limits and unreachable API', () => {
    expect(signInErrorHint('Invalid email or password')).toMatch(/case-sensitive/)
    expect(signInErrorHint('Too many requests')).toMatch(/Wait/)
    expect(signInErrorHint('Network unreachable')).toMatch(/API/)
    expect(signInErrorHint('Something odd')).toBeNull()
  })
})
