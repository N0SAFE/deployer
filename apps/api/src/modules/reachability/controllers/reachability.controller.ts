/**
 * Reachability Controller
 *
 * HTTP endpoints for URL/domain reachability and for the STACK's edge.
 *
 * Two distinct concerns live here, and the split matters:
 *
 *   NODE  — a node's own public address (`node_network_config`). Needed in
 *           `direct` mode, where DNS resolves an app hostname to a node address.
 *   STACK — how the internet reaches the edge at all: the mode (`direct` vs
 *           `tunnel`) and the ONE tunnel every node shares. Persisted in the
 *           local `platform_settings` table via PlatformIngressSettingsService.
 *
 * The tunnel used to be per NODE, which meant N Cloudflare tunnels for one
 * platform — N objects to create, N hostname rules to keep in sync, and N
 * connectors racing to answer for the same hostname. It is a property of the
 * stack, so it is provisioned once here and run by the connector supervisor.
 *
 * This controller is also the layer that talks to the PROVIDER (creating and
 * routing the tunnel); the core service only persists config and probes.
 */
import { Controller, Logger, BadRequestException } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { reachabilityContract } from "@repo/api-contracts";
import { requireAuth } from "@/core/modules/auth/orpc/middlewares";
import { ReachabilityService, type NodeNetworkConfigData } from "@/core/modules/reachability/services/reachability.service";
import { PublicAccessPointService } from "@/core/modules/reachability/services/public-access-point.service";
import { CloudflareTunnelService } from "@/modules/providers/dns/cloudflare/services/cloudflare-tunnel.service";
import { TraefikConfigRefresher } from "@/core/modules/traefik/services/traefik-config-refresher.service";
import { platformTraefikContainerName } from "@/core/modules/platform-ingress/services/platform-names";
import { PlatformIngressSettingsService } from "@/core/modules/platform-ingress/services/platform-ingress-settings.service";
import { Observable } from "rxjs";

/**
 * Name of the STACK's tunnel on the provider account.
 *
 * Stack-scoped, deliberately: naming it after a node (the old behaviour) made a
 * second tunnel look correct on the next node and split the edge in two.
 * `createTunnel` reuses a tunnel the account already owns under this name, so a
 * retry converges instead of creating a duplicate.
 */
function stackTunnelName(prefix: string | undefined): string {
    const clean = (prefix ?? "").trim();
    return clean === "" ? "deployer-stack" : `deployer-stack-${clean}`;
}

/** The service the tunnel forwards to — the platform ingress, always. */
function tunnelRouteTarget(): string {
    return (
        process.env.CLOUDFLARE_TUNNEL_SERVICE_URL?.trim() ||
        `http://${platformTraefikContainerName(process.env.DEPLOYER_PREFIX)}:80`
    );
}

/**
 * A node's own network config as the contract sees it.
 *
 * No tunnel field: the tunnel belongs to the STACK (`getStackEdge`).
 */
interface NodeNetworkView extends NodeNetworkConfigData {}

@Controller()
export class ReachabilityController {
    private readonly logger = new Logger(ReachabilityController.name);

    constructor(
        private readonly reachabilityService: ReachabilityService,
        private readonly publicAccessPointService: PublicAccessPointService,
        private readonly tunnelService: CloudflareTunnelService,
        private readonly ingressRefresher: TraefikConfigRefresher,
        private readonly edgeSettings: PlatformIngressSettingsService,
    ) {}

