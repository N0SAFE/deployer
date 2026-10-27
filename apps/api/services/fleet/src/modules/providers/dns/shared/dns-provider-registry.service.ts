/**
 * DNS Provider Registry
 *
 * The public API for DNS provider operations: callers invoke ONE shared
 * method and the registry resolves the right provider adapter by type.
 */
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import type {
    CreateDnsRecordInput,
    DnsProvider,
    DnsProviderAccountRef,
    DnsProviderRecord,
    DnsProviderZone,
} from "./dns-provider.interface";

/**
 * Multi-provider injection token.
 *
 * A `Symbol`, not the `"DNS_PROVIDERS"` string this used to be: a plain string constant
 * is not a key Nest's provider union recognises, so a multi-bound entry carrying it is
 * awkward to type. The string form was declared and never used, which is exactly why
 * nobody noticed.
 *
 * Kept in step with `apps/api`'s copy — the two tiers must agree on the token or the
 * same module file behaves differently depending on which service loads it.
 */
export const DNS_PROVIDERS = Symbol("DNS_PROVIDERS");

@Injectable()
export class DnsProviderRegistryService {
    private readonly logger = new Logger(DnsProviderRegistryService.name);
    private readonly providersByType: Map<string, DnsProvider>;

    constructor(providers: DnsProvider[]) {
        this.providersByType = new Map(
            providers.map((provider) => [provider.providerType.toLowerCase(), provider]),
        );
    }

    /** Registered provider types (e.g. ["cloudflare"]). */
    listProviderTypes(): string[] {
        return [...this.providersByType.keys()];
    }

    /** Resolve the adapter for a provider type, or throw. */
    getProvider(providerType: string): DnsProvider {
        const provider = this.providersByType.get(providerType.toLowerCase());
        if (!provider) {
            throw new BadRequestException(`Unsupported DNS provider '${providerType}'`);
        }
        return provider;
    }

    // ─── Shared dispatch methods ────────────────────────────────────────────

    async listAccounts(providerType: string): Promise<DnsProviderAccountRef[]> {
        return this.getProvider(providerType).listAccounts();
    }

    async listZones(account: DnsProviderAccountRef): Promise<DnsProviderZone[]> {
        return this.getProvider(account.providerType).listZones(account);
    }

    async findZoneForHostname(
        account: DnsProviderAccountRef,
        hostname: string,
    ): Promise<{ zoneId: string; zoneName: string } | null> {
        return this.getProvider(account.providerType).findZoneForHostname(account, hostname);
    }

    async listRecords(
        account: DnsProviderAccountRef,
        zoneId: string,
    ): Promise<DnsProviderRecord[]> {
        return this.getProvider(account.providerType).listRecords(account, zoneId);
    }

    async createRecord(
        account: DnsProviderAccountRef,
        input: CreateDnsRecordInput,
    ): Promise<DnsProviderRecord> {
        return this.getProvider(account.providerType).createRecord(account, input);
    }

    async deleteRecord(
        account: DnsProviderAccountRef,
        zoneId: string,
        recordId: string,
    ): Promise<void> {
        return this.getProvider(account.providerType).deleteRecord(account, zoneId, recordId);
    }
}
