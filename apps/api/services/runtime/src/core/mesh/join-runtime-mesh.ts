import { existsSync } from "node:fs";
import { hostname } from "node:os";

import { type INestApplication, Logger } from "@nestjs/common";

import { MESH_LOCAL_SOCKET_NAME, MESH_WEBSOCKET_PATH } from "@deployer/mesh-agent-contracts";
import { type MeshMembership, joinMesh } from "@deployer/mesh-service";
import { apiServicePort } from "@deployer/shared/server";

import { LOCAL_NODE_OPERATIONS } from "../../modules/docker/domains/containers/mesh/local-node-operations";
import { NODE_MESH_AGENT, type NodeMeshAgent } from "../../modules/docker/domains/containers/mesh/docker-node-mesh";
import { buildNodeRouter, containerIds } from "../../modules/docker/domains/containers/mesh/node-router";
import { runtimeReplicaId } from "./runtime-replica-id";

import type { LocalNodeOperations } from "../../modules/docker/domains/containers/mesh/local-node-operations";
import type { Server } from "node:http";

/**
 * Where the agent of this node keeps its socket: its data directory is a mount point of the deployment, and the socket
 * is a fixed name inside it. Not node configuration: nothing here says what the node is or which swarm it is in.
 */
const DEFAULT_AGENT_SOCKET = `/var/lib/deployer/mesh-agent/run/${MESH_LOCAL_SOCKET_NAME}`;

const logger = new Logger("RuntimeMesh");

/**
 * Takes the runtime into the mesh of its node, if the node has an agent.
 *
 * Without an agent (a dev run, a node that has not been given one) the runtime simply runs as it always did: the mesh is
 * how services find each other, not a requirement to start. With one, the runtime registers with it, announcing every
 * container id on the node as a key, so a call about a container reaches the node that owns it, and serves the node
 * router on its websocket. It holds no credential: its agent vouches for the peers that connect.
 */
export async function joinRuntimeMesh(app: INestApplication): Promise<MeshMembership | undefined> {
  const socketPath = process.env.MESH_AGENT_SOCKET ?? DEFAULT_AGENT_SOCKET;
  if (!existsSync(socketPath)) {
    logger.log(`No mesh agent at ${socketPath}: the runtime runs without the mesh`);
    return undefined;
  }

  const local = app.get<LocalNodeOperations>(LOCAL_NODE_OPERATIONS, { strict: false });
  const advertiseUrl = process.env.MESH_ADVERTISE_URL ?? `ws://${hostname()}:${String(apiServicePort("runtime"))}${MESH_WEBSOCKET_PATH}`;

  const membership = joinMesh({
    service: "runtime",
    replicaId: runtimeReplicaId(),
    server: app.getHttpServer() as Server,
    router: buildNodeRouter(local) as never,
    context: () => ({}),
    agentSocketPath: socketPath,
    advertiseUrl,
    // An engine that cannot be listed right now must not stop the replica from beating: it announces nothing this round.
    keys: () => containerIds(local).catch(() => []),
  });
  // From now on the runtime can ask the other nodes through the same link: the docker callers read it from this holder.
  app.get<NodeMeshAgent>(NODE_MESH_AGENT, { strict: false }).link = membership.agent;
  logger.log(`The runtime joined the mesh through ${socketPath}, advertised at ${advertiseUrl}`);
  return membership;
}
