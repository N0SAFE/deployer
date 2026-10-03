import { describe, expect, it, vi } from "vitest";
import z from "zod/v4";
import {
	BaseSupervisorService,
	baseSupervisorPayloadSchema,
	type SupervisorIdentifierInput,
	type SupervisorProbeResult,
} from "./base-supervisor.service";
import { baseSupervisorProcessInfoSchema } from "./supervisor-process-info";
import { SupervisorEventBus } from "./supervisor-event.bus";
import { SupervisorOrchestratorService } from "./supervisor-orchestrator.service";

const fakePayloadSchema = baseSupervisorPayloadSchema.extend({ counter: z.number().int() });
type FakePayload = z.output<typeof fakePayloadSchema>;

class FakeSupervisor extends BaseSupervisorService<typeof fakePayloadSchema> {
        readonly description = "fake supervised thing";
        readonly payloadSchema = fakePayloadSchema;
        readonly processInfoSchema = baseSupervisorProcessInfoSchema;

        reconcileCalls = 0;
        probeResult: SupervisorProbeResult<typeof fakePayloadSchema> = {
                healthy: true,
                payload: { checkedAt: new Date().toISOString(), latencyMs: 1, counter: 0 },
        };

        constructor(
                supervisorId: string,
                private readonly reconcileError?: Error,
                private readonly identifierInput?: SupervisorIdentifierInput,
        ) {
                super();
                // The base exposes `supervisorId` as an accessor resolved from
                // the class identifier — seed it via the constructor param by
                // calling the base setter through the public accessor (no
                // instance field here, which the base's accessor would clash
                // with).
                this.setSupervisorIdForTest(supervisorId);
        }

        private setSupervisorIdForTest(supervisorId: string): void {
                (this as unknown as { _supervisorId: string | undefined })._supervisorId = supervisorId;
        }

	protected async reconcile(): Promise<void> {
		this.reconcileCalls++;
		if (this.reconcileError !== undefined) throw this.reconcileError;
	}

	protected async probe(): Promise<SupervisorProbeResult<typeof fakePayloadSchema>> {
		return this.probeResult;
	}

	protected buildDegradedPayload(detail: string): FakePayload {
		return { checkedAt: new Date().toISOString(), latencyMs: 0, counter: -1 };
	}

	protected async buildProcessInfo(): Promise<Record<string, unknown>> {
		return { kind: "test" };
	}
}

describe("BaseSupervisorService auto-registration", () => {
	it("registers itself through onModuleInit when the orchestrator is injected", () => {
		const orchestrator = new SupervisorOrchestratorService();
		const supervisor = new FakeSupervisor("auto");
		// Simulate NestJS property injection of the @Global orchestrator.
		(supervisor as unknown as { orchestrator: SupervisorOrchestratorService }).orchestrator = orchestrator;

		supervisor.onModuleInit();

		expect(orchestrator.has("auto")).toBe(true);
	});

	it("skips registration harmlessly when constructed directly without DI", () => {
		const orchestrator = new SupervisorOrchestratorService();
		const supervisor = new FakeSupervisor("manual");

		expect(() => supervisor.onModuleInit()).not.toThrow();
		expect(orchestrator.has("manual")).toBe(false);
	});
});

