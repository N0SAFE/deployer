import type { Server } from "node:http";

import { type INestApplication, Logger } from "@nestjs/common";
import { runtimeContract } from "@deployer/runtime-contracts";
import { type MeshMembership, joinServiceMeshOnNode } from "@deployer/mesh-service";
import { toAsyncIteratorFromObservable } from "@deployer/orpc-utils/utils/observable/contract";
import { apiServicePort } from "@deployer/shared/server";

import { NODE_MESH_AGENT, type NodeMeshAgent } from "../../modules/docker/domains/containers/mesh/docker-node-mesh";
import { LOCAL_NODE_OPERATIONS, type LocalNodeOperations } from "../../modules/docker/domains/containers/mesh/local-node-operations";
import { DockerRuntimeMeshRelayService } from "../../modules/docker/common/mesh/docker-runtime-mesh-relay.service";
import { buildNodeRouter, containerIds } from "../../modules/docker/domains/containers/mesh/node-router";

const logger = new Logger("RuntimeMesh");

/**
 * Takes the runtime onto the mesh of its node, if the node has an agent.
 *
 * Without an agent the runtime runs as it always did. With one it is reached like every other service (its contracts,
 * served from its own HTTP surface) and also answers the node router, `mesh.node`, from its own engine, and it announces
 * every container id on the node as a key, so a call about a container reaches the node that owns it. It holds no
 * credential: its agent vouches for the peers that connect.
 */
export function joinRuntimeMesh(app: INestApplication): MeshMembership | undefined {
  const local = app.get<LocalNodeOperations>(LOCAL_NODE_OPERATIONS, { strict: false });
  const relay = app.get(DockerRuntimeMeshRelayService, { strict: false });

  const membership = joinServiceMeshOnNode({
    service: "runtime",
    port: apiServicePort("runtime"),
    server: app.getHttpServer() as Server,
    contracts: [runtimeContract as never],
    extraRouter: { mesh: { node: buildNodeRouter(local, { stream: () => toAsyncIteratorFromObservable(relay.localEvents$()) }) } },
    // An engine that cannot be listed right now must not stop the replica from beating: it announces nothing this round.
    keys: () => containerIds(local).catch(() => []),
    log: (message) => {
      logger.log(message);
    },
  });

  if (membership !== undefined) {
    // From now on the runtime can ask the other nodes through the same link: the docker callers read it from this holder.
    app.get<NodeMeshAgent>(NODE_MESH_AGENT, { strict: false }).link = membership.agent;
  }
  return membership;
}
