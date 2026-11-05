/**
 * Cloudflare Controller
 *
 * Cloudflare-specific DNS provider endpoints: zones, DNS records, and
 * tunnels. Provider-agnostic CRUD lives in
 * `dns/shared/controllers/dns-providers.controller.ts`.
 */
import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { Effect } from "effect";

import { providersContract } from "@deployer/fleet-contracts";
import { procedure } from "@deployer/nest-effect";
import { requireAuth, requirePlatformRole } from "@deployer/shared/core/modules/auth/orpc/middlewares";

import { attempt } from "@/core/effects";
import { TunnelEdge } from "@/core/ports/tunnel-edge.port";

import { CloudflareAppService } from "../services/cloudflare-app.service";
import { CloudflareDnsProviderService } from "../services/cloudflare-dns-provider.service";
import { CloudflareTunnelService } from "../services/cloudflare-tunnel.service";

/**
 * Normalize a DNS record content value for comparison: trimmed, lowercased,
 * trailing dot stripped (CNAME/TXT values returned by the Cloudflare API end
 * with one).
 */
function normalizeRecordContent(content: string): string {
    return content.trim().toLowerCase().replace(/\.$/, "");
}

const describe = (err: unknown) => (err instanceof Error ? err.message : String(err));


/** Writing DNS records or tunnels — and reading a tunnel token — is an operational act. */
const DNS_OPERATOR_ROLES = ["superAdmin", "admin", "operator"];

@Controller()
export class CloudflareController {
    // ─── Cloudflare Zones & Records ─────────────────────────────────────────

