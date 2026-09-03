/**
 * Reachability Controller
 *
 * Endpoints for checking URL reachability, domain DNS resolution, and the
 * per-node public IP/tunnel network config. Tunnel provisioning (creating the
 * Cloudflare tunnel) and LIVE tunnel health are orchestrated here — the core
 * service persists config, the product layer talks to the provider apps.
 */
import { Controller, Logger } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { appContract } from "@repo/api-contracts";
import { requireAuth } from "@/core/modules/auth/orpc/middlewares";
import { ReachabilityService, type NodeNetworkConfigData, type TunnelConfig } from "@/core/modules/reachability/services/reachability.service";
import { PublicAccessPointService } from "@/core/modules/reachability/services/public-access-point.service";
import { CloudflareTunnelService } from "@/modules/providers/dns/cloudflare/services/cloudflare-tunnel.service";
import { TraefikConfigRefresher } from "@/core/modules/traefik/services/traefik-config-refresher.service";
import { platformTraefikContainerName } from "@/core/modules/platform-ingress/services/platform-names";
import { Observable } from "rxjs";

export interface TunnelHealthView {
    status: "healthy" | "degraded" | "down" | "inactive" | "unknown" | null;
    checkedAt: string | null;
    connections: number;
    tunnelId: string | null;
    error: string | null;
}

interface TunnelView extends TunnelConfig {
    health: TunnelHealthView | null;
}

interface NodeNetworkView extends Omit<NodeNetworkConfigData, "tunnel"> {
    tunnel: TunnelView;
}

@Controller()
export class ReachabilityController {
    private readonly logger = new Logger(ReachabilityController.name);

    constructor(
        private readonly reachabilityService: ReachabilityService,
        private readonly publicAccessPointService: PublicAccessPointService,
        private readonly tunnelService: CloudflareTunnelService,
        private readonly ingressRefresher: TraefikConfigRefresher,
    ) {}

    @Implement(appContract.reachability.check)
    check() {
        return implement(appContract.reachability.check)
            .use(requireAuth())
            .handler(async ({ input }) => {
                const url = input.url;
                const probeUrl = `${url.replace(/\/$/, "")}/mesh/ping`;
                const start = Date.now();
                try {
                    const resp = await fetch(probeUrl, { signal: AbortSignal.timeout(5000) });
                    const latencyMs = Date.now() - start;
                    return {
                        url,
                        reachable: resp.ok,
                        latencyMs,
                        statusCode: resp.status,
                        error: resp.ok ? undefined : `HTTP ${resp.status}`,
                    };
                } catch (err) {
                    const latencyMs = Date.now() - start;
                    return {
                        url,
                        reachable: false,
                        latencyMs,
                        error: err instanceof Error ? err.message : "Connection failed",
                    };
                }
            });
    }

    @Implement(appContract.reachability.getConfig)
    getConfig() {
        return implement(appContract.reachability.getConfig)
            .use(requireAuth())
            .handler(async () => {
                // F2: derive the public URL from the node network config (DB —
                // never env vars): tunnel hostname first, else public address.
                const node = await this.reachabilityService.getNodeNetworkConfig();
                const tunnelHostname = node.tunnel.hostname?.trim();
                const publicAddress = node.publicAddress?.trim();
                const publicUrl = tunnelHostname
                    ? `https://${tunnelHostname}`
                    : publicAddress
                      ? `http://${publicAddress}`
                      : null;

                if (!publicUrl) {
                    return { publicUrl: null, lastCheckedAt: null, lastStatus: null, reachable: null };
                }

                const start = Date.now();
                try {
                    const resp = await fetch(`${publicUrl}/health`, { signal: AbortSignal.timeout(5000) });
                    return {
                        publicUrl,
                        lastCheckedAt: new Date().toISOString(),
                        lastStatus: resp.ok ? "reachable" : `http_${resp.status}`,
                        reachable: resp.ok,
                    };
                } catch (err) {
                    return {
                        publicUrl,
                        lastCheckedAt: new Date().toISOString(),
                        lastStatus: err instanceof Error ? err.message : "unreachable",
                        reachable: false,
                    };
                }
            });
    }

