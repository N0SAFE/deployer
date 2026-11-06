/**
 * EdgeDnsService — converges the DNS records the lanes need, through whichever DNS
 * provider account owns the zone.
 *
 * The record set for a lane name is owned by the lane: converging `*.<domain>`
 * means creating the planned contents and deleting any other A/AAAA/CNAME at that
 * exact name. When no configured provider owns the zone, the record is reported
 * as `manual` with exactly what to create — a missing provider is an operator
 * step, not an error.
 */

import { Context, Effect } from 'effect'

import {
    DnsProviderRegistryService,
    type DnsProviderRegistryServices,
    type DnsProviderRegistryServiceShape,
} from '@/modules/providers/dns/shared/dns-provider-registry.service'
import type { DnsProviderAccountRef } from '@/modules/providers/dns/shared/dns-provider.interface'

import type { LaneDnsRecordPlan } from './lane-dns-plan'

export type LaneDnsResult = {
    lane: LaneDnsRecordPlan['lane']
    name: string
    type: LaneDnsRecordPlan['type']
    contents: string[]
    status: 'synced' | 'manual' | 'error'
    detail: string | null
}

/** The record types a lane name may carry; anything else at that name is left alone. */
const LANE_OWNED_TYPES = new Set(['A', 'AAAA', 'CNAME'])

const describe = (error: unknown) =>
    error instanceof Error ? error.message : String(error)

/**
 * Nothing here fails: each record reports its own outcome (`synced`, `manual`, `error`), because a
 * missing provider is an operator step and a provider outage must not abort the other records.
 */
export type EdgeDnsServiceShape = {
    /** Results of the last reconcile: what the Network pages show. */
    readonly results: () => Effect.Effect<
        LaneDnsResult[],
        never,
        DnsProviderRegistryServices
    >
    /** Converge every planned record set. */
    readonly reconcile: (
        plans: readonly LaneDnsRecordPlan[]
    ) => Effect.Effect<LaneDnsResult[], never, DnsProviderRegistryServices>
    /** Remove the lane-owned records at `name` (e.g. after the edge moved to another domain). */
    readonly removeRecords: (
        name: string,
        preferredProviderId: string | null
    ) => Effect.Effect<void, never, DnsProviderRegistryServices>
}

/** What the last reconcile found, kept across calls. */
type EdgeDnsState = { lastResults: LaneDnsResult[] }

/** The zone that serves a hostname, and the account that owns it. */
type ZoneLocation = {
    readonly account: DnsProviderAccountRef
    readonly zoneId: string
    readonly zoneName: string
}

/** Find the account + zone serving `hostname`, trying `preferred` first. */
function locateZone(
    registry: DnsProviderRegistryServiceShape,
    hostname: string,
    preferred: string | null
): Effect.Effect<ZoneLocation | null, never, DnsProviderRegistryServices> {
    return Effect.gen(function* () {
        const accounts: DnsProviderAccountRef[] = []
        for (const type of yield* registry.listProviderTypes()) {
            accounts.push(
                ...(yield* registry
                    .listAccounts(type)
                    .pipe(
                        Effect.orElseSucceed((): DnsProviderAccountRef[] => [])
                    ))
            )
        }
        accounts.sort(
            (a, b) =>
                Number(b.providerId === preferred) -
                Number(a.providerId === preferred)
        )
        for (const account of accounts) {
            const zone = yield* registry
                .findZoneForHostname(account, hostname)
                .pipe(Effect.orElseSucceed(() => null))
            if (zone !== null) return { account, ...zone }
        }
        return null
    })
}

