import { MESH_LOCAL_SOCKET_NAME, MESH_WEBSOCKET_PATH } from "@deployer/mesh-agent-contracts";

import { contractId } from "./contract-id";
import { grantFollowingLink } from "./grant-link";
import { type PooledLink, pooledLink } from "./pooled-link";
import { relayLink } from "./relay-link";
import { openWebSocketConnection } from "./websocket-link";

import { existsSync } from "node:fs";

import type { ClientContext, ClientLink } from "@orpc/client";

/**
 * Where the agent of a node keeps its socket: its data directory is a mount point of the deployment, and the socket is a
 * fixed name inside it. Not node configuration: nothing here says what the node is or which swarm it is in.
 */
export const DEFAULT_AGENT_SOCKET = `/var/lib/deployer/mesh-agent/run/${MESH_LOCAL_SOCKET_NAME}`;

/** The persistent, pooled link to this node's agent over its unix socket. Lazy: nothing connects until the first call. */
export function agentLink(socketPath: string): PooledLink<ClientContext> {
  return pooledLink<ClientContext>({
    target: socketPath,
    maxConnections: 2,
    multiplex: 64,
    idleMs: 60_000,
    open: () => Promise.resolve(openWebSocketConnection({ url: `ws://agent${MESH_WEBSOCKET_PATH}`, socketPath, reconnectDelayMs: 250 })),
  });
}

/**
 * The link to the agent of the node this process runs on, or `undefined` when the node has none.
 *
 * `MESH_AGENT_SOCKET` is where the deployment mounted the agent's socket, not a node setting. Without an agent a process
 * reaches its peers directly, which is how a node works alone before it is part of anything.
 */
export function nodeAgentLink(env: Readonly<Record<string, string | undefined>> = process.env): PooledLink<ClientContext> | undefined {
  const socketPath = env.MESH_AGENT_SOCKET ?? DEFAULT_AGENT_SOCKET;
  return existsSync(socketPath) ? agentLink(socketPath) : undefined;
}

export type ServiceLinkOptions = {
  /** The link to this node's agent. */
  readonly agent: ClientLink<ClientContext>;
  /** The service the calls are for. The caller never names a replica. */
  readonly service: string;
  /** The contract the client is bound to: its id prefixes every path, so the service knows which of its contracts a call is for. */
  readonly contract: unknown;
  /** The caller's credentials, read at every call. */
  readonly headers?: () => Readonly<Record<string, string>>;
};

/**
 * The link a service client uses to reach another service through the mesh.
 *
 * Every call goes to the local agent as a relayed call for the service; the agent picks the replica, answers any redirect
 * itself and carries the answer back. When the agent would rather not carry the bytes it answers with a grant, which this
 * link follows by opening a pooled link straight to the replica. The caller's credentials ride along on each call, so the
 * service authenticates the caller exactly as if it had been called directly.
 */
export function serviceLink<C extends ClientContext>(options: ServiceLinkOptions): ClientLink<C> {
  const id = contractId(options.contract);
  const relayed = relayLink({ agent: options.agent, target: { service: options.service }, headers: options.headers });
  const prefixed: ClientLink<C> = { call: (path, input, callOptions) => relayed.call([id, ...path], input, callOptions) };

  const followed = grantFollowingLink<C>({
    agent: prefixed,
    direct: (grant) =>
      pooledLink<C>({
        target: grant.replicaId,
        maxConnections: 2,
        multiplex: 64,
        idleMs: 60_000,
        open: () =>
          Promise.resolve(openWebSocketConnection<C>({ url: `${grant.address}?credential=${encodeURIComponent(grant.token)}`, reconnectDelayMs: 250 })),
      }),
  });
  // The grant follower replays the call it was given on the replica, which serves the same prefixed path.
  return followed;
}
