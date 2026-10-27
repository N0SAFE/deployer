import { describe, expect, it } from 'vitest'
import { describeBinding, describeTls, describeVisibility, serviceTypeFor, stringifyValue } from './review-helpers'

describe('stringifyValue', () => {
  it('uses a dash for empty values', () => {
    expect(stringifyValue(undefined)).toBe('—')
    expect(stringifyValue('')).toBe('—')
    expect(stringifyValue([])).toBe('—')
  })
  it('joins arrays and prints scalars', () => {
    expect(stringifyValue(['a', 'b'])).toBe('a, b')
    expect(stringifyValue(30)).toBe('30')
    expect(stringifyValue(false)).toBe('false')
  })
})

describe('serviceTypeFor', () => {
  it('maps runners to service types', () => {
    expect(serviceTypeFor('manual')).toBe('application')
    expect(serviceTypeFor('orchestrator')).toBe('sub-services')
    expect(serviceTypeFor('worker-runtime')).toBe('worker')
    expect(serviceTypeFor('static')).toBe('static')
  })
})

describe('describeTls', () => {
  it('is Off when disabled or missing', () => {
    expect(describeTls(undefined)).toBe('Off')
    expect(describeTls({ enabled: false })).toBe('Off')
  })
  it('lists certificate and redirect when enabled', () => {
    expect(describeTls({ enabled: true, certSecretRef: 'letsencrypt', httpRedirect: true })).toBe('On · certificate letsencrypt · HTTP redirects to HTTPS')
    expect(describeTls({ enabled: true, httpRedirect: false })).toBe('On · default certificate · no HTTP redirect')
  })
})

describe('describeVisibility', () => {
  it('explains both values', () => {
    expect(describeVisibility('private')).toContain('mesh members only')
    expect(describeVisibility('public')).toContain('public lane')
    expect(describeVisibility(undefined)).toContain('public lane')
  })
})

describe('describeBinding', () => {
  const names = new Map([['d1', 'example.com']])
  it('builds the full URL and marks the primary binding', () => {
    expect(describeBinding({ projectDomainId: 'd1', subdomain: 'app', basePath: 'v1', isPrimary: true, sslEnabled: true }, names)).toBe('https://app.example.com/v1 (primary)')
  })
  it('uses http when SSL is disabled', () => {
    expect(describeBinding({ projectDomainId: 'd1', subdomain: null, basePath: null, isPrimary: false, sslEnabled: false }, names)).toBe('http://example.com')
  })
  it('falls back when the domain is unknown', () => {
    expect(describeBinding({ projectDomainId: 'x', subdomain: null, basePath: null, isPrimary: false }, names)).toBe('unknown domain')
  })
})
