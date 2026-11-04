import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { makeSupervisorDriftControl } from "./supervisors.module";
import { makeSupervisorEventBusFacade } from "./supervisor-event.bus";
import { makeSupervisorRegistrar, type SupervisorRegistration } from "./supervisor-registration";

import type { SupervisorOrchestratorShape } from "@deployer/supervision";

const registration = (id: string, activate: SupervisorRegistration["activate"], blocking?: boolean): SupervisorRegistration => ({
	supervisor: { id } as never,
	activate,
	blocking,
});

describe("makeSupervisorRegistrar", () => {
	const orchestrator = () => ({ register: vi.fn(() => Effect.void) }) as unknown as SupervisorOrchestratorShape & { register: ReturnType<typeof vi.fn> };

	it("registers what activates, skips a null activation and logs (never fails) one that errors", async () => {
		const o = orchestrator();
		const registrar = makeSupervisorRegistrar(
			[
				registration("ok", Effect.succeed({})),
				registration("skipped", Effect.succeed(null)),
				registration("broken", Effect.fail(new Error("provider down"))),
			],
			o,
		);
		await Effect.runPromise(registrar.onStart());
		expect(o.register).toHaveBeenCalledTimes(1);
		expect((o.register.mock.calls[0]?.[0] as { id: string }).id).toBe("ok");
	});

	it("does not wait for a non-blocking registration, and interrupts the background loops on stop", async () => {
		const o = orchestrator();
		let interrupted = false;
		const loop = Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(() => { interrupted = true; })));
		const registrar = makeSupervisorRegistrar([registration("loop", Effect.succeed({ background: loop })), registration("slow", Effect.never, false)], o);
		await Effect.runPromise(registrar.onStart());
		expect(o.register).toHaveBeenCalledTimes(1);
		await new Promise((resolve) => setTimeout(resolve, 5)); // let the loop start, so interrupting it is observable
		await Effect.runPromise(registrar.onStop());
		expect(interrupted).toBe(true);
	});
});

describe("makeSupervisorDriftControl", () => {
	it("starts drift control on ready only when something is registered, and stops it on stop", async () => {
		const stop = vi.fn(() => Effect.void);
		const start = Effect.succeed({ stop: Effect.suspend(stop) });
		const withSupervisors = { list: () => [{}], startDriftControl: start } as unknown as SupervisorOrchestratorShape;
		const empty = { list: () => [], startDriftControl: start } as unknown as SupervisorOrchestratorShape;
		const previous = process.env.NODE_ENV;
		process.env.NODE_ENV = "production";
		try {
			const control = makeSupervisorDriftControl(withSupervisors);
			await Effect.runPromise(control.onReady!());
			await Effect.runPromise(control.onStop!());
			expect(stop).toHaveBeenCalledOnce();

			stop.mockClear();
			const idle = makeSupervisorDriftControl(empty);
			await Effect.runPromise(idle.onReady!());
			await Effect.runPromise(idle.onStop!());
			expect(stop).not.toHaveBeenCalled();
		} finally {
			process.env.NODE_ENV = previous;
		}
	});
});

describe("SupervisorEventBus facade", () => {
	it("lets the Effect bus and the Observable see the same events", async () => {
		const bus = makeSupervisorEventBusFacade();
		const seen = bus.once({});
		await Effect.runPromise(bus.core.emit({ type: "state", supervisorId: "x" } as never));
		expect(await seen).toMatchObject({ supervisorId: "x" });
	});
});