    @Implement(reachabilityContract.check)
    check() {
        return implement(reachabilityContract.check)
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

    @Implement(reachabilityContract.getConfig)
    getConfig() {
        return implement(reachabilityContract.getConfig)
            .use(requireAuth())
            .handler(async () => await this.probePublicUrl());
    }

    @Implement(reachabilityContract.updateConfig)
    updateConfig() {
        return implement(reachabilityContract.updateConfig)
            .use(requireAuth())
            .handler(async () => await this.probePublicUrl());
    }

    @Implement(reachabilityContract.checkDomain)
    checkDomain() {
        return implement(reachabilityContract.checkDomain)
            .use(requireAuth())
            .handler(async ({ input }) => {
                const result = await this.reachabilityService.checkDomainReachability(
                    input.domain,
                    input.expectedIp,
                );
                return result;
            });
    }

    @Implement(reachabilityContract.getPublicIp)
    getPublicIp() {
        return implement(reachabilityContract.getPublicIp)
            .use(requireAuth())
            .handler(async () => {
                const ip = await this.reachabilityService.getPublicIp();
                return { ip };
            });
    }

    @Implement(reachabilityContract.getNodeNetworkConfig)
    getNodeNetworkConfig() {
        return implement(reachabilityContract.getNodeNetworkConfig)
            .use(requireAuth())
            .handler(async ({ input }) => {
                const config = await this.reachabilityService.getNodeNetworkConfig(input.nodeId);
                return this.toNodeNetworkView(config);
            });
    }

    @Implement(reachabilityContract.listNodeNetworkConfigs)
    listNodeNetworkConfigs() {
        return implement(reachabilityContract.listNodeNetworkConfigs)
            .use(requireAuth())
            .handler(async () => {
                const configs = await this.reachabilityService.listNodeNetworkConfigs();
                const views = await Promise.all(configs.map((config) => this.toNodeNetworkView(config)));
                return { configs: views };
            });
    }

    @Implement(reachabilityContract.updateNodeNetworkConfig)
    updateNodeNetworkConfig() {
        return implement(reachabilityContract.updateNodeNetworkConfig)
            .use(requireAuth())
            .handler(async ({ input }) => {
                const updated = await this.reachabilityService.updateNodeNetworkConfig({
                    nodeId: input.nodeId,
                    publicAddress: input.publicAddress,
                });
                // The node's address changed → Traefik must publish the new Host
                // rule (dynamic-domain.yml). Fire-and-forget re-converge.
                this.ingressRefresher.refresh();
                return this.toNodeNetworkView(updated);
            });
    }

    @Implement(reachabilityContract.checkDomainGate)
    checkDomainGate() {
        return implement(reachabilityContract.checkDomainGate)
            .use(requireAuth())
            .handler(async () => {
                const gate = await this.reachabilityService.checkDomainGate();
                return {
                    allowed: gate.allowed,
                    reason: gate.reason,
                    publicAddress: gate.publicAddress,
                    addressKind: gate.addressKind,
                };
            });
    }

    // ─── Stack edge (mode + ONE tunnel for the whole stack) ────────────────

    @Implement(reachabilityContract.getStackEdge)
    getStackEdge() {
        return implement(reachabilityContract.getStackEdge)
            .use(requireAuth())
            .handler(async () => await this.toStackEdgeView());
    }

    @Implement(reachabilityContract.setStackEdgeMode)
    setStackEdgeMode() {
        return implement(reachabilityContract.setStackEdgeMode)
            .use(requireAuth())
            .handler(async ({ input }) => {
                // The singleton edge is addressed as a collection (POST), so the
                // payload IS the input — there is no `:id` to nest under.
                const { mode, providerId, wildcard } = input;
                // Switching to `tunnel` must leave a USABLE tunnel behind, so the
                // provisioning happens here rather than being left to the caller:
                // a mode that claims `tunnel` with no token would report an edge
                // that cannot exist, and the connector would silently never start.
                if (mode === "tunnel") {
                    await this.ensureStackTunnel(providerId, wildcard);
                }
                await this.edgeSettings.setEdgeMode(mode);
                this.logger.log(`Stack edge mode set to '${mode}'`);
                return await this.toStackEdgeView();
            });
    }

    @Implement(reachabilityContract.clearStackEdgeTunnel)
    clearStackEdgeTunnel() {
        return implement(reachabilityContract.clearStackEdgeTunnel)
            .use(requireAuth())
            .handler(async () => {
                const { tunnelId, providerId, wildcard } = await this.edgeSettings.getEdgeTunnel();
                // Delete on the provider BEFORE forgetting it locally: the reverse
                // order would lose the ids and leave an orphan tunnel no one can
                // name — the failure the per-node model produced routinely.
                if (tunnelId !== null && providerId !== null) {
                    await this.tunnelService.deleteTunnel(providerId, tunnelId, { hostname: wildcard });
                    this.logger.log(`Deleted stack edge tunnel ${tunnelId} (provider ${providerId})`);
                }
                await this.edgeSettings.clearEdgeTunnel();
                return await this.toStackEdgeView();
            });
    }

    @Implement(reachabilityContract.getTunnelHealth)
    getTunnelHealth() {
        return implement(reachabilityContract.getTunnelHealth)
            .use(requireAuth())
            .handler(async () => {
                // Health of the STACK's tunnel — the one tunnel every node shares.
                const { tunnelId, providerId } = await this.edgeSettings.getEdgeTunnel();
                if (tunnelId === null || providerId === null) {
                    return {
                        status: null,
                        checkedAt: new Date().toISOString(),
                        connections: 0,
                        tunnelId,
                        error: "No stack tunnel is provisioned",
                    };
                }
                const health = await this.tunnelService.getTunnelHealth(providerId, tunnelId);
                return {
                    status: health.status,
                    checkedAt: health.checkedAt,
                    connections: health.connections,
                    tunnelId,
                    error: health.error,
                };
            });
    }

    // ─── Public access point (global relay) ────────────────────────────────

    /**
     * First-class public access point: request ⇒ live re-check ⇒ push onto the
     * global relay ⇒ return the fresh state.
     */
    @Implement(reachabilityContract.getPublicAccessPoint)
    getPublicAccessPoint() {
        return implement(reachabilityContract.getPublicAccessPoint)
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
    @Implement(reachabilityContract.watchPublicAccessPoint)
    watchPublicAccessPoint() {
        return implement(reachabilityContract.watchPublicAccessPoint)
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

    // ─── Helpers ───────────────────────────────────────────────────────────

    /**
     * Live availability of the stack's public URL.
     *
     * Shared by getConfig and updateConfig, which are otherwise the same call —
     * the URL is derived (never stored), so both endpoints answer the same
     * question and must not drift apart.
     */
    private async probePublicUrl(): Promise<{
        publicUrl: string | null;
        lastCheckedAt: string | null;
        lastStatus: string | null;
        reachable: boolean | null;
    }> {
        const publicUrl = await this.reachabilityService.getNodePublicUrl();
        if (!publicUrl) {
            return { publicUrl: null, lastCheckedAt: null, lastStatus: null, reachable: null };
        }
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
    }

    /**
     * The per-node view: this node's own public address.
     *
     * The TUNNEL is deliberately absent — it belongs to the STACK (see
     * `getStackEdge`).
     */
    private toNodeNetworkView(config: NodeNetworkConfigData): NodeNetworkView {
        return {
            nodeId: config.nodeId,
            publicAddress: config.publicAddress,
            addressKind: config.addressKind,
            updatedAt: config.updatedAt,
        };
    }

    /**
     * The stack edge as the contract sees it. The token is NEVER included — it
     * is a credential, and nothing outside the connector supervisor needs it.
     */
    private async toStackEdgeView() {
        const mode = await this.edgeSettings.getEdgeMode();
        const tunnel = await this.edgeSettings.getEdgeTunnel();
        return {
            mode,
            tunnel: {
                tunnelId: tunnel.tunnelId,
                providerId: tunnel.providerId,
                wildcard: tunnel.wildcard,
                provisioned: tunnel.token !== null && tunnel.tunnelId !== null,
            },
            // Derived from the MODE so a client never re-implements the rule:
            // `direct` needs a bound port (DNS points at it), `tunnel` must not
            // have one (the connector dials out).
            publishesEntryPort: mode === "direct",
            publicHostname: tunnel.wildcard ?? null,
        };
    }

    /**
     * Create the stack's tunnel when none is stored yet, and make it usable.
     *
     * Idempotent: an already-provisioned tunnel keeps its token and only has its
     * routing rule re-applied. `createTunnel` itself also reuses a tunnel the
     * account already owns under the same name, so a retry after a partial
     * failure converges instead of creating a second tunnel.
     */
    private async ensureStackTunnel(providerId?: string, wildcard?: string): Promise<void> {
        const existing = await this.edgeSettings.getEdgeTunnel();
        const resolvedProvider = providerId ?? existing.providerId;
        if (resolvedProvider === null) {
            throw new BadRequestException(
                "Switching to tunnel mode requires a DNS provider — pass 'providerId' (the Cloudflare app the tunnel is created on).",
            );
        }

        // The wildcard the tunnel routes: explicit, else stored, else the env
        // default. Persisted so the routing rule survives a restart without env.
        const resolvedWildcard =
            wildcard?.trim() ||
            existing.wildcard?.trim() ||
            process.env.DEPLOYER_TUNNEL_WILDCARD?.trim() ||
            null;

        // A tunnel with no wildcard routes NOTHING, so the mode would claim a
        // working edge while every request 404s at Cloudflare. Refused here,
        // where the operator can still fix it.
        if (resolvedWildcard === null) {
            throw new BadRequestException(
                "Tunnel mode needs a wildcard hostname (e.g. '*.example.com') — without one the tunnel would route nothing. Pass 'wildcard' or set DEPLOYER_TUNNEL_WILDCARD.",
            );
        }

        let tunnelId = existing.tunnelId;
        if (tunnelId === null || existing.token === null) {
            this.logger.log(`Provisioning the stack edge tunnel on provider ${resolvedProvider}`);
            const result = await this.tunnelService.createTunnel(resolvedProvider, {
                name: stackTunnelName(process.env.DEPLOYER_PREFIX),
                hostname: resolvedWildcard,
            });
            tunnelId = result.tunnel.id;
            await this.edgeSettings.setEdgeTunnel({
                token: result.token,
                tunnelId: result.tunnel.id,
                providerId: resolvedProvider,
                wildcard: resolvedWildcard,
            });
        }

        // Point the tunnel at the platform TRAEFIK: every public entry point
        // terminates there, and Traefik decides which app a Host header belongs
        // to. ONE wildcard rule covers every app and preview, so onboarding a
        // deployment never touches Cloudflare — a rule per hostname would make
        // Cloudflare a participant in every deploy, turning its failures into
        // failed deploys.
        await this.tunnelService.configureIngress(
            resolvedProvider,
            tunnelId,
            resolvedWildcard,
            tunnelRouteTarget(),
        );
    }
}
