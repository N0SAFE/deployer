import { describe, expect, it, vi } from "vitest";

import { createOrpcModule } from "./orpc-host";

type Config = { context: unknown };
type Factory = (request: unknown, auth: unknown, ...deps: unknown[]) => Promise<Config>;

/** The factory `ORPCModule.forRootAsync` was given, so it can be driven without a Nest application. */
function configFactory(extra: Parameters<typeof createOrpcModule>[0]): Factory {
	const module = createOrpcModule(extra);
	const provider = module.providers?.find(
		(candidate) => typeof candidate === "object" && "useFactory" in candidate,
	) as { useFactory: Factory } | undefined;
	if (provider === undefined) throw new Error("no config factory");
	return provider.useFactory;
}

describe("createOrpcModule extraContext", () => {
	it("is read for every request, not once while the host is being built", async () => {
		let calls = 0;
		const resolve = vi.fn(() => {
			calls += 1;
			return { "effect/context": `snapshot-${String(calls)}` };
		});
		const factory = configFactory({ extraContext: { inject: [], resolve } });

		const config = await factory({}, { createEmptyAuthUtils: () => ({}) });

		// Building the config must not have asked the runtime for anything: at that point the
		// container is unfinished, and what it answered would have been kept for every request.
		expect(resolve).not.toHaveBeenCalled();

		const context = config.context as (ctx: unknown) => Promise<Record<string, unknown>>;
		expect((await context({}))["effect/context"]).toBe("snapshot-1");
		expect((await context({}))["effect/context"]).toBe("snapshot-2");
	});

	it("still carries the request and the auth utilities", async () => {
		const request = { id: "r1" };
		const auth = { isLoggedIn: false };
		const factory = configFactory(undefined);

		const config = await factory(request, { createEmptyAuthUtils: () => auth });
		const context = await (config.context as (ctx: unknown) => Promise<Record<string, unknown>>)({});

		expect(context.request).toBe(request);
		expect(context.auth).toBe(auth);
	});
});
