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
import { serviceOver, type Over } from "@deployer/effect-core";
import { Context, Effect } from "effect";

import { attempt } from "@/core/effects";
import { FleetInvalid } from "@/core/fleet.errors";
import { CloudflareAppService, type CloudflareAppServiceShape } from "./cloudflare-app.service";
import {
    buildRecordCreateParams,
    toDnsRecordShape,
    type SupportedRecordType,
} from "./cloudflare.helpers";
import type {
    CreateDnsRecordInput,
    DnsProviderAccountRef,
    DnsProviderRecord,
    DnsProviderZone,
} from "../../shared/dns-provider.interface";

const PROVIDER_TYPE = "cloudflare";

type RecordFilter = {
    type?: "A" | "AAAA" | "CAA" | "CERT" | "CNAME" | "DNSKEY" | "DS" | "HTTPS" | "LOC" | "MX" | "NAPTR" | "NS" | "OPENPGPKEY" | "PTR" | "SMIMEA" | "SRV" | "SVCB" | "TLSA" | "TXT" | "URI";
    name?: string;
    page?: number;
    pageSize?: number;
};

function makeCloudflareDnsProviderService(appService: CloudflareAppServiceShape) {
    // ─── Provider accounts ───────────────────────────────────────────────────

    const listAccounts = Effect.fn("CloudflareDnsProviderService.listAccounts")(function* () {
        const apps = yield* appService.listApps(PROVIDER_TYPE);
        return apps.map((a): DnsProviderAccountRef => ({ providerId: a.id, providerType: PROVIDER_TYPE }));
    });

    /**
     * First active provider app with `dnsManagement` enabled and a healthy
     * runtime state. Used when the caller does not pin a specific provider
     * (e.g. preview DNS provisioning).
     */
    const findFirstActiveProvider = Effect.fn("CloudflareDnsProviderService.findFirstActiveProvider")(function* () {
        const apps = yield* appService.listApps(PROVIDER_TYPE);
        const active = apps.find((a) => a.isActive && a.features.dnsManagement && a.state?.status === "ok");
        return active
            ? ({ providerId: active.id, providerType: PROVIDER_TYPE } satisfies DnsProviderAccountRef)
            : null;
    });

    // ─── Zones ───────────────────────────────────────────────────────────────

    const listZones = Effect.fn("CloudflareDnsProviderService.listZones")(function* (account: DnsProviderAccountRef) {
        const client = yield* appService.buildClient(account.providerId);
        const page = yield* attempt(() => client.zones.list());
        return page.result.map((z): DnsProviderZone => ({
            id: z.id,
            name: z.name,
            status: z.status ?? "unknown",
            nameServers: z.name_servers,
        }));
    });

    /**
     * Find the zone whose name is the longest suffix of `hostname`.
     * Returns null when no provider zone covers the hostname.
     */
    const findZoneForHostname = Effect.fn("CloudflareDnsProviderService.findZoneForHostname")(function* (
        account: DnsProviderAccountRef,
        hostname: string,
    ) {
        const clean = hostname.replace(/^https?:\/\//, "").split("/")[0]?.toLowerCase() ?? hostname;
        const zones = yield* listZones(account);
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
    });

    // ─── Records ─────────────────────────────────────────────────────────────

    const listRecords = Effect.fn("CloudflareDnsProviderService.listRecords")(function* (
        account: DnsProviderAccountRef,
        zoneId: string,
    ) {
        const client = yield* appService.buildClient(account.providerId);
        const page = yield* attempt(() => client.dns.records.list({ zone_id: zoneId }));
        return page.result.map((r): DnsProviderRecord => ({
            ...toDnsRecordShape(r),
            zoneId,
        }));
    });

    /**
     * Filtered + paginated record listing (used by the Cloudflare app detail
     * table). Type is narrowed by the contract's enum, so no cast is needed.
     * Auto-paginates the SDK iterator (safety cap) so `total` is truthful.
     */
    const listRecordsFiltered = Effect.fn("CloudflareDnsProviderService.listRecordsFiltered")(function* (
        account: DnsProviderAccountRef,
        zoneId: string,
        filter: RecordFilter,
    ) {
        const client = yield* appService.buildClient(account.providerId);
        const page = filter.page ?? 1;
        const pageSize = filter.pageSize ?? 50;
        const MAX_RECORDS = 5000;

        const collected = yield* attempt(async () => {
            const records: DnsProviderRecord[] = [];
            const stream = client.dns.records.list({
                zone_id: zoneId,
                per_page: 500,
                ...(filter.type ? { type: filter.type } : {}),
                ...(filter.name ? { name: { exact: filter.name } } : {}),
            });
            for await (const rec of stream) {
                records.push({ ...toDnsRecordShape(rec), zoneId });
                if (records.length >= MAX_RECORDS) break;
            }
            return records;
        });

        const start = (page - 1) * pageSize;
        return {
            records: collected.slice(start, start + pageSize),
            total: collected.length,
            page,
            pageSize,
        };
    });

    const createRecord = Effect.fn("CloudflareDnsProviderService.createRecord")(function* (
        account: DnsProviderAccountRef,
        input: CreateDnsRecordInput,
    ) {
        // The shared interface allows any DnsRecordType; the Cloudflare SDK
        // helper supports a narrower set — validate before building params.
        const isSupported = (type: string): type is SupportedRecordType =>
            ["A", "AAAA", "CNAME", "TXT"].includes(type);
        if (!isSupported(input.type)) {
            return yield* new FleetInvalid({ reason: `Unsupported DNS record type for Cloudflare: ${input.type}` });
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
            return yield* new FleetInvalid({ reason: `Unsupported DNS record type: ${input.type}` });
        }
        const client = yield* appService.buildClient(account.providerId);
        const record = yield* attempt(() => client.dns.records.create(params));
        return {
            ...toDnsRecordShape(record),
            zoneId: input.zoneId,
        } satisfies DnsProviderRecord;
    });

    /**
     * Delete a DNS record by id within a zone (used by preview cleanup).
     */
    const deleteRecord = Effect.fn("CloudflareDnsProviderService.deleteRecord")(function* (
        account: DnsProviderAccountRef,
        zoneId: string,
        recordId: string,
    ) {
        const client = yield* appService.buildClient(account.providerId);
        yield* attempt(() => client.dns.records.delete(recordId, { zone_id: zoneId }));
    });

    return {
        listAccounts,
        findFirstActiveProvider,
        listZones,
        findZoneForHostname,
        listRecords,
        listRecordsFiltered,
        createRecord,
        deleteRecord,
    };
}

export type CloudflareDnsProviderServiceShape = Over<ReturnType<typeof makeCloudflareDnsProviderService>, CloudflareAppService>;

/** Tag and implementation together: the tag is the contract, `live` the one implementation. */
export class CloudflareDnsProviderService extends Context.Service<CloudflareDnsProviderService, CloudflareDnsProviderServiceShape>()(
    "fleet/CloudflareDnsProviderService",
) {
    /** The app service is yielded when a method runs, so this is a constant the module provides with `useValue`. */
    static readonly live: CloudflareDnsProviderServiceShape = serviceOver(CloudflareAppService, makeCloudflareDnsProviderService);
}
