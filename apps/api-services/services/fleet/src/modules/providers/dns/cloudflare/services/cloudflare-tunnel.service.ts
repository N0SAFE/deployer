/**
 * Cloudflare Tunnel Service — tunnel management on a Cloudflare provider app.
 *
 * All operations require the provider app to be active AND have the
 * `tunnelManagement` feature enabled (checked at runtime). The Cloudflare
 * account id is resolved at runtime (never from env vars).
 */
import { BadGatewayException, BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Cloudflare } from "cloudflare";
import type { Client } from "cloudflare/resources/zero-trust/tunnels/cloudflared/connections";
import type { ConfigurationUpdateParams } from "cloudflare/resources/zero-trust/tunnels/cloudflared/configurations";
import { CloudflareAppService, type DnsProviderAppView } from "./cloudflare-app.service";
import { CloudflareDnsProviderService } from "./cloudflare-dns-provider.service";
import { toCloudflareErrorMessage, toTunnelConnectionShape, toTunnelShape, type TunnelConnectionShape, type TunnelShape } from "./cloudflare.helpers";

/**
 * Cloudflare's ingress rules, as the API defines them — deliberately NOT the
 * SDK's `Config.Ingress`.
 *
 * The SDK declares `hostname` as REQUIRED on every rule. Cloudflare requires the
 * opposite for the FINAL rule: it must carry no hostname and no path, otherwise
 * the entire configuration is refused with
 *
 *   400 code 1056 — "The last ingress rule must match all URLs
 *                     (i.e. it should not have a hostname or path filter)"
 *
 * so a payload shaped to satisfy the SDK's type can never be accepted. `hostname`
 * is optional here because that is what the endpoint actually takes.
 */
interface CloudflareIngressRule {
    hostname?: string;
    path?: string;
    service: string;
}

/**
 * Terminator for every ingress list: a request that matched no rule above gets a
 * 404 from Cloudflare, rather than falling through to an unintended origin.
 */
const INGRESS_CATCH_ALL: CloudflareIngressRule = { service: "http_status:404" };

@Injectable()
export class CloudflareTunnelService {
    private readonly logger = new Logger(CloudflareTunnelService.name);

    constructor(
        private readonly appService: CloudflareAppService,
        private readonly dnsService: CloudflareDnsProviderService,
    ) {}

    /** App view with the tunnelManagement feature gate applied. */
    private async requireTunnelApp(providerId: string): Promise<DnsProviderAppView> {
        const app = await this.appService.getAppView(providerId);
        if (!app) throw new NotFoundException(`DNS provider not found: ${providerId}`);
        if (!app.isActive) throw new BadRequestException(`DNS provider is inactive: ${providerId}`);
        if (!app.features.tunnelManagement) {
            throw new BadRequestException(
                `Tunnel management is not enabled on "${app.name}". Enable it in the Cloudflare app configuration first.`,
            );
        }
        return app;
    }

    private async clientFor(providerId: string) {
        const app = await this.requireTunnelApp(providerId);
        const client = await this.appService.buildClient(providerId);
        const accountId = await this.appService.getOrResolveAccountId(providerId);
        return { app, client, accountId };
    }

    // ─── Tunnels ─────────────────────────────────────────────────────────────

    async listTunnels(providerId: string): Promise<{ tunnels: TunnelShape[]; error: string | null }> {
        try {
            const { client, accountId } = await this.clientFor(providerId);
            const page = await client.zeroTrust.tunnels.cloudflared.list({
                account_id: accountId,
                is_deleted: false,
                per_page: 100,
            });
            const tunnels = page.result.map((t) =>
                toTunnelShape(t, (t.connections ?? []).map((c) => toTunnelConnectionShape(c))),
            );
            return { tunnels, error: null };
        } catch (err) {
            this.logger.warn(`cloudflareListTunnels failed for provider ${providerId}: ${err instanceof Error ? err.message : String(err)}`);
            return { tunnels: [], error: toCloudflareErrorMessage(err) };
        }
    }

