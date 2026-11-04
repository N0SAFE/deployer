import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { Correlation, CurrentActor, HttpRequest, clientAddressOf, domainError, headerOf } from "@deployer/effect-core";

import { createServe } from "./serve";

class Missing extends domainError("Missing", "not_found")() {}

const onDefect = vi.fn();
const { serve, serveAnonymous } = createServe({ service: "svc-test", onDefect });

const whoAmI = Effect.gen(function* () {
	const actor = yield* CurrentActor;
	const { id } = yield* Correlation;
	return `${actor.id}:${id}`;
});

describe("createServe", () => {
	it("provides the actor and correlation id", async () => {
		const ctx = { auth: { user: { id: "u1" } }, request: { headers: { "x-correlation-id": "c1" } } };
		await expect(Effect.runPromise(serve(ctx)(whoAmI))).resolves.toBe("u1:c1");
	});

	it("refuses an anonymous caller as unauthorized, but lets serveAnonymous through", async () => {
		const refused = await Effect.runPromise(Effect.flip(serve({})(whoAmI)));
		expect((refused as { code: string }).code).toBe("UNAUTHORIZED");
		await expect(Effect.runPromise(serveAnonymous({})(whoAmI))).resolves.toMatch(/^anonymous:/);
	});

	it("maps domain errors and logs defects with the correlation id", async () => {
		const ctx = { auth: { user: { id: "u1" } }, request: { headers: { "x-correlation-id": "c2" } } };
		const mapped = await Effect.runPromise(Effect.flip(serve(ctx)(Effect.fail(new Missing({})))));
		expect((mapped as { code: string }).code).toBe("NOT_FOUND");

		const hidden = await Effect.runPromise(Effect.flip(serve(ctx)(Effect.die(new Error("secret")))));
		expect((hidden as { code: string }).code).toBe("INTERNAL_SERVER_ERROR");
		expect(onDefect).toHaveBeenCalledWith(expect.anything(), "c2");
	});

	it("supplies the request itself, so a handler can read it without a Nest scope", async () => {
		const seen = Effect.gen(function* () {
			const request = yield* HttpRequest;
			return { method: request.method, url: request.url, ua: headerOf(request, "user-agent"), ip: clientAddressOf(request) };
		});

		const ctx = {
			auth: { user: { id: "u1" } },
			request: {
				method: "POST",
				url: "/user/list",
				headers: { "user-agent": "cli/1.0", "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
			},
		};

		await expect(Effect.runPromise(serve(ctx)(seen))).resolves.toEqual({
			method: "POST",
			url: "/user/list",
			ua: "cli/1.0",
			ip: "203.0.113.7",
		});
	});

	it("keeps two overlapping requests apart", async () => {
		const reader = Effect.gen(function* () {
			const request = yield* HttpRequest;
			yield* Effect.sleep("1 millis");
			return headerOf(request, "x-request-id");
		});

		const [first, second] = await Promise.all([
			Effect.runPromise(serve({ auth: { user: { id: "u1" } }, request: { headers: { "x-request-id": "a" } } })(reader)),
			Effect.runPromise(serve({ auth: { user: { id: "u2" } }, request: { headers: { "x-request-id": "b" } } })(reader)),
		]);

		// Each call runs on its own immutable context: no shared mutable slot, so no bleed.
		expect([first, second]).toEqual(["a", "b"]);
	});
});
