import type { ContractRouterClient, RouterContract } from "@orpc/contract";

/** A callable member of a client — an oRPC procedure, or a nested router. */
type Procedure = (...args: never[]) => unknown;

/** Turns a union of records into one record (the standard TS idiom). */
type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (
	k: infer I,
) => void
	? I
	: never;

/** `3 -> 2 -> 1 -> 0 -> never`, so the recursion below has a hard floor. */
type Prev<N extends number> = N extends 0
	? never
	: N extends 1
		? 0
		: N extends 2
			? 1
			: N extends 3
				? 2
				: 0;

/**
 * Every callable reachable from `T`, re-keyed by its LAST path segment.
 *
 * ── WHY THIS IS BOUNDED AND NOT "INFINITELY RECURSIVE" ──────────────────────
 * These contracts are large (identity alone declares ~20 procedures across three
 * routers) and TypeScript has already failed us once on their inferred size
 * (TS7056 in `packages/contracts/bff`). An unbounded mapped type over a router this
 * wide is how a build goes from seconds to minutes, so the depth is capped at 3 —
 * which covers every shape the platform has:
 *
 *     identityContract.find             depth 1  (a top-level procedure)
 *     identityContract.user.find        depth 2  (router -> procedure)
 *     serviceContract.crud.findById     depth 3  (router -> router -> procedure)
 *
 * A deeper contract still works at RUNTIME; only the type-level root alias would be
 * missing, and the namespaced path is always available.
 */
export type FlatLeaves<T, Depth extends number = 3> = UnionToIntersection<
	{
		[K in keyof T]: T[K] extends Procedure
			? { [P in K]: T[K] }
			: Depth extends 0
				? never
				: T[K] extends object
					? FlatLeaves<T[K], Prev<Depth>>
					: never;
	}[keyof T]
>;

/**
 * What a bound service client looks like: the real tree, the flattened procedures,
 * and the unprefixed client.
 *
 * ── WHY ALL THREE ───────────────────────────────────────────────────────────
 * The namespaced path (`identity.user.findById`) is unambiguous and is what you
 * reach for when a name collides; the flattened name (`identity.findById`) is the
 * short form this package exists to provide; `raw` is the escape hatch for the case
 * where a collision cannot be resolved by either.
 *
 * ── WHY A COLLIDING NAME IS AN INTERSECTION, NOT A WINNER ───────────────────
 * `list` exists on several routers, so `identity.list` is typed as the INTERSECTION
 * of those signatures. If they are compatible it is callable; if not, TypeScript
 * refuses the root call and points at the namespaced path. Picking a silent winner
 * (first or last) would run the wrong procedure with no diagnostic — the failure
 * this design avoids.
 */
export type ServiceClient<T extends RouterContract> = ContractRouterClient<T> &
	FlatLeaves<ContractRouterClient<T>> & {
		/** The unprefixed client, for when a name collides at the root. */
		readonly raw: ContractRouterClient<T>;
	};

/**
 * What an addressable service looks like from the outside.
 *
 * ── WHY THIS IS AN INTERFACE AND NOT THE CONCRETE REGISTRY ──────────────────
 * A client needs exactly one thing from the application: "give me a bound client for
 * this service and contract". Depending on the concrete registry would make every
 * client — and every package that holds one — transitively depend on the registry's
 * transport choices (oRPC link, header injection, caching), none of which a client
 * should know about. This is the seam that keeps that dependency one-way.
 */
export type ServiceClientBinder = {
	/** The bound client for `service`, driven by `contract`. */
	bind<T extends RouterContract>(service: string, contract: T): ServiceClient<T>;
}
