import "@orpc/effect/extensions/effect";

import { call, os } from "@orpc/server";
import { Effect, Layer } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AccessDeclaration, Actor } from "@deployer/auth/authz";

import {
	Authz,
	access,
	authzConfigured,
	authzGate,
	authzLive,
	configureAuthz,
	makeAuthz,
	platformRoleStore,
	resolveScope,
	type AuthzOptions,
	type DecisionEvent,
	type PermissionStore,
} from "./authz";
import { procedure } from "./requirements";

/**
 * The gate is proved through the real builder: a contract declares `access(...)`, `procedure()` appends the gate, and a
 * caller either gets the handler's result or `FORBIDDEN`. That is the whole DX contract, so a unit test of the middleware
 * alone would miss the part that matters — that the declaration on the contract is what the gate reads.
 */
const caller = (role: string, id = "u1") => ({ auth: { user: { id, role } } });

const store: PermissionStore = {
	capabilities: (actor: Actor) =>
		platformRoleStore.capabilities(actor, { kind: "platform" }),
};

const readContract = os
	.meta(access({ permission: "project:read" }));

const execContract = os
	.meta(access({ permission: "container:exec" }));

const openContract = os
	.meta(access({ public: true, reason: "liveness probe" }));

afterEach(() => {
	configureAuthz(null);
});

