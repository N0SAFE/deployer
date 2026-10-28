import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit, type Provider } from "@nestjs/common";
import { runPromiseUnwrapped, runSyncUnwrapped } from "@deployer/effect-core";
import {
	makeSupervisor,
	SupervisorOrchestrator,
	type AnySupervisor,
	type SupervisorOrchestratorShape,
	type SupervisorSpec,
} from "@deployer/supervision";
import { Effect, Fiber } from "effect";
import type z from "zod/v4";

import type { SupervisorEventBus } from "./supervisor-event.bus";

/**
 * One supervisor in a module: the Effect `Supervisor` built from its spec, and when (and whether) it
 * joins the orchestrator.
 *
 * A supervisor is one piece of platform infrastructure, written as a `SupervisorSpec` in a platform
 * package. What the app adds is the decision to register it: `activate` returns null to skip (after
 * logging why), or the background loop to run once registered. Everything else (state, health, events,
 * drift control) is the Effect framework.
 */
export type SupervisorRegistration = {
	readonly supervisor: AnySupervisor;
	/** Runs once at module init. Null skips registration; otherwise the optional loop to run beside it. */
	readonly activate: Effect.Effect<{ readonly background?: Effect.Effect<unknown, unknown> } | null, unknown>;
	/** False lets boot continue while `activate` is still resolving (a connector whose provider is slow). */
	readonly blocking?: boolean;
};

/** The runtime of `spec`, publishing its events on the shared bus. */
export const buildSupervisor = <TSchema extends z.ZodType, TProcess extends z.ZodType>(
	spec: SupervisorSpec<TSchema, TProcess>,
	bus: SupervisorEventBus,
	label: string,
) => makeSupervisor(spec, { bus: bus.core, label });

/** Registers a module's supervisors with the orchestrator, runs their background loops, stops them on shutdown. */
@Injectable()
export class SupervisorRegistrar implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(SupervisorRegistrar.name);
	private readonly fibers: Fiber.Fiber<unknown, unknown>[] = [];

	constructor(
		private readonly registrations: readonly SupervisorRegistration[],
		private readonly orchestrator: SupervisorOrchestratorShape,
	) {}

	async onModuleInit(): Promise<void> {
		const starts = this.registrations.map((entry) => {
			const start = this.start(entry);
			return entry.blocking === false ? undefined : start;
		});
		await Promise.all(starts);
	}

	private async start(entry: SupervisorRegistration): Promise<void> {
		try {
			const activation = await runPromiseUnwrapped(entry.activate);
			if (activation === null) return;
			runSyncUnwrapped(this.orchestrator.register(entry.supervisor));
			if (activation.background !== undefined) this.fibers.push(Effect.runFork(activation.background));
		} catch (error: unknown) {
			this.logger.warn(`Supervisor ${entry.supervisor.id} not registered: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	async onModuleDestroy(): Promise<void> {
		await Promise.all(this.fibers.splice(0).map((fiber) => Effect.runPromise(Fiber.interrupt(fiber))));
	}
}

/**
 * Providers for a module's supervisors: the registrations under `token`, and the registrar that
 * activates them. `inject` are the registrations' dependencies, in the order `build` takes them.
 */
export const supervisorProviders = (config: {
	readonly token: symbol;
	readonly inject: (symbol | string | (abstract new (...args: never[]) => unknown))[];
	readonly build: (...deps: never[]) => readonly SupervisorRegistration[];
}): Provider[] => [
	{ provide: config.token, useFactory: config.build, inject: config.inject },
	{
		provide: Symbol(`SupervisorRegistrar:${config.token.description ?? "supervisors"}`),
		useFactory: (registrations: readonly SupervisorRegistration[], orchestrator: SupervisorOrchestratorShape) =>
			new SupervisorRegistrar(registrations, orchestrator),
		inject: [config.token, SupervisorOrchestrator],
	},
];