describe("SupervisorOrchestratorService", () => {
	/** Unwraps an indexed health result without assertions-as-casts. */
	function must(health: Awaited<ReturnType<SupervisorOrchestratorService["getHealthOfAll"]>>[number] | undefined) {
		if (health === undefined) throw new Error("expected supervisor health entry");
		return health;
	}

	it("rejects two different supervisors sharing a supervisorId", () => {
		const orchestrator = new SupervisorOrchestratorService();
		orchestrator.register(new FakeSupervisor("dup"));
		expect(() => orchestrator.register(new FakeSupervisor("dup"))).toThrow(/Duplicate supervisorId/);
	});

	it("accepts re-registration of the same instance idempotently", () => {
		const orchestrator = new SupervisorOrchestratorService();
		const supervisor = new FakeSupervisor("same");
		orchestrator.register(supervisor);
		orchestrator.register(supervisor);
		expect(orchestrator.list()).toHaveLength(1);
	});

	it("converges all supervisors and isolates individual failures", async () => {
		const orchestrator = new SupervisorOrchestratorService();
		const healthy = new FakeSupervisor("ok");
		const broken = new FakeSupervisor("broken", new Error("socket gone"));
		orchestrator.register(healthy);
		orchestrator.register(broken);

		const results = await orchestrator.ensureAll();

		expect(results.get("ok")).toBe("converged");
		expect(results.get("broken")).toBe("degraded");
		expect(healthy.reconcileCalls).toBe(1);
		expect(broken.getStateSnapshot().detail).toContain("socket gone");
	});

	it("aggregates health across supervisors in parallel", async () => {
		const orchestrator = new SupervisorOrchestratorService();
		const ok = new FakeSupervisor("ok");
		ok.probeResult = { healthy: true, detail: "all good", payload: { checkedAt: new Date().toISOString(), latencyMs: 2, counter: 1 } };
		const sick = new FakeSupervisor("sick");
		sick.probeResult = { healthy: false, detail: "nope", payload: { checkedAt: new Date().toISOString(), latencyMs: 3, counter: 2 } };
		orchestrator.register(ok);
		orchestrator.register(sick);
		// Health requires convergence first — idle supervisors report unhealthy by design.
		await orchestrator.ensureAll();

		const health = await orchestrator.getHealthOfAll();

		expect(health).toHaveLength(2);
		const byId = new Map(health.map((h) => [h.supervisorId, h]));
		expect(byId.get("ok")?.healthy).toBe(true);
		expect(byId.get("sick")?.healthy).toBe(false);
	});

	it("treats degraded convergence as unhealthy even when the probe passes", async () => {
		const orchestrator = new SupervisorOrchestratorService();
		const supervisor = new FakeSupervisor("flaky", new Error("boom"));
		orchestrator.register(supervisor);

		await orchestrator.ensureAll();
		const [flakyHealth] = await orchestrator.getHealthOfAll();
		const health = must(flakyHealth);

		expect(health.state).toBe("degraded");
		expect(health.healthy).toBe(false);
	});

	it("reports probe exceptions as unhealthy instead of throwing", async () => {
		const orchestrator = new SupervisorOrchestratorService();
		const supervisor = new FakeSupervisor("exploding");
		vi.spyOn(supervisor as unknown as { probe(): Promise<SupervisorProbeResult<typeof fakePayloadSchema>> }, "probe").mockRejectedValue(
			new Error("inspect failed"),
		);
		orchestrator.register(supervisor);

		const [explodingHealth] = await orchestrator.getHealthOfAll();
		const health = must(explodingHealth);

		expect(health.healthy).toBe(false);
		expect(health.detail).toContain("inspect failed");
		// The degraded payload still satisfies the schema (Zod source of truth).
		expect(fakePayloadSchema.safeParse(health.payload).success).toBe(true);
	});

	it("fetches a registered supervisor by class, fully typed", async () => {
		const orchestrator = new SupervisorOrchestratorService();
		const ok = new FakeSupervisor("ok");
		orchestrator.register(ok);

		const fetched = await orchestrator.getSupervisor(FakeSupervisor);

		expect(fetched).toBe(ok);
	});

	it("returns null from getSupervisor when the class is not registered", async () => {
		const orchestrator = new SupervisorOrchestratorService();

		expect(await orchestrator.getSupervisor(FakeSupervisor, { timeoutMs: 0 })).toBeNull();
	});

	it("awaits registration when the supervisor self-registers after the call", async () => {
		const orchestrator = new SupervisorOrchestratorService();
		const bus = new SupervisorEventBus();
		(orchestrator as unknown as { supervisorEvents: SupervisorEventBus }).supervisorEvents = bus;

		// The supervisor is NOT registered yet — the accessor must wait for it.
		const pending = orchestrator.getSupervisor(FakeSupervisor, { timeoutMs: 5_000 });

		const late = new FakeSupervisor("late");
		orchestrator.register(late);
		// Mimic BaseSupervisorService.onModuleInit: register + emit `registered`.
		bus.emit({ supervisorId: late.supervisorId, type: "registered", at: new Date().toISOString() });

		await expect(pending).resolves.toBe(late);
	});

	it("resolves null when no supervisor registers within the wait window", async () => {
		vi.useFakeTimers();
		try {
			const orchestrator = new SupervisorOrchestratorService();
			const bus = new SupervisorEventBus();
			(orchestrator as unknown as { supervisorEvents: SupervisorEventBus }).supervisorEvents = bus;

			const pending = orchestrator.getSupervisor(FakeSupervisor, { timeoutMs: 200 });
			vi.advanceTimersByTime(200);

			await expect(pending).resolves.toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});

	it("fetches a supervisor by its stable id", async () => {
		const orchestrator = new SupervisorOrchestratorService();
		const ok = new FakeSupervisor("ok");
		orchestrator.register(ok);

		expect(await orchestrator.getSupervisorById("ok")).toBe(ok);
		expect(await orchestrator.getSupervisorById("missing", { timeoutMs: 0 })).toBeNull();
	});

	it("exposes the entire process info of a supervised process", async () => {
		const orchestrator = new SupervisorOrchestratorService();
		const ok = new FakeSupervisor("ok");
		orchestrator.register(ok);

		const supervisor = await orchestrator.getSupervisor(FakeSupervisor);
		const info = supervisor !== null ? await supervisor.getProcessInfo() : null;

		expect(info).toMatchObject({
			supervisorId: "ok",
			description: "fake supervised thing",
			state: "idle",
			healthy: false,
		});
	});
});
/**
 * A DEGRADED supervisor used to be permanent: `ensureAll()` ran once at
 * bootstrap and nothing retried. That is fatal here for a structural reason —
 * the API starts before setup provisions the database, so a DB-touching
 * supervisor can lose the race by seconds and then stay degraded forever:
 *
 *   [ManagedWebSupervisor] Convergence failed: insert into "app_config" ...
 *   (09:02:22, against a schema that finished migrating at 09:02:27)
 *
 * The consequence was not cosmetic: `/health/ready` stayed red, and setup waits
 * for readiness before releasing the entry port — so the handover never ran and
 * traefik was never promoted to a swarm service.
 */
describe("SupervisorOrchestratorService degraded retry", () => {
	it("recovers a supervisor whose failure was transient", async () => {
		vi.useFakeTimers();
		try {
			const orchestrator = new SupervisorOrchestratorService();
			const failing = new FakeSupervisor("transient", new Error("relation does not exist"));
			(orchestrator as unknown as { supervisors: Map<string, FakeSupervisor> }).supervisors.set(
				"transient",
				failing,
			);

			// Boot: fails, so it goes DEGRADED.
			await failing.ensureDesiredState();
			expect(failing.getStateSnapshot().state).toBe("degraded");
			expect(failing.reconcileCalls).toBe(1);

			// The precondition now exists (schema migrated) — the retry must
			// succeed where boot failed.
			(failing as unknown as { reconcileError?: Error }).reconcileError = undefined;
			await (orchestrator as unknown as { retryDegraded(): Promise<string[]> }).retryDegraded();

			expect(failing.getStateSnapshot().state).toBe("converged");
			expect(failing.reconcileCalls).toBe(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it("does NOT retry a converged supervisor", async () => {
		const orchestrator = new SupervisorOrchestratorService();
		const healthy = new FakeSupervisor("fine");
		(orchestrator as unknown as { supervisors: Map<string, FakeSupervisor> }).supervisors.set("fine", healthy);

		await healthy.ensureDesiredState();
		expect(healthy.reconcileCalls).toBe(1);

		const recovered = await (orchestrator as unknown as { retryDegraded(): Promise<string[]> }).retryDegraded();

		// Nothing degraded means nothing to retry — the cadence is not a poll.
		expect(recovered).toEqual([]);
		expect(healthy.reconcileCalls).toBe(1);
	});

	it("keeps a genuinely broken supervisor degraded instead of masking it", async () => {
		const orchestrator = new SupervisorOrchestratorService();
		const broken = new FakeSupervisor("broken", new Error("engine refused"));
		(orchestrator as unknown as { supervisors: Map<string, FakeSupervisor> }).supervisors.set("broken", broken);

		await broken.ensureDesiredState();
		const recovered = await (orchestrator as unknown as { retryDegraded(): Promise<string[]> }).retryDegraded();

		// Still degraded, and NOT reported as recovered — a real fault must keep
		// surfacing through health.
		expect(recovered).toEqual([]);
		expect(broken.getStateSnapshot().state).toBe("degraded");
	});

	it("isolates one failing retry from the others in the same pass", async () => {
		const orchestrator = new SupervisorOrchestratorService();
		const broken = new FakeSupervisor("broken", new Error("still broken"));
		const fixable = new FakeSupervisor("fixable", new Error("transient"));
		const registry = (orchestrator as unknown as { supervisors: Map<string, FakeSupervisor> }).supervisors;
		registry.set("broken", broken);
		registry.set("fixable", fixable);

		await broken.ensureDesiredState();
		await fixable.ensureDesiredState();
		(fixable as unknown as { reconcileError?: Error }).reconcileError = undefined;

		const recovered = await (orchestrator as unknown as { retryDegraded(): Promise<string[]> }).retryDegraded();

		expect(recovered).toEqual(["fixable"]);
		expect(fixable.getStateSnapshot().state).toBe("converged");
		expect(broken.getStateSnapshot().state).toBe("degraded");
	});
});