    @Implement(providersContract.dns.cloudflare.listZones)
    listZones() {
        return procedure(providersContract.dns.cloudflare.listZones)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const dns = yield* CloudflareDnsProviderService;
                return yield* dns.listZones({ providerId: input.params.providerId, providerType: "cloudflare" }).pipe(
                        Effect.map((zones) => ({ zones, error: null as string | null })),
                        Effect.catch((err) =>
                            Effect.logWarning(`cloudflareListZones failed for provider ${input.params.providerId}: ${describe(err)}`).pipe(
                                Effect.as({ zones: [], error: err instanceof Error ? err.message : "Unknown Cloudflare error" }),
                            ),
                        ),
                    )
                ;
            });
    }

    @Implement(providersContract.dns.cloudflare.listRecords)
    listRecords() {
        return procedure(providersContract.dns.cloudflare.listRecords)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const dns = yield* CloudflareDnsProviderService;
                const { params } = input;
                const query = input.query ?? {};
                return yield* dns
                        .listRecordsFiltered({ providerId: params.providerId, providerType: "cloudflare" }, params.zoneId, {
                            type: query.type,
                            name: query.name,
                            page: query.page,
                            pageSize: query.pageSize,
                        })
                        .pipe(
                            Effect.map((result) => ({
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
                                error: null as string | null,
                            })),
                            Effect.catch((err) =>
                                Effect.logWarning(`cloudflareListRecords failed for provider ${params.providerId}: ${describe(err)}`).pipe(
                                    Effect.as({
                                        records: [],
                                        total: 0,
                                        page: query.page ?? 1,
                                        pageSize: query.pageSize ?? 50,
                                        error: err instanceof Error ? err.message : "Unknown Cloudflare error",
                                    }),
                                ),
                            ),
                        )
                ;
            });
    }

    @Implement(providersContract.dns.cloudflare.checkRecord)
    checkRecord() {
        return procedure(providersContract.dns.cloudflare.checkRecord)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const apps = yield* CloudflareAppService;
                const { params } = input;
                const query = input.query ?? {};
                return yield* Effect.gen(function* () {
                        const client = yield* apps.buildClient(params.providerId);
                        const page = yield* attempt(() =>
                            client.dns.records.list({
                                zone_id: params.zoneId,
                                name: { exact: query.recordName },
                                ...(query.recordType ? { type: query.recordType } : {}),
                            }),
                        );
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
                            error: null as string | null,
                        };
                    }).pipe(
                        Effect.catch((err) =>
                            Effect.logWarning(`cloudflareCheckRecord failed for provider ${params.providerId}: ${describe(err)}`).pipe(
                                Effect.as({
                                    exists: false,
                                    records: [],
                                    matchContent: null,
                                    error: err instanceof Error ? err.message : "Unknown Cloudflare error",
                                }),
                            ),
                        ),
                    )
                ;
            });
    }

    @Implement(providersContract.dns.cloudflare.createRecord)
    createRecord() {
        return procedure(providersContract.dns.cloudflare.createRecord)
            .use(requireAuth())
            .use(requirePlatformRole(DNS_OPERATOR_ROLES))
            .effect(function* ({ input }) {
                const dns = yield* CloudflareDnsProviderService;
                const { params, body } = input;
                const record = yield* dns.createRecord(
                        { providerId: params.providerId, providerType: "cloudflare" },
                        {
                            zoneId: params.zoneId,
                            type: body.type,
                            name: body.name,
                            content: body.content,
                            ttl: body.ttl,
                            proxied: body.proxied,
                        },
                    )
                ;
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

    @Implement(providersContract.dns.cloudflare.deleteRecord)
    deleteRecord() {
        return procedure(providersContract.dns.cloudflare.deleteRecord)
            .use(requireAuth())
            .use(requirePlatformRole(DNS_OPERATOR_ROLES))
            .effect(function* ({ input }) {
                const dns = yield* CloudflareDnsProviderService;
                yield* dns.deleteRecord(
                        { providerId: input.params.providerId, providerType: "cloudflare" },
                        input.params.zoneId,
                        input.params.id,
                    )
                ;
                return { success: true };
            });
    }

    // ─── Cloudflare Tunnels ─────────────────────────────────────────────────

    @Implement(providersContract.dns.cloudflare.listTunnels)
    listTunnels() {
        return procedure(providersContract.dns.cloudflare.listTunnels)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const tunnels = yield* CloudflareTunnelService;
                return yield* tunnels.listTunnels(input.params.providerId);
            });
    }

    @Implement(providersContract.dns.cloudflare.getTunnel)
    getTunnel() {
        return procedure(providersContract.dns.cloudflare.getTunnel)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const tunnels = yield* CloudflareTunnelService;
                return yield* tunnels.getTunnel(input.params.providerId, input.params.id);
            });
    }

    @Implement(providersContract.dns.cloudflare.createTunnel)
    createTunnel() {
        return procedure(providersContract.dns.cloudflare.createTunnel)
            .use(requireAuth())
            .use(requirePlatformRole(DNS_OPERATOR_ROLES))
            .effect(function* ({ input }) {
                const tunnels = yield* CloudflareTunnelService;
                return yield* tunnels.createTunnel(input.params.providerId, input.body);
            });
    }

    @Implement(providersContract.dns.cloudflare.deleteTunnel)
    deleteTunnel() {
        return procedure(providersContract.dns.cloudflare.deleteTunnel)
            .use(requireAuth())
            .use(requirePlatformRole(DNS_OPERATOR_ROLES))
            .effect(function* ({ input }) {
                const tunnels = yield* CloudflareTunnelService;
                const tunnelEdge = yield* TunnelEdge;
                const { providerId, id } = input.params;
                return yield* Effect.gen(function* () {
                        // When this is the STACK's tunnel, remove its wildcard CNAME too, and
                        // make the edge forget it so no dead tunnel id keeps claiming the
                        // public lane (the Ingress page then shows it as not provisioned).
                        const hostname = yield* attempt(() => tunnelEdge.stackWildcard(providerId, id));
                        const success = yield* tunnels.deleteTunnel(providerId, id, { hostname });
                        if (success) {
                            yield* attempt(() => tunnelEdge.forgetDeletedTunnel(providerId, id)).pipe(
                                Effect.flatMap((forgotten) =>
                                    forgotten
                                        ? Effect.logInfo(`Deleted tunnel ${id} was the stack's public edge — forgotten`)
                                        : Effect.void,
                                ),
                                Effect.catch((err) => Effect.logWarning(`Edge cleanup for tunnel ${id} failed: ${describe(err)}`)),
                            );
                        }
                        return { success };
                    })
                ;
            });
    }

    @Implement(providersContract.dns.cloudflare.getTunnelToken)
    getTunnelToken() {
        return procedure(providersContract.dns.cloudflare.getTunnelToken)
            .use(requireAuth())
            .use(requirePlatformRole(DNS_OPERATOR_ROLES))
            .effect(function* ({ input }) {
                const tunnels = yield* CloudflareTunnelService;
                return yield* tunnels.getTunnelToken(input.params.providerId, input.params.id);
            });
    }
}
