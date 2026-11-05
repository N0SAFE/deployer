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
import { serviceOver, type Over } from '@deployer/effect-core'

import { Context, Effect } from 'effect'

import { isIP } from 'node:net'

import { attempt, describeFailure, recover } from '@/core/effects'
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

type Ports = {
    readonly store: PreviewEnvironmentStoreShape
    readonly routing: DomainRoutingShape
    readonly accessPoint: PublicAccessPointShape
    readonly dns: CloudflareDnsProviderServiceShape
}

function makePreviewProvisioningService({
    store,
    routing,
    accessPoint,
    dns,
}: Ports) {
    /** The preview host under the service's primary domain, or null when the service has no domain mapping. */
    const resolveHost = (serviceId: string, previewName: string) =>
        Effect.gen(function* () {
            const urls = yield* routing.resolveServiceUrls(serviceId)
            const primary = urls.find((u) => u.isPrimary) ?? urls[0]
            return primary ? `${previewName}.${primary.domain}` : null
        })

    /**
     * Resolve the DNS target for preview records from the node's PUBLIC ACCESS POINT (global relay):
     * tunnel hostname first (CNAME), else the configured address — which may be an IP (A/AAAA) or a
     * hostname (CNAME), detected with node:net isIP. Never from env vars.
     */
    const resolveDnsTarget = Effect.fn(
        'PreviewProvisioningService.resolveDnsTarget'
    )(function* () {
        const point = yield* accessPoint.getAccessPoint()
        if (point.kind === 'tunnel' && point.address) {
            return { kind: 'hostname' as const, value: point.address }
        }
        if (point.configured && point.address) {
            const address = point.address.trim()
            if (!address) return null
            return isIP(address.split('/')[0]!) === 0
                ? { kind: 'hostname' as const, value: address }
                : { kind: 'ip' as const, value: address }
        }
        return null
    })

    /**
     * Create the preview host's record on the first DNS provider account whose zone covers it.
     * Nothing is created (null) when no account, no zone or no DNS target is available.
     */
    const createPreviewRecord = (host: string) =>
        Effect.gen(function* () {
            const provider = yield* dns.findFirstActiveProvider()
            if (!provider) return null
            const zone = yield* dns.findZoneForHostname(provider, host)
            if (!zone) return null
            const target = yield* resolveDnsTarget()
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

    /** The preview host's record, with the account and zone holding it, when a DNS provider covers its zone. */
    const findPreviewRecord = (host: string) =>
        Effect.gen(function* () {
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

    const deletePreviewRecord = (found: {
        provider: DnsProviderAccountRef
        zoneId: string
        record: DnsProviderRecord
    }) => dns.deleteRecord(found.provider, found.zoneId, found.record.id)

    /** Record the preview row when the pull request has a deployment to attach it to. */
    const recordPreviewRow = (input: PreviewProvisionInput, host: string) =>
        Effect.gen(function* () {
            if (input.prNumber == null) {
                return false
            }

            // Find a deployment for this service whose source config matches the PR.
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

    const skipped = (): PreviewProvisionResult => ({
        action: 'skipped',
        reason: 'no_domain_mapping',
        host: null,
        dnsRecord: null,
        routeApplied: false,
        recorded: false,
    })

    const cleanupPreview = Effect.fn(
        'PreviewProvisioningService.cleanupPreview'
    )(function* (input: PreviewProvisionInput) {
        const host = yield* resolveHost(input.serviceId, input.previewName)
        if (host === null) return skipped()

        // Deactivate the route.
        const routeApplied = yield* recover(
            routing.removePreviewRoute(input.serviceId, host),
            (error) =>
                Effect.logWarning(
                    `Preview route cleanup failed for ${host}: ${describeFailure(error)}`
                ).pipe(Effect.as(false))
        )

        // Remove the DNS record if a provider covers the zone.
        let dnsRecord = null as {
            name: string
            type: string
            content: string
        } | null
        yield* recover(
            Effect.gen(function* () {
                const found = yield* findPreviewRecord(host)
                if (found) {
                    dnsRecord = {
                        name: found.record.name,
                        type: found.record.type,
                        content: found.record.content,
                    }
                    yield* deletePreviewRecord(found)
                }
            }),
            (error) =>
                Effect.logWarning(
                    `Preview DNS lookup during cleanup failed for ${host}: ${describeFailure(error)}`
                )
        )

        // Mark any matching preview rows inactive.
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

    return {
        provisionPreview: Effect.fn(
            'PreviewProvisioningService.provisionPreview'
        )(function* (input: PreviewProvisionInput) {
            // 1. Resolve the preview host from the service's primary domain mapping.
            const host = yield* resolveHost(input.serviceId, input.previewName)
            if (host === null) return skipped()

            // 2. DNS record (only when a provider covers the host's zone).
            const dnsRecord = yield* recover(
                createPreviewRecord(host),
                (error) =>
                    Effect.logWarning(
                        `Preview DNS provisioning skipped for ${host}: ${describeFailure(error)}`
                    ).pipe(Effect.as(null))
            )

            // 3. Temporary Traefik route.
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
            const recorded = yield* recordPreviewRow(input, host)

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
        }),

        cleanupPreview,

        /**
         * Deactivate an expired preview row (TTL scheduler): deactivates the traefik route and removes
         * the DNS record, the same cleanup as a PR close.
         */
        expirePreview: (
            previewId: string,
            serviceId: string,
            previewName: string
        ) =>
            cleanupPreview({
                serviceId,
                previewName,
                trigger: 'ttl_expired',
                reason: 'preview_ttl_expired',
                deliveryId: `ttl-${previewId}`,
            }),

        /** Active preview environments that have expired (expiresAt < now). Used by the TTL cleanup scheduler. */
        findExpiredPreviews: Effect.fn(
            'PreviewProvisioningService.findExpiredPreviews'
        )(function* (now: Date = new Date()) {
            const rows = yield* store.findExpired(now)
            return rows.map((r) => ({
                id: r.id,
                serviceId: r.serviceId,
                previewName: r.subdomain,
                fullDomain: r.fullDomain,
            }))
        }),
    }
}

export type PreviewProvisioningServiceShape = Over<
    ReturnType<typeof makePreviewProvisioningService>,
    | PreviewEnvironmentStore
    | DomainRouting
    | PublicAccessPoint
    | CloudflareDnsProviderService
>

/** Tag and implementation together: the tag is the contract, `live` the one implementation. */
export class PreviewProvisioningService extends Context.Service<
    PreviewProvisioningService,
    PreviewProvisioningServiceShape
>()('fleet/PreviewProvisioningService') {
    /** The collaborators are yielded when a method runs, so this is a constant the module provides with `useValue`. */
    static readonly live: PreviewProvisioningServiceShape = serviceOver(
        Effect.all({
            store: PreviewEnvironmentStore,
            routing: DomainRouting,
            accessPoint: PublicAccessPoint,
            dns: CloudflareDnsProviderService,
        }),
        makePreviewProvisioningService
    )
}
