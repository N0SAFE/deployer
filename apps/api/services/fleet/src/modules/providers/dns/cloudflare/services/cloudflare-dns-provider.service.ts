/**
 * Cloudflare DNS Provider — implements the shared `DnsProvider` contract.
 *
 * Owns zone/record operations only. Provider-app storage, credentials and
 * runtime state live in `CloudflareAppService` (the `dns_providers` table);
 * tunnel operations live in `CloudflareTunnelService`. Registered in the
 * `DnsProviderRegistryService` under the key `cloudflare`.
 *
 * Consumers: the Cloudflare controller (HTTP) and PreviewProvisioningService
 * (server-side DNS record creation for preview domains). No domain value ever
 * comes from env vars.
 */
import { Context, Effect } from 'effect'

import type { RequirementsOf } from '@deployer/effect-core'

import { attempt } from '@/core/effects'
import { FleetInvalid } from '@/core/fleet.errors'

import {
    CloudflareAppService,
    type CloudflareAppServiceShape,
} from './cloudflare-app.service'
import {
    buildRecordCreateParams,
    toDnsRecordShape,
    type SupportedRecordType,
} from './cloudflare.helpers'

import type {
    CreateDnsRecordInput,
    DnsProviderAccountRef,
    DnsProviderRecord,
    DnsProviderZone,
} from '../../shared/dns-provider.interface'

const PROVIDER_TYPE = 'cloudflare'

/** What a method here reads from the context: the app service, and what it reads in turn. */
export type CloudflareDnsProviderRequirements =
    | CloudflareAppService
    | RequirementsOf<CloudflareAppServiceShape>

type RecordFilter = {
    type?:
        | 'A'
        | 'AAAA'
        | 'CAA'
        | 'CERT'
        | 'CNAME'
        | 'DNSKEY'
        | 'DS'
        | 'HTTPS'
        | 'LOC'
        | 'MX'
        | 'NAPTR'
        | 'NS'
        | 'OPENPGPKEY'
        | 'PTR'
        | 'SMIMEA'
        | 'SRV'
        | 'SVCB'
        | 'TLSA'
        | 'TXT'
        | 'URI'
    name?: string
    page?: number
    pageSize?: number
}

/** Every zone the account can see. */
const zonesOf = (apps: CloudflareAppServiceShape, account: DnsProviderAccountRef) =>
    Effect.gen(function* () {
        const client = yield* apps.buildClient(account.providerId)
        const page = yield* attempt(() => client.zones.list())
        return page.result.map(
            (z): DnsProviderZone => ({
                id: z.id,
                name: z.name,
                status: z.status ?? 'unknown',
                nameServers: z.name_servers,
            })
        )
    })

/**
 * The zone among `zones` whose name is the longest suffix of `hostname`; null when none covers it.
 */
