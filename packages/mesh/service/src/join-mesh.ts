import { Effect, Fiber } from "effect";

import { MESH_WEBSOCKET_PATH } from "@deployer/mesh-agent-contracts";
import { type ReplicaHeartbeatOptions, openWebSocketConnection, pooledLink, replicaHeartbeat } from "@deployer/mesh-client";
import { attachMeshWebSocket, credentialVerifier } from "@deployer/mesh-server";

import type { ClientContext } from "@orpc/client";
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
  /** The oRPC context of one call, read per call. */
  readonly context: (request: IncomingMessage) => T | Promise<T>;
  /** The shared mesh credential. */
  readonly secret: string;
  /** Where the local agent's websocket answers, e.g. `ws://127.0.0.1:3106/mesh/ws`. */
  readonly agentUrl: string;
  /** Where THIS replica's websocket answers on the overlay network: what the agent hands out in grants and resolutions. */
  readonly advertiseUrl: string;
  /** The resources this replica holds right now, read at every beat. */
  readonly keys?: ReplicaHeartbeatOptions["keys"];
  readonly load?: ReplicaHeartbeatOptions["load"];
  readonly heartbeatMs?: number;
  readonly ttlMs?: number;
};

export type MeshMembership = {
  /** Stops beating, closes the websocket and the link to the agent. The agent forgets the replica when its lease ends. */
  readonly stop: () => Promise<void>;
};

/**
 * Takes a running service into the mesh: it answers the mesh router on a persistent websocket, and keeps itself
 * registered with the local agent, announcing the resources it holds so calls for them reach it.
 *
 * Two independent halves: the websocket is how others reach this replica, the heartbeat is how they learn it exists. A
 * failed beat is not an error (the agent may be restarting); a replica that stops beating ages out of every directory.
 */
export function joinMesh<T extends Context>(options: JoinMeshOptions<T>): MeshMembership {
  const websocket = attachMeshWebSocket({
    server: options.server,
    path: MESH_WEBSOCKET_PATH,
    router: options.router,
    verify: credentialVerifier(options.secret),
    context: options.context,
  });

  const agent = pooledLink<ClientContext>({
    target: options.agentUrl,
    maxConnections: 1,
    multiplex: 16,
    idleMs: 60_000,
    open: () => Promise.resolve(openWebSocketConnection({ url: `${options.agentUrl}?credential=${encodeURIComponent(options.secret)}` })),
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
    }),
  );

  return {
    async stop() {
      await Effect.runPromise(Fiber.interrupt(beating));
      await agent.closeAll();
      await websocket.close();
    },
  };
}
