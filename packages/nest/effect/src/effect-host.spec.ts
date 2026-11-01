import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { makeEffectHost } from "./effect-host";
import type { EffectRuntime } from "./effect-runtime";

/**
 * The host is the one place a process starts non-request Effect work. The test drives it with a fake runtime that runs
 * programs synchronously, so it asserts the *contract* — forked, tracked, interrupted — without timers.
 */
const fakeRuntime = () => {
	const interrupted: string[] = [];
	const runtime = {
		runPromise: vi.fn((effect: Effect.Effect<unknown, unknown, never>) => Effect.runPromise(effect)),
		runPromiseUnwrapped: vi.fn((effect: Effect.Effect<unknown, unknown, never>) => Effect.runPromise(effect)),
		runFork: vi.fn((effect: Effect.Effect<void, never, never>) => {
			// A real fiber, but started and interrupted through the host's own bookkeeping.
			const fiber = Effect.runFork(effect);
			fiber.addObserver?.(() => interrupted.push("done"));
			return fiber;
		}),
	};
	return { runtime: runtime as unknown as EffectRuntime, interrupted, runFork: runtime.runFork };
};

describe("EffectHost", () => {
	it("runs a program through the runtime", async () => {
		const { runtime } = fakeRuntime();
		const host = makeEffectHost(runtime);

		await expect(host.run(Effect.succeed(42))).resolves.toBe(42);
		expect(runtime.runPromise).toHaveBeenCalledTimes(1);
	});

	it("runs a program and rejects with the original failure", async () => {
		const { runtime } = fakeRuntime();
		const host = makeEffectHost(runtime);

		await expect(host.runUnwrapped(Effect.fail(new Error("boom")))).rejects.toThrow("boom");
		expect(runtime.runPromiseUnwrapped).toHaveBeenCalledTimes(1);
	});

	it("forks a long-lived program, counts it, and stops it on demand", async () => {
		const { runtime, runFork } = fakeRuntime();
		const host = makeEffectHost(runtime);

		const stop = host.fork("loop", Effect.never);
		expect(runFork).toHaveBeenCalledTimes(1);
		expect(host.size()).toBe(1);

		await stop();
		expect(host.size()).toBe(0);
	});

	it("is safe to stop twice", async () => {
		const { runtime } = fakeRuntime();
		const host = makeEffectHost(runtime);

		const stop = host.fork("loop", Effect.never);
		await stop();
		await expect(stop()).resolves.toBeUndefined();
		expect(host.size()).toBe(0);
	});
});
