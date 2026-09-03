/**
 * Cloudflare DNS Provider — implements the shared `DnsProvider` contract.
 *
 * Owns zone/record operations only. Provider-app storage, credentials and
 * runtime state live in `CloudflareAppService` (the `dns_providers` table);
 * tunnel operations live in `CloudflareTunnelService`. Registered in the
 * ProvidersModule and dispatched by the DnsProviderRegistryService.
 *
 * Consumers: the DnsProvidersController (HTTP) and PreviewProvisioningService
 * (server-side DNS record creation for preview domains). No domain value ever
 * comes from env vars.
 */
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { CloudflareAppService } from "./cloudflare-app.service";
import {
    buildRecordCreateParams,
    toDnsRecordShape,
    type SupportedRecordType,
} from "./cloudflare.helpers";
import type {
    CreateDnsRecordInput,
    DnsProvider,
    DnsProviderAccountRef,
    DnsProviderRecord,
    DnsProviderZone,
} from "../../shared/dns-provider.interface";

@Injectable()
export class CloudflareDnsProviderService implements DnsProvider {
    readonly providerType = "cloudflare";

    private readonly logger = new Logger(CloudflareDnsProviderService.name);

    constructor(
        private readonly appService: CloudflareAppService,
    ) {}

    // ─── Provider accounts ───────────────────────────────────────────────────

    async listAccounts(): Promise<DnsProviderAccountRef[]> {
        const apps = await this.appService.listApps(this.providerType);
        return apps.map((a) => ({ providerId: a.id, providerType: this.providerType }));
    }

    /**
     * First active provider app with `dnsManagement` enabled and a healthy
     * runtime state. Used when the caller does not pin a specific provider
     * (e.g. preview DNS provisioning).
     */
    async findFirstActiveProvider(): Promise<DnsProviderAccountRef | null> {
        const apps = await this.appService.listApps(this.providerType);
        const active = apps.find((a) => a.isActive && a.features.dnsManagement && a.state?.status === "ok");
        return active
            ? { providerId: active.id, providerType: this.providerType }
            : null;
    }

    // ─── Zones ───────────────────────────────────────────────────────────────

    async listZones(account: DnsProviderAccountRef): Promise<DnsProviderZone[]> {
        const client = await this.appService.buildClient(account.providerId);
        const page = await client.zones.list();
        return page.result.map((z) => ({
            id: z.id,
            name: z.name,
            status: z.status ?? "unknown",
            nameServers: z.name_servers,
        }));
    }

    /**
     * Find the zone whose name is the longest suffix of `hostname`.
     * Returns null when no provider zone covers the hostname.
     */
    async findZoneForHostname(
        account: DnsProviderAccountRef,
        hostname: string,
    ): Promise<{ zoneId: string; zoneName: string } | null> {
        const clean = hostname.replace(/^https?:\/\//, "").split("/")[0]?.toLowerCase() ?? hostname;
        const zones = await this.listZones(account);
        let best: DnsProviderZone | null = null;
        for (const zone of zones) {
            const zoneName = zone.name.toLowerCase();
            if (clean === zoneName || clean.endsWith(`.${zoneName}`)) {
                if (!best || zoneName.length > best.name.length) {
                    best = zone;
                }
            }
        }
        return best ? { zoneId: best.id, zoneName: best.name } : null;
    }

    // ─── Records ─────────────────────────────────────────────────────────────

    async listRecords(
        account: DnsProviderAccountRef,
        zoneId: string,
    ): Promise<DnsProviderRecord[]> {
        const client = await this.appService.buildClient(account.providerId);
        const page = await client.dns.records.list({ zone_id: zoneId });
        return page.result.map((r) => ({
            ...toDnsRecordShape(r),
            zoneId,
        }));
    }

    /**
     * Filtered + paginated record listing (used by the Cloudflare app detail
     * table). Type is narrowed by the contract's enum, so no cast is needed.
     * Auto-paginates the SDK iterator (safety cap) so `total` is truthful.
     */
    async listRecordsFiltered(
        account: DnsProviderAccountRef,
        zoneId: string,
        filter: {
            type?: "A" | "AAAA" | "CAA" | "CERT" | "CNAME" | "DNSKEY" | "DS" | "HTTPS" | "LOC" | "MX" | "NAPTR" | "NS" | "OPENPGPKEY" | "PTR" | "SMIMEA" | "SRV" | "SVCB" | "TLSA" | "TXT" | "URI";
            name?: string;
            page?: number;
            pageSize?: number;
        },
    ): Promise<{ records: DnsProviderRecord[]; total: number; page: number; pageSize: number }> {
        const client = await this.appService.buildClient(account.providerId);
        const page = filter.page ?? 1;
        const pageSize = filter.pageSize ?? 50;
        const MAX_RECORDS = 5000;

        const collected: DnsProviderRecord[] = [];
        const stream = client.dns.records.list({
            zone_id: zoneId,
            per_page: 500,
            ...(filter.type ? { type: filter.type } : {}),
            ...(filter.name ? { name: { exact: filter.name } } : {}),
        });
        for await (const rec of stream) {
            collected.push({ ...toDnsRecordShape(rec), zoneId });
            if (collected.length >= MAX_RECORDS) break;
        }

        const start = (page - 1) * pageSize;
        return {
            records: collected.slice(start, start + pageSize),
            total: collected.length,
            page,
            pageSize,
        };
    }

    async createRecord(
        account: DnsProviderAccountRef,
        input: CreateDnsRecordInput,
    ): Promise<DnsProviderRecord> {
        // The shared interface allows any DnsRecordType; the Cloudflare SDK
        // helper supports a narrower set — validate before building params.
        const isSupported = (type: string): type is SupportedRecordType =>
            ["A", "AAAA", "CNAME", "TXT"].includes(type);
        if (!isSupported(input.type)) {
            throw new BadRequestException(`Unsupported DNS record type for Cloudflare: ${input.type}`);
        }
        const params = buildRecordCreateParams({
            zoneId: input.zoneId,
            type: input.type,
            name: input.name,
            content: input.content,
            ttl: input.ttl,
            proxied: input.proxied,
        });
        if (!params) {
            throw new BadRequestException(`Unsupported DNS record type: ${input.type}`);
        }
        const client = await this.appService.buildClient(account.providerId);
        const record = await client.dns.records.create(params);
        return {
            ...toDnsRecordShape(record),
            zoneId: input.zoneId,
        };
    }

    /**
     * Delete a DNS record by id within a zone (used by preview cleanup).
     */
    async deleteRecord(
        account: DnsProviderAccountRef,
        zoneId: string,
        recordId: string,
    ): Promise<void> {
        const client = await this.appService.buildClient(account.providerId);
        await client.dns.records.delete(recordId, { zone_id: zoneId });
    }
}
