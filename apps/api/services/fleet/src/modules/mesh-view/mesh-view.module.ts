import { Module } from "@nestjs/common";
import { NodeConfigRepository, type NodeConfigRepositoryShape } from "@deployer/node-state";
import { runPromiseUnwrapped } from "@deployer/effect-core";
import { nodeAgentLink } from "@deployer/mesh-client";

import { MeshViewController } from "./mesh-view.controller";
import { MeshViewService } from "./mesh-view.service";

/**
 * The agent's link is looked up on each call, not once at boot: the agent can start after this service, and a node
 * that gains an agent should be seen as having one without a restart.
 */
/** One pooled link for the life of the process, opened the first time the agent's socket is there. */
const sharedAgentLink = (() => {
  let link: ReturnType<typeof nodeAgentLink>;
  return () => (link ??= nodeAgentLink());
})();

@Module({
  controllers: [MeshViewController],
  providers: [
    {
      provide: MeshViewService,
      useFactory: (nodeConfig: NodeConfigRepositoryShape) =>
        new MeshViewService(
          sharedAgentLink,
          async () => ({ nodeId: (await runPromiseUnwrapped(nodeConfig.find()))?.nodeId ?? "standalone" }),
        ),
      inject: [NodeConfigRepository],
    },
  ],
})
export class MeshViewModule {}