const zoneFor = (hostname: string, zones: readonly DnsProviderZone[]) => {
    const clean =
        hostname
            .replace(/^https?:\/\//, '')
            .split('/')[0]
            ?.toLowerCase() ?? hostname
    let best: DnsProviderZone | null = null
    for (const zone of zones) {
        const zoneName = zone.name.toLowerCase()
        if (clean === zoneName || clean.endsWith(`.${zoneName}`)) {
            if (!best || zoneName.length > best.name.length) {
                best = zone
            }
        }
    }
    return best ? { zoneId: best.id, zoneName: best.name } : null
}

/**
 * Zone and record operations on a Cloudflare account, as the shared `DnsProvider` contract states
 * them.
 *
 * The app service — the one that holds the credentials and builds the SDK client — is yielded when a
 * method runs, so this is a constant the module provides as `{ provide: CloudflareDnsProviderService,
 * useClass: CloudflareDnsProviderService.live }`.
 */
export type CloudflareDnsProviderServiceShape = {
    readonly listAccounts: () => Effect.Effect<
        DnsProviderAccountRef[],
        unknown,
        CloudflareDnsProviderRequirements
    >
    readonly findFirstActiveProvider: () => Effect.Effect<
        DnsProviderAccountRef | null,
        unknown,
        CloudflareDnsProviderRequirements
    >
    readonly listZones: (
        account: DnsProviderAccountRef
    ) => Effect.Effect<
        DnsProviderZone[],
        unknown,
        CloudflareDnsProviderRequirements
    >
    readonly findZoneForHostname: (
        account: DnsProviderAccountRef,
        hostname: string
    ) => Effect.Effect<
        { zoneId: string; zoneName: string } | null,
        unknown,
        CloudflareDnsProviderRequirements
    >
    readonly listRecords: (
        account: DnsProviderAccountRef,
        zoneId: string
    ) => Effect.Effect<
        DnsProviderRecord[],
        unknown,
        CloudflareDnsProviderRequirements
    >
    readonly listRecordsFiltered: (
        account: DnsProviderAccountRef,
        zoneId: string,
        filter: RecordFilter
    ) => Effect.Effect<
        {
            records: DnsProviderRecord[]
            total: number
            page: number
            pageSize: number
        },
        unknown,
        CloudflareDnsProviderRequirements
    >
    readonly createRecord: (
        account: DnsProviderAccountRef,
        input: CreateDnsRecordInput
    ) => Effect.Effect<
        DnsProviderRecord,
        unknown,
        CloudflareDnsProviderRequirements
    >
    readonly deleteRecord: (
        account: DnsProviderAccountRef,
        zoneId: string,
        recordId: string
    ) => Effect.Effect<void, unknown, CloudflareDnsProviderRequirements>
}

/** Tag and implementation together: the tag is the contract, `live` the one implementation. */
export class CloudflareDnsProviderService extends Context.Service<
    CloudflareDnsProviderService,
    CloudflareDnsProviderServiceShape
>()('fleet/CloudflareDnsProviderService') {
    static readonly live = class CloudflareDnsProviderServiceImpl
        implements CloudflareDnsProviderServiceShape
    {
        // ─── Provider accounts ───────────────────────────────────────────────

        listAccounts(): ReturnType<
            CloudflareDnsProviderServiceShape['listAccounts']
        > {
            return Effect.gen(function* () {
                const apps = yield* CloudflareAppService
                const views = yield* apps.listApps(PROVIDER_TYPE)
                return views.map(
                    (a): DnsProviderAccountRef => ({
                        providerId: a.id,
                        providerType: PROVIDER_TYPE,
                    })
                )
            })
        }

        /**
         * First active provider app with `dnsManagement` enabled and a healthy
         * runtime state. Used when the caller does not pin a specific provider
         * (e.g. preview DNS provisioning).
         */
        findFirstActiveProvider(): ReturnType<
            CloudflareDnsProviderServiceShape['findFirstActiveProvider']
        > {
            return Effect.gen(function* () {
                const apps = yield* CloudflareAppService
                const views = yield* apps.listApps(PROVIDER_TYPE)
                const active = views.find(
                    (a) =>
                        a.isActive &&
                        a.features.dnsManagement &&
                        a.state?.status === 'ok'
                )
                return active
                    ? ({
                          providerId: active.id,
                          providerType: PROVIDER_TYPE,
                      } satisfies DnsProviderAccountRef)
                    : null
            })
        }

        // ─── Zones ───────────────────────────────────────────────────────────

        listZones(
            account: DnsProviderAccountRef
        ): ReturnType<CloudflareDnsProviderServiceShape['listZones']> {
            return Effect.gen(function* () {
                return yield* zonesOf(yield* CloudflareAppService, account)
            })
        }

        findZoneForHostname(
            account: DnsProviderAccountRef,
            hostname: string
        ): ReturnType<
            CloudflareDnsProviderServiceShape['findZoneForHostname']
        > {
            return Effect.gen(function* () {
                const zones = yield* zonesOf(
                    yield* CloudflareAppService,
                    account
                )
                return zoneFor(hostname, zones)
            })
        }

        // ─── Records ─────────────────────────────────────────────────────────

        listRecords(
            account: DnsProviderAccountRef,
            zoneId: string
        ): ReturnType<CloudflareDnsProviderServiceShape['listRecords']> {
            return Effect.gen(function* () {
                const apps = yield* CloudflareAppService
                const client = yield* apps.buildClient(account.providerId)
                const page = yield* attempt(() =>
                    client.dns.records.list({ zone_id: zoneId })
                )
                return page.result.map(
                    (r): DnsProviderRecord => ({
                        ...toDnsRecordShape(r),
                        zoneId,
                    })
                )
            })
        }

        /**
         * Filtered + paginated record listing (used by the Cloudflare app detail
         * table). Type is narrowed by the contract's enum, so no cast is needed.
         * Auto-paginates the SDK iterator (safety cap) so `total` is truthful.
         */
        listRecordsFiltered(
            account: DnsProviderAccountRef,
            zoneId: string,
            filter: RecordFilter
        ): ReturnType<
            CloudflareDnsProviderServiceShape['listRecordsFiltered']
        > {
            return Effect.gen(function* () {
                const apps = yield* CloudflareAppService
                const client = yield* apps.buildClient(account.providerId)
                const page = filter.page ?? 1
                const pageSize = filter.pageSize ?? 50
                const maxRecords = 5000

                const collected = yield* attempt(async () => {
                    const records: DnsProviderRecord[] = []
                    const stream = client.dns.records.list({
                        zone_id: zoneId,
                        per_page: 500,
                        ...(filter.type ? { type: filter.type } : {}),
                        ...(filter.name
                            ? { name: { exact: filter.name } }
                            : {}),
                    })
                    for await (const rec of stream) {
                        records.push({ ...toDnsRecordShape(rec), zoneId })
                        if (records.length >= maxRecords) break
                    }
                    return records
                })

                const start = (page - 1) * pageSize
                return {
                    records: collected.slice(start, start + pageSize),
                    total: collected.length,
                    page,
                    pageSize,
                }
            })
        }

        createRecord(
            account: DnsProviderAccountRef,
            input: CreateDnsRecordInput
        ): ReturnType<CloudflareDnsProviderServiceShape['createRecord']> {
            return Effect.gen(function* () {
                const apps = yield* CloudflareAppService
                // The shared interface allows any DnsRecordType; the Cloudflare SDK
                // helper supports a narrower set — validate before building params.
                const isSupported = (
                    type: string
                ): type is SupportedRecordType =>
                    ['A', 'AAAA', 'CNAME', 'TXT'].includes(type)
                if (!isSupported(input.type)) {
                    return yield* new FleetInvalid({
                        reason: `Unsupported DNS record type for Cloudflare: ${input.type}`,
                    })
                }
                const params = buildRecordCreateParams({
                    zoneId: input.zoneId,
                    type: input.type,
                    name: input.name,
                    content: input.content,
                    ttl: input.ttl,
                    proxied: input.proxied,
                })
                if (!params) {
                    return yield* new FleetInvalid({
                        reason: `Unsupported DNS record type: ${input.type}`,
                    })
                }
                const client = yield* apps.buildClient(account.providerId)
                const record = yield* attempt(() =>
                    client.dns.records.create(params)
                )
                return {
                    ...toDnsRecordShape(record),
                    zoneId: input.zoneId,
                } satisfies DnsProviderRecord
            })
        }

        /**
         * Delete a DNS record by id within a zone (used by preview cleanup).
         */
        deleteRecord(
            account: DnsProviderAccountRef,
            zoneId: string,
            recordId: string
        ): ReturnType<CloudflareDnsProviderServiceShape['deleteRecord']> {
            return Effect.gen(function* () {
                const apps = yield* CloudflareAppService
                const client = yield* apps.buildClient(account.providerId)
                yield* attempt(() =>
                    client.dns.records.delete(recordId, { zone_id: zoneId })
                )
            })
        }
    }
}
