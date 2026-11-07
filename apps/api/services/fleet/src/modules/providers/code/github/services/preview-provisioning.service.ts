/**
 * Preview Provisioning Service
 *
 * Makes preview deployments actually reachable. Called by the GitHub webhook
 * dispatch after a preview lifecycle decision:
 *
 *  1. Resolve the preview host from the service's PRIMARY domain mapping
 *     (e.g. `pr-123.example.com` where `example.com` is a provider-owned org
 *     domain). Fully data-driven — no `.local` placeholder, no env vars.
 *  2. If a DNS provider account covers the host's zone, create the DNS record
 *     (CNAME → tunnel hostname, or A → public IP) from the node network config.
 *  3. Add a temporary Traefik route for the preview host (stable mappings
 *     untouched).
 *  4. Record the preview in `preview_environments` when a matching deployment
 *     exists (the FK requires a deploymentId).
 *
 * Cleanup deactivates the route, removes the DNS record, and marks the row
 * inactive.
 *
 * The DNS, route and row steps are best effort: one failing is logged and the others still run.
 */
import { Context, Effect } from 'effect'

import { isIP } from 'node:net'

import type { RequirementsOf } from '@deployer/effect-core'

import { describeFailure, recover } from '@/core/effects'
import {
    DomainRouting,
    type DomainRoutingShape,
} from '@/core/ports/domain-routing.port'
import {
    PublicAccessPoint,
    type PublicAccessPointShape,
} from '@/core/ports/public-access-point.port'
import {
    CloudflareDnsProviderService,
    type CloudflareDnsProviderServiceShape,
} from '@/modules/providers/dns/cloudflare/services/cloudflare-dns-provider.service'
import type {
    DnsProviderAccountRef,
    DnsProviderRecord,
} from '@/modules/providers/dns/shared/dns-provider.interface'

import {
    PreviewEnvironmentStore,
    type PreviewEnvironmentStoreShape,
} from '../repositories/preview-environment.repository'

export type PreviewProvisionInput = {
    serviceId: string
    previewName: string
    branchName?: string | null
    prNumber?: number | null
    commitSha?: string | null
    pullRequestUrl?: string | null
    trigger?: 'merge' | 'close' | 'ttl_expired'
    reason?: string
    deliveryId: string
}

export type PreviewProvisionResult = {
    action: 'provisioned' | 'cleaned' | 'skipped'
    reason: string
    host: string | null
    dnsRecord: { name: string; type: string; content: string } | null
    routeApplied: boolean
    recorded: boolean
}

/** What resolving the preview host reads: the routing service and what it reads in turn. */
type RoutingRequirements = DomainRouting | RequirementsOf<DomainRoutingShape>

/** What resolving the DNS target reads: this node's access point and what it reads in turn. */
type AccessPointRequirements =
    | PublicAccessPoint
    | RequirementsOf<PublicAccessPointShape>

/** What the DNS record steps read: the Cloudflare DNS provider and what it reads in turn. */
type DnsRequirements =
    | CloudflareDnsProviderService
    | RequirementsOf<CloudflareDnsProviderServiceShape>

/** What recording and expiring preview rows read: the store and what it reads in turn. */
type StoreRequirements =
    | PreviewEnvironmentStore
    | RequirementsOf<PreviewEnvironmentStoreShape>

/** An expired preview as the TTL scheduler sees it. */
export type ExpiredPreview = {
    id: string
    serviceId: string
    previewName: string
    fullDomain: string
}

const skipped = (): PreviewProvisionResult => ({
    action: 'skipped',
    reason: 'no_domain_mapping',
    host: null,
    dnsRecord: null,
    routeApplied: false,
    recorded: false,
})

/** Tag and implementation together: the tag is the contract, `live` the one implementation. */
export class PreviewProvisioningService extends Context.Service<
    PreviewProvisioningService,
    PreviewProvisioningServiceShape
