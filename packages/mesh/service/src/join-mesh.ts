import { Effect, Fiber } from "effect";

import { type ReplicaHeartbeatOptions, openWebSocketConnection, pooledLink, replicaHeartbeat } from "@deployer/mesh-client";
import { type MeshCall, attachMeshWebSocket } from "@deployer/mesh-server";
import { MESH_WEBSOCKET_PATH } from "@deployer/node-agent-contracts";

import type { ClientContext, ClientLink } from "@orpc/client";
import type { Context, Router } from "@orpc/server";
import type { IncomingMessage, Server } from "node:http";




export type JoinMeshOptions<T extends Context> = {
  /** The service's name in the mesh, e.g. `runtime`. */
  readonly service: string;
  /** This replica's id: unique among the replicas of the service, stable for the life of the process. */
  readonly replicaId: string;
  /** The http server the service already runs: the mesh websocket shares its port. */
  readonly server: Server;
  /** The mesh router this service answers: the procedures other services and agents call. */
  readonly router: Router<T>;
  /** The oRPC context of one call, read per call: the upgrade request, and the call's own headers. */
  readonly context: (upgrade: IncomingMessage, call: MeshCall) => T | Promise<T>;
  /**
   * The unix socket of the agent on this node. A service reaches its agent through it, and the file's permissions are
   * the only credential: the service never holds the swarm's secret, and asks the agent whether a peer is trusted.
   */
  readonly agentSocketPath: string;
  /** Where THIS replica's websocket answers on the overlay network: what the agent hands out in grants and resolutions. */
  readonly advertiseUrl: string;
  /** The resources this replica holds right now, read at every beat. */
  readonly keys?: ReplicaHeartbeatOptions["keys"];
  readonly load?: ReplicaHeartbeatOptions["load"];
  readonly heartbeatMs?: number;
  readonly ttlMs?: number;
  /** Told once when the first registration with the agent fails: the service keeps running, but not silently. */
  readonly onRegistrationFailure?: (error: unknown) => void;
};

export type MeshMembership = {
  /**
   * The service's persistent link to its own agent. A service asks the mesh through it: other nodes, other services, the
   * directory. It is the same link the service registers over, so it is open already and shared.
   */
  readonly agent: ClientLink<ClientContext>;
  /** Stops beating, closes the websocket and the link to the agent. The agent forgets the replica when its lease ends. */
  readonly stop: () => Promise<void>;
};

const TRUST_CACHE_MS = 30_000;
/** How long a replica waits for its agent to vouch for a peer before it refuses it. */
const TRUST_TIMEOUT_MS = 2_000;

/**
 * Whether a connecting peer is trusted, decided by the local agent, which alone holds the swarm's credential. A peer the
 * agent vouched for is remembered for a short while, so a busy replica does not ask on every connection, and a failure to
 * reach the agent refuses the peer: unknown is not trusted.
 */
function askAgent(agent: ClientLink<ClientContext>, replicaId: string): (presented: string | undefined) => Promise<boolean> {
  const vouched = new Map<string, number>();
  return async (presented) => {
    if (presented === undefined) {
      return false;
    }
    const until = vouched.get(presented);
    if (until !== undefined && until > Date.now()) {
      return true;
    }
    try {
      const answer = (await Promise.race([
        agent.call(["access", "verify"], { presented, replicaId }, { context: {} }),
        new Promise<never>((_resolve, reject) => setTimeout(() => { reject(new Error("The agent did not answer")); }, TRUST_TIMEOUT_MS).unref()),
      ])) as { ok: boolean };
      if (answer.ok) {
        vouched.set(presented, Date.now() + TRUST_CACHE_MS);
      }
      return answer.ok;
    } catch {
      return false;
    }
  };
}

/**
 * Takes a running service into the mesh: it answers the mesh router on a persistent websocket, and keeps itself
 * registered with the local agent, announcing the resources it holds so calls for them reach it.
 *
 * Two independent halves: the websocket is how others reach this replica, the heartbeat is how they learn it exists. A
 * failed beat is not an error (the agent may be restarting); a replica that stops beating ages out of every directory.
 */
export function joinMesh<T extends Context>(options: JoinMeshOptions<T>): MeshMembership {
  const agent = pooledLink<ClientContext>({
    target: options.agentSocketPath,
    maxConnections: 1,
    multiplex: 16,
    idleMs: 60_000,
    open: () => Promise.resolve(openWebSocketConnection({ url: `ws://agent${MESH_WEBSOCKET_PATH}`, socketPath: options.agentSocketPath, reconnectDelayMs: 250 })),
  });

  const websocket = attachMeshWebSocket({
    server: options.server,
    path: MESH_WEBSOCKET_PATH,
    router: options.router,
    verify: askAgent(agent, options.replicaId),
    context: options.context,
  });

  const heartbeatMs = options.heartbeatMs ?? 5_000;
  const beating = Effect.runFork(
    replicaHeartbeat({
      agent,
      service: options.service,
      replicaId: options.replicaId,
      address: options.advertiseUrl,
      keys: options.keys ?? (() => []),
      load: options.load ?? (() => 0),
      intervalMs: heartbeatMs,
      // Several beats, so one missed beat is not a death.
      ttlMs: options.ttlMs ?? heartbeatMs * 4,
      onRegistrationFailure: options.onRegistrationFailure,
    }),
  );

  return {
    agent,
    async stop() {
      await Effect.runPromise(Fiber.interrupt(beating));
      await agent.closeAll();
      await websocket.close();
    },
  };
}