    @Implement(appContract.reachability.updateConfig)
    updateConfig() {
        return implement(appContract.reachability.updateConfig)
            .use(requireAuth())
            .handler(async () => {
                // Same data-driven self-check as getConfig (updateConfig has no
                // persisted body today — it reflects the node network state).
                const node = await this.reachabilityService.getNodeNetworkConfig();
                const tunnelHostname = node.tunnel.hostname?.trim();
                const publicAddress = node.publicAddress?.trim();
                const publicUrl = tunnelHostname
                    ? `https://${tunnelHostname}`
                    : publicAddress
                      ? `http://${publicAddress}`
                      : null;

                if (!publicUrl) {
                    return { publicUrl: null, lastCheckedAt: null, lastStatus: null, reachable: null };
                }

                const start = Date.now();
                try {
                    const resp = await fetch(`${publicUrl}/health`, { signal: AbortSignal.timeout(5000) });
                    return {
                        publicUrl,
                        lastCheckedAt: new Date().toISOString(),
                        lastStatus: resp.ok ? "reachable" : `http_${resp.status}`,
                        reachable: resp.ok,
                    };
                } catch (err) {
                    return {
                        publicUrl,
                        lastCheckedAt: new Date().toISOString(),
                        lastStatus: err instanceof Error ? err.message : "unreachable",
                        reachable: false,
                    };
                }
            });
    }

    @Implement(appContract.reachability.checkDomain)
    checkDomain() {
        return implement(appContract.reachability.checkDomain)
            .use(requireAuth())
            .handler(async ({ input }) => {
                const result = await this.reachabilityService.checkDomainReachability(
                    input.domain,
                    input.expectedIp,
                );
                return result;
            });
    }

    @Implement(appContract.reachability.getPublicIp)
    getPublicIp() {
        return implement(appContract.reachability.getPublicIp)
            .use(requireAuth())
            .handler(async () => {
                const ip = await this.reachabilityService.getPublicIp();
                return { ip };
            });
    }

    @Implement(appContract.reachability.getNodeNetworkConfig)
    getNodeNetworkConfig() {
        return implement(appContract.reachability.getNodeNetworkConfig)
            .use(requireAuth())
            .handler(async ({ input }) => {
                const config = await this.reachabilityService.getNodeNetworkConfig(input.nodeId);
                return this.toNodeNetworkView(config);
            });
    }

    @Implement(appContract.reachability.listNodeNetworkConfigs)
    listNodeNetworkConfigs() {
        return implement(appContract.reachability.listNodeNetworkConfigs)
            .use(requireAuth())
            .handler(async () => {
                const configs = await this.reachabilityService.listNodeNetworkConfigs();
                const views = await Promise.all(configs.map((config) => this.toNodeNetworkView(config)));
                return { configs: views };
            });
    }

