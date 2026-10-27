import { Correlation, CurrentActor, domainError } from "@deployer/effect-core";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

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
});
