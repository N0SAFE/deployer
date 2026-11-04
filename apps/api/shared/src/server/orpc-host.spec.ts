import { Context } from "effect";
import { describe, expect, it, vi } from "vitest";

import { HttpRequest } from "@deployer/effect-core";

import { createOrpcModule } from "./orpc-host";

/** A marker service, so a test can tell which resolved context a request received. */
class Snapshot extends Context.Service<Snapshot, { readonly n: number }>()("test/Snapshot") {}

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
			return { "effect/context": Context.make(Snapshot, { n: calls }) };
		});
		const factory = configFactory({ extraContext: { inject: [], resolve } });

		const config = await factory({}, { createEmptyAuthUtils: () => ({}) });

		// Building the config must not have asked the runtime for anything: at that point the
		// container is unfinished, and what it answered would have been kept for every request.
		expect(resolve).not.toHaveBeenCalled();

		const context = config.context as (ctx: unknown) => Promise<{ "effect/context": Context.Context<Snapshot> }>;
		expect(Context.get((await context({}))["effect/context"], Snapshot).n).toBe(1);
		expect(Context.get((await context({}))["effect/context"], Snapshot).n).toBe(2);
	});

	it("adds the request to the Effect context, so a handler can `yield* HttpRequest`", async () => {
		const request = { headers: { "x-test": "1" }, method: "GET", url: "/things" };
		const factory = configFactory({ extraContext: { inject: [], resolve: () => ({ "effect/context": Context.make(Snapshot, { n: 1 }) }) } });

		const config = await factory(request, { createEmptyAuthUtils: () => ({}) });
		const { "effect/context": effect } = await (config.context as (ctx: unknown) => Promise<{ "effect/context": Context.Context<Snapshot | HttpRequest> }>)({});

		expect(Context.get(effect, HttpRequest)).toEqual({ headers: { "x-test": "1" }, method: "GET", url: "/things" });
		// What the app resolved is still there beside it.
		expect(Context.get(effect, Snapshot).n).toBe(1);
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
