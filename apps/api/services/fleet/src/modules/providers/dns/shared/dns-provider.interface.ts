import type { DnsRecordType } from '@deployer/contracts-common'

/**
 * DNS Provider Interface — the shapes every DNS provider adapter answers.
 *
 * The adapters themselves are Effect services (one `Context.Service` tag each, e.g.
 * `CloudflareDnsProviderService`); the registry dispatches on the key it registers them under, so no
 * adapter carries a type key of its own and no separate adapter type is declared here.
 */

export type DnsProviderAccountRef = {
    /** Provider app row id (dns_providers.id). */
    providerId: string
    /** Provider type: "cloudflare" | "route53" | "google-dns" | ... */
    providerType: string
}

export type DnsProviderZone = {
    id: string
    name: string
    status: string
    nameServers: string[]
}

export type DnsProviderRecord = {
    id: string
    zoneId: string
    name: string
    type: string
    content: string
    ttl: number
    proxied: boolean
}

export type CreateDnsRecordInput = {
    zoneId: string
    type: DnsRecordType
    name: string
    content: string
    ttl?: number
    proxied?: boolean
}