    @Implement(appContract.reachability.updateNodeNetworkConfig)
    updateNodeNetworkConfig() {
        return implement(appContract.reachability.updateNodeNetworkConfig)
            .use(requireAuth())
            .handler(async ({ input }) => {
                // Capture the PREVIOUS tunnel state before the update so we can
                // tear down a provisioned Cloudflare tunnel when disabling.
                const before = await this.reachabilityService.getNodeNetworkConfig(input.nodeId);

                // Disabling a tunnel with a provisioned Cloudflare tunnel must
                // DELETE it on Cloudflare first — otherwise the cloudflared
                // connector + CNAME keep serving a node that no longer claims
                // the tunnel. A failed deletion aborts the disable (no ghost
                // tunnel, and the local config stays consistent).
                if (
                    input.tunnel?.enabled === false &&
                    before.tunnel.enabled &&
                    before.tunnel.tunnelId &&
                    before.tunnel.providerId
                ) {
                    await this.tunnelService.deleteTunnel(
                        before.tunnel.providerId,
                        before.tunnel.tunnelId,
                        { hostname: before.tunnel.hostname },
                    );
                    this.logger.log(
                        `Deleted Cloudflare tunnel ${before.tunnel.tunnelId} (provider ${before.tunnel.providerId}) while disabling node tunnel`,
                    );
                }

                const initial = await this.reachabilityService.updateNodeNetworkConfig({
                    nodeId: input.nodeId,
                    publicAddress: input.publicAddress,
                    tunnel: input.tunnel,
                });
                // Auto-setup: when tunnel mode is enabled without a provisioned
                // tunnel yet, create it on the chosen provider app.
                const provisioned = await this.provisionTunnelIfNeeded(initial);
                // Ingress self-heal: even an EXISTING tunnel with a hostname
                // needs the public-hostname → service rule (idempotent). This
                // fixes the 1033 "unable to resolve" state when an earlier
                // provision created the tunnel + CNAME but never set routing.
                const tunnel = provisioned.tunnel;
                if (tunnel.enabled && tunnel.tunnelId && tunnel.providerId && tunnel.hostname) {
                    // The node's GLOBAL address/tunnel serves the NODE via the
                    // platform TRAEFIK (web:80): every public entry point
                    // terminates at Traefik, which routes this hostname to the
                    // API (dynamic-domain.yml). The web app gets its OWN
                    // surface (see the managed-web app section).
                    const service =
                        process.env.CLOUDFLARE_TUNNEL_SERVICE_URL?.trim() ||
                        `http://${platformTraefikContainerName(process.env.DEPLOYER_PREFIX)}:80`;
                    try {
                        await this.tunnelService.configureIngress(
                            tunnel.providerId,
                            tunnel.tunnelId,
                            tunnel.hostname,
                            service,
                        );
                    } catch (err) {
                        this.logger.error(
                            `Tunnel ingress re-sync failed for ${tunnel.hostname}: ${err instanceof Error ? err.message : String(err)}`,
                        );
                        throw err;
                    }
                }
                // The global hostname/tunnel changed → Traefik must publish the
                // new Host rule (dynamic-domain.yml). Fire-and-forget re-converge.
                this.ingressRefresher.refresh();
                return this.toNodeNetworkView(provisioned);
            });
    }

    @Implement(appContract.reachability.getTunnelHealth)
    getTunnelHealth() {
        return implement(appContract.reachability.getTunnelHealth)
            .use(requireAuth())
            .handler(async ({ input }) => {
                const config = await this.reachabilityService.getNodeNetworkConfig(input.nodeId);
                const tunnel = config.tunnel;
                if (!tunnel.enabled || !tunnel.providerId || !tunnel.tunnelId) {
                    return {
                        status: null,
                        checkedAt: new Date().toISOString(),
                        connections: 0,
                        tunnelId: tunnel.tunnelId,
                        error: tunnel.enabled ? "Tunnel not provisioned yet" : "Tunnel is disabled",
                    };
                }
                const health = await this.tunnelService.getTunnelHealth(tunnel.providerId, tunnel.tunnelId);
                return {
                    status: health.status,
                    checkedAt: health.checkedAt,
                    connections: health.connections,
                    tunnelId: tunnel.tunnelId,
                    error: health.error,
                };
            });
    }

    @Implement(appContract.reachability.checkDomainGate)
    checkDomainGate() {
        return implement(appContract.reachability.checkDomainGate)
            .use(requireAuth())
            .handler(async () => {
                const gate = await this.reachabilityService.checkDomainGate();
                const view = await this.toNodeNetworkView({
                    nodeId: "",
                    publicAddress: gate.publicAddress,
                    addressKind: gate.addressKind,
                    tunnel: gate.tunnel,
                    updatedAt: new Date(0).toISOString(),
                });
                return {
                    allowed: gate.allowed,
                    reason: gate.reason,
                    publicAddress: gate.publicAddress,
                    addressKind: gate.addressKind,
                    tunnel: view.tunnel,
                };
            });
    }

    // ─── Tunnel provisioning & live health helpers ──────────────────────────

