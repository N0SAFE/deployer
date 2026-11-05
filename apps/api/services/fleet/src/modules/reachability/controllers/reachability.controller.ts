/**
 * Reachability Controller
 *
 * HTTP endpoints for URL/domain reachability, a node's own public address, and the STACK's ingress
 * lanes. Thin: probes live in `NodeReachabilityService`, the lanes, the public edge, DNS and the
 * mesh view in `IngressEdgeService`; this file resolves them from the module's Effect context and
 * runs each use case through the `.effect()` boundary.
 */
import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";

import { reachabilityContract } from "@deployer/fleet-contracts";
import { procedure } from "@deployer/nest-effect";
import { requireAuth, requirePlatformRole } from "@deployer/shared/core/modules/auth/orpc/middlewares";

import { IngressEdgeService } from "../services/ingress-edge.service";
import { NodeReachabilityService } from "../services/node-reachability.service";

/** Changing how the stack is reached, or who is in the mesh, is a platform-admin act. */
const EDGE_ADMIN_ROLES = ["superAdmin", "admin"];


/** Probing a caller-named target, and the node config behind it, is an operational act. */
const PROBE_OPERATOR_ROLES = ["superAdmin", "admin", "operator"];

@Controller()
export class ReachabilityController {
    @Implement(reachabilityContract.check)
    check() {
        return procedure(reachabilityContract.check)
            .use(requireAuth())
            .use(requirePlatformRole(PROBE_OPERATOR_ROLES))
            .effect(function* ({ input }) {
                const reachability = yield* NodeReachabilityService;
                return yield* reachability.check(input.url);
            });
    }

    @Implement(reachabilityContract.getConfig)
    getConfig() {
        return procedure(reachabilityContract.getConfig)
            .use(requireAuth())
            .effect(function* () {
                const reachability = yield* NodeReachabilityService;
                return yield* reachability.probePublicUrl();
            });
    }

    @Implement(reachabilityContract.updateConfig)
    updateConfig() {
        return procedure(reachabilityContract.updateConfig)
            .use(requireAuth())
            .use(requirePlatformRole(PROBE_OPERATOR_ROLES))
            .effect(function* () {
                const reachability = yield* NodeReachabilityService;
                return yield* reachability.probePublicUrl();
            });
    }

    @Implement(reachabilityContract.checkDomain)
    checkDomain() {
        return procedure(reachabilityContract.checkDomain)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const reachability = yield* NodeReachabilityService;
                return yield* reachability.checkDomain(input.domain, input.expectedIp);
            });
    }

    @Implement(reachabilityContract.getPublicIp)
    getPublicIp() {
        return procedure(reachabilityContract.getPublicIp)
            .use(requireAuth())
            .effect(function* () {
                const reachability = yield* NodeReachabilityService;
                return yield* reachability.getPublicIp();
            });
    }

    @Implement(reachabilityContract.getNodeNetworkConfig)
    getNodeNetworkConfig() {
        return procedure(reachabilityContract.getNodeNetworkConfig)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const reachability = yield* NodeReachabilityService;
                return yield* reachability.getNodeNetworkConfig(input.nodeId);
            });
    }

    @Implement(reachabilityContract.listNodeNetworkConfigs)
    listNodeNetworkConfigs() {
        return procedure(reachabilityContract.listNodeNetworkConfigs)
            .use(requireAuth())
            .effect(function* () {
                const reachability = yield* NodeReachabilityService;
                return yield* reachability.listNodeNetworkConfigs();
            });
    }

    @Implement(reachabilityContract.updateNodeNetworkConfig)
    updateNodeNetworkConfig() {
        return procedure(reachabilityContract.updateNodeNetworkConfig)
            .use(requireAuth())
            .use(requirePlatformRole(PROBE_OPERATOR_ROLES))
            .effect(function* ({ input }) {
                const reachability = yield* NodeReachabilityService;
                return yield* reachability.updateNodeNetworkConfig({ nodeId: input.nodeId, publicAddress: input.publicAddress });
            });
    }

    @Implement(reachabilityContract.checkDomainGate)
    checkDomainGate() {
        return procedure(reachabilityContract.checkDomainGate)
            .use(requireAuth())
            .effect(function* () {
                const reachability = yield* NodeReachabilityService;
                return yield* reachability.checkDomainGate();
            });
    }

    @Implement(reachabilityContract.getIngress)
    getIngress() {
        return procedure(reachabilityContract.getIngress)
            .use(requireAuth())
            .effect(function* () {
                const ingress = yield* IngressEdgeService;
                return yield* ingress.getState();
            });
    }

    @Implement(reachabilityContract.updateIngress)
    updateIngress() {
        return procedure(reachabilityContract.updateIngress)
            .use(requireAuth())
            .use(requirePlatformRole(EDGE_ADMIN_ROLES))
            .effect(function* ({ input }) {
                const ingress = yield* IngressEdgeService;
                return yield* ingress.update(input);
            });
    }

    @Implement(reachabilityContract.teardownPublicEdge)
    teardownPublicEdge() {
        return procedure(reachabilityContract.teardownPublicEdge)
            .use(requireAuth())
            .use(requirePlatformRole(EDGE_ADMIN_ROLES))
            .effect(function* () {
                const ingress = yield* IngressEdgeService;
                return yield* ingress.teardownPublicEdge();
            });
    }

    @Implement(reachabilityContract.revokeMeshMember)
    revokeMeshMember() {
        return procedure(reachabilityContract.revokeMeshMember)
            .use(requireAuth())
            .use(requirePlatformRole(EDGE_ADMIN_ROLES))
            .effect(function* ({ input }) {
                const ingress = yield* IngressEdgeService;
                return yield* ingress.revokeMeshMember(input.memberId, input.reason);
            });
    }

    @Implement(reachabilityContract.getPublicAccessPoint)
    getPublicAccessPoint() {
        return procedure(reachabilityContract.getPublicAccessPoint)
            .use(requireAuth())
            .effect(function* () {
                const reachability = yield* NodeReachabilityService;
                return yield* reachability.getPublicAccessPoint();
            });
    }

    @Implement(reachabilityContract.watchPublicAccessPoint)
    watchPublicAccessPoint() {
        return procedure(reachabilityContract.watchPublicAccessPoint)
            .use(requireAuth())
            .effect(function* () {
                const reachability = yield* NodeReachabilityService;
                return yield* reachability.watchPublicAccessPoint();
            });
    }
}
