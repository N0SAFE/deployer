import { Correlation, CurrentActor, domainError } from "@deployer/effect-core";
import { ORPCError } from "@orpc/client";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { handle } from "./handle";
import { actorFromContext, correlationFromContext, provideRequest } from "./request-context";

class Missing extends domainError("Missing", "not_found")() {}

const headers = (map: Record<string, string>) => ({ get: (name: string) => map[name] ?? null });
const run = <A, E>(effect: Effect.Effect<A, E, Correlation>) =>
	Effect.runPromise(Effect.flip(effect.pipe(Effect.provideService(Correlation, { id: "cid-1" }))));

describe("handle", () => {
	it("maps a domain error to its oRPC error and does not log it", async () => {
		const onDefect = vi.fn();
		const error = await run(handle(onDefect)(Effect.fail(new Missing({}))));
		expect(error).toBeInstanceOf(ORPCError);
		expect(error.code).toBe("NOT_FOUND");
		expect(onDefect).not.toHaveBeenCalled();
	});

	it("hides a defect behind the correlation id and logs the cause", async () => {
		const onDefect = vi.fn();
		const error = await run(handle(onDefect)(Effect.die(new Error("db password is hunter2"))));
		expect(error.code).toBe("INTERNAL_SERVER_ERROR");
		expect(JSON.stringify(error.data)).toContain("cid-1");
		expect(JSON.stringify(error)).not.toContain("hunter2");
		expect(onDefect).toHaveBeenCalledWith(expect.anything(), "cid-1");
	});

	it("treats an unexpected typed failure like a defect", async () => {
		const error = await run(handle(vi.fn())(Effect.fail(new Error("raw"))));
		expect(error.code).toBe("INTERNAL_SERVER_ERROR");
	});

	it("passes an existing ORPCError through", async () => {
		const original = new ORPCError("FORBIDDEN");
		expect(await run(handle(vi.fn())(Effect.fail(original)))).toBe(original);
	});
});

describe("request context", () => {
	it("prefers a system claim over a user session", () => {
		const actor = actorFromContext({
			systemActor: { kind: "system", source: "github-push" },
			auth: { user: { id: "u1", role: "admin" } },
		});
		expect(actor).toEqual({ kind: "system", id: "github-push" });
	});

	it("reads the user, defaulting the role", () => {
		expect(actorFromContext({ auth: { user: { id: "u1" } } })).toEqual({ kind: "user", id: "u1", role: "user" });
		expect(actorFromContext({})).toBeNull();
	});

	it("reuses the caller's correlation id or mints one", () => {
		expect(correlationFromContext({ request: { headers: headers({ "x-correlation-id": "abc" }) } })).toBe("abc");
		expect(correlationFromContext({ request: { headers: headers({}) } })).toMatch(/[0-9a-f-]{36}/);
	});

	it("reads the correlation id from a plain Node header record too", () => {
		expect(correlationFromContext({ request: { headers: { "x-correlation-id": "node-1" } } })).toBe("node-1");
		expect(correlationFromContext({ request: { headers: { "x-correlation-id": ["a", "b"] } } })).toBe("a");
	});

	it("provides the ambient services, and fails through onAnonymous without an actor", async () => {
		const read = Effect.gen(function* () {
			const actor = yield* CurrentActor;
			const { id } = yield* Correlation;
			return `${actor.id}:${id}`;
		});
		const ctx = { auth: { user: { id: "u1" } }, request: { headers: headers({ "x-correlation-id": "c9" }) } };
		const onAnonymous = () => Effect.fail("anon" as const);
		await expect(Effect.runPromise(read.pipe(provideRequest(ctx, onAnonymous)))).resolves.toBe("u1:c9");
		await expect(Effect.runPromise(Effect.flip(read.pipe(provideRequest({}, onAnonymous))))).resolves.toBe("anon");
	});
});