    /**
     * When a node enables tunnel mode without a provisioned tunnel yet, create
     * the Cloudflare tunnel automatically on the bound provider app and store
     * its id + hostname. The tunnel name is derived from the node id.
     */
    private async provisionTunnelIfNeeded(config: NodeNetworkConfigData): Promise<NodeNetworkConfigData> {
        const tunnel = config.tunnel;
        if (!tunnel.enabled || !tunnel.providerId || tunnel.tunnelId) {
            return config;
        }
        this.logger.log(`Auto-provisioning tunnel for node ${config.nodeId} on provider ${tunnel.providerId}`);
        const name = `deployer-${config.nodeId.replace(/-/g, "").slice(0, 8)}`;
        const result = await this.tunnelService.createTunnel(tunnel.providerId, {
            name,
            hostname: tunnel.hostname ?? undefined,
        });

        // Point the tunnel's ingress at the platform TRAEFIK (web:80) — all
        // public traffic enters Traefik, which routes this hostname to the
        // API (dynamic-domain.yml). Without this rule Cloudflare answers
        // error 1033 even with the CNAME present.
        const tunnelHostname = tunnel.hostname ?? result.hostname;
        if (tunnelHostname) {
            const service =
                process.env.CLOUDFLARE_TUNNEL_SERVICE_URL?.trim() ||
                // Default: the platform Traefik container (web:80).
                `http://${platformTraefikContainerName(process.env.DEPLOYER_PREFIX)}:80`;
            try {
                await this.tunnelService.configureIngress(
                    tunnel.providerId,
                    result.tunnel.id,
                    tunnelHostname,
                    service,
                );
            } catch (err) {
                // The tunnel + CNAME are created; an ingress failure would
                // keep 1033, but we surface it loudly instead of hiding it.
                this.logger.error(
                    `Tunnel ingress configuration failed for ${tunnelHostname}: ${err instanceof Error ? err.message : String(err)}`,
                );
                throw err;
            }
        }

        return this.reachabilityService.updateNodeNetworkConfig({
            nodeId: config.nodeId,
            tunnel: {
                enabled: true,
                providerId: tunnel.providerId,
                hostname: (result.hostname ?? tunnel.hostname) ?? undefined,
                tunnelId: result.tunnel.id,
            },
        });
    }

    /** Build the contract view with LIVE tunnel health (never from the DB). */
    private async toNodeNetworkView(config: NodeNetworkConfigData): Promise<NodeNetworkView> {
        const tunnel = config.tunnel;
        const health = await this.resolveTunnelHealth(config);
        return {
            nodeId: config.nodeId,
            publicAddress: config.publicAddress,
            addressKind: config.addressKind,
            tunnel: { ...tunnel, health },
            updatedAt: config.updatedAt,
        };
    }

    private async resolveTunnelHealth(config: NodeNetworkConfigData): Promise<TunnelHealthView> {
        const tunnel = config.tunnel;
        if (!tunnel.enabled || !tunnel.providerId || !tunnel.tunnelId) {
            return {
                status: null,
                checkedAt: new Date().toISOString(),
                connections: 0,
                tunnelId: tunnel.tunnelId,
                error: null,
            };
        }
        const health = await this.tunnelService.getTunnelHealth(tunnel.providerId, tunnel.tunnelId);
        return {
            status: health.status,
            checkedAt: health.checkedAt,
            connections: health.connections,
            tunnelId: tunnel.tunnelId,
            error: health.error,
        };
    }

    /**
     * First-class public access point: request ⇒ live re-check ⇒ push onto the
     * global relay ⇒ return the fresh state.
     */
    @Implement(appContract.reachability.getPublicAccessPoint)
    getPublicAccessPoint() {
        return implement(appContract.reachability.getPublicAccessPoint)
            .use(requireAuth())
            .handler(async () => {
                const state = await this.publicAccessPointService.getAccessPoint();
                this.logger.log(`Public access point requested: kind=${String(state.kind)} url=${state.publicUrl ?? 'none'} reachable=${String(state.reachable)}`);
                return state;
            });
    }

    /**
     * Watch the global public-access-point relay: emits the current state and
     * every subsequent push (e.g. after a feature requests a refresh).
     */
    @Implement(appContract.reachability.watchPublicAccessPoint)
    watchPublicAccessPoint() {
        return implement(appContract.reachability.watchPublicAccessPoint)
            .use(requireAuth())
            .handler(async () => {
                return new Observable((subscriber) => {
                    const sub = this.publicAccessPointService.watchAccessPoint().subscribe({
                        next: (state) => subscriber.next(state),
                        error: (err) => subscriber.error(err),
                    });
                    return () => sub.unsubscribe();
                });
            });
    }
}
