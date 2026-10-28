import { Inject, Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import {
	makeSupervisorOrchestrator,
	type HealthSnapshot,
	type SupervisorOrchestratorShape,
	type SupervisorState,
} from "@deployer/supervision";
import { Cause, Effect, Exit } from "effect";

import type { SupervisorHost } from "./base-supervisor.service";
import { SupervisorEventBus } from "./supervisor-event.bus";

/** Any registered supervisor: payload and process-info types are heterogeneous. */
export type AnySupervisor = SupervisorHost<any, any>;

/**
 * The Nest face of the `SupervisorOrchestrator` in `@deployer/supervision`: the same registry,
 * boot convergence and drift control, with the Promise API the Nest callers use.
 *
 * Supervisors register themselves from their own `onModuleInit` (each decides when it is ready), so
 * a module adds a supervisor without touching this class. The registry belongs to the Nest
 * container, not the process: booting the same app twice gives each its own supervisors.
 */
@Injectable()
export class SupervisorOrchestratorService implements OnApplicationBootstrap, OnModuleDestroy {
	@Inject(SupervisorEventBus)
	protected readonly supervisorEvents: SupervisorEventBus | undefined;

	private orchestrator: SupervisorOrchestratorShape | undefined;
	private stopDriftControl: Effect.Effect<void> | undefined;

	/** Built on first use: the bus is injected after construction. */
	get core(): SupervisorOrchestratorShape {
		return (this.orchestrator ??= makeSupervisorOrchestrator(this.supervisorEvents?.core));
	}

	private static fail(exit: Exit.Exit<unknown, unknown>): never {
		throw Cause.squash((exit as Exit.Failure<unknown, unknown>).cause);
	}

	register(supervisor: AnySupervisor): void {
		const exit = Effect.runSyncExit(this.core.register(supervisor.runtime));
		if (!Exit.isSuccess(exit)) SupervisorOrchestratorService.fail(exit);
	}

	list(): AnySupervisor[] {
		return this.core.list().map((entry) => entry.source as AnySupervisor);
	}

	has(supervisorId: string): boolean {
		return this.core.has(supervisorId);
	}

	/**
	 * A registered supervisor by its class, typed by its own schemas. Waits (up to `timeoutMs`,
	 * default 10s) for it to register, since supervisors register late when they depend on something
	 * that does not exist at boot. Null when none did.
	 */
	async getSupervisor<T extends AnySupervisor>(
		supervisorClass: new (...args: any[]) => T,
		options: { timeoutMs?: number } = {},
	): Promise<T | null> {
		const found = await Effect.runPromise(this.core.getMatching((entry) => entry.source instanceof supervisorClass, options));
		return found === null ? null : (found.source as T);
	}

	/** A registered supervisor by id; typed only at runtime, so prefer `getSupervisor(Class)`. */
	async getSupervisorById(supervisorId: string, options: { timeoutMs?: number } = {}): Promise<AnySupervisor | null> {
		const found = await Effect.runPromise(this.core.getById(supervisorId, options));
		return found === null ? null : (found.source as AnySupervisor);
	}

	ensureAll(): Promise<Map<string, SupervisorState>> {
		return Effect.runPromise(this.core.ensureAll);
	}

	convergeNow(supervisorId: string): Promise<SupervisorState | null> {
		return Effect.runPromise(this.core.convergeNow(supervisorId));
	}

	/** The supervisors whose last convergence failed. The app never stops for one. */
	degraded(): AnySupervisor[] {
		return this.list().filter((supervisor) => supervisor.getStateSnapshot().state === "degraded");
	}

	getHealthOfAll(): Promise<HealthSnapshot<unknown>[]> {
		return Effect.runPromise(this.core.healthOfAll);
	}

	async onApplicationBootstrap(): Promise<void> {
		if (process.env.NODE_ENV === "test" || this.core.list().length === 0) return;
		const control = await Effect.runPromise(this.core.startDriftControl);
		this.stopDriftControl = control.stop;
	}

	async onModuleDestroy(): Promise<void> {
		if (this.stopDriftControl) await Effect.runPromise(this.stopDriftControl);
	}
}