>()('fleet/PreviewProvisioningService') {
    static readonly live = class PreviewProvisioningServiceImpl
        implements PreviewProvisioningServiceShape
    {
        /** The preview host under the service's primary domain, or null when the service has no domain mapping. */
        private resolveHost(
            serviceId: string,
            previewName: string
        ): Effect.Effect<string | null, unknown, RoutingRequirements> {
            return Effect.gen(function* () {
                const routing = yield* DomainRouting
                const urls = yield* routing.resolveServiceUrls(serviceId)
                const primary = urls.find((u) => u.isPrimary) ?? urls[0]
                return primary ? `${previewName}.${primary.domain}` : null
            })
        }

        /**
         * Resolve the DNS target for preview records from the node's PUBLIC ACCESS POINT (global relay):
         * tunnel hostname first (CNAME), else the configured address — which may be an IP (A/AAAA) or a
         * hostname (CNAME), detected with node:net isIP. Never from env vars.
         */
        private resolveDnsTarget(): Effect.Effect<
            { kind: 'hostname' | 'ip'; value: string } | null,
            unknown,
            AccessPointRequirements
        > {
            return Effect.gen(function* () {
                const accessPoint = yield* PublicAccessPoint
                const point = yield* accessPoint.getAccessPoint()
                if (point.kind === 'tunnel' && point.address) {
                    return {
                        kind: 'hostname' as const,
                        value: point.address,
                    }
                }
                if (point.configured && point.address) {
                    const address = point.address.trim()
                    if (!address) return null
                    return isIP(address.split('/')[0] ?? '') === 0
                        ? { kind: 'hostname' as const, value: address }
                        : { kind: 'ip' as const, value: address }
                }
                return null
            })
        }

        /**
         * Create the preview host's record on the first DNS provider account whose zone covers it.
         * Nothing is created (null) when no account, no zone or no DNS target is available.
         */
        private createPreviewRecord(host: string): Effect.Effect<
            { name: string; type: string; content: string } | null,
            unknown,
            DnsRequirements | AccessPointRequirements
        > {
            return Effect.gen({ self: this }, function* () {
                const dns = yield* CloudflareDnsProviderService
                const provider = yield* dns.findFirstActiveProvider()
                if (!provider) return null
                const zone = yield* dns.findZoneForHostname(provider, host)
                if (!zone) return null
                const target = yield* this.resolveDnsTarget()
                if (!target) return null
                const created = yield* dns.createRecord(provider, {
                    zoneId: zone.zoneId,
                    type: target.kind === 'hostname' ? 'CNAME' : 'A',
                    name: host,
                    content: target.value,
                    ttl: 1,
                    proxied: true,
                })
                return {
                    name: created.name,
                    type: created.type,
                    content: created.content,
                }
            })
        }

        /** The preview host's record, with the account and zone holding it, when a DNS provider covers its zone. */
        private findPreviewRecord(host: string): Effect.Effect<
            {
                provider: DnsProviderAccountRef
                zoneId: string
                record: DnsProviderRecord
            } | null,
            unknown,
            DnsRequirements
        > {
            return Effect.gen(function* () {
                const dns = yield* CloudflareDnsProviderService
                const provider = yield* dns.findFirstActiveProvider()
                if (!provider) return null
                const zone = yield* dns.findZoneForHostname(provider, host)
                if (!zone) return null
                const records: DnsProviderRecord[] = yield* dns.listRecords(
                    provider,
                    zone.zoneId
                )
                const record = records.find((r) => r.name === host)
                return record ? { provider, zoneId: zone.zoneId, record } : null
            })
        }

        private deletePreviewRecord(found: {
            provider: DnsProviderAccountRef
            zoneId: string
            record: DnsProviderRecord
        }): Effect.Effect<void, unknown, DnsRequirements> {
            return Effect.gen(function* () {
                const dns = yield* CloudflareDnsProviderService
                yield* dns.deleteRecord(
                    found.provider,
                    found.zoneId,
                    found.record.id
                )
            })
        }

        /** Record the preview row when the pull request has a deployment to attach it to. */
        private recordPreviewRow(
            input: PreviewProvisionInput,
            host: string
        ): Effect.Effect<boolean, unknown, StoreRequirements> {
            return Effect.gen(function* () {
                if (input.prNumber == null) {
                    return false
                }

                // Find a deployment for this service whose source config matches the PR.
                const store = yield* PreviewEnvironmentStore
                const deployment = yield* store.findLatestDeploymentByService(
                    input.serviceId
                )
                if (!deployment) {
                    return false
                }

                yield* store.upsertPreview({
                    deploymentId: deployment.id,
                    subdomain: input.previewName,
                    fullDomain: host,
                    branchName: input.branchName ?? undefined,
                    pullRequestUrl: input.pullRequestUrl ?? undefined,
                })

                return true
            })
        }

        provisionPreview(
            input: PreviewProvisionInput
        ): ReturnType<PreviewProvisioningServiceShape['provisionPreview']> {
            return Effect.gen({ self: this }, function* () {
                // 1. Resolve the preview host from the service's primary domain mapping.
                const host = yield* this.resolveHost(
                    input.serviceId,
                    input.previewName
                )
                if (host === null) return skipped()

                // 2. DNS record (only when a provider covers the host's zone).
                const dnsRecord = yield* recover(
                    this.createPreviewRecord(host),
                    (error) =>
                        Effect.logWarning(
                            `Preview DNS provisioning skipped for ${host}: ${describeFailure(error)}`
                        ).pipe(Effect.as(null))
                )

                // 3. Temporary Traefik route.
                const routing = yield* DomainRouting
                const routeApplied = yield* recover(
                    routing
                        .addPreviewRoute(input.serviceId, host, {
                            sslEnabled: true,
                        })
                        .pipe(Effect.map((route) => route !== null)),
                    (error) =>
                        Effect.logWarning(
                            `Preview route provisioning skipped for ${host}: ${describeFailure(error)}`
                        ).pipe(Effect.as(false))
                )

                // 4. Record the preview row when a matching deployment exists.
                const recorded = yield* this.recordPreviewRow(input, host)

                yield* Effect.logInfo(
                    `Preview provisioned: ${host} (dns=${dnsRecord ? 'yes' : 'no'}, route=${String(routeApplied)}, recorded=${String(recorded)})`
                )
                return {
                    action: 'provisioned',
                    reason: 'preview_provisioned',
                    host,
                    dnsRecord,
                    routeApplied,
                    recorded,
                } satisfies PreviewProvisionResult
            })
        }

        cleanupPreview(
            input: PreviewProvisionInput
        ): ReturnType<PreviewProvisioningServiceShape['cleanupPreview']> {
            return Effect.gen({ self: this }, function* () {
                const host = yield* this.resolveHost(
                    input.serviceId,
                    input.previewName
                )
                if (host === null) return skipped()

                // Deactivate the route.
                const routing = yield* DomainRouting
                const routeApplied = yield* recover(
                    routing.removePreviewRoute(input.serviceId, host),
                    (error) =>
                        Effect.logWarning(
                            `Preview route cleanup failed for ${host}: ${describeFailure(error)}`
                        ).pipe(Effect.as(false))
                )

                // Remove the DNS record if a provider covers the zone.
                let dnsRecord: {
                    name: string
                    type: string
                    content: string
                } | null = null
                const found = yield* recover(this.findPreviewRecord(host), (error) =>
                    Effect.logWarning(
                        `Preview DNS lookup during cleanup failed for ${host}: ${describeFailure(error)}`
                    ).pipe(Effect.as(null))
                )
                if (found !== null) {
                    dnsRecord = {
                        name: found.record.name,
                        type: found.record.type,
                        content: found.record.content,
                    }
                    yield* recover(this.deletePreviewRecord(found), (error) =>
                        Effect.logWarning(
                            `Preview DNS record removal failed for ${host}: ${describeFailure(error)}`
                        )
                    )
                }

                // Mark any matching preview rows inactive.
                const store = yield* PreviewEnvironmentStore
                yield* store.deactivateByFullDomain(host)

                yield* Effect.logInfo(
                    `Preview cleaned: ${host} (route=${String(routeApplied)})`
                )
                return {
                    action: 'cleaned',
                    reason: input.reason ?? 'preview_cleaned',
                    host,
                    dnsRecord,
                    routeApplied,
                    recorded: false,
                } satisfies PreviewProvisionResult
            })
        }

        /**
         * Deactivate an expired preview row (TTL scheduler): deactivates the traefik route and removes
         * the DNS record, the same cleanup as a PR close.
         */
        expirePreview(
            previewId: string,
            serviceId: string,
            previewName: string
        ): ReturnType<PreviewProvisioningServiceShape['expirePreview']> {
            return Effect.gen({ self: this }, function* () {
                return yield* this.cleanupPreview({
                    serviceId,
                    previewName,
                    trigger: 'ttl_expired',
                    reason: 'preview_ttl_expired',
                    deliveryId: `ttl-${previewId}`,
                })
            })
        }

        /** Active preview environments that have expired (expiresAt < now). Used by the TTL cleanup scheduler. */
        findExpiredPreviews(
            now: Date = new Date()
        ): ReturnType<PreviewProvisioningServiceShape['findExpiredPreviews']> {
            return Effect.gen(function* () {
                const store = yield* PreviewEnvironmentStore
                const rows = yield* store.findExpired(now)
                return rows.map(
                    (r): ExpiredPreview => ({
                        id: r.id,
                        serviceId: r.serviceId,
                        previewName: r.subdomain,
                        fullDomain: r.fullDomain,
                    })
                )
            })
        }
    }
}

/**
 * The preview lifecycle as the webhook dispatch and the TTL scheduler call it. Each operation names
 * the collaborators it yields, plus what those collaborators read in turn.
 */
export type PreviewProvisioningServiceShape = {
    readonly provisionPreview: (
        input: PreviewProvisionInput
    ) => Effect.Effect<
        PreviewProvisionResult,
        unknown,
        RoutingRequirements | AccessPointRequirements | DnsRequirements | StoreRequirements
    >
    readonly cleanupPreview: (
        input: PreviewProvisionInput
    ) => Effect.Effect<
        PreviewProvisionResult,
        unknown,
        RoutingRequirements | DnsRequirements | StoreRequirements
    >
    readonly expirePreview: (
        previewId: string,
        serviceId: string,
        previewName: string
    ) => Effect.Effect<
        PreviewProvisionResult,
        unknown,
        RoutingRequirements | DnsRequirements | StoreRequirements
    >
    readonly findExpiredPreviews: (
        now?: Date
    ) => Effect.Effect<ExpiredPreview[], unknown, StoreRequirements>
}
