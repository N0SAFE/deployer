import { runPromiseUnwrapped } from "@deployer/effect-core";
import { nodeDoorFromEnv } from "@deployer/mesh-client";
import { createModuleContext } from "@deployer/nest-effect";
import { NodeConfigRepository, type NodeConfigRepositoryShape } from "@deployer/node-state";
import { EnvModule, EnvService } from "@deployer/shared/config/env/env.module";
import { MeshCoreModule } from "@deployer/shared/core/modules/mesh/mesh-core.module";
import { SystemMeshClusterRepository } from "@deployer/shared/core/modules/mesh/repositories/system-mesh-cluster.repository";
import { SwarmCoreModule } from "@deployer/shared/core/modules/swarm/swarm.module";
import { DEPLOYER_VERSION } from "@deployer/shared/core/utils/deployer-version";
import { SwarmJoinGrant, type SwarmJoinGrantShape } from "@deployer/swarm";

import { EnrollmentController } from "./enrollment.controller";
import { EnrollmentService } from "./enrollment.service";

export class EnrollmentModule extends createModuleContext({
  // This node's agent vouches for the token, the fleet's swarm role decision is the grant, and the registry of nodes is
  // what an enrollment writes to.
  imports: [MeshCoreModule, SwarmCoreModule, EnvModule],
  controllers: [EnrollmentController],
  providers: [
    {
      provide: EnrollmentService,
      useFactory: (
        clusters: SystemMeshClusterRepository,
        nodeConfig: NodeConfigRepositoryShape,
        grants: SwarmJoinGrantShape,
        env: EnvService,
      ) =>
        new EnrollmentService({
          version: DEPLOYER_VERSION,
          // The token is checked by THIS node's agent, over the node door; an absent door answers null.
          checkToken: (token) => nodeDoorFromEnv(env).checkJoinToken(token),
          swarmGrant: (policy) => runPromiseUnwrapped(grants.buildGrant(policy)),
          databaseUrl: async () => (await runPromiseUnwrapped(nodeConfig.find()))?.databaseUrl?.trim() ?? null,
          register: async (input) => {
            const registered = await clusters.registerOrUpdateNode({ ...input, metadata: { enrolledVia: "join_token" } });
            return { nodeId: registered.nodeId, enrolledAt: registered.enrolledAt };
          },
        }),
      inject: [SystemMeshClusterRepository, NodeConfigRepository, SwarmJoinGrant, EnvService],
    },
  ],
}) {}
