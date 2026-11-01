import { randomUUID } from "node:crypto";

import { Context, Effect } from "effect";

import { AgentStore, type AgentStoreError } from "../../../local/agent-store";
import { decodeJoinToken, encodeJoinToken } from "../../../local/join-token";
import { SwarmCredential } from "../../../local/swarm-credential";
import { MeshJoinRejected } from "../mesh.errors";

import { MeshClock } from "./mesh-clock.service";
import { AdvertisedAddress, GossipSettings, RosterGossip, type SeedResult } from "./roster-gossip.service";

import type { AgentLinkFactory } from "./agent-link-factory.service";
import type { MeshDirectory } from "./directory.service";
import type { NodeAgents } from "./node-agents.service";
import type { NodeIdentity } from "./node-identity.service";
import type { PendingSeeds } from "./pending-seeds.service";
import type { NodeLabels } from "../../node/services/node-labels.service";
import type { MeshDirectoryRepository } from "../repositories/directory.repository";

type Deps =
  | AgentStore
  | SwarmCredential
  | MeshClock
  | AdvertisedAddress
  | RosterGossip
  | GossipSettings
  | PendingSeeds
  | MeshDirectory
  | NodeAgents
  | NodeIdentity
  | AgentLinkFactory
  | MeshDirectoryRepository
  | NodeLabels;

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
  readonly check: (token: string) => Effect.Effect<boolean, never, SwarmCredential | MeshClock | AgentStore>;
  readonly redeem: (token: string) => Effect.Effect<SeedResult & { readonly swarmId: string }, MeshJoinRejected | AgentStoreError, Deps>;
  /** Revokes a token before it expires: the operator has the token, so the token itself is the key. */
  readonly revoke: (token: string) => Effect.Effect<{ readonly revoked: boolean }, AgentStoreError, AgentStore>;
};

export class JoinTokens extends Context.Service<JoinTokens, JoinTokensShape>()("node-agent/JoinTokens") {
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
      return {
        token: encodeJoinToken({ jti: randomUUID(), address: advertised.address, secret: credential.current(), swarmId, expiresAt }),
        expiresAt,
      };
    }),

    check: Effect.fn("JoinTokens.check")(function* (encoded: string) {
      const credential = yield* SwarmCredential;
      const clock = yield* MeshClock;
      const store = yield* AgentStore;
      const decoded = decodeJoinToken(encoded, clock.now());
      // `verify` is grace-aware: a token minted before a rotation still passes on the secret it carries until the
      // window closes, and fails closed after it.
      const good = decoded.ok && credential.verify(decoded.token.secret) && decoded.token.swarmId === credential.swarmId();
      if (!good) return false;

      // Fail closed: if the revocation list cannot be read, a token is not accepted.
      const revoked = yield* store.isTokenRevoked(encoded).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            console.warn(`[node-agent] could not read the revoked-token list: ${error.operation}`);
            return true;
          }),
        ),
      );
      return !revoked;
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

      if (yield* store.isTokenRevoked(encoded)) {
        return yield* new MeshJoinRejected({ reason: "revoked" });
      }

      yield* credential.install(secret, swarmId);
      yield* store.addSeed(address);
      const result = yield* (yield* RosterGossip).join(address);
      return { reached: result.reached, learned: result.learned, swarmId };
    }),

    revoke: Effect.fn("JoinTokens.revoke")(function* (encoded: string) {
      const store = yield* AgentStore;
      yield* store.revokeToken(encoded);
      return { revoked: true };
    }),
  };
}
