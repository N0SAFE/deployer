
import { ConfigService } from "@nestjs/config";
import { Effect } from "effect";

import { MESH_WEBSOCKET_PATH, meshAgentContract } from "@deployer/mesh-agent-contracts";
import { attachMeshWebSocket, type MeshWebSocket } from "@deployer/mesh-server";
import { EffectRuntime } from "@deployer/nest-effect";
import { MESH_CREDENTIAL_VERIFIER, type MeshCredentialVerifier } from "@deployer/shared/server";

import { type MeshAgentEnv, resolveSeeds } from "../config/mesh-agent.env";
import { MeshDirectoryController } from "../modules/mesh/controllers/mesh-directory.controller";
import { MeshRelayController } from "../modules/mesh/controllers/mesh-relay.controller";
import { MeshRosterController } from "../modules/mesh/controllers/mesh-roster.controller";
import { PendingSeeds } from "../modules/mesh/services/pending-seeds.service";
import { RosterGossip } from "../modules/mesh/services/roster-gossip.service";

import { type GossipLoop, startGossipLoop } from "./gossip-loop";

import type { INestApplication } from "@nestjs/common";
import type { Context, Router } from "@orpc/server";
import type { IncomingMessage } from "node:http";

const DEFAULT_GOSSIP_INTERVAL_MS = 5_000;

export type MeshTransport = {
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
  const directory = await app.resolve(MeshDirectoryController);
  const relay = await app.resolve(MeshRelayController);
  const roster = await app.resolve(MeshRosterController);
  const router = {
    directory: {
      register: directory.register(),
      unregister: directory.unregister(),
      resolve: directory.resolve(),
      snapshot: directory.snapshot(),
    },
    relay: { call: relay.call() },
    roster: { exchange: roster.exchange(), join: roster.join() },
  } satisfies Record<keyof typeof meshAgentContract, unknown>;

  const websocket: MeshWebSocket = attachMeshWebSocket({
    server: app.getHttpServer() as never,
    path: MESH_WEBSOCKET_PATH,
    router: router as unknown as Router<Context>,
    verify,
    context: async (request: IncomingMessage) =>
      ({ request: { headers: request.headers }, "effect/context": await runtime.context() }),
  });

  // Seeds from the environment are only the first ones: `roster.join` adds more at any time.
  for (const address of resolveSeeds({ MESH_AGENT_SECRET: "", MESH_SEEDS: config.get("MESH_SEEDS", { infer: true }) })) {
    await runtime.runPromiseUnwrapped(Effect.flatMap(PendingSeeds, (seeds) => seeds.add(address)));
  }

  const gossip: GossipLoop = startGossipLoop({
    intervalMs: options.gossipIntervalMs ?? DEFAULT_GOSSIP_INTERVAL_MS,
    pending: () => runtime.runPromiseUnwrapped(Effect.flatMap(PendingSeeds, (seeds) => seeds.pending())),
    seed: (address) => runtime.runPromiseUnwrapped(Effect.flatMap(RosterGossip, (g) => g.seed(address))),
    reached: (address) => runtime.runPromiseUnwrapped(Effect.flatMap(PendingSeeds, (seeds) => seeds.reached(address))),
    round: () => runtime.runPromiseUnwrapped(Effect.flatMap(RosterGossip, (g) => g.round())),
  });

  return {
    async stop() {
      gossip.stop();
      await websocket.close();
    },
  };
}
