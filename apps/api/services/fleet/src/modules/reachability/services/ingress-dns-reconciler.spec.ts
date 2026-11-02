import { Effect, Fiber } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Over } from "@deployer/effect-core";
import type { EffectHostShape } from "@deployer/nest-effect";

import { startIngressDnsReconciler } from "./ingress-dns-reconciler";
import { IngressEdgeService, type IngressEdgePorts, type IngressEdgeServiceShape } from "./ingress-edge.service";

/** A host that records the program instead of running it, so the loop can be started on demand. */
function fakeHost() {
	const forks: { label: string; effect: unknown }[] = [];
	const stop = vi.fn(() => Promise.resolve());
	const host = {
		fork: vi.fn((label: string, effect: unknown) => {
			forks.push({ label, effect });
			return stop;
		}),
	} as unknown as EffectHostShape;
	return { host, forks, stop };
}

function fakeIngress() {
	const reconcileDns = vi.fn(() => Effect.void);
	const service = { reconcileDns } as unknown as Over<IngressEdgeServiceShape, IngressEdgePorts>;
	return { reconcileDns, service };
}

/** Run the forked loop for a short real slice, then interrupt it as shutdown would. */
async function runFor(
	effect: unknown,
	service: Over<IngressEdgeServiceShape, IngressEdgePorts>,
	ms: number,
): Promise<void> {
	const fiber = Effect.runFork(
		(effect as Effect.Effect<void, never, IngressEdgeService>).pipe(
			Effect.provideService(IngressEdgeService, service),
		),
	);
	await new Promise((resolve) => setTimeout(resolve, ms));
	await Effect.runPromise(Fiber.interrupt(fiber));
}

describe("startIngressDnsReconciler", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("forks one labelled program on the host and stops it when the application shuts down", async () => {
		const { host, forks, stop } = fakeHost();
		const handle = startIngressDnsReconciler(host, 1_000);

		expect(forks.map((fork) => fork.label)).toEqual(["fleet/ingress-dns-reconciler"]);

		await handle.onApplicationShutdown();
		expect(stop).toHaveBeenCalledTimes(1);
	});

	it("reconciles on every tick until the fiber is interrupted", async () => {
		const { host, forks } = fakeHost();
		const { reconcileDns, service } = fakeIngress();
		startIngressDnsReconciler(host, 5);

		await runFor(forks[0]?.effect, service, 40);

		expect(reconcileDns.mock.calls.length).toBeGreaterThan(1);
	});

	it("survives a reconcile that fails, and tries again on the next tick", async () => {
		const { host, forks } = fakeHost();
		const { reconcileDns, service } = fakeIngress();
		reconcileDns.mockImplementation(() => Effect.fail(new Error("platform said no")) as never);
		startIngressDnsReconciler(host, 5);

		await runFor(forks[0]?.effect, service, 40);

		// A loop that died on the first failure would have run exactly once.
		expect(reconcileDns.mock.calls.length).toBeGreaterThan(1);
	});
});
