import { describe, expect, it } from 'vitest'
import { resolveFullUrl, sanitizeBasePath, sanitizeSubdomain, sslLabel } from './domain-url'

describe('domain-url', () => {
  it('composes the URL from domain, subdomain and base path', () => {
    expect(resolveFullUrl('example.com', null, null)).toBe('https://example.com')
    expect(resolveFullUrl('example.com', 'api', '/v1/')).toBe('https://api.example.com/v1')
  })
  it('sanitises subdomains and base paths', () => {
    expect(sanitizeSubdomain(' My_App! ')).toBe('my-app')
    expect(sanitizeBasePath('//a//b//')).toBe('a/b')
  })
  it('labels the certificate source', () => {
    expect(sslLabel(false, 'letsencrypt')).toBe('No SSL')
    expect(sslLabel(true, 'custom')).toBe('Custom cert')
    expect(sslLabel(true, 'letsencrypt')).toBe("Let's Encrypt")
  })
})
