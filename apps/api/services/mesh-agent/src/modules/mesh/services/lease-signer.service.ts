import { Context, Effect } from "effect";

import type { MeshDirectGrant } from "@deployer/mesh-agent-contracts";

import { signLease } from "../rules/lease-token";

import { MeshClock } from "./mesh-clock.service";

import type { ReplicaRecord } from "../rules/replica-record";

export type LeaseSignerShape = {
  /** A short-lived grant for a direct link to `replica`, signed so the replica can check it. */
  readonly issue: (replica: ReplicaRecord) => Effect.Effect<MeshDirectGrant, never, MeshClock>;
};

/** Signer over a secret and a lifetime, both from the environment. */
export function leaseSignerOver(options: { readonly secret: string; readonly ttlMs: number }): LeaseSignerShape {
  return {
    issue: Effect.fn("LeaseSigner.issue")(function* (replica: ReplicaRecord) {
      const clock = yield* MeshClock;
      const expiresAt = clock.now() + options.ttlMs;
      return {
        replicaId: replica.replicaId,
        address: replica.address,
        // The caller is a mesh peer authenticated by the shared credential, so the grant names the replica and the
        // expiry and nothing about who asked: the credential is what limits who can present it.
        token: signLease({ replicaId: replica.replicaId, callerId: "mesh-peer", expiresAt }, options.secret),
        expiresAt,
      };
    }),
  };
}

export class LeaseSigner extends Context.Service<LeaseSigner, LeaseSignerShape>()("mesh-agent/LeaseSigner") {}
