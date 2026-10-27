/**
 * Reachability Controller
 *
 * HTTP endpoints for URL/domain reachability, a node's own public address, and
 * the STACK's ingress lanes. Thin: the lanes, the public edge, DNS and the mesh
 * view are orchestrated by `IngressEdgeService`; this file only maps contracts to it.
 */
import { Controller, Logger } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { reachabilityContract } from "@deployer/fleet-contracts";
import { requireAuth, requirePlatformRole } from "@deployer/shared/core/modules/auth/orpc/middlewares";

/** Changing how the stack is reached, or who is in the mesh, is a platform-admin act. */
const EDGE_ADMIN_ROLES = ["superAdmin", "admin"];
import { EgressService } from "@deployer/shared/core/modules/egress/egress.service";
import { ReachabilityService } from "@deployer/shared/core/modules/reachability/services/reachability.service";
import type { NodeNetworkConfigData } from "@deployer/shared/core/modules/reachability/services/node-network-config.mapper";
import { PublicAccessPointService } from "@deployer/shared/core/modules/reachability/services/public-access-point.service";
import { TraefikConfigRefresher } from "@deployer/shared/core/modules/traefik/services/traefik-config-refresher.service";
import { Observable } from "rxjs";

import { IngressEdgeService } from "../services/ingress-edge.service";

/** A node's own network config as the contract sees it (the public edge belongs to the stack). */
type NodeNetworkView = NodeNetworkConfigData;

@Controller()
export class ReachabilityController {
    private readonly logger = new Logger(ReachabilityController.name);

    constructor(
        private readonly reachabilityService: ReachabilityService,
        private readonly publicAccessPointService: PublicAccessPointService,
        private readonly ingressRefresher: TraefikConfigRefresher,
        private readonly ingressEdge: IngressEdgeService,
        private readonly egress: EgressService,
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
                    // Any authenticated user can name this URL: it goes through the operator egress
                    // policy (no loopback / link-local / metadata, no redirects) and failures are
                    // reported as a category, never as a resolved address or a transport error.
                    const resp = await this.egress.operator({ url: probeUrl });
                    const latencyMs = Date.now() - start;
                    const ok = resp.status >= 200 && resp.status < 300;
                    return {
                        url,
                        reachable: ok,
                        latencyMs,
                        statusCode: resp.status,
                        error: ok ? undefined : `HTTP ${resp.status}`,
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

    // ─── Ingress lanes (local · private · public) ──────────────────────────

    @Implement(reachabilityContract.getIngress)
    getIngress() {
        return implement(reachabilityContract.getIngress)
            .use(requireAuth())
            .handler(async () => await this.ingressEdge.getState());
    }

    @Implement(reachabilityContract.updateIngress)
    updateIngress() {
        return implement(reachabilityContract.updateIngress)
            .use(requireAuth())
            .use(requirePlatformRole(EDGE_ADMIN_ROLES))
            .handler(async ({ input }) => await this.ingressEdge.update(input));
    }

    @Implement(reachabilityContract.teardownPublicEdge)
    teardownPublicEdge() {
        return implement(reachabilityContract.teardownPublicEdge)
            .use(requireAuth())
            .use(requirePlatformRole(EDGE_ADMIN_ROLES))
            .handler(async () => await this.ingressEdge.teardownPublicEdge());
    }

    @Implement(reachabilityContract.revokeMeshMember)
    revokeMeshMember() {
        return implement(reachabilityContract.revokeMeshMember)
            .use(requireAuth())
            .use(requirePlatformRole(EDGE_ADMIN_ROLES))
            .handler(async ({ input }) => await this.ingressEdge.revokeMeshMember(input.memberId, input.reason));
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
                        next: (state) => { subscriber.next(state); },
                        error: (err) => { subscriber.error(err); },
                    });
                    return () => { sub.unsubscribe(); };
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
            const resp = await this.egress.operator({ url: `${publicUrl}/health` });
            const ok = resp.status >= 200 && resp.status < 300;
            return {
                publicUrl,
                lastCheckedAt: new Date().toISOString(),
                lastStatus: ok ? "reachable" : `http_${resp.status}`,
                reachable: ok,
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
     * `getIngress`).
     */
    private toNodeNetworkView(config: NodeNetworkConfigData): NodeNetworkView {
        return {
            nodeId: config.nodeId,
            publicAddress: config.publicAddress,
            addressKind: config.addressKind,
            updatedAt: config.updatedAt,
        };
    }
}
