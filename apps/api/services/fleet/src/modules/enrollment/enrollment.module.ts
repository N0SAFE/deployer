import { Module } from "@nestjs/common";
import { runPromiseUnwrapped, runSyncUnwrapped } from "@deployer/effect-core";
import { nodeAgentLink } from "@deployer/mesh-client";
import { NodeConfigRepository, type NodeConfigRepositoryShape } from "@deployer/node-state";
import { SwarmJoinGrant, type SwarmJoinGrantShape } from "@deployer/swarm";
import { DEPLOYER_VERSION } from "@deployer/shared/core/utils/deployer-version";
import { MeshAdmissionService } from "@deployer/shared/core/modules/mesh-agent/mesh-admission.service";
import { SystemMeshClusterRepository } from "@deployer/shared/core/modules/mesh/repositories/system-mesh-cluster.repository";
import { MeshCoreModule } from "@deployer/shared/core/modules/mesh/mesh-core.module";
import { MeshAgentModule } from "@deployer/shared/core/modules/mesh-agent/mesh-agent.module";
import { SwarmCoreModule } from "@deployer/shared/core/modules/swarm/swarm.module";

import { EnrollmentController } from "./enrollment.controller";
import { EnrollmentService } from "./enrollment.service";

/** One pooled link for the life of the process, opened the first time the agent's socket is there. */
const sharedAgentLink = (() => {
  let link: ReturnType<typeof nodeAgentLink>;
  return () => (link ??= nodeAgentLink());
})();

@Module({
  // The fleet's swarm role decision, the WireGuard admission and the registry of nodes are what an enrollment touches.
  imports: [MeshCoreModule, SwarmCoreModule, MeshAgentModule],
  controllers: [EnrollmentController],
  providers: [
    {
      provide: EnrollmentService,
      useFactory: (
        clusters: SystemMeshClusterRepository,
        admission: MeshAdmissionService,
        nodeConfig: NodeConfigRepositoryShape,
        grants: SwarmJoinGrantShape,
      ) =>
        new EnrollmentService(sharedAgentLink, {
          version: DEPLOYER_VERSION,
          cluster: () => admission.clusterForGrant(),
          swarmGrant: (policy) => runPromiseUnwrapped(grants.buildGrant(policy)),
          admit: (request) => admission.admit(request),
          databaseUrl: () => runSyncUnwrapped(nodeConfig.find())?.databaseUrl?.trim() ?? null,
          register: async (input) => {
            const registered = await clusters.registerOrUpdateNode({ ...input, metadata: { enrolledVia: "join_token" } });
            return { nodeId: registered.nodeId, enrolledAt: registered.enrolledAt };
          },
        }),
      inject: [SystemMeshClusterRepository, MeshAdmissionService, NodeConfigRepository, SwarmJoinGrant],
    },
  ],
})
export class EnrollmentModule {}
