import type { DnsRecordType } from "@deployer/contracts-common";

import type { Effect } from "effect";

/**
 * DNS Provider Interface — abstract contract every DNS provider adapter
 * implements. THE abstract contract is the shared dispatch surface.
 */

export type DnsProviderAccountRef = {
    /** Provider app row id (dns_providers.id). */
    providerId: string;
    /** Provider type: "cloudflare" | "route53" | "google-dns" | ... */
    providerType: string;
}

export type DnsProviderZone = {
    id: string;
    name: string;
    status: string;
    nameServers: string[];
}

export type DnsProviderRecord = {
    id: string;
    zoneId: string;
    name: string;
    type: string;
    content: string;
    ttl: number;
    proxied: boolean;
}

export type CreateDnsRecordInput = {
    zoneId: string;
    type: DnsRecordType;
    name: string;
    content: string;
    ttl?: number;
    proxied?: boolean;
}

/**
 * What a DNS provider adapter answers, as Effects. `R` is what the adapter reads from the Effect
 * context; the registry dispatches on the key the adapter is registered under, so the adapter carries
 * no type key of its own.
 */
export type DnsProvider<R = never> = {
    /** Accounts this provider type knows about. */
    listAccounts(): Effect.Effect<DnsProviderAccountRef[], unknown, R>;

    listZones(account: DnsProviderAccountRef): Effect.Effect<DnsProviderZone[], unknown, R>;

    /** Find the zone whose name is the longest suffix of `hostname`. */
    findZoneForHostname(
        account: DnsProviderAccountRef,
        hostname: string,
    ): Effect.Effect<{ zoneId: string; zoneName: string } | null, unknown, R>;

    listRecords(
        account: DnsProviderAccountRef,
        zoneId: string,
    ): Effect.Effect<DnsProviderRecord[], unknown, R>;

    createRecord(
        account: DnsProviderAccountRef,
        input: CreateDnsRecordInput,
    ): Effect.Effect<DnsProviderRecord, unknown, R>;

    deleteRecord(
        account: DnsProviderAccountRef,
        zoneId: string,
        recordId: string,
    ): Effect.Effect<void, unknown, R>;
}
