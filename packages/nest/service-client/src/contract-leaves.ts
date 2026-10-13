/** One procedure found in a contract tree, with the path that reaches it. */
export type ContractLeaf = {
	/** `[]` for a router's own procedure; `["user"]` for `router.user.find`. */
	readonly path: readonly string[];
	/** The last segment — the name the procedure is hoisted under. */
	readonly name: string;
	/** The path joined, for diagnostics (`user.findById`). */
	readonly qualifiedName: string;
}

/**
 * Is `value` a procedure rather than a nested router?
 *
 * ── WHY `~orpc` AND NOT A SHAPE CHECK ───────────────────────────────────────
 * Every oRPC procedure carries its metadata under the `~orpc` key; a router is a
 * plain object of children. Checking for that key uses the library's OWN marker, so
 * it keeps working when a procedure gains internal fields — whereas a hand-rolled
 * "looks callable" check would start misclassifying after any change to the
 * library's internals.
 *
 * Verified against the installed library: a router of two procedures reports
 * `keys=[ping, findById]`, and each child reports `keys=[~orpc]`.
 */
export function isProcedure(value: unknown): boolean {
	// ── WHY BOTH `object` AND `function` ────────────────────────────────────────
	// A procedure is whatever the library marks with `~orpc`, and that includes
	// callables: a bound client's leaf is a function, while the contract's own node is
	// a plain object. Accepting only `object` silently walked PAST every function-shaped
	// parent — which is how the package's own test caught this, with a walk that
	// returned nothing on a contract that plainly had procedures in it.
	if (typeof value !== "object" && typeof value !== "function") return false;
	if (value === null) return false;
	return "~orpc" in (value as Record<string, unknown>);
}

/**
 * Every procedure in `contract`, depth-first, with the path that reaches it.
 *
 * ── WHY THE CONTRACT AND NOT THE CLIENT ─────────────────────────────────────
 * The client an oRPC link produces is a Proxy: `Object.keys(client)` is `[]` and
 * `typeof client` is `"function"`, yet `client.user.findById` resolves. There is
 * therefore nothing on the client to enumerate — the CONTRACT is the only thing
 * that knows which procedures exist, and the client is how each one is reached once
 * the contract has named it.
 */
export function collectContractLeaves(
	contract: unknown,
	path: readonly string[] = [],
): ContractLeaf[] {
	if (contract === null || typeof contract !== "object") return [];

	const leaves: ContractLeaf[] = [];
	for (const [key, child] of Object.entries(contract)) {
		// The library's own metadata on a procedure object — not a child.
		if (key === "~orpc") continue;

		if (isProcedure(child)) {
			leaves.push({ path, name: key, qualifiedName: [...path, key].join(".") });
		} else if (typeof child === "object" && child !== null) {
			leaves.push(...collectContractLeaves(child, [...path, key]));
		}
	}
	return leaves;
}

/** Follows `path` down the client and returns what it finds, or undefined. */
export function resolveAtPath(client: unknown, path: readonly string[]): unknown {
	let current: unknown = client;
	for (const segment of path) {
		if (current === null || current === undefined) return undefined;
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}
