import { randomBytes } from "node:crypto";

import { Context, Effect } from "effect";

import { credentialVerifier } from "@deployer/mesh-server";

import { AgentStore, type AgentStoreError } from "./agent-store";

/** How long the secret a rotation replaces is still accepted: long enough for every peer to learn the new one. */
export const ROTATION_GRACE_MS = 24 * 60 * 60 * 1_000;

export type Rotation = { readonly secret: string; readonly validUntil: number; readonly epoch: number };

export type SwarmCredentialShape = {
  /** The credential in force right now. Read at every check and every connection, so a join takes effect at once. */
  readonly current: () => string;
  /** The swarm this node belongs to, or `null` while it is standalone. */
  readonly swarmId: () => string | null;
  /** When the current secret was installed: the rotation epoch, so an older rotation never wins. */
  readonly epoch: () => number;
  /** The secret this one replaced, accepted until `previousValidUntil`. Null outside a rotation. */
  readonly previous: () => string | null;
  /** Until when the previous secret is accepted (epoch ms), or 0 when there is none. */
  readonly validUntil: () => number;
  /** Adopts a swarm's credential: stored first, so a crash between the two never loses it, then in force. */
  readonly install: (secret: string, swarmId: string) => Effect.Effect<void, AgentStoreError, AgentStore>;
  /** Whether a presented credential is the one in force, or the one being rotated out inside its grace window. */
  readonly verify: (presented: string | undefined) => boolean;
  /** Rotates: a fresh 32-byte secret, a `ROTATION_GRACE_MS` window for the old one, both stored then in force. */
  readonly rotate: () => Effect.Effect<Rotation, AgentStoreError, AgentStore>;
  /** Rotates to a secret minted elsewhere: the originator broadcasts before installing, so every peer gets the same. */
  readonly rotateTo: (secret: string, validUntil: number, epoch: number) => Effect.Effect<Rotation, AgentStoreError, AgentStore>;
  /** Takes in a rotation learned from a peer. An epoch at or below the current one is stale and changes nothing. */
  readonly adopt: (secret: string, validUntil: number, epoch: number) => Effect.Effect<void, AgentStoreError, AgentStore>;
};

/** The credential cell, starting from what the store holds. */
export function swarmCredentialFrom(initial: {
  readonly secret: string;
  readonly swarmId: string | null;
  readonly installedAt?: number;
  readonly previousSecret?: string | null;
  readonly previousValidUntil?: number | null;
}): SwarmCredentialShape {
  let secret = initial.secret;
  let swarmId = initial.swarmId;
  let installedAt = initial.installedAt ?? 0;
  let previousSecret = initial.previousSecret ?? null;
  let previousValidUntil = initial.previousValidUntil ?? 0;

  /** Reads back the row just written: the store's clock is the one the epoch is stamped with. */
  const replace = Effect.fn("SwarmCredential.replace")(function* (next: string, expiresAt: number, epoch?: number) {
    const store = yield* AgentStore;
    // The old secret is the one this cell held, which is what `verify` compares against; the row may hold a different
    // one when the deployment pinned the credential (dev) and never persisted it.
    yield* store.rotateCredential(next, expiresAt, epoch, secret);
    const stored = yield* store.credential();
    secret = stored.secret;
    previousSecret = stored.previousSecret;
    previousValidUntil = stored.previousValidUntil ?? 0;
    installedAt = stored.installedAt;
    return { secret, validUntil: previousValidUntil, epoch: installedAt } satisfies Rotation;
  });

  return {
    current: () => secret,
    swarmId: () => swarmId,
    epoch: () => installedAt,
    previous: () => previousSecret,
    validUntil: () => previousValidUntil,

    install: Effect.fn("SwarmCredential.install")(function* (next: string, nextSwarmId: string) {
      const store = yield* AgentStore;
      yield* store.installCredential(next, nextSwarmId);
      secret = next;
      swarmId = nextSwarmId;
      previousSecret = null;
      previousValidUntil = 0;
      installedAt = (yield* store.credential()).installedAt;
    }),

    // Never throws and always compares, so the answer is the only thing a caller learns.
    verify: (presented) => {
      if (credentialVerifier(secret)(presented)) return true;
      return previousSecret !== null && Date.now() < previousValidUntil && credentialVerifier(previousSecret)(presented);
    },

    rotate: Effect.fn("SwarmCredential.rotate")(function* () {
      const validUntil = Date.now() + ROTATION_GRACE_MS;
      return yield* replace(randomBytes(32).toString("base64url"), validUntil);
    }),

    rotateTo: Effect.fn("SwarmCredential.rotateTo")(function* (next: string, expiresAt: number, epoch: number) {
      return yield* replace(next, expiresAt, epoch);
    }),

    adopt: Effect.fn("SwarmCredential.adopt")(function* (next: string, expiresAt: number, epoch: number) {
      if (epoch <= installedAt) return;
      yield* replace(next, expiresAt, epoch);
    }),
  };
}

export class SwarmCredential extends Context.Service<SwarmCredential, SwarmCredentialShape>()("node-agent/SwarmCredential") {}
