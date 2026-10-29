/**
 * DNS Provider Registry
 *
 * The public API for DNS provider operations: callers invoke ONE shared
 * method and the registry resolves the right provider adapter by type.
 *
 * The adapters are Effect services; `registered` is the one place that names them, so a second
 * provider is one more entry there and nothing else changes.
 */
import { serviceOver, type Over, type RequirementsOf } from "@deployer/effect-core";
import { Context, Effect } from "effect";

import { FleetInvalid } from "@/core/fleet.errors";
import {
    CloudflareDnsProviderService,
    type CloudflareDnsProviderServiceShape,
} from "../cloudflare/services/cloudflare-dns-provider.service";
import type {
    CreateDnsRecordInput,
    DnsProvider,
    DnsProviderAccountRef,
} from "./dns-provider.interface";

/** The adapters, by the lowercase provider type the registry dispatches on. */
type RegisteredProviders = { readonly cloudflare: CloudflareDnsProviderServiceShape };

/** What a provider adapter reads from the Effect context when one of its methods runs. */
type ProviderRequirements = RequirementsOf<CloudflareDnsProviderServiceShape>;

function makeDnsProviderRegistryService(registered: RegisteredProviders) {
    const providersByType = new Map<string, DnsProvider<ProviderRequirements>>(Object.entries(registered));

    /** Resolve the adapter for a provider type, or fail. */
    const getProvider = (providerType: string) => {
        const provider = providersByType.get(providerType.toLowerCase());
        return provider
            ? Effect.succeed(provider)
            : Effect.fail(new FleetInvalid({ reason: `Unsupported DNS provider '${providerType}'` }));
    };

    return {
        /** Registered provider types (e.g. ["cloudflare"]). */
        listProviderTypes: () => Effect.succeed([...providersByType.keys()]),

        // ─── Shared dispatch methods ────────────────────────────────────────────

        listAccounts: Effect.fn("DnsProviderRegistryService.listAccounts")(function* (providerType: string) {
            const provider = yield* getProvider(providerType);
            return yield* provider.listAccounts();
        }),

        listZones: Effect.fn("DnsProviderRegistryService.listZones")(function* (account: DnsProviderAccountRef) {
            const provider = yield* getProvider(account.providerType);
            return yield* provider.listZones(account);
        }),

        findZoneForHostname: Effect.fn("DnsProviderRegistryService.findZoneForHostname")(function* (
            account: DnsProviderAccountRef,
            hostname: string,
        ) {
            const provider = yield* getProvider(account.providerType);
            return yield* provider.findZoneForHostname(account, hostname);
        }),

        listRecords: Effect.fn("DnsProviderRegistryService.listRecords")(function* (
            account: DnsProviderAccountRef,
            zoneId: string,
        ) {
            const provider = yield* getProvider(account.providerType);
            return yield* provider.listRecords(account, zoneId);
        }),

        createRecord: Effect.fn("DnsProviderRegistryService.createRecord")(function* (
            account: DnsProviderAccountRef,
            input: CreateDnsRecordInput,
        ) {
            const provider = yield* getProvider(account.providerType);
            return yield* provider.createRecord(account, input);
        }),

        deleteRecord: Effect.fn("DnsProviderRegistryService.deleteRecord")(function* (
            account: DnsProviderAccountRef,
            zoneId: string,
            recordId: string,
        ) {
            const provider = yield* getProvider(account.providerType);
            return yield* provider.deleteRecord(account, zoneId, recordId);
        }),
    };
}

export type DnsProviderRegistryServiceShape = Over<ReturnType<typeof makeDnsProviderRegistryService>, CloudflareDnsProviderService>;

/** Tag and implementation together: the tag is the contract, `live` the one implementation. */
export class DnsProviderRegistryService extends Context.Service<DnsProviderRegistryService, DnsProviderRegistryServiceShape>()(
    "fleet/DnsProviderRegistryService",
) {
    /** The adapters are yielded when a method runs, so this is a constant the module provides with `useValue`. */
    static readonly live: DnsProviderRegistryServiceShape = serviceOver(
        Effect.all({ cloudflare: CloudflareDnsProviderService }),
        makeDnsProviderRegistryService,
    );
}

/**
 * Everything a registry method leaves open in the Effect context: the registry itself, its adapters
 * and what they read. A consumer that hands the registry over with its requirements settled
 * (`bindServices`) names this.
 */
export type DnsProviderRegistryServices = DnsProviderRegistryService | RequirementsOf<DnsProviderRegistryServiceShape>;