    /**
     * The live tunnel with this name, or `null`.
     *
     * Cloudflare enforces tunnel names per account (error 1013 — "You already
     * have a tunnel with this name"). That check runs BEFORE any local bookkeeping
     * we do, so a run that created the tunnel and then failed later — a refused
     * ingress, a crash — leaves an orphan the next attempt collides with, while
     * our stored `tunnelId` is still empty and the guard upstream looks satisfied.
     * Reusing by name makes provisioning idempotent instead of wedging the node.
     */
    private async findTunnelByName(
        client: Cloudflare,
        accountId: string,
        name: string,
    ): Promise<{ id: string } | null> {
        const page = await client.zeroTrust.tunnels.cloudflared.list({
            account_id: accountId,
            is_deleted: false,
            name,
            per_page: 100,
        });
        const match = page.result.find((candidate) => candidate.name === name && candidate.id);
        return match?.id ? { id: match.id } : null;
    }

    async getTunnel(providerId: string, tunnelId: string): Promise<{ tunnel: TunnelShape | null; error: string | null }> {
        try {
            const { client, accountId } = await this.clientFor(providerId);
            const tunnel = await client.zeroTrust.tunnels.cloudflared.get(tunnelId, { account_id: accountId });
            const connections = await this.fetchConnections(client, accountId, tunnelId);
            return { tunnel: toTunnelShape(tunnel, connections), error: null };
        } catch (err) {
            this.logger.warn(`cloudflareGetTunnel failed for provider ${providerId}: ${err instanceof Error ? err.message : String(err)}`);
            return { tunnel: null, error: toCloudflareErrorMessage(err) };
        }
    }

    /**
     * Auto-setup: create the tunnel, fetch its `cloudflared` run token, and
     * (when a hostname is given) create the CNAME routing record.
     */
    async createTunnel(
        providerId: string,
        input: { name: string; hostname?: string },
    ): Promise<{ tunnel: TunnelShape; token: string; dnsRecord: string | null; hostname: string | null; error: string | null }> {
        try {
            const { client, accountId, app } = await this.clientFor(providerId);

            // Reuse a tunnel this account already owns under the same name — see
            // `findTunnelByName` for why re-creating one wedges the node rather
            // than being harmless.
            const existing = await this.findTunnelByName(client, accountId, input.name);
            const created = existing ?? (await client.zeroTrust.tunnels.cloudflared.create({
                account_id: accountId,
                name: input.name,
            }));
            if (!created.id) throw new BadGatewayException("Cloudflare did not return a tunnel id");
            if (existing) {
                this.logger.log(
                    `Reusing existing Cloudflare tunnel "${input.name}" (${created.id}) on app "${app.name}"`,
                );
            }

            const token = await client.zeroTrust.tunnels.cloudflared.token.get(created.id, { account_id: accountId });

            let dnsRecord: string | null = null;
            let hostname: string | null = null;
            if (input.hostname) {
                const zone = await this.dnsService.findZoneForHostname(
                    { providerId, providerType: "cloudflare" },
                    input.hostname,
                );
                if (zone) {
                    const record = await this.dnsService.createRecord(
                        { providerId, providerType: "cloudflare" },
                        {
                            zoneId: zone.zoneId,
                            type: "CNAME",
                            name: input.hostname,
                            content: `${created.id}.cfargotunnel.com`,
                            ttl: 1,
                            proxied: true,
                        },
                    );
                    dnsRecord = record.id;
                    hostname = input.hostname;
                }
            }
            this.logger.log(`Cloudflare tunnel "${input.name}" created on app "${app.name}" (${created.id})`);
            return { tunnel: toTunnelShape(created), token, dnsRecord, hostname, error: null };
        } catch (err) {
            this.logger.warn(`cloudflareCreateTunnel failed for provider ${providerId}: ${err instanceof Error ? err.message : String(err)}`);
            throw new BadGatewayException(toCloudflareErrorMessage(err), { cause: err });
        }
    }

