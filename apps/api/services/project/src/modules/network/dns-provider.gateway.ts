import { Injectable, Logger } from "@nestjs/common";
// `providersContract` from the package root: the wildcard subpath (`./*` → `./*.ts`)
// does not resolve a directory's `index.ts`, so `modules/providers` is not importable
// even though the file exists.
import { providersContract } from "@deployer/fleet-contracts";
import { ServiceClient } from "@deployer/shared/server";

/**
 * The DNS/provider facts `project` needs, reached through fleet's CONTRACT.
 *
 * ── WHY AN ADAPTER AND NOT THE SERVICES ─────────────────────────────────────
 * The project domain builds a network view (zones, records, provider list) that is
 * entirely fleet's data: the provider apps, their zones and their DNS records all live
 * in fleet, which owns `dns_providers`. `project` used to inject fleet's
 * `CloudflareAppService` / `CloudflareDnsProviderService` directly, which is the
 * coupling the service split exists to remove — and which could not actually resolve,
 * since those modules are not in this app.
 *
 * Reaching fleet through `providersContract` keeps the boundary: fleet decides what a
 * zone or a record IS, and this class only narrows the contract's output to the view
 * shapes `project` renders. If fleet is unreachable the call fails loudly rather than
 * silently returning an empty network view, which would look like "no zones configured"
 * on a screen that is actually broken.
 */
@Injectable()
export class DnsProviderGateway {
    private readonly logger = new Logger(DnsProviderGateway.name);

    constructor(private readonly clients: ServiceClient) {}

    /** The provider apps an operator can pin a project to, with their live state. */
    async listProviders() {
        const client = this.clients.clientFor("fleet", providersContract);
        const result = await client.dns.list({});
        return result.providers;
    }
    /** The zones a provider account exposes. */
    async listZones(providerId: string) {
        const client = this.clients.clientFor("fleet", providersContract);
        const result = await client.dns.cloudflare.listZones({ params: { providerId } });
        return result.zones;
    }

    /** The DNS records in a zone. */
    async listRecords(providerId: string, zoneId: string) {
        const client = this.clients.clientFor("fleet", providersContract);
        const result = await client.dns.cloudflare.listRecords({ params: { providerId, zoneId } });
        return result.records;
    }

    /** Create a record in a zone. */
    async createRecord(
        providerId: string,
        zoneId: string,
        input: { type: "A" | "AAAA" | "CNAME" | "TXT"; name: string; content: string; ttl?: number; proxied?: boolean },
    ) {
        const client = this.clients.clientFor("fleet", providersContract);
        const result = await client.dns.cloudflare.createRecord({
            params: { providerId, zoneId },
            body: input,
        });
        return result;
    }

    /**
     * Resolve a zone's name, for syncing a project's base domain.
     *
     * Returns `undefined` when the provider is reachable but the zone is gone, and
     * lets a transport failure propagate — the two cases mean different things and
     * collapsing them would hide a broken fleet behind "zone not found".
     */
    async findZoneName(providerId: string, zoneId: string): Promise<string | undefined> {
        const zones = await this.listZones(providerId);
        return zones.find((z) => z.id === zoneId)?.name;
    }
}
