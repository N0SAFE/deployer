/**
 * Cloudflare Controller
 *
 * Cloudflare-specific DNS provider endpoints: zones, DNS records, and
 * tunnels. Provider-agnostic CRUD lives in
 * `dns/shared/controllers/dns-providers.controller.ts`.
 */
import { Controller, Logger } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { appContract } from "@repo/api-contracts";
import { requireAuth } from "@/core/modules/auth/orpc/middlewares";
import { CloudflareAppService } from "../services/cloudflare-app.service";
import { CloudflareDnsProviderService } from "../services/cloudflare-dns-provider.service";
import { CloudflareTunnelService } from "../services/cloudflare-tunnel.service";
import { ReachabilityService } from "@/core/modules/reachability/services/reachability.service";

/**
 * Normalize a DNS record content value for comparison: trimmed, lowercased,
 * trailing dot stripped (CNAME/TXT values returned by the Cloudflare API end
 * with one).
 */
function normalizeRecordContent(content: string): string {
    return content.trim().toLowerCase().replace(/\.$/, "");
}

@Controller()
export class CloudflareController {
    private readonly logger = new Logger(CloudflareController.name);

    constructor(
        private readonly appService: CloudflareAppService,
        private readonly dnsService: CloudflareDnsProviderService,
        private readonly tunnelService: CloudflareTunnelService,
        private readonly reachabilityService: ReachabilityService,
    ) {}

    // ─── Cloudflare Zones & Records ─────────────────────────────────────────

    @Implement(appContract.providers.dns.cloudflare.listZones)
    listZones() {
        return implement(appContract.providers.dns.cloudflare.listZones)
            .use(requireAuth())
            .handler(async ({ input }) => {
                try {
                    const zones = await this.dnsService.listZones({
                        providerId: input.params.providerId,
                        providerType: "cloudflare",
                    });
                    return { zones, error: null };
                } catch (err) {
                    this.logger.warn(`cloudflareListZones failed for provider ${input.params.providerId}: ${err instanceof Error ? err.message : String(err)}`);
                    return { zones: [], error: err instanceof Error ? err.message : "Unknown Cloudflare error" };
                }
            });
    }

    @Implement(appContract.providers.dns.cloudflare.listRecords)
    listRecords() {
        return implement(appContract.providers.dns.cloudflare.listRecords)
            .use(requireAuth())
            .handler(async ({ input }) => {
                const { params } = input;
                const query = input.query ?? {};
                try {
                    const result = await this.dnsService.listRecordsFiltered(
                        { providerId: params.providerId, providerType: "cloudflare" },
                        params.zoneId,
                        {
                            type: query.type,
                            name: query.name,
                            page: query.page,
                            pageSize: query.pageSize,
                        },
                    );
                    return {
                        records: result.records.map((r) => ({
                            id: r.id,
                            type: r.type,
                            name: r.name,
                            content: r.content,
                            ttl: r.ttl,
                            proxied: r.proxied,
                        })),
                        total: result.total,
                        page: result.page,
                        pageSize: result.pageSize,
                        error: null,
                    };
                } catch (err) {
                    this.logger.warn(`cloudflareListRecords failed for provider ${params.providerId}: ${err instanceof Error ? err.message : String(err)}`);
                    return {
                        records: [],
                        total: 0,
                        page: query.page ?? 1,
                        pageSize: query.pageSize ?? 50,
                        error: err instanceof Error ? err.message : "Unknown Cloudflare error",
                    };
                }
            });
    }

    @Implement(appContract.providers.dns.cloudflare.checkRecord)
    checkRecord() {
        return implement(appContract.providers.dns.cloudflare.checkRecord)
            .use(requireAuth())
            .handler(async ({ input }) => {
                const { params } = input;
                const query = input.query ?? {};
                try {
                    const client = await this.appService.buildClient(params.providerId);
                    const page = await client.dns.records.list({
                        zone_id: params.zoneId,
                        name: { exact: query.recordName },
                        ...(query.recordType ? { type: query.recordType } : {}),
                    });
                    const records = page.result.map((r) => ({
                        id: r.id,
                        type: r.type,
                        name: r.name,
                        content: Array.isArray(r.content) ? r.content.join(" ") : (r.content ?? ""),
                        ttl: r.ttl ?? 1,
                        proxied: r.proxied ?? false,
                    }));
                    // CF-7: real content matching, not a "any record exists" no-op.
                    // `matchContent` is only meaningful when a content criterion
                    // was provided; normalized (trimmed, lowercased, trailing
                    // dot stripped — CNAME values end with one from the API).
                    const contentCriterion = query.recordContent?.trim().toLowerCase();
                    const matchContent =
                        contentCriterion && contentCriterion.length > 0
                            ? records.some((r) => normalizeRecordContent(r.content) === contentCriterion)
                            : null;
                    return {
                        exists: records.length > 0,
                        records,
                        matchContent,
                        error: null,
                    };
                } catch (err) {
                    this.logger.warn(`cloudflareCheckRecord failed for provider ${params.providerId}: ${err instanceof Error ? err.message : String(err)}`);
                    return {
                        exists: false,
                        records: [],
                        matchContent: null,
                        error: err instanceof Error ? err.message : "Unknown Cloudflare error",
                    };
                }
            });
    }

