/**
 * EdgeStateStore — where an edge provider keeps what it created (tunnel ids, credentials…), replicated to every member.
 *
 * One cluster setting per provider (`edge.<provider id>`), validated by the provider's own schema, so providers never
 * collide and never need a migration of someone else's shape.
 *
 * Credentials stored here (a connector token) replicate to every member: a connector may be scheduled on any node, and
 * members are admitted, WireGuard-encrypted peers — the same trust boundary as the cluster itself. They NEVER travel to a
 * client: providers report `EdgeStatus` facts, not their state.
 */

import { Context, Effect } from "effect";

import { EdgeStateFailure } from "./edge.errors";

import type z from "zod/v4";

import type { ClusterSettings } from "../mesh-node/cluster-settings";

export function edgeStateKey(providerId: string): string {
	return `edge.${providerId}`;
}

export type EdgeStateStoreShape = {
	/** The provider's state, or null when it has none (never provisioned, torn down, malformed). */
	readonly read: <T extends z.ZodType>(providerId: string, schema: T) => Effect.Effect<z.output<T> | null, EdgeStateFailure>;
	/** A write that cannot be stored FAILS: an operator's choice is never silently dropped. */
	readonly write: <T extends z.ZodType>(providerId: string, schema: T, value: z.input<T>) => Effect.Effect<void, EdgeStateFailure>;
	/** Forget the provider's state. Written as `null` so the removal replicates like any write. */
	readonly clear: (providerId: string) => Effect.Effect<void, EdgeStateFailure>;
};

/** The cluster settings are still a Promise-based provider of the mesh-node module, so the store lifts each call. */
export function makeEdgeStateStore(settings: Pick<ClusterSettings, "read" | "write">): EdgeStateStoreShape {
	const lift = <A>(operation: string, run: () => Promise<A>): Effect.Effect<A, EdgeStateFailure> =>
		Effect.tryPromise({ try: run, catch: (cause) => new EdgeStateFailure({ operation, cause }) });

	return {
		read: (providerId, schema) => lift("read", () => settings.read(edgeStateKey(providerId), schema.nullable(), null)),
		write: (providerId, schema, value) =>
			Effect.try({ try: () => schema.parse(value), catch: (cause) => new EdgeStateFailure({ operation: "validated", cause }) }).pipe(
				Effect.flatMap((parsed) => lift("written", () => settings.write(edgeStateKey(providerId), parsed))),
			),
		clear: (providerId) => lift("cleared", () => settings.write(edgeStateKey(providerId), null)),
	};
}

export class EdgeStateStore extends Context.Service<EdgeStateStore, EdgeStateStoreShape>()("shared/EdgeStateStore") {}
