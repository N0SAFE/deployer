import { createHash } from "node:crypto";
import { Context } from "effect";

export type LeaseSignerShape = {
	/** A grant a replica can present to a peer, bound to the replica and its expiry. */
	readonly sign: (replicaId: string, expiresAt: number) => string;
};

/**
 * Signs direct grants. Owned by the platform, not by the mesh: every service that hands out a lease needs it, so it is
 * provided once and resolved from above.
 */
export class LeaseSigner extends Context.Service<LeaseSigner, LeaseSignerShape>()("demo/LeaseSigner") {
	static readonly live: LeaseSignerShape = {
		sign: (replicaId, expiresAt) =>
			createHash("sha256").update(`${replicaId}:${expiresAt}`).digest("hex").slice(0, 16),
	};
}
