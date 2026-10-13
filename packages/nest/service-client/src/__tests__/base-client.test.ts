import { describe, expect, it, vi } from "vitest";

import { BaseClient } from "../base-client";
import type { ServiceClient, ServiceClientBinder } from "../types";

/**
 * A procedure stand-in: CALLABLE, and carrying the library's `~orpc` marker.
 *
 * ── WHY BOTH ────────────────────────────────────────────────────────────────
 * The two halves of the design key on different things, and a fixture has to satisfy
 * both to be a real test:
 *
 *   the WALK     reads `~orpc` to tell a procedure from a nested router
 *   the LOOKUP   calls the resolved value, so it must be callable
 *
 * A bare `vi.fn()` would fail the first (nothing to hoist, so every assertion below
 * would pass vacuously), and a marker-only object would fail the second. A marked
 * function is what the real library produces on the client side, and it is what makes
 * these tests prove something.
 */
function makeProcedure(label: string) {
	const fn = vi.fn((...args: unknown[]) => Promise.resolve({ called: label, args }));
	return Object.assign(fn, { "~orpc": { route: { path: `/${label}`, method: "POST" } } });
}

/** The contract shape every service has: namespaces plus a top-level procedure. */
function makeContract() {
	return {
		user: { find: makeProcedure("user.find"), list: makeProcedure("user.list") },
		analytics: { deep: { getApiUsage: makeProcedure("analytics.deep.getApiUsage") } },
		topLevel: makeProcedure("topLevel"),
	};
}

/**
 * A binder whose client IS the contract.
 *
 * This stands in for the oRPC client, which is a Proxy that resolves any path through
 * the contract. Using the contract directly makes a call PROVE which leaf was reached
 * — the recording function on the other end names it.
 */
function makeBinder(client: unknown): ServiceClientBinder {
	return {
		bind: () => {
			const bound = client as Record<string, unknown> & { raw?: unknown };
			bound.raw = client;
			return bound as unknown as ServiceClient<never>;
		},
	};
}

class TestClient extends BaseClient {
	constructor(binder: ServiceClientBinder) {
		// The fixture stands in for a real contract: it has the library's shape but not
		// the full generic machinery, so the cast is what says "this is a contract" here.
		super(binder, { service: "test", contract: makeContract() as never });
	}
}

/**
 * The alias, viewed as callable — which is how a consumer uses it.
 *
 * Variadic because a procedure takes an input object; typing it 0-arg would make the
 * argument-pass-through assertion unrepresentable rather than wrong.
 */
function alias<K extends string>(client: unknown, name: K): (...args: unknown[]) => Promise<unknown> {
	return (client as Record<K, (...args: unknown[]) => Promise<unknown>>)[name];
}

describe("BaseClient", () => {
	describe("root aliases", () => {
		it("exposes a nested procedure under its own name at the root", async () => {
			const contract = makeContract();
			const client = new TestClient(makeBinder(contract));

			const call = alias(client, "find");
			expect(typeof call).toBe("function");
			await call();

			// The decisive assertion: calling the ROOT alias must reach the NESTED
			// procedure — not another leaf that happens to share a name.
			expect(contract.user.find).toHaveBeenCalledTimes(1);
			expect(contract.user.list).not.toHaveBeenCalled();
		});

		it("hoists a THREE-level procedure too", async () => {
			const contract = makeContract();
			const client = new TestClient(makeBinder(contract));

			const call = alias(client, "getApiUsage");
			expect(typeof call).toBe("function");
			await call();

			expect(contract.analytics.deep.getApiUsage).toHaveBeenCalledTimes(1);
		});

		it("keeps a top-level procedure working", async () => {
			const contract = makeContract();
			const client = new TestClient(makeBinder(contract));

			await alias(client, "topLevel")();
			expect(contract.topLevel).toHaveBeenCalledTimes(1);
		});

		it("passes the caller's arguments through to the procedure", async () => {
			const contract = makeContract();
			const client = new TestClient(makeBinder(contract));

			await alias(client, "find")("the-input");
			expect(contract.user.find).toHaveBeenCalledWith("the-input");
		});

		it("binds the procedure to the CLIENT, so `this` inside it is the client", async () => {
			// The procedures come off the client as methods. Without binding, a leaf that
			// reads `this` internally would see the wrong receiver — a failure that only
			// appears at call time, deep inside the transport.
			const seen: unknown[] = [];
			const selfAware = Object.assign(
				function (this: unknown) {
					seen.push(this);
					return Promise.resolve(null);
				},
				{ "~orpc": { route: { path: "/self", method: "GET" } } },
			);

			const binder: ServiceClientBinder = {
				bind: () => {
					const bound = { group: { probe: selfAware }, raw: {} } as unknown as Record<
						string,
						unknown
					>;
					bound.raw = bound;
					return bound as unknown as ServiceClient<never>;
				},
			};

			class ProbeClient extends BaseClient {
				constructor() {
					super(binder, {
						service: "test",
						contract: { group: { probe: selfAware } } as never,
					});
				}
			}

			await alias(new ProbeClient(), "probe")();

			expect(seen).toHaveLength(1);
			// Bound to SOMETHING (not loose undefined), which is what `bind` provides.
			expect(seen[0]).toBeDefined();
		});
	});

	describe("non-enumerability", () => {
		it("does not expose the procedures to Object.keys", () => {
			const client = new TestClient(makeBinder(makeContract()));

			// A client is injected into services that get logged and spread. If the aliases
			// were enumerable, every such log would carry the whole surface.
			expect(Object.keys(client)).not.toContain("find");
			expect(Object.keys(client)).not.toContain("getApiUsage");
		});

		it("still makes them callable despite being non-enumerable", () => {
			const client = new TestClient(makeBinder(makeContract()));
			const desc = Object.getOwnPropertyDescriptor(client, "find");
			expect(desc?.enumerable).toBe(false);
			expect(typeof desc?.value).toBe("function");
		});
	});

	describe("identity", () => {
		it("reports the service it reaches", () => {
			const client = new TestClient(makeBinder(makeContract()));
			expect(client.service).toBe("test");
		});

		it("keeps the contract it was declared with", () => {
			const client = new TestClient(makeBinder(makeContract()));
			expect(Object.keys(client.contract)).toEqual(["user", "analytics", "topLevel"]);
		});
	});

	describe("resilience", () => {
		it("skips a leaf the bound client does not implement, instead of failing to construct", () => {
			// A contract and a running service can disagree while a deployment rolls out.
			// Constructing a client must not throw over a procedure the service has not got
			// yet; the missing alias is simply absent.
			const binder: ServiceClientBinder = {
				bind: () => ({ raw: {} }) as unknown as ServiceClient<never>,
			};

			class SparseClient extends BaseClient {
				constructor() {
					super(binder, { service: "test", contract: makeContract() as never });
				}
			}

			expect(() => new SparseClient()).not.toThrow();
			expect((new SparseClient() as unknown as Record<string, unknown>).find).toBeUndefined();
		});
	});
});