describe("authz gate", () => {
	/** The gate reads the declaration off the implemented procedure; this is the same shape `access()` writes. */
	const withDeclaration = (declaration: AccessDeclaration) => ({ "~orpc": { meta: { authz: declaration } } });
	const run = async (
		declaration: AccessDeclaration,
		context: unknown,
		options: Omit<AuthzOptions, "store"> & { readonly store?: PermissionStore } = { mode: "enforce" },
	) => {
		const done = vi.fn((result?: unknown) => result ?? "next");
		const gate = authzGate({ store: options.store ?? store, ...options });
		const outcome = await gate({ procedure: withDeclaration(declaration), context, path: [] }, undefined, done);
		return { outcome, done };
	};

	it("lets a granted permission through", async () => {
		const { done } = await run({ permission: "cluster:read" }, caller("viewer"));
		expect(done).toHaveBeenCalled();
	});

	it("refuses with FORBIDDEN when the role lacks the permission", async () => {
		await expect(run({ permission: "container:exec" }, caller("viewer"))).rejects.toMatchObject({
			code: "FORBIDDEN",
			data: { permission: "container:exec" },
		});
	});

	it("allows an operator what a viewer is refused", async () => {
		const { done } = await run({ permission: "container:exec" }, caller("operator"));
		expect(done).toHaveBeenCalled();
	});

	it("records a would-deny in shadow mode and lets the call through", async () => {
		const events: DecisionEvent[] = [];
		const { done } = await run({ permission: "container:exec" }, caller("viewer"), {
			mode: "shadow",
			onDecision: (event) => events.push(event),
		});

		expect(done).toHaveBeenCalled();
		expect(events[0]).toMatchObject({ enforced: false, decision: { allowed: false, permission: "container:exec" } });
	});

	it("serves a declared-public procedure without an actor", async () => {
		const { done } = await run({ public: true, reason: "liveness probe" }, {});
		expect(done).toHaveBeenCalled();
	});

	it("requires an actor for a non-public procedure", async () => {
		await expect(run({ permission: "cluster:read" }, {})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});

	it("logs an undeclared procedure without blocking, and never invents a permission for it", async () => {
		const events: DecisionEvent[] = [];
		const done = vi.fn((result?: unknown) => result);
		const gate = authzGate({ store, mode: "enforce", onDecision: (event) => events.push(event) });

		await gate({ procedure: {}, context: caller("viewer"), path: [] }, undefined, done);

		expect(done).toHaveBeenCalled();
		expect(events[0]).toMatchObject({ undeclared: true, enforced: false });
	});

	it("is the gate `procedure()` appends, on a real contract declaration", async () => {
		configureAuthz({ store, mode: "enforce" });

		await expect(
			procedure(execContract).effect(function* () {
				return { ok: true as const };
			}),
		).toBeDefined();

		// The declaration reaches the procedure through the contract's metadata: a viewer is refused at call time.
		await expect(
			call(
				procedure(execContract).effect(function* () {
					return { ok: true as const };
				}),
				undefined,
				{ context: caller("viewer") },
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("is not installed at all when the host has not configured authz", async () => {
		configureAuthz(null);

		expect(authzConfigured()).toBeNull();
		// `procedure()` builds normally; nothing wraps the handler, so an unconfigured host is byte-identical to before.
		expect(
			procedure(execContract).effect(function* () {
				return { ok: true as const };
			}),
		).toBeDefined();
	});
});

describe("Authz service", () => {
	const layer = (store: PermissionStore) => authzLive(store);

	it("checks, requires and explains through the same resolver memo", async () => {
		const capabilities = vi.fn(store.capabilities);

		const program = Effect.gen(function* () {
			const authz = yield* Authz;
			const allowed = yield* authz.check({ actor: { id: "u1", role: "operator" }, permission: "cluster:operate", scope: { kind: "platform" } });
			const denied = yield* authz.check({ actor: { id: "u1", role: "viewer" }, permission: "cluster:operate", scope: { kind: "platform" } });
			const explained = yield* authz.explain({ actor: { id: "u1", role: "operator" }, permission: "cluster:operate", scope: { kind: "platform" } });
			return { allowed, denied, explained };
		});

		const result = await Effect.runPromise(program.pipe(Effect.provide(layer({ capabilities }))));

		expect(result.allowed.allowed).toBe(true);
		expect(result.denied.allowed).toBe(false);
		expect(result.explained.capabilities.permissions).toContain("cluster:operate");
		// Two (actor, role) pairs → two loads; the explain reuses the operator's entry from the first check.
		expect(capabilities).toHaveBeenCalledTimes(2);
	});

	it("memoises per actor and scope inside one layer", async () => {
		const capabilities = vi.fn(store.capabilities);

		const program = Effect.gen(function* () {
			const authz = yield* Authz;
			const query = { actor: { id: "u1", role: "viewer" }, permission: "cluster:read" as const, scope: { kind: "platform" as const } };
			yield* authz.check(query);
			yield* authz.check(query);
			yield* authz.explain(query);
		});

		await Effect.runPromise(program.pipe(Effect.provide(layer({ capabilities }))));

		expect(capabilities).toHaveBeenCalledTimes(1);
	});

	it("fails `require` with the typed denial", async () => {
		const program = Effect.gen(function* () {
			const authz = yield* Authz;
			yield* authz.require({ actor: { id: "u1", role: "viewer" }, permission: "container:exec", scope: { kind: "platform" } });
		});

		await expect(Effect.runPromise(program.pipe(Effect.provide(layer(store))))).rejects.toMatchObject({
			_tag: "AuthzDenied",
			permission: "container:exec",
		});
	});
});

describe("resolveScope", () => {
	it("reads a bare id from the input and takes the kind from the path", () => {
		expect(
			resolveScope({ permission: "service:deploy", scope: { by: "input", path: "serviceId" } }, { serviceId: "s-1" }, {}),
		).toEqual({ kind: "service", id: "s-1" });
	});

	it("reads an explicit {kind,id} at a nested path", () => {
		expect(
			resolveScope(
				{ permission: "deployment:create", scope: { by: "input", path: "target" } },
				{ target: { kind: "environment", id: "e-1" } },
				{},
			),
		).toEqual({ kind: "environment", id: "e-1" });
	});

	it("falls back to the platform when the declaration names no scope", () => {
		expect(resolveScope({ permission: "project:read" }, {}, {})).toEqual({ kind: "platform" });
	});
});

describe("makeAuthz", () => {
	it("is constructible without a layer, for a caller that already holds an Effect context", async () => {
		const authz = await Effect.runPromise(makeAuthz(store));
		const decision = await Effect.runPromise(
			authz.check({ actor: { id: "u1", role: "superAdmin" }, permission: "platform.secret:reveal", scope: { kind: "platform" } }),
		);
		expect(decision.allowed).toBe(true);
	});
});
