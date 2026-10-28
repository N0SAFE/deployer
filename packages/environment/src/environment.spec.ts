import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import z from "zod/v4";

import { makeEnvironment, makeLenientEnvironment, type EnvironmentSource } from "./environment";
import { EnvironmentInvalid } from "./errors";

const source = (values: Record<string, unknown>): EnvironmentSource => ({
	read: (key) => values[key],
	all: () => ({ ...values }),
});

const apiLike = z.object({
	API_PORT: z.coerce.number().default(3005),
	NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
	OPTIONAL_TOKEN: z.string().optional(),
});
const setupLike = z.object({
	SETUP_APP_PORT: z.coerce.number().default(3016),
	SETUP_MODE: z.enum(["dev", "prod"]).default("dev"),
});

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

describe("makeEnvironment", () => {
	it("reads through the schema the caller supplied, with coercions and defaults", async () => {
		const env = await run(makeEnvironment(apiLike, source({ API_PORT: "4000" })));
		expect(env.get("API_PORT")).toBe(4000);
		expect(env.get("NODE_ENV")).toBe("development");
		expect(env.get("OPTIONAL_TOKEN")).toBeUndefined();
	});

	it("does not expose another app's variables", async () => {
		const env = await run(makeEnvironment(setupLike, source({ API_PORT: "1", SETUP_MODE: "prod" })));
		expect((env.values as Record<string, unknown>).API_PORT).toBeUndefined();
		expect(env.get("SETUP_MODE")).toBe("prod");
	});

	it("fails with EnvironmentInvalid naming every bad variable", async () => {
		const strict = z.object({ A: z.string().min(1), B: z.coerce.number() });
		const exit = await Effect.runPromiseExit(makeEnvironment(strict, source({ B: "x" })));
		expect(Exit.isFailure(exit)).toBe(true);
		const failure = Exit.isFailure(exit) ? Cause.squash(exit.cause) : null;
		expect(failure).toBeInstanceOf(EnvironmentInvalid);
		expect((failure as EnvironmentInvalid).issues.map((issue) => issue.variable).sort()).toEqual(["A", "B"]);
	});

	it("use() validates the same source under another contract", async () => {
		const base = await run(makeEnvironment(apiLike, source({ SETUP_MODE: "prod" })));
		const narrow = await run(base.use(setupLike));
		expect(narrow.get("SETUP_MODE")).toBe("prod");
		expect((narrow.values as Record<string, unknown>).API_PORT).toBeUndefined();
	});

	it("reports the mode from NODE_ENV", async () => {
		const env = await run(makeEnvironment(apiLike, source({ NODE_ENV: "production" })));
		expect([env.isProduction(), env.isDevelopment(), env.isTest()]).toEqual([true, false, false]);
	});
});

describe("makeLenientEnvironment", () => {
	it("degrades to the raw values instead of failing", async () => {
		const strict = z.object({ REQUIRED_THING: z.string().min(1) });
		const env = await run(makeLenientEnvironment(strict, source({ PATH: "/bin" })));
		expect((env as { get: (key: string) => unknown }).get("PATH")).toBe("/bin");
	});
});
