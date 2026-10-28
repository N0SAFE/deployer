import { Inject, Logger, type OnModuleInit } from "@nestjs/common";
import {
	baseSupervisorPayloadSchema,
	makeSupervisor,
	supervisorIdentifier,
	type baseSupervisorProcessInfoSchema,
	type HealthSnapshot,
	type ProbeResult,
	type Supervisor,
	type SupervisorSpec,
	type SupervisorIdentifierInput,
	type SupervisorState,
} from "@deployer/supervision";
import { Effect } from "effect";
import type z from "zod/v4";

import { runPromiseUnwrapped } from "@deployer/effect-core";
import { SupervisorEventBus } from "./supervisor-event.bus";
import { SupervisorOrchestratorService } from "./supervisor-orchestrator.service";


/**
 * The Nest host for a desired-state supervisor.
 *
 * A supervisor is one piece of platform infrastructure: an Effect `SupervisorSpec` (how to converge it,
 * how to probe it, what the observations look like) written in a platform package such as
 * `@deployer/platform-supervisors`. A subclass is the Nest face of one: it supplies the engine and the
 * environment, returns the spec from `buildSpec`, and decides in `onModuleInit` WHETHER to register.
 * The lifecycle (state transitions, health, process info, events, registry, drift control) is the Effect
 * framework in `@deployer/supervision`; this class exposes the framework's `Supervisor` as `runtime` and
 * its operations as Promises for the callers that are not on Effect yet.
 *
 * Every supervisor declares `payloadSchema` (what the probe reports) and `processInfoSchema` (what
 * `getProcessInfo` reports); both are validated at runtime, so consumers get typed, verified
 * measurements instead of a boolean. A subclass that overrides `onModuleInit` must call
 * `super.onModuleInit()` to register. Consumers resolve one with
 * `await orchestrator.getSupervisor(SupervisorClass)`.
 *
 * Identifiers: a class declares a static `identifier`, and `getIdentifier(input?)` gives the stable
 * registry id, hashed with the input for classes with several instances.
 */
export abstract class SupervisorHost<
	TSchema extends z.ZodType = typeof baseSupervisorPayloadSchema,
	TProcessSchema extends z.ZodType = typeof baseSupervisorProcessInfoSchema,
> implements OnModuleInit
{
	/** Stable base identifier of this supervisor class. Subclasses override it. */
	static readonly identifier: string;

	static getIdentifier(input?: SupervisorIdentifierInput): string {
		const base = (this as unknown as { identifier?: string }).identifier ?? this.name;
		return supervisorIdentifier(base, input);
	}

	/** The registry id, computed once from the class static and `getIdentifierInput()`. */
	get supervisorId(): string {
		this._supervisorId ??= (this.constructor as unknown as typeof SupervisorHost).getIdentifier(this.getIdentifierInput());
		return this._supervisorId;
	}
	private _supervisorId: string | undefined;

	abstract readonly description: string;
	abstract readonly payloadSchema: TSchema;
	abstract readonly processInfoSchema: TProcessSchema;

	protected readonly logger: Logger;

	/** Injected by the global SupervisorsModule; unset under direct construction (unit tests), which skips registration. */
	@Inject(SupervisorOrchestratorService)
	protected readonly orchestrator: SupervisorOrchestratorService | undefined;

	@Inject(SupervisorEventBus)
	protected readonly eventBus: SupervisorEventBus | undefined;

	private _runtime: Supervisor<z.output<TSchema>, z.output<TProcessSchema>> | undefined;

	constructor() {
		this.logger = new Logger(this.constructor.name);
	}

	/** The Effect supervisor running this one's lifecycle, built on first use. */
	get runtime(): Supervisor<z.output<TSchema>, z.output<TProcessSchema>> {
		this._runtime ??= makeSupervisor(
			this.buildSpec(),
			{ ...(this.eventBus ? { bus: this.eventBus.core } : {}), label: this.constructor.name, source: this },
		);
		return this._runtime;
	}

	/** The description of this supervisor for the Effect lifecycle. */
	protected abstract buildSpec(): SupervisorSpec<TSchema, TProcessSchema>;

	/** The instance-specific part of the identifier; single-instance supervisors return undefined. */
	protected getIdentifierInput(): SupervisorIdentifierInput {
		return undefined;
	}

	onModuleInit(): void {
		this.orchestrator?.register(this as never);
	}

	/** One convergence pass, recording the state it ends in. Never throws. */
	ensureDesiredState(): Promise<SupervisorState> {
		return runPromiseUnwrapped(this.runtime.ensureDesiredState);
	}

	/** Health snapshot; a probe that fails degrades gracefully instead of throwing. */
	getHealth(): Promise<HealthSnapshot<z.output<TSchema>>> {
		return runPromiseUnwrapped(this.runtime.getHealth);
	}

	/** `getHealth`, published as a `health-snapshot` event. */
	getHealthAndNotify(): Promise<HealthSnapshot<z.output<TSchema>>> {
		return runPromiseUnwrapped(this.runtime.getHealthAndNotify);
	}

	/** Health plus the supervisor's process description, validated against `processInfoSchema`. */
	getProcessInfo(): Promise<z.output<TProcessSchema>> {
		return runPromiseUnwrapped(this.runtime.getProcessInfo);
	}

	getStateSnapshot(): { state: SupervisorState; detail: string | null } {
		return Effect.runSync(this.runtime.getStateSnapshot);
	}
}
