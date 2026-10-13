import { describe, expect, it } from "vitest";

import { collectContractLeaves, isProcedure, resolveAtPath } from "../contract-leaves";

/**
 * A two-level router, which is the shape every service contract has: a namespace
 * (`user`) holding procedures, plus a procedure at the top level.
 *
 * Real contracts come from `oc.router(...)`, which is not available in this package
 * (it deliberately depends on `@orpc/contract` but not on the repo's builder). These
 * tests exercise the WALK, so what they need is the library's own `~orpc` marker,
 * which is exactly what `isProcedure` keys on.
 */
const procedure = { "~orpc": { route: { path: "/x", method: "GET" } } };
const contract = {
	user: { find: procedure, list: procedure },
	analytics: { deep: { getApiUsage: procedure } },
	topLevel: procedure,
};

describe("contract-leaves", () => {
	describe("isProcedure", () => {
		it("recognises a procedure by the library's own marker", () => {
			expect(isProcedure(procedure)).toBe(true);
		});

		it("rejects a router, even though it is also an object", () => {
			expect(isProcedure({ user: procedure })).toBe(false);
		});

		it("rejects primitives and null without throwing", () => {
			expect(isProcedure(null)).toBe(false);
			expect(isProcedure(undefined)).toBe(false);
			expect(isProcedure("string")).toBe(false);
			expect(isProcedure(42)).toBe(false);
		});
	});

	describe("collectContractLeaves", () => {
		it("finds every procedure and records the path that reaches it", () => {
			const leaves = collectContractLeaves(contract);

			const byName = Object.fromEntries(leaves.map((l) => [l.qualifiedName, l.name]));
			expect(byName).toEqual({
				"user.find": "find",
				"user.list": "list",
				"analytics.deep.getApiUsage": "getApiUsage",
				topLevel: "topLevel",
			});
		});

		it("records the path separately from the name", () => {
			const deep = collectContractLeaves(contract).find(
				(l) => l.qualifiedName === "analytics.deep.getApiUsage",
			);

			// The name is the LAST segment; the path is everything before it. This split
			// is what lets the client define the short alias while still resolving the
			// procedure through its real route.
			expect(deep?.name).toBe("getApiUsage");
			expect(deep?.path).toEqual(["analytics", "deep"]);
		});

		it("does not mistake the `~orpc` metadata for a child", () => {
			const names = collectContractLeaves({ a: procedure }).map((l) => l.name);
			expect(names).toEqual(["a"]);
		});

		it("returns nothing for a contract with no procedures", () => {
			expect(collectContractLeaves({ empty: {} })).toEqual([]);
		});

		it("survives a non-object input rather than throwing", () => {
			expect(collectContractLeaves(null)).toEqual([]);
			expect(collectContractLeaves("nope")).toEqual([]);
		});
	});

	describe("resolveAtPath", () => {
		it("walks a nested path to the procedure", () => {
			expect(resolveAtPath(contract, ["user", "find"])).toBe(procedure);
		});

		it("returns the client itself for an empty path", () => {
			expect(resolveAtPath(contract, [])).toBe(contract);
		});

		it("returns undefined for a path that does not exist, rather than throwing", () => {
			// A contract and the client it is bound to can disagree (a stale client), and a
			// missing leaf must be skippable — not a boot-time crash.
			expect(resolveAtPath(contract, ["user", "missing"])).toBeUndefined();
			expect(resolveAtPath(contract, ["nope", "deeper"])).toBeUndefined();
		});
	});
});
