/** Pure helpers for composing and sanitising a service's public URL. */

export interface ServiceDomainEntry {
  projectDomainId: string
  subdomain: string | null
  basePath: string | null
  isPrimary: boolean
  sslEnabled: boolean
}

export function resolveFullUrl(domain: string, subdomain: string | null, basePath: string | null): string {
  const host = subdomain?.trim() ? `${subdomain.trim()}.${domain}` : domain
  const path = basePath?.trim() ? `/${basePath.replace(/^\/+/, '').replace(/\/+$/, '')}` : ''
  return `https://${host}${path}`
}

export function sanitizeSubdomain(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
}

export function sanitizeBasePath(input: string): string {
  return input
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/')
    .slice(0, 255)
}

/** Human label for the certificate source shown next to a binding. */
export function sslLabel(sslEnabled: boolean, sslProvider: string | null | undefined): string {
  if (!sslEnabled || sslProvider === 'none') return 'No SSL'
  if (sslProvider === 'custom') return 'Custom cert'
  return "Let's Encrypt"
}
