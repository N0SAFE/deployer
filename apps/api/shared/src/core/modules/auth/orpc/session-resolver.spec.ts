import { Cause, Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";

import type { Auth } from "../../../../auth";
import { makeSessionResolver, SessionLookupFailed } from "./session-resolver";

const session = { session: { id: "s1" }, user: { id: "u1", role: "admin" } };

const resolverFor = (getSession: () => Promise<unknown>) =>
	makeSessionResolver({ api: { getSession: vi.fn(getSession) } } as unknown as Auth);

const run = (resolver: ReturnType<typeof makeSessionResolver>) => Effect.runPromiseExit(resolver.resolve(new Headers()));

describe("makeSessionResolver", () => {
	it("returns the session Better Auth hands back directly", async () => {
		const result = await run(resolverFor(async () => session));
		expect(Exit.isSuccess(result) && result.value).toEqual(session);
	});

	it("reads a session out of a wrapped or bare Response", async () => {
		const wrapped = await run(resolverFor(async () => ({ response: Response.json(session) })));
		const bare = await run(resolverFor(async () => Response.json(session)));
		expect(Exit.isSuccess(wrapped) && wrapped.value).toEqual(session);
		expect(Exit.isSuccess(bare) && bare.value).toEqual(session);
	});

	it("is null when there is no session or the response is not ok", async () => {
		const none = await run(resolverFor(async () => null));
		const refused = await run(resolverFor(async () => new Response("no", { status: 401 })));
		expect(Exit.isSuccess(none) && none.value).toBeNull();
		expect(Exit.isSuccess(refused) && refused.value).toBeNull();
	});

	it("fails with SessionLookupFailed when Better Auth throws", async () => {
		const result = await run(resolverFor(async () => { throw new Error("db down"); }));
		expect(Exit.isFailure(result)).toBe(true);
		if (Exit.isFailure(result)) expect(Cause.squash(result.cause)).toBeInstanceOf(SessionLookupFailed);
	});
});
