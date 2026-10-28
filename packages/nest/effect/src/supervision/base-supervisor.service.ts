import { Inject, Logger, type OnModuleInit } from "@nestjs/common";
import {
	baseSupervisorPayloadSchema,
	makeSupervisor,
	supervisorIdentifier,
	withBackoff,
	type BackoffOptions,
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
import { attempt } from "./run";
import { SupervisorEventBus } from "./supervisor-event.bus";
import { SupervisorOrchestratorService } from "./supervisor-orchestrator.service";

export type SupervisorProbeResult<TSchema extends z.ZodType> = ProbeResult<z.output<TSchema>>;
export type SupervisorHealthSnapshot<TSchema extends z.ZodType> = HealthSnapshot<z.output<TSchema>>;

/**
 * The Nest host for a desired-state supervisor.
 *
 * A subclass is one piece of platform infrastructure: it converges towards its desired state
 * (`reconcile`) and reports health (`probe`). The lifecycle (state transitions, health, process
 * info, backoff, events, registry, drift control) is the Effect framework in `@deployer/supervision`;
 * this class adapts its Promise methods into a `SupervisorSpec` and exposes the framework's `Supervisor`
 * as `runtime`.
 *
 * Every supervisor declares `payloadSchema` (what `probe` reports) and `processInfoSchema` (what
 * `getProcessInfo` reports); both are validated at runtime, so consumers get typed, verified
 * measurements instead of a boolean. Supervisors register themselves from `onModuleInit` (each
 * decides when it is ready); a subclass that overrides it must call `super.onModuleInit()`.
 * Consumers resolve one with `await orchestrator.getSupervisor(SupervisorClass)`.
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
	getHealth(): Promise<SupervisorHealthSnapshot<TSchema>> {
		return runPromiseUnwrapped(this.runtime.getHealth);
	}

	/** `getHealth`, published as a `health-snapshot` event. */
	getHealthAndNotify(): Promise<SupervisorHealthSnapshot<TSchema>> {
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

/**
 * A supervisor written as Promise methods: the Nest subclasses that have not moved to an Effect
 * `SupervisorSpec` yet. `buildSpec` adapts the methods; the lifecycle is the same framework.
 */
export abstract class BaseSupervisorService<
	TSchema extends z.ZodType = typeof baseSupervisorPayloadSchema,
	TProcessSchema extends z.ZodType = typeof baseSupervisorProcessInfoSchema,
> extends SupervisorHost<TSchema, TProcessSchema> {
	protected buildSpec(): SupervisorSpec<TSchema, TProcessSchema> {
		return {
			id: this.supervisorId,
			description: this.description,
			payloadSchema: this.payloadSchema,
			processInfoSchema: this.processInfoSchema,
			converge: attempt(() => this.reconcile()),
			probe: attempt(() => this.probe()),
			degradedPayload: (detail) => this.buildDegradedPayload(detail),
			processInfo: attempt(() => this.buildProcessInfo()),
			blocker: attempt(() => this.convergenceBlocker()),
			warnings: (probe) => this.collectWarnings(probe),
		};
	}

	/** One idempotent convergence pass. Throws on failure so the caller can apply a backoff policy. */
	protected abstract reconcile(): Promise<void>;

	/**
	 * A real observation of the resource, with a rich typed payload. Read-only: it must not converge,
	 * and should return `healthy: false` for an unhealthy resource rather than throw.
	 */
	protected abstract probe(): Promise<SupervisorProbeResult<TSchema>>;

	/** The payload to report when `probe` itself throws (the engine is unreachable); must satisfy `payloadSchema`. */
	protected abstract buildDegradedPayload(detail: string): z.output<TSchema>;

	/** The supervisor-specific part of the process info: kind of process, desired config, how to reach it. */
	protected abstract buildProcessInfo(): Promise<Record<string, unknown>>;

	/** A precondition that makes convergence impossible right now, or null. The base is never blocked. */
	protected convergenceBlocker(): Promise<string | null> {
		return Promise.resolve(null);
	}

	/** Non-fatal warnings the operator must see. By default a degraded convergence is one. */
	protected collectWarnings(_probe: SupervisorProbeResult<TSchema>): string[] {
		const { state, detail } = this.getStateSnapshot();
		return state === "degraded" ? [`${this.supervisorId}: convergence degraded — ${detail ?? "unknown"}`] : [];
	}

	/** Deterministic conflicts the backoff must not retry. */
	protected isFatalConvergenceError(_error: unknown): boolean {
		return false;
	}

	protected delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/** Retries `fn` with exponential backoff, rethrowing the last error once the attempts run out. */
	protected async runWithBackoff(label: string, fn: () => Promise<void>, options?: BackoffOptions): Promise<void> {
		await runPromiseUnwrapped(
			withBackoff(label, attempt(fn), {
				...options,
				isFatal: (error) => this.isFatalConvergenceError(error),
				sleep: (ms) => Effect.promise(() => this.delay(ms)),
			}),
		);
	}
}