    @Implement(appContract.providers.dns.cloudflare.createRecord)
    createRecord() {
        return implement(appContract.providers.dns.cloudflare.createRecord)
            .use(requireAuth())
            .handler(async ({ input }) => {
                const { params, body } = input;
                const record = await this.dnsService.createRecord(
                    { providerId: params.providerId, providerType: "cloudflare" },
                    {
                        zoneId: params.zoneId,
                        type: body.type,
                        name: body.name,
                        content: body.content,
                        ttl: body.ttl,
                        proxied: body.proxied,
                    },
                );
                return {
                    id: record.id,
                    type: record.type,
                    name: record.name,
                    content: record.content,
                    ttl: record.ttl,
                    proxied: record.proxied,
                };
            });
    }

    @Implement(appContract.providers.dns.cloudflare.deleteRecord)
    deleteRecord() {
        return implement(appContract.providers.dns.cloudflare.deleteRecord)
            .use(requireAuth())
            .handler(async ({ input }) => {
                await this.dnsService.deleteRecord(
                    { providerId: input.params.providerId, providerType: "cloudflare" },
                    input.params.zoneId,
                    input.params.id,
                );
                return { success: true };
            });
    }

    // ─── Cloudflare Tunnels ─────────────────────────────────────────────────

    @Implement(appContract.providers.dns.cloudflare.listTunnels)
    listTunnels() {
        return implement(appContract.providers.dns.cloudflare.listTunnels)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.tunnelService.listTunnels(input.params.providerId);
            });
    }

    @Implement(appContract.providers.dns.cloudflare.getTunnel)
    getTunnel() {
        return implement(appContract.providers.dns.cloudflare.getTunnel)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.tunnelService.getTunnel(input.params.providerId, input.params.id);
            });
    }

    @Implement(appContract.providers.dns.cloudflare.createTunnel)
    createTunnel() {
        return implement(appContract.providers.dns.cloudflare.createTunnel)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.tunnelService.createTunnel(input.params.providerId, input.body);
            });
    }

    @Implement(appContract.providers.dns.cloudflare.deleteTunnel)
    deleteTunnel() {
        return implement(appContract.providers.dns.cloudflare.deleteTunnel)
            .use(requireAuth())
            .handler(async ({ input }) => {
                // Resolve the bound hostname (if any) so the CNAME this tunnel
                // owned is removed too, then delete the Cloudflare tunnel.
                const hostname = await this.reachabilityService.getTunnelHostname(
                    input.params.providerId,
                    input.params.id,
                );
                const success = await this.tunnelService.deleteTunnel(
                    input.params.providerId,
                    input.params.id,
                    { hostname },
                );
                // Keep node_network_config consistent: if any node still bound
                // this tunnel, clear the binding so it does not reference a
                // dead tunnel. Best-effort — never fails the deletion.
                if (success) {
                    try {
                        const cleared = await this.reachabilityService.clearTunnelBinding(
                            input.params.providerId,
                            input.params.id,
                        );
                        if (cleared > 0) {
                            this.logger.log(
                                `Cleared ${cleared} node binding(s) for deleted tunnel ${input.params.id}`,
                            );
                        }
                    } catch (err) {
                        this.logger.warn(
                            `Node-binding cleanup for tunnel ${input.params.id} failed: ${err instanceof Error ? err.message : String(err)}`,
                        );
                    }
                }
                return { success };
            });
    }

    @Implement(appContract.providers.dns.cloudflare.getTunnelToken)
    getTunnelToken() {
        return implement(appContract.providers.dns.cloudflare.getTunnelToken)
            .use(requireAuth())
            .handler(async ({ input }) => {
                return this.tunnelService.getTunnelToken(input.params.providerId, input.params.id);
            });
    }
}
