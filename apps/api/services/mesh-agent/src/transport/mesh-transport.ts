
import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { dirname, join } from "node:path";

import { type INestApplication, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Effect } from "effect";

import { MESH_LOCAL_SOCKET_NAME, MESH_WEBSOCKET_PATH, meshAgentContract } from "@deployer/mesh-agent-contracts";
import { attachMeshWebSocket, type MeshWebSocket } from "@deployer/mesh-server";
import { EffectRuntime } from "@deployer/nest-effect";
import { MESH_CREDENTIAL_VERIFIER, type MeshCredentialVerifier } from "@deployer/shared/server";

import { type MeshAgentEnv, resolveDataDir, resolveSeeds } from "../config/mesh-agent.env";
import { AgentStore } from "../local/agent-store";
import { MeshAccessController } from "../modules/mesh/controllers/mesh-access.controller";
import { MeshDirectoryController } from "../modules/mesh/controllers/mesh-directory.controller";
import { MeshRelayController } from "../modules/mesh/controllers/mesh-relay.controller";
import { MeshRosterController } from "../modules/mesh/controllers/mesh-roster.controller";
import { PendingSeeds } from "../modules/mesh/services/pending-seeds.service";
import { RosterGossip } from "../modules/mesh/services/roster-gossip.service";

import { type GossipLoop, startGossipLoop } from "./gossip-loop";

import type { Context, Router } from "@orpc/server";

const DEFAULT_GOSSIP_INTERVAL_MS = 5_000;

const logger = new Logger("MeshTransport");

export type MeshTransport = {
  /** The unix socket the services of this node reach the agent through. */
  readonly localSocketPath: string;
  readonly stop: () => Promise<void>;
};

/**
 * What an agent does once its HTTP port is bound: serve the mesh over a persistent websocket, and keep its view of the
 * other agents and of every replica fresh by gossip.
 *
 * It reuses the controllers' own procedures as the websocket's router, so the HTTP surface and the websocket surface
 * cannot drift: one implementation answers both. The oRPC context is read per call from the Effect runtime, so a call on
 * a connection that lives for hours still sees the services of the moment.
 */
export async function startMeshTransport(app: INestApplication, options: { readonly gossipIntervalMs?: number } = {}): Promise<MeshTransport> {
  const runtime = app.get(EffectRuntime);
  const config = app.get<ConfigService<MeshAgentEnv, true>>(ConfigService);
  const verify = app.get<MeshCredentialVerifier>(MESH_CREDENTIAL_VERIFIER);

  // The controllers are request-scoped (the oRPC host injects the request), so `get` refuses them. They hold no state:
  // each procedure is a pure description built from the Effect context of the call, so one instance serves every call.
  const access = await app.resolve(MeshAccessController);
  const directory = await app.resolve(MeshDirectoryController);
  const relay = await app.resolve(MeshRelayController);
  const roster = await app.resolve(MeshRosterController);
  const router = {
    access: { verify: access.verify() },
    directory: {
      register: directory.register(),
      unregister: directory.unregister(),
      resolve: directory.resolve(),
      snapshot: directory.snapshot(),
    },
    relay: { call: relay.call() },
    roster: { exchange: roster.exchange(), join: roster.join(), token: roster.token() },
  } satisfies Record<keyof typeof meshAgentContract, unknown>;

  const serve = (server: Server, trusted: MeshCredentialVerifier) =>
    attachMeshWebSocket({
      server,
      path: MESH_WEBSOCKET_PATH,
      router: router as unknown as Router<Context>,
      verify: trusted,
      context: async (request: IncomingMessage) =>
        ({ request: { headers: request.headers }, "effect/context": await runtime.context() }),
    });

  // The mesh, for other agents: on the service's own port, behind the swarm's credential.
  const websocket: MeshWebSocket = serve(app.getHttpServer() as Server, verify);

  // The node, for its own services: a unix socket, behind nothing but the file's permissions. A service on the node
  // reaches its agent here and never holds the swarm's credential, so there is nothing in it to leak or to rotate.
  const localSocketPath = join(resolveDataDir({ MESH_DATA_DIR: config.get("MESH_DATA_DIR", { infer: true }) }), "run", MESH_LOCAL_SOCKET_NAME);
  mkdirSync(dirname(localSocketPath), { recursive: true, mode: 0o755 });
  rmSync(localSocketPath, { force: true });
  const localServer = createServer((_request, response) => response.writeHead(404).end());
  const localWebsocket = serve(localServer, () => true);
  await new Promise<void>((resolve, reject) => {
    localServer.once("error", reject);
    localServer.listen(localSocketPath, resolve);
  });
  chmodSync(localSocketPath, 0o660);

  // A node that joined a swarm rejoins by itself: the seeds it was given are kept in its store. The environment can add
  // more (dev only), and `roster.join` adds one at any time.
  const remembered = await runtime.runPromiseUnwrapped(Effect.flatMap(AgentStore, (store) => store.seeds()));
  for (const address of [...remembered, ...resolveSeeds({ MESH_SEEDS: config.get("MESH_SEEDS", { infer: true }) })]) {
    await runtime.runPromiseUnwrapped(Effect.flatMap(PendingSeeds, (seeds) => seeds.add(address)));
  }

  const gossip: GossipLoop = startGossipLoop({
    intervalMs: options.gossipIntervalMs ?? DEFAULT_GOSSIP_INTERVAL_MS,
    onError: (error) => { logger.warn(`Gossip round failed: ${error instanceof Error ? error.message : String(error)}`); },
    pending: () => runtime.runPromiseUnwrapped(Effect.flatMap(PendingSeeds, (seeds) => seeds.pending())),
    seed: (address) => runtime.runPromiseUnwrapped(Effect.flatMap(RosterGossip, (g) => g.seed(address))),
    reached: (address) => runtime.runPromiseUnwrapped(Effect.flatMap(PendingSeeds, (seeds) => seeds.reached(address))),
    round: () => runtime.runPromiseUnwrapped(Effect.flatMap(RosterGossip, (g) => g.round())),
  });

  return {
    localSocketPath,
    async stop() {
      gossip.stop();
      await Promise.all([websocket.close(), localWebsocket.close()]);
      await new Promise<void>((resolve) => localServer.close(() => { resolve(); }));
      rmSync(localSocketPath, { force: true });
    },
  };
}
