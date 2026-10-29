import { randomUUID } from "node:crypto";

import { Context, Effect } from "effect";

import { AgentStore, type AgentStoreError } from "../../../local/agent-store";
import { decodeJoinToken, encodeJoinToken } from "../../../local/join-token";
import { SwarmCredential } from "../../../local/swarm-credential";
import { MeshJoinRejected } from "../mesh.errors";

import { MeshClock } from "./mesh-clock.service";
import { AdvertisedAddress, RosterGossip, type SeedResult } from "./roster-gossip.service";

import type { AgentLinkFactory } from "./agent-link-factory.service";
import type { MeshDirectory } from "./directory.service";
import type { NodeAgents } from "./node-agents.service";
import type { NodeIdentity } from "./node-identity.service";
import type { PendingSeeds } from "./pending-seeds.service";
import type { MeshDirectoryRepository } from "../repositories/directory.repository";

type Deps =
  | AgentStore
  | SwarmCredential
  | MeshClock
  | AdvertisedAddress
  | RosterGossip
  | PendingSeeds
  | MeshDirectory
  | NodeAgents
  | NodeIdentity
  | AgentLinkFactory
  | MeshDirectoryRepository;

export type JoinTokensShape = {
  /**
   * A token a new node redeems to join this agent's swarm. A standalone agent becomes the first node of a new swarm by
   * issuing one: its own credential becomes the swarm's, under a fresh swarm id.
   */
  readonly issue: (ttlMs: number) => Effect.Effect<{ readonly token: string; readonly expiresAt: number }, AgentStoreError, Deps>;
  /**
   * Joins the swarm a token names: adopts its credential, remembers its seed so the node rejoins after a restart, and
   * gossips with it at once. The credential is installed before the first connection, so that connection already
   * carries it.
   */
  /** Whether `token` was issued by this agent's swarm and is still good. Never reveals the credential. */
  readonly check: (token: string) => Effect.Effect<boolean, never, SwarmCredential | MeshClock>;
  readonly redeem: (token: string) => Effect.Effect<SeedResult & { readonly swarmId: string }, MeshJoinRejected | AgentStoreError, Deps>;
};

export class JoinTokens extends Context.Service<JoinTokens, JoinTokensShape>()("mesh-agent/JoinTokens") {
  static readonly live: JoinTokensShape = {
    issue: Effect.fn("JoinTokens.issue")(function* (ttlMs: number) {
      const credential = yield* SwarmCredential;
      const clock = yield* MeshClock;
      const advertised = yield* AdvertisedAddress;

      let swarmId = credential.swarmId();
      if (swarmId === null) {
        swarmId = `swarm-${randomUUID()}`;
        yield* credential.install(credential.current(), swarmId);
      }
      const expiresAt = clock.now() + ttlMs;
      return { token: encodeJoinToken({ address: advertised.address, secret: credential.current(), swarmId, expiresAt }), expiresAt };
    }),

    check: Effect.fn("JoinTokens.check")(function* (encoded: string) {
      const credential = yield* SwarmCredential;
      const clock = yield* MeshClock;
      const decoded = decodeJoinToken(encoded, clock.now());
      return decoded.ok && decoded.token.secret === credential.current() && decoded.token.swarmId === credential.swarmId();
    }),

    redeem: Effect.fn("JoinTokens.redeem")(function* (encoded: string) {
      const clock = yield* MeshClock;
      const decoded = decodeJoinToken(encoded, clock.now());
      if (!decoded.ok) {
        return yield* new MeshJoinRejected({ reason: decoded.reason });
      }

      const { address, secret, swarmId } = decoded.token;
      const credential = yield* SwarmCredential;
      const store = yield* AgentStore;

      yield* credential.install(secret, swarmId);
      yield* store.addSeed(address);
      const result = yield* (yield* RosterGossip).join(address);
      return { reached: result.reached, learned: result.learned, swarmId };
    }),
  };
}
