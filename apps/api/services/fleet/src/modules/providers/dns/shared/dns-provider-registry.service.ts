/**
 * DNS Provider Registry
 *
 * The public API for DNS provider operations: callers invoke ONE shared
 * method and the registry resolves the right provider adapter by type.
 *
 * The adapters are Effect services; `REGISTERED_PROVIDERS` is the one place that names them, so a
 * second provider is one more entry there and nothing else changes.
 */
import { Context, Effect } from 'effect'

import type { RequirementsOf } from '@deployer/effect-core'

import { FleetInvalid } from '@/core/fleet.errors'

import { CloudflareDnsProviderService } from '../cloudflare/services/cloudflare-dns-provider.service'

import type {
    CreateDnsRecordInput,
    DnsProviderAccountRef,
    DnsProviderRecord,
    DnsProviderZone,
} from './dns-provider.interface'
import type { CloudflareDnsProviderServiceShape } from '../cloudflare/services/cloudflare-dns-provider.service'

/**
 * The registered adapters, by the lowercase provider type the registry dispatches on.
 *
 * A list of TAGS, not of built shapes: an adapter is an Effect service whose collaborators are only
 * reachable by yielding it, so the registry cannot hold an instance. It holds the tag and yields it
 * when a method runs.
 */
const REGISTERED_PROVIDERS = [
    { providerType: 'cloudflare', service: CloudflareDnsProviderService },
] as const

/** The adapter tag for a provider type, or a refusal. */
const providerFor = (providerType: string) => {
    const wanted = providerType.toLowerCase()
    const found = REGISTERED_PROVIDERS.find(
        (entry) => entry.providerType === wanted
    )
    return found
        ? Effect.succeed(found.service)
        : Effect.fail(
              new FleetInvalid({
                  reason: `Unsupported DNS provider '${providerType}'`,
              })
          )
}

/** What a registry method leaves open: the adapter it yields, and what the adapter reads. */
export type DnsProviderRegistryRequirements =
    | CloudflareDnsProviderService
    | RequirementsOf<CloudflareDnsProviderServiceShape>

export type DnsProviderRegistryServiceShape = {
    /** Registered provider types (e.g. ["cloudflare"]). */
    readonly listProviderTypes: () => Effect.Effect<string[]>
    readonly listAccounts: (
        providerType: string
    ) => Effect.Effect<
        DnsProviderAccountRef[],
        unknown,
        DnsProviderRegistryRequirements
    >
    readonly listZones: (
        account: DnsProviderAccountRef
    ) => Effect.Effect<
        DnsProviderZone[],
        unknown,
        DnsProviderRegistryRequirements
    >
    readonly findZoneForHostname: (
        account: DnsProviderAccountRef,
        hostname: string
    ) => Effect.Effect<
        { zoneId: string; zoneName: string } | null,
        unknown,
        DnsProviderRegistryRequirements
    >
    readonly listRecords: (
        account: DnsProviderAccountRef,
        zoneId: string
    ) => Effect.Effect<
        DnsProviderRecord[],
        unknown,
        DnsProviderRegistryRequirements
    >
    readonly createRecord: (
        account: DnsProviderAccountRef,
        input: CreateDnsRecordInput
    ) => Effect.Effect<
        DnsProviderRecord,
        unknown,
        DnsProviderRegistryRequirements
    >
    readonly deleteRecord: (
        account: DnsProviderAccountRef,
        zoneId: string,
        recordId: string
    ) => Effect.Effect<void, unknown, DnsProviderRegistryRequirements>
}

/**
 * Dispatch to the adapter registered for a provider type.
 *
 * The adapter is yielded when a method runs, so this is a constant the module provides as
 * `{ provide: DnsProviderRegistryService, useClass: DnsProviderRegistryService.live }`.
 */
export class DnsProviderRegistryService extends Context.Service<
    DnsProviderRegistryService,
    DnsProviderRegistryServiceShape
>()('fleet/DnsProviderRegistryService') {
    static readonly live = class DnsProviderRegistryServiceImpl
        implements DnsProviderRegistryServiceShape
    {
        listProviderTypes(): ReturnType<
            DnsProviderRegistryServiceShape['listProviderTypes']
        > {
            return Effect.succeed(
                REGISTERED_PROVIDERS.map((entry) => entry.providerType)
            )
        }

        listAccounts(
            providerType: string
        ): ReturnType<DnsProviderRegistryServiceShape['listAccounts']> {
            return Effect.gen(function* () {
                const adapter = yield* providerFor(providerType)
                const provider = yield* adapter
                return yield* provider.listAccounts()
            })
        }

        listZones(
            account: DnsProviderAccountRef
        ): ReturnType<DnsProviderRegistryServiceShape['listZones']> {
            return Effect.gen(function* () {
                const adapter = yield* providerFor(account.providerType)
                const provider = yield* adapter
                return yield* provider.listZones(account)
            })
        }

        findZoneForHostname(
            account: DnsProviderAccountRef,
            hostname: string
        ): ReturnType<
            DnsProviderRegistryServiceShape['findZoneForHostname']
        > {
            return Effect.gen(function* () {
                const adapter = yield* providerFor(account.providerType)
                const provider = yield* adapter
                return yield* provider.findZoneForHostname(account, hostname)
            })
        }

        listRecords(
            account: DnsProviderAccountRef,
            zoneId: string
        ): ReturnType<DnsProviderRegistryServiceShape['listRecords']> {
            return Effect.gen(function* () {
                const adapter = yield* providerFor(account.providerType)
                const provider = yield* adapter
                return yield* provider.listRecords(account, zoneId)
            })
        }

        createRecord(
            account: DnsProviderAccountRef,
            input: CreateDnsRecordInput
        ): ReturnType<DnsProviderRegistryServiceShape['createRecord']> {
            return Effect.gen(function* () {
                const adapter = yield* providerFor(account.providerType)
                const provider = yield* adapter
                return yield* provider.createRecord(account, input)
            })
        }

        deleteRecord(
            account: DnsProviderAccountRef,
            zoneId: string,
            recordId: string
        ): ReturnType<DnsProviderRegistryServiceShape['deleteRecord']> {
            return Effect.gen(function* () {
                const adapter = yield* providerFor(account.providerType)
                const provider = yield* adapter
                return yield* provider.deleteRecord(account, zoneId, recordId)
            })
        }
    }
}

/**
 * Everything a registry method leaves open in the Effect context: the registry itself, its adapters
 * and what they read. A consumer that hands the registry over with its requirements settled
 * (`bindServices`) names this.
 */
export type DnsProviderRegistryServices =
    | DnsProviderRegistryService
    | RequirementsOf<DnsProviderRegistryServiceShape>
