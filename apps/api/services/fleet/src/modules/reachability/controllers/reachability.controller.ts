/**
 * Reachability Controller
 *
 * HTTP endpoints for URL/domain reachability, a node's own public address, and the STACK's ingress
 * lanes. Thin: probes live in `NodeReachabilityService`, the lanes, the public edge, DNS and the
 * mesh view in `IngressEdgeService`; this file resolves them from the module's Effect context and
 * runs each use case through `serve`.
 */
import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { reachabilityContract } from "@deployer/fleet-contracts";
import { EffectContextOf } from "@deployer/nest-effect";
import { requireAuth, requirePlatformRole } from "@deployer/shared/core/modules/auth/orpc/middlewares";

import { serve } from "../../../core/orpc/serve";
import { ReachabilityModule } from "../reachability.module";
import { IngressEdgeService } from "../services/ingress-edge.service";
import { NodeReachabilityService } from "../services/node-reachability.service";

/** Changing how the stack is reached, or who is in the mesh, is a platform-admin act. */
const EDGE_ADMIN_ROLES = ["superAdmin", "admin"];

@Controller()
export class ReachabilityController {
    @Implement(reachabilityContract.check)
    check() {
        return implement(reachabilityContract.check)
            .use(requireAuth())
            .use(ReachabilityModule[EffectContextOf])
            .effect(function* ({ input, context }) {
                const reachability = yield* NodeReachabilityService;
                return yield* serve(context)(reachability.check(input.url));
            });
    }

    @Implement(reachabilityContract.getConfig)
    getConfig() {
        return implement(reachabilityContract.getConfig)
            .use(requireAuth())
            .use(ReachabilityModule[EffectContextOf])
            .effect(function* ({ context }) {
                const reachability = yield* NodeReachabilityService;
                return yield* serve(context)(reachability.probePublicUrl());
            });
    }

    @Implement(reachabilityContract.updateConfig)
    updateConfig() {
        return implement(reachabilityContract.updateConfig)
            .use(requireAuth())
            .use(ReachabilityModule[EffectContextOf])
            .effect(function* ({ context }) {
                const reachability = yield* NodeReachabilityService;
                return yield* serve(context)(reachability.probePublicUrl());
            });
    }

    @Implement(reachabilityContract.checkDomain)
    checkDomain() {
        return implement(reachabilityContract.checkDomain)
            .use(requireAuth())
            .use(ReachabilityModule[EffectContextOf])
            .effect(function* ({ input, context }) {
                const reachability = yield* NodeReachabilityService;
                return yield* serve(context)(reachability.checkDomain(input.domain, input.expectedIp));
            });
    }

    @Implement(reachabilityContract.getPublicIp)
    getPublicIp() {
        return implement(reachabilityContract.getPublicIp)
            .use(requireAuth())
            .use(ReachabilityModule[EffectContextOf])
            .effect(function* ({ context }) {
                const reachability = yield* NodeReachabilityService;
                return yield* serve(context)(reachability.getPublicIp());
            });
    }

    @Implement(reachabilityContract.getNodeNetworkConfig)
    getNodeNetworkConfig() {
        return implement(reachabilityContract.getNodeNetworkConfig)
            .use(requireAuth())
            .use(ReachabilityModule[EffectContextOf])
            .effect(function* ({ input, context }) {
                const reachability = yield* NodeReachabilityService;
                return yield* serve(context)(reachability.getNodeNetworkConfig(input.nodeId));
            });
    }

    @Implement(reachabilityContract.listNodeNetworkConfigs)
    listNodeNetworkConfigs() {
        return implement(reachabilityContract.listNodeNetworkConfigs)
            .use(requireAuth())
            .use(ReachabilityModule[EffectContextOf])
            .effect(function* ({ context }) {
                const reachability = yield* NodeReachabilityService;
                return yield* serve(context)(reachability.listNodeNetworkConfigs());
            });
    }

    @Implement(reachabilityContract.updateNodeNetworkConfig)
    updateNodeNetworkConfig() {
        return implement(reachabilityContract.updateNodeNetworkConfig)
            .use(requireAuth())
            .use(ReachabilityModule[EffectContextOf])
            .effect(function* ({ input, context }) {
                const reachability = yield* NodeReachabilityService;
                return yield* serve(context)(reachability.updateNodeNetworkConfig({ nodeId: input.nodeId, publicAddress: input.publicAddress }));
            });
    }

    @Implement(reachabilityContract.checkDomainGate)
    checkDomainGate() {
        return implement(reachabilityContract.checkDomainGate)
            .use(requireAuth())
            .use(ReachabilityModule[EffectContextOf])
            .effect(function* ({ context }) {
                const reachability = yield* NodeReachabilityService;
                return yield* serve(context)(reachability.checkDomainGate());
            });
    }

    @Implement(reachabilityContract.getIngress)
    getIngress() {
        return implement(reachabilityContract.getIngress)
            .use(requireAuth())
            .use(ReachabilityModule[EffectContextOf])
            .effect(function* ({ context }) {
                const ingress = yield* IngressEdgeService;
                return yield* serve(context)(ingress.getState());
            });
    }

    @Implement(reachabilityContract.updateIngress)
    updateIngress() {
        return implement(reachabilityContract.updateIngress)
            .use(requireAuth())
            .use(ReachabilityModule[EffectContextOf])
            .use(requirePlatformRole(EDGE_ADMIN_ROLES))
            .effect(function* ({ input, context }) {
                const ingress = yield* IngressEdgeService;
                return yield* serve(context)(ingress.update(input));
            });
    }

    @Implement(reachabilityContract.teardownPublicEdge)
    teardownPublicEdge() {
        return implement(reachabilityContract.teardownPublicEdge)
            .use(requireAuth())
            .use(ReachabilityModule[EffectContextOf])
            .use(requirePlatformRole(EDGE_ADMIN_ROLES))
            .effect(function* ({ context }) {
                const ingress = yield* IngressEdgeService;
                return yield* serve(context)(ingress.teardownPublicEdge());
            });
    }

    @Implement(reachabilityContract.revokeMeshMember)
    revokeMeshMember() {
        return implement(reachabilityContract.revokeMeshMember)
            .use(requireAuth())
            .use(ReachabilityModule[EffectContextOf])
            .use(requirePlatformRole(EDGE_ADMIN_ROLES))
            .effect(function* ({ input, context }) {
                const ingress = yield* IngressEdgeService;
                return yield* serve(context)(ingress.revokeMeshMember(input.memberId, input.reason));
            });
    }

    @Implement(reachabilityContract.getPublicAccessPoint)
    getPublicAccessPoint() {
        return implement(reachabilityContract.getPublicAccessPoint)
            .use(requireAuth())
            .use(ReachabilityModule[EffectContextOf])
            .effect(function* ({ context }) {
                const reachability = yield* NodeReachabilityService;
                return yield* serve(context)(reachability.getPublicAccessPoint());
            });
    }

    @Implement(reachabilityContract.watchPublicAccessPoint)
    watchPublicAccessPoint() {
        return implement(reachabilityContract.watchPublicAccessPoint)
            .use(requireAuth())
            .use(ReachabilityModule[EffectContextOf])
            .effect(function* ({ context }) {
                const reachability = yield* NodeReachabilityService;
                return yield* serve(context)(reachability.watchPublicAccessPoint());
            });
    }
}