/** Converge one planned record set; a provider failure is reported on the record, never raised. */
function convergeRecord(
    registry: DnsProviderRegistryServiceShape,
    plan: LaneDnsRecordPlan,
    preferred: string | null
): Effect.Effect<LaneDnsResult, never, DnsProviderRegistryServices> {
    const base = {
        lane: plan.lane,
        name: plan.name,
        type: plan.type,
        contents: plan.contents,
    }
    return Effect.gen(function* () {
        const zone = yield* locateZone(
            registry,
            plan.name.replace(/^\*\./, ''),
            preferred
        )
        if (zone === null) {
            return {
                ...base,
                status: 'manual' as const,
                detail: `No configured DNS provider owns this zone — create ${plan.type} ${plan.name} → ${plan.contents.join(', ')} manually`,
            }
        }
        const existing = (yield* registry.listRecords(
            zone.account,
            zone.zoneId
        )).filter(
            (record) =>
                record.name.toLowerCase() === plan.name.toLowerCase() &&
                LANE_OWNED_TYPES.has(record.type)
        )
        for (const record of existing) {
            const keep =
                record.type === plan.type &&
                plan.contents.includes(record.content) &&
                record.proxied === plan.proxied
            if (!keep)
                yield* registry.deleteRecord(
                    zone.account,
                    zone.zoneId,
                    record.id
                )
        }
        const present = new Set(
            existing
                .filter(
                    (record) =>
                        record.type === plan.type &&
                        record.proxied === plan.proxied
                )
                .map((record) => record.content)
        )
        for (const content of plan.contents) {
            if (present.has(content)) continue
            yield* registry.createRecord(zone.account, {
                zoneId: zone.zoneId,
                type: plan.type,
                name: plan.name,
                content,
                ttl: 1,
                proxied: plan.proxied,
            })
        }
        yield* Effect.logInfo(
            `DNS ${plan.type} ${plan.name} → ${plan.contents.join(', ')} (zone ${zone.zoneName})`
        )
        return { ...base, status: 'synced' as const, detail: null }
    }).pipe(
        Effect.catch((error) => {
            const detail = describe(error)
            return Effect.logWarning(
                `DNS ${plan.type} ${plan.name} not converged: ${detail}`
            ).pipe(Effect.as({ ...base, status: 'error' as const, detail }))
        })
    )
}

/**
 * The records the lanes need, converged through whichever provider owns the zone.
 *
 * The registry is yielded when a method runs, so this is a class the module provides with `useClass`: one instance keeps
 * the last results, which is the state the Network pages read back.
 */
export class EdgeDnsService extends Context.Service<
    EdgeDnsService,
    EdgeDnsServiceShape
>()('fleet/EdgeDnsService') {
    static readonly live = class EdgeDnsServiceImpl implements EdgeDnsServiceShape {
        private readonly state: EdgeDnsState = { lastResults: [] }

        // Bound, not a method: `provideTo` calls a service's members off the proxy without a receiver.
        readonly results = (): ReturnType<EdgeDnsServiceShape['results']> =>
            Effect.sync(() => this.state.lastResults)

        readonly reconcile = (
            plans: readonly LaneDnsRecordPlan[]
        ): ReturnType<EdgeDnsServiceShape['reconcile']> => {
            const state = this.state
            return Effect.gen(function* () {
                const registry = yield* DnsProviderRegistryService
                const results: LaneDnsResult[] = []
                for (const plan of plans)
                    results.push(
                        yield* convergeRecord(
                            registry,
                            plan,
                            plan.preferredAccountId
                        )
                    )
                state.lastResults = results
                return results
            })
        }

        removeRecords(
            name: string,
            preferredProviderId: string | null
        ): ReturnType<EdgeDnsServiceShape['removeRecords']> {
            return Effect.gen(function* () {
                const registry = yield* DnsProviderRegistryService
                const zone = yield* locateZone(
                    registry,
                    name.replace(/^\*\./, ''),
                    preferredProviderId
                )
                if (zone === null) return
                const records = yield* registry.listRecords(
                    zone.account,
                    zone.zoneId
                )
                for (const record of records) {
                    if (
                        record.name.toLowerCase() === name.toLowerCase() &&
                        LANE_OWNED_TYPES.has(record.type)
                    ) {
                        yield* registry.deleteRecord(
                            zone.account,
                            zone.zoneId,
                            record.id
                        )
                    }
                }
            }).pipe(
                Effect.catch((error) =>
                    Effect.logWarning(
                        `DNS cleanup of ${name} failed: ${describe(error)}`
                    )
                )
            )
        }
    }
}
