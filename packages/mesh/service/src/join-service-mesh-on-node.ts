import { existsSync } from "node:fs";
import { hostname } from "node:os";

import { MESH_WEBSOCKET_PATH } from "@deployer/mesh-agent-contracts";
import { DEFAULT_AGENT_SOCKET } from "@deployer/mesh-client";

import { type JoinServiceMeshOptions, joinServiceMesh } from "./join-service-mesh";

import type { MeshMembership } from "./join-mesh";
import type { RouterContract } from "@orpc/contract";
import type { Server } from "node:http";

export type JoinOnNodeOptions = {
  readonly service: string;
  /** The port the service's HTTP surface answers on: the mesh websocket shares it, and the loopback calls it. */
  readonly port: number;
  readonly server: Server;
  readonly contracts: readonly RouterContract[];
  readonly extraRouter?: JoinServiceMeshOptions["extraRouter"];
  readonly keys?: JoinServiceMeshOptions["keys"];
  readonly load?: JoinServiceMeshOptions["load"];
  readonly heartbeatMs?: JoinServiceMeshOptions["heartbeatMs"];
  /** The environment the service runs in, for the deployment's own facts. Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly log?: (message: string) => void;
};

/**
 * Takes a service onto the mesh of its node, if the node has an agent.
 *
 * Without an agent (a dev run, a node that was not given one) the service runs exactly as it always did and is reached
 * directly: the mesh is how services find each other, not a requirement to start. With one, the service registers with it,
 * serves its contracts over its websocket, and from then on its callers reach it through their own agents.
 *
 * `MESH_AGENT_SOCKET` and `MESH_ADVERTISE_URL` are deployment facts (where the agent's socket is mounted, which address the
 * overlay network knows this host by), not node configuration, and both have a default.
 */
export function joinServiceMeshOnNode(options: JoinOnNodeOptions): MeshMembership | undefined {
  const env = options.env ?? process.env;
  const log = options.log ?? ((message: string) => { console.log(message); });
  const socketPath = env.MESH_AGENT_SOCKET ?? DEFAULT_AGENT_SOCKET;
  if (!existsSync(socketPath)) {
    log(`[${options.service}] No mesh agent at ${socketPath}: running without the mesh`);
    return undefined;
  }

  const advertiseUrl = env.MESH_ADVERTISE_URL ?? `ws://${hostname()}:${String(options.port)}${MESH_WEBSOCKET_PATH}`;
  const membership = joinServiceMesh({
    service: options.service,
    replicaId: `${options.service}-${hostname()}`,
    server: options.server,
    contracts: options.contracts,
    loopbackOrigin: `http://127.0.0.1:${String(options.port)}`,
    agentSocketPath: socketPath,
    advertiseUrl,
    extraRouter: options.extraRouter,
    keys: options.keys,
    load: options.load,
    heartbeatMs: options.heartbeatMs,
  });
  log(`[${options.service}] Joined the mesh through ${socketPath}, advertised at ${advertiseUrl}`);
  return membership;
}
