import { Cause, Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";

import { makeSupervisorEventBus, type SupervisorEventBusShape } from "../events/event-bus";
import { baseSupervisorPayloadSchema } from "../schemas/probe";
import { baseSupervisorProcessInfoSchema } from "../schemas/process-info";
import { makeSupervisor, type AnySupervisor } from "../supervisor/supervisor";
import { makeSupervisorOrchestrator } from "./orchestrator";

async function run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
	const exit = await Effect.runPromiseExit(effect);
	if (Exit.isSuccess(exit)) return exit.value;
	throw Cause.squash(exit.cause);
}

const payload = () => ({ checkedAt: new Date().toISOString(), latencyMs: 1 });

function supervisor(
	id: string,
	converge: Effect.Effect<void, unknown> = Effect.void,
	source: unknown = null,
	bus?: SupervisorEventBusShape,
): AnySupervisor {
	return makeSupervisor(
		{
			id,
			description: id,
			payloadSchema: baseSupervisorPayloadSchema,
			processInfoSchema: baseSupervisorProcessInfoSchema,
			converge,
			probe: Effect.succeed({ healthy: true, payload: payload() }),
			degradedPayload: () => payload(),
			processInfo: Effect.succeed({}),
		},
		{ source, label: id, ...(bus ? { bus } : {}) },
	);
}

describe("SupervisorOrchestrator", () => {
	it("registers once and rejects another supervisor with the same id", async () => {
		const orchestrator = makeSupervisorOrchestrator();
		const first = supervisor("a", Effect.void, { n: 1 });
		await run(orchestrator.register(first));
		await run(orchestrator.register(first));

		await expect(run(orchestrator.register(supervisor("a", Effect.void, { n: 2 })))).rejects.toThrow(/Duplicate supervisorId "a"/);
		expect(orchestrator.list()).toHaveLength(1);
	});

	it("converges everything in parallel, isolating a failure", async () => {
		const orchestrator = makeSupervisorOrchestrator();
		await run(orchestrator.register(supervisor("ok")));
		await run(orchestrator.register(supervisor("bad", Effect.fail(new Error("boom")))));

		const states = await run(orchestrator.ensureAll);

		expect(states.get("ok")).toBe("converged");
		expect(states.get("bad")).toBe("degraded");
		expect((await run(orchestrator.degraded)).map((s) => s.id)).toEqual(["bad"]);
	});

	it("converges one supervisor on demand, and answers null for an unknown id", async () => {
		const orchestrator = makeSupervisorOrchestrator();
		await run(orchestrator.register(supervisor("a")));

		expect(await run(orchestrator.convergeNow("a"))).toBe("converged");
		expect(await run(orchestrator.convergeNow("missing"))).toBeNull();
	});

	it("waits for a supervisor that registers late, and gives up after the timeout", async () => {
		const orchestrator = makeSupervisorOrchestrator();

		const waiting = run(orchestrator.getById("late", { timeoutMs: 2_000 }));
		setTimeout(() => void run(orchestrator.register(supervisor("late"))), 100);

		expect((await waiting)?.id).toBe("late");
		expect(await run(orchestrator.getById("never", { timeoutMs: 120 }))).toBeNull();
	});

	it("finds a supervisor by the object it was built from", async () => {
		class Marker {}
		const orchestrator = makeSupervisorOrchestrator();
		await run(orchestrator.register(supervisor("m", Effect.void, new Marker())));

		const found = await run(orchestrator.getMatching((s) => s.source instanceof Marker));

		expect(found?.id).toBe("m");
	});

	it("probes every supervisor and publishes each snapshot", async () => {
		const bus = await run(makeSupervisorEventBus());
		const emit = vi.spyOn(bus, "emit");
		const orchestrator = makeSupervisorOrchestrator(bus);
		await run(orchestrator.register(supervisor("a", Effect.void, null, bus)));

		const healths = await run(orchestrator.healthOfAll);

		expect(healths.map((h) => h.supervisorId)).toEqual(["a"]);
		expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: "health-snapshot", supervisorId: "a" }));
	});

	it("retries a degraded supervisor until it recovers, and stops with the handle", async () => {
		let attempts = 0;
		const flaky = Effect.suspend(() => (++attempts < 3 ? Effect.fail(new Error("db not ready")) : Effect.void));
		const orchestrator = makeSupervisorOrchestrator(undefined, { degradedRetryMs: 20, reconcileSweepMs: 60_000 });
		await run(orchestrator.register(supervisor("flaky", flaky)));

		const control = await run(orchestrator.startDriftControl);
		await new Promise((resolve) => setTimeout(resolve, 250));
		await run(control.stop);

		expect(attempts).toBe(3);
		expect((await run(orchestrator.degraded))).toEqual([]);
	});

	it("corrects drift: a converged supervisor is converged again by the sweep", async () => {
		let passes = 0;
		const counting = Effect.sync(() => void (passes += 1));
		const orchestrator = makeSupervisorOrchestrator(undefined, { degradedRetryMs: 60_000, reconcileSweepMs: 20 });
		await run(orchestrator.register(supervisor("steady", counting)));

		const control = await run(orchestrator.startDriftControl);
		await new Promise((resolve) => setTimeout(resolve, 200));
		await run(control.stop);

		expect(passes).toBeGreaterThan(2);
	});
});
