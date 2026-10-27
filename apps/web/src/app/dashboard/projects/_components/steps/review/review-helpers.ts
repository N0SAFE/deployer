import { resolveFullUrl } from '../../service-domains/domain-url'

/** Render any form value as a short human string for the review rows. */
export function stringifyValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'string') return v === '' ? '—' : v
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v)
  if (Array.isArray(v)) return v.map(stringifyValue).filter(Boolean).join(', ') || '—'
  return JSON.stringify(v)
}

/** The service "type" shown in the review header — derived from the runner. */
export function serviceTypeFor(runnerId: string): string {
  switch (runnerId) {
    case 'manual': return 'application'
    case 'compose': return 'compose'
    case 'orchestrator': return 'sub-services'
    case 'worker-runtime': return 'worker'
    default: return runnerId
  }
}

export interface TlsInput { enabled?: boolean; certSecretRef?: string; httpRedirect?: boolean }

/** One-line TLS summary: exactly what is sent (`enabled`, certificate, redirect). */
export function describeTls(tls: TlsInput | undefined): string {
  if (!tls?.enabled) return 'Off'
  const parts = ['On']
  parts.push(tls.certSecretRef ? `certificate ${tls.certSecretRef}` : 'default certificate')
  parts.push(tls.httpRedirect === false ? 'no HTTP redirect' : 'HTTP redirects to HTTPS')
  return parts.join(' · ')
}

/** What a visibility value means for reachability, in the operator's words. */
export function describeVisibility(visibility: 'private' | 'public' | undefined): string {
  return visibility === 'private'
    ? 'Private — this machine and mesh members only'
    : 'Public — also on the public lane (internet) when one is enabled'
}

export interface DomainBindingInput {
  projectDomainId: string
  subdomain: string | null
  basePath: string | null
  isPrimary: boolean
  sslEnabled?: boolean
}

/** Full URL of a domain binding; falls back to a neutral label when the domain name is unknown. */
export function describeBinding(entry: DomainBindingInput, domainNameById: ReadonlyMap<string, string>): string {
  const domain = domainNameById.get(entry.projectDomainId)
  const url = domain
    ? resolveFullUrl(domain, entry.subdomain, entry.basePath).replace(/^https:\/\//, entry.sslEnabled === false ? 'http://' : 'https://')
    : 'unknown domain'
  return `${url}${entry.isPrimary ? ' (primary)' : ''}`
}