    /**
     * Configure the tunnel's ingress (public hostname → local service) so
     * `cloudflared` knows where to route requests for `hostname` once a
     * connector is running. WITHOUT this, Cloudflare answers error 1033
     * ("Cloudflare is currently unable to resolve it") even when the DNS
     * CNAME and the tunnel exist — the tunnel has no routing rule.
     *
     * Idempotent: a later call with the same hostname replaces the rule.
     *
     * @param service   e.g. `http://deployer:3000` (the web entry the tunnel
     *                  frontends, resolved from the cloudflared container's
     *                  network).
     */
    async configureIngress(
        providerId: string,
        tunnelId: string,
        hostname: string,
        service: string,
    ): Promise<void> {
        const { client, accountId } = await this.clientFor(providerId);
        try {
            const preserved = await this.applyIngressRules(
                client,
                accountId,
                tunnelId,
                hostname,
                service,
            );
            this.logger.log(
                `Tunnel ${tunnelId} ingress configured: ${hostname} → ${service} (${String(preserved)} other hostname rule(s) preserved)`,
            );
        } catch (err) {
            // Like every sibling method here, the SDK's own error type is converted
            // at the boundary. Letting it escape made an ordinary "Cloudflare refused
            // this configuration" rejection surface as a bare 500 with no reason
            // attached, which is how the 1056 ingress failure stayed unexplained.
            const message = toCloudflareErrorMessage(err);
            this.logger.error(
                `configureIngress failed for tunnel ${tunnelId} (${hostname} → ${service}): ${message}`,
            );
            throw new BadGatewayException(
                `Could not configure the tunnel's routing for ${hostname}: ${message}`,
                { cause: err },
            );
        }
    }

    /**
     * Read the tunnel's current ingress, replace the rule for `hostname`, and put
     * the catch-all back at the end.
     *
     * @returns how many OTHER hostname rules were preserved, for the caller to log.
     */
    private async applyIngressRules(
        client: Cloudflare,
        accountId: string,
        tunnelId: string,
        hostname: string,
        service: string,
    ): Promise<number> {
        // Read the CURRENT rules so this call replaces the rule for `hostname`
        // only. Writing a freshly-built array dropped every other hostname routed
        // through the same tunnel, and the damage was silent: the next request for
        // a dropped hostname answered 1033 "unable to resolve" while the tunnel
        // and its CNAME both still looked healthy.
        const current = await client.zeroTrust.tunnels.cloudflared.configurations.get(
            tunnelId,
            { account_id: accountId },
        );
        const existingRules: CloudflareIngressRule[] = current.config?.ingress ?? [];

        // Keep the other hostnames' rules; drop this hostname's previous rule(s)
        // and any earlier terminator, both of which are re-added below. A rule
        // without a hostname IS a terminator, which is why it is filtered here.
        const preserved = existingRules.filter(
            (rule) => rule.hostname !== undefined && rule.hostname !== hostname,
        );

        // Cloudflare requires the FINAL rule to match every URL — no hostname, no
        // path. Without `INGRESS_CATCH_ALL` the whole configuration is rejected:
        // 400 code 1056 "The last ingress rule must match all URLs".
        const ingress: CloudflareIngressRule[] = [
            ...preserved,
            { hostname, service },
            INGRESS_CATCH_ALL,
        ];

        await client.zeroTrust.tunnels.cloudflared.configurations.update(
            tunnelId,
            {
                account_id: accountId,
                // The one assertion in this file. The SDK's `Ingress` type demands a
                // `hostname` that Cloudflare forbids on the final rule, so the type is
                // wrong rather than the payload: `ConfigurationUpdateParams.Config.Ingress`
                // is assignable to `CloudflareIngressRule` (required → optional widens),
                // which is what makes this assertion legal. Cloudflare validates the
                // result itself and answers 400/1056 if any rule is actually malformed.
                config: { ingress: ingress as ConfigurationUpdateParams.Config.Ingress[] },
            },
        );
        return preserved.length;
    }

