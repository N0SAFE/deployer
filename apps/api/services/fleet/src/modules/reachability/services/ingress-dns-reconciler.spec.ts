import type { EffectRuntime } from "@deployer/nest-effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startIngressDnsReconciler } from "./ingress-dns-reconciler";

describe("startIngressDnsReconciler", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("reconciles on every interval until the application shuts down", async () => {
		const runPromise = vi.fn(() => Promise.resolve());
		const handle = startIngressDnsReconciler({ runPromise } as unknown as EffectRuntime, 1_000);

		await vi.advanceTimersByTimeAsync(3_000);
		expect(runPromise).toHaveBeenCalledTimes(3);

		handle.onApplicationShutdown();
		await vi.advanceTimersByTimeAsync(3_000);
		expect(runPromise).toHaveBeenCalledTimes(3);
	});

	it("survives a reconcile that fails, and tries again on the next interval", async () => {
		const runPromise = vi.fn().mockRejectedValueOnce(new Error("platform said no")).mockResolvedValue(undefined);
		const handle = startIngressDnsReconciler({ runPromise } as unknown as EffectRuntime, 1_000);

		await vi.advanceTimersByTimeAsync(2_000);

		expect(runPromise).toHaveBeenCalledTimes(2);
		handle.onApplicationShutdown();
	});
});
