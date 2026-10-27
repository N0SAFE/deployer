/**
 * DNS Provider Registry
 *
 * The public API for DNS provider operations: callers invoke ONE shared
 * method and the registry resolves the right provider adapter by type.
 */
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { DnsProvider } from "./dns-provider.interface";
import type { CreateDnsRecordInput, DnsProviderAccountRef, DnsProviderRecord, DnsProviderZone } from "./dns-provider.interface";
import { DnsProvidersRepository } from "./repositories/dns-providers.repository";

/**
 * Multi-provider injection token.
 *
 * ── WHY A SYMBOL AND NOT THE STRING IT USED TO BE ────────────────────────────
 * This was `export const DNS_PROVIDERS = "DNS_PROVIDERS"`, which works at runtime
 * but defeats Nest's typing: a plain `string` constant is not a recognised
 * `Provider` key, so a `{ provide: DNS_PROVIDERS, multi: true }` entry fails to
 * compile with "Object literal may only specify known properties". The token was
 * declared and then never used — which is exactly why that went unnoticed.
 *
 * A `Symbol` carries the runtime identity Nest needs AND is accepted in a
 * multi-provider entry, so adding a provider stays one array entry.
 */
export const DNS_PROVIDERS = Symbol("DNS_PROVIDERS");

@Injectable()
export class DnsProviderRegistryService {
    private readonly logger = new Logger(DnsProviderRegistryService.name);
    private readonly providersByType: Map<string, DnsProvider>;

    constructor(
        providers: DnsProvider[],
        private readonly repository: DnsProvidersRepository,
    ) {
        this.providersByType = new Map(
            providers.map((provider) => [provider.providerType.toLowerCase(), provider]),
        );
    }

    /** Registered provider types (e.g. ["cloudflare"]). */
    listProviderTypes(): string[] {
        return [...this.providersByType.keys()];
    }

    /**
     * Build a `DnsProviderAccountRef` from a stored provider id.
     *
     * Callers used to hand-construct this as `{ providerId, providerType:
     * "cloudflare" }`, which hardcoded one provider at every call site: a second
     * DNS provider would silently route to Cloudflare (or fail with a confusing
     * "unsupported provider"). The provider type belongs to the row, so it is
     * read from the row.
     *
     * Returns `null` when the provider row is gone — callers treat that the same
     * as "no provider configured" rather than throwing on a stale config.
     */
    async resolveAccount(providerId: string): Promise<DnsProviderAccountRef | null> {
        const row = await this.repository.findById(providerId);
        if (!row) {
            this.logger.warn(`DNS provider not found: ${providerId}`);
            return null;
        }
        return { providerId: row.id, providerType: row.providerType };
    }

    /**
     * First active account across ALL registered providers, in registration order.
     *
     * This lived on `CloudflareDnsProviderService`, so callers that only needed
     * "whichever DNS provider is configured" were bound to Cloudflare and had to
     * inject the concrete class. Resolution belongs to the registry: it already
     * knows every provider.
     */
    async findFirstActiveAccount(): Promise<DnsProviderAccountRef | null> {
        for (const provider of this.providersByType.values()) {
            const accounts = await provider.listAccounts();
            if (accounts.length > 0) {
                return accounts[0]!;
            }
        }
        return null;
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
