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
import { CloudflareAppService, type DnsProviderAppView } from "./cloudflare-app.service";
import { CloudflareDnsProviderService } from "./cloudflare-dns-provider.service";
import { toCloudflareErrorMessage, toTunnelConnectionShape, toTunnelShape, type TunnelConnectionShape, type TunnelShape } from "./cloudflare.helpers";

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
            const created = await client.zeroTrust.tunnels.cloudflared.create({
                account_id: accountId,
                name: input.name,
            });
            if (!created.id) throw new BadGatewayException("Cloudflare did not return a tunnel id");

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
        await client.zeroTrust.tunnels.cloudflared.configurations.update(
            tunnelId,
            {
                account_id: accountId,
                config: {
                    ingress: [
                        {
                            hostname,
                            service,
                        },
                    ],
                },
            },
        );
        this.logger.log(`Tunnel ${tunnelId} ingress configured: ${hostname} → ${service}`);
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
            return page.result.map((c: Client) => toTunnelConnectionShape(c));        } catch {
            return [];
        }
    }
}

export type { TunnelShape };