    async deleteTunnel(
        providerId: string,
        tunnelId: string,
        opts?: { hostname?: string | null },
    ): Promise<boolean> {
        const { client, accountId } = await this.clientFor(providerId);
        await client.zeroTrust.tunnels.cloudflared.delete(tunnelId, { account_id: accountId });
        this.logger.log(`Cloudflare tunnel ${tunnelId} deleted (provider ${providerId})`);

        // Remove the CNAME this tunnel owned (when a hostname is known), so
        // deleting the tunnel does not leave an orphan record pointing at a
        // dead `{tunnelId}.cfargotunnel.com`.
        const hostname = opts?.hostname?.trim();
        if (hostname) {
            try {
                const zone = await this.dnsService.findZoneForHostname(
                    { providerId, providerType: "cloudflare" },
                    hostname,
                );
                if (zone) {
                    const records = await this.dnsService.listRecords(
                        { providerId, providerType: "cloudflare" },
                        zone.zoneId,
                    );
                    const cname = records.find(
                        (r) =>
                            r.type === "CNAME" &&
                            r.name.toLowerCase() === hostname.toLowerCase(),
                    );
                    if (cname) {
                        await this.dnsService.deleteRecord(
                            { providerId, providerType: "cloudflare" },
                            zone.zoneId,
                            cname.id,
                        );
                        this.logger.log(
                            `Deleted CNAME ${cname.name} (zone ${zone.zoneName}) for tunnel ${tunnelId}`,
                        );
                    }
                }
            } catch (err) {
                // The tunnel is gone regardless; the orphan CNAME is a
                // cosmetic cleanup — surface it but do not fail the deletion.
                this.logger.warn(
                    `CNAME cleanup for tunnel ${tunnelId} failed: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        }
        return true;
    }

    async getTunnelToken(providerId: string, tunnelId: string): Promise<{ token: string | null; error: string | null }> {
        try {
            const { client, accountId } = await this.clientFor(providerId);
            const token = await client.zeroTrust.tunnels.cloudflared.token.get(tunnelId, { account_id: accountId });
            return { token, error: null };
        } catch (err) {
            this.logger.warn(`cloudflareGetTunnelToken failed for provider ${providerId}: ${err instanceof Error ? err.message : String(err)}`);
            return { token: null, error: toCloudflareErrorMessage(err) };
        }
    }

    /** Live tunnel health: Cloudflare status + active connection count. */
    async getTunnelHealth(providerId: string, tunnelId: string): Promise<{
        status: "healthy" | "degraded" | "down" | "inactive" | "unknown";
        checkedAt: string;
        connections: number;
        error: string | null;
    }> {
        try {
            const { client, accountId } = await this.clientFor(providerId);
            const tunnel = await client.zeroTrust.tunnels.cloudflared.get(tunnelId, { account_id: accountId });
            const connections = await this.fetchConnections(client, accountId, tunnelId);
            const active = connections.filter((c) => !c.isPendingReconnect).length;
            return {
                status: tunnel.status ?? "unknown",
                checkedAt: new Date().toISOString(),
                connections: active,
                error: null,
            };
        } catch (err) {
            this.logger.warn(`cloudflareGetTunnelHealth failed for provider ${providerId}: ${err instanceof Error ? err.message : String(err)}`);
            return {
                status: "unknown",
                checkedAt: new Date().toISOString(),
                connections: 0,
                error: toCloudflareErrorMessage(err),
            };
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private async fetchConnections(
        client: Cloudflare,
        accountId: string,
        tunnelId: string,
    ): Promise<TunnelConnectionShape[]> {
        try {
            const page = await client.zeroTrust.tunnels.cloudflared.connections.get(tunnelId, { account_id: accountId });
            return page.result.map((c: Client) => toTunnelConnectionShape(c));        } catch (error: unknown) {
            this.logger.warn(
                `cloudflareFetchTunnelConnections failed for tunnel ${tunnelId}: ${error instanceof Error ? error.message : String(error)}`,
            );
            return [];
        }
    }
}

export type { TunnelShape };
