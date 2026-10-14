import type { DnsRecordType } from "@repo/contracts-common";

/**
 * DNS Provider Interface — abstract contract every DNS provider adapter
 * implements. THE abstract contract is the shared dispatch surface.
 */

export interface DnsProviderAccountRef {
    /** Provider app row id (dns_providers.id). */
    providerId: string;
    /** Provider type: "cloudflare" | "route53" | "google-dns" | ... */
    providerType: string;
}

export interface DnsProviderZone {
    id: string;
    name: string;
    status: string;
    nameServers: string[];
}

export interface DnsProviderRecord {
    id: string;
    zoneId: string;
    name: string;
    type: string;
    content: string;
    ttl: number;
    proxied: boolean;
}

export interface CreateDnsRecordInput {
    zoneId: string;
    type: DnsRecordType;
    name: string;
    content: string;
    ttl?: number;
    proxied?: boolean;
}

export interface DnsProvider {
    /** Lowercase provider type key used for dispatch: "cloudflare", "route53", ... */
    readonly providerType: string;

    /** Accounts this provider type knows about. */
    listAccounts(): Promise<DnsProviderAccountRef[]>;

    listZones(account: DnsProviderAccountRef): Promise<DnsProviderZone[]>;

    /** Find the zone whose name is the longest suffix of `hostname`. */
    findZoneForHostname(
        account: DnsProviderAccountRef,
        hostname: string,
    ): Promise<{ zoneId: string; zoneName: string } | null>;

    listRecords(
        account: DnsProviderAccountRef,
        zoneId: string,
    ): Promise<DnsProviderRecord[]>;

    createRecord(
        account: DnsProviderAccountRef,
        input: CreateDnsRecordInput,
    ): Promise<DnsProviderRecord>;

    deleteRecord(
        account: DnsProviderAccountRef,
        zoneId: string,
        recordId: string,
    ): Promise<void>;
}
