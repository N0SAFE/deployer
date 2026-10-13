import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { describe, expect, it } from "vitest";

import { ServiceClientRegistry } from "../service-client.registry";

/**
 * A minimal Standard-Schema object, so the fixture needs no validator dependency.
 *
 * `oc.output(...)` accepts anything with a `~standard` property. This package
 * deliberately depends on `@orpc/contract` only — not on `zod` or the repo's
 * `@deployer/orpc-utils` builder — so the fixture supplies the shape directly rather
 * than pulling in a validator that is not a dependency.
 */
const passthroughSchema = {
	"~standard": {
		version: 1 as const,
		vendor: "service-client-test",
		validate: (value: unknown) => ({ value }),
	},
};

/**
 * A router with ONE procedure, whose route path names the contract it came from.
 *
 * Built the way every real contract in this repo is built — `oc.meta(openapi({...}))`
 * for the prefix — because the whole point of this file is that a client is bound to a
 * SPECIFIC contract object. The prefix is what makes the recorded URL decisive: the
 * OpenAPI link composes the request path from it, so the URL proves which contract the
 * client was built from.
 */
function oneRoutineRouter(name: string) {
	return oc.meta(openapi({ tags: [name], prefix: `/${name}` })).router({
		[name]: oc.output(passthroughSchema),
	});
}

/**
 * A registry whose fetch records the URL instead of issuing a request.
 *
 * `resolveOrigin` returns a fixed origin so the recorded URL differs only by the
 * procedure path — the part the contract decides.
 */
function makeRegistry() {
	const requested: string[] = [];
	const registry = new ServiceClientRegistry({
		resolveOrigin: () => "http://svc.test",
		headers: () => ({}),
	});

	// The link is built inside the registry, so the stub replaces the global fetch it
	// calls. The link's own signature accepts `RequestInfo | URL`; this narrower one
	// matches, so no cast is needed.
	const original = globalThis.fetch;
	globalThis.fetch = (request: RequestInfo | URL) => {
		const url = typeof request === "string" ? request : (request as { url: string }).url;
		requested.push(url);
		return Promise.resolve(
			new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
		);
	};

	return { registry, requested, restore: () => void (globalThis.fetch = original) };
}

/**
 * Why this file exists.
 *
 * The BFF binds SEVERAL contracts to ONE service — `project` alone receives
 * `projectContract`, `serviceContract`, `domainContract` and
 * `servicePreviewTopologyContract`. The registry used to key its client cache by the
 * SERVICE NAME, so every bind after the first was handed the first contract's client.
 *
 * The consequence is not a subtle wrong-data bug: an oRPC client resolves a procedure
 * through its own contract, so calling a procedure the FIRST contract does not declare
 * throws `Expected procedure or contract path`, and calling one it DOES declare
 * silently reaches that contract's route. Measured against the previous
 * implementation: a second bind's own procedure threw, while the first contract's
 * procedure succeeded and issued the wrong URL.
 */
describe("ServiceClientRegistry — contract-scoped client cache", () => {
	it("keeps a separate client per (service, contract), not per service", async () => {
		const { registry, requested, restore } = makeRegistry();
		try {
			const alphaContract = oneRoutineRouter("alpha");
			const bravoContract = oneRoutineRouter("bravo");

			// Same service, two different contracts — the shape the BFF actually uses.
			const alpha = registry.bind("project", alphaContract);
			const bravo = registry.bind("project", bravoContract);

			// Each bind must resolve ITS OWN procedure. The path is `<prefix>/<name>`
			// (the router prefix plus the routine), so the two URLs differ by contract.
			await (alpha as unknown as { alpha: (i: unknown) => Promise<unknown> }).alpha({});
			await (bravo as unknown as { bravo: (i: unknown) => Promise<unknown> }).bravo({});

			expect(requested).toEqual([
				"http://svc.test/alpha/alpha",
				"http://svc.test/bravo/bravo",
			]);
		} finally {
			restore();
		}
	});

	it("does not leak the first contract's routes into the second bind", async () => {
		const { registry, restore } = makeRegistry();
		try {
			const alphaContract = oneRoutineRouter("alpha");
			const bravoContract = oneRoutineRouter("bravo");

			registry.bind("project", alphaContract);
			const bravo = registry.bind("project", bravoContract) as unknown as Record<string, unknown>;

			// AWAITED, because an async function never throws synchronously: a bare
			// `expect(() => fn()).not.toThrow()` would pass even when the call rejects,
			// which is exactly the bug this test exists to catch. Before the fix the
			// call rejected with `Expected procedure or contract path (bravo)`, because
			// the client handed over was still built from `alphaContract`.
			await expect(
				(bravo.bravo as (i: unknown) => Promise<unknown>)({}),
			).resolves.toBeDefined();
		} finally {
			restore();
		}
	});

	it("still reuses one client when the SAME contract is bound twice", async () => {
		const { registry, requested, restore } = makeRegistry();
		try {
			const contract = oneRoutineRouter("alpha");

			// Two binds of the identical (service, contract) pair must share a client —
			// that is what the cache is FOR, and a per-bind client would allocate a link
			// per injection.
			const first = registry.bind("project", contract);
			const second = registry.bind("project", contract);

			await (first as unknown as { alpha: (i: unknown) => Promise<unknown> }).alpha({});
			await (second as unknown as { alpha: (i: unknown) => Promise<unknown> }).alpha({});

			// Two calls, but the SAME client instance — proven by the bind identity below.
			expect(requested).toHaveLength(2);
			expect(first.raw).toBe(second.raw);
		} finally {
			restore();
		}
	});

	it("keeps different SERVICES apart even for the same contract", async () => {
		const { registry, requested, restore } = makeRegistry();
		try {
			const contract = oneRoutineRouter("alpha");

			const onProject = registry.bind("project", contract);
			const onFleet = registry.bind("fleet", contract);

			await (onProject as unknown as { alpha: (i: unknown) => Promise<unknown> }).alpha({});
			await (onFleet as unknown as { alpha: (i: unknown) => Promise<unknown> }).alpha({});

			// Same route, two services: the URL cannot distinguish them (the origin
			// resolver is fixed here), so the assertion is that BOTH clients exist and
			// are distinct objects rather than one shared instance.
			expect(onProject.raw).not.toBe(onFleet.raw);
			expect(requested).toHaveLength(2);
		} finally {
			restore();
		}
	});
});
