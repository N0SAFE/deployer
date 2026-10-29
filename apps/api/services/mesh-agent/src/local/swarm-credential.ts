import { createHash, timingSafeEqual } from "node:crypto";

import { Context, Effect } from "effect";

import { AgentStore, type AgentStoreError } from "./agent-store";

export type SwarmCredentialShape = {
  /** The credential in force right now. Read at every check and every connection, so a join takes effect at once. */
  readonly current: () => string;
  /** The swarm this node belongs to, or `null` while it is standalone. */
  readonly swarmId: () => string | null;
  /** Adopts a swarm's credential: stored first, so a crash between the two never loses it, then in force. */
  readonly install: (secret: string, swarmId: string) => Effect.Effect<void, AgentStoreError, AgentStore>;
  /** Whether a presented credential is the one in force. Constant time, never throws. */
  readonly verify: (presented: string | undefined) => boolean;
};

const digest = (value: string) => createHash("sha256").update(value).digest();

/** The credential cell, starting from what the store holds. */
export function swarmCredentialFrom(initial: { readonly secret: string; readonly swarmId: string | null }): SwarmCredentialShape {
  let secret = initial.secret;
  let swarmId = initial.swarmId;

  return {
    current: () => secret,
    swarmId: () => swarmId,
    install: Effect.fn("SwarmCredential.install")(function* (next: string, nextSwarmId: string) {
      const store = yield* AgentStore;
      yield* store.installCredential(next, nextSwarmId);
      secret = next;
      swarmId = nextSwarmId;
    }),
    verify: (presented) => presented !== undefined && timingSafeEqual(digest(presented), digest(secret)),
  };
}

export class SwarmCredential extends Context.Service<SwarmCredential, SwarmCredentialShape>()("mesh-agent/SwarmCredential") {}
