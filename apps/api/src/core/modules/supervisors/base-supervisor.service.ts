/**
 * BaseSupervisorService — framework base for desired-state supervisors.
 *
 * A supervisor owns ONE piece of platform infrastructure (a container, a
 * process, a resource). It converges an observed state towards a desired
 * state and reports its health. Concrete subclasses implement:
 *
 *   - `reconcile()` — idempotent convergence (single pass, throws on failure)
 *   - `probe()`     — REAL health observation with a rich, typed payload
 *
 * TYPED, ZOD-VALIDATED PAYLOADS
 * -----------------------------
 * Every supervisor declares `payloadSchema` (a Zod schema — the single source
 * of truth for what its probe reports). `probe()` returns a
 * {@link SupervisorProbeResult} whose `payload` is validated against that
 * schema at runtime before it is exposed through `getHealth()`. Consumers get
 * fully typed, runtime-verified measurements (latency, sizes, status codes,
 * process state) instead of a bare boolean. Discriminated-union schemas let a
 * supervisor report different detail branches (e.g. the DB supervisor reports
 * "managed" vs "external" modes).
 *
 * Every supervisor ALSO declares `processInfoSchema` and exposes
 * `getProcessInfo()` — the entire config + live state of the supervised
 * process (docker process, entry points, connection URLs, …), validated
 * against its schema the same way.
 *
 * Supervisors SELF-REGISTER into the SupervisorOrchestratorService from their
 * own `onModuleInit` (each decides when IT is ready — e.g. the global-db
 * supervisor waits for the database URL), so adding a supervisor to any
 * module automatically makes it visible to health reporting. Consumers
 * resolve it with `await orch.getSupervisor(SupervisorClass)`.
 */

import { Inject, Logger, type OnModuleInit } from "@nestjs/common";
import { createHash } from "node:crypto";
import z from "zod/v4";

import { SupervisorOrchestratorService } from "./supervisor-orchestrator.service";
import { SupervisorEventBus } from "./supervisor-event.bus";
import { baseSupervisorProcessInfoSchema } from "./supervisor-process-info";

/** Lifecycle state of a supervisor's last convergence attempt. */
export type SupervisorState = "idle" | "converging" | "converged" | "degraded";

/** Shared measurement fields every supervisor payload must carry. */
export const supervisorProbeMetaSchema = z.object({
	/** ISO 8601 timestamp of the probe. */
	checkedAt: z.string().datetime(),
	/** Round-trip latency of the probe's primary check, milliseconds. */
	latencyMs: z.number().int().min(0),
});
export type SupervisorProbeMeta = z.infer<typeof supervisorProbeMetaSchema>;

/** Minimal payload schema every supervisor extends. */
export const baseSupervisorPayloadSchema = supervisorProbeMetaSchema;
export type BaseSupervisorPayload = z.infer<typeof baseSupervisorPayloadSchema>;

/** Result of a supervisor-specific health probe (rich + typed). */
export interface SupervisorProbeResult<TSchema extends z.ZodType> {
	healthy: boolean;
	/** Human-readable context — what is wrong, or notable status. */
	detail?: string;
	/** Rich, typed measurement payload. Validated against `payloadSchema` at runtime. */
	payload: z.output<TSchema>;
}

/** Full health snapshot exposed through the orchestrator / health module. */
export interface SupervisorHealthSnapshot<TSchema extends z.ZodType> {
	supervisorId: string;
	description: string;
	healthy: boolean;
	state: SupervisorState;
	detail: string | null;
	/** ISO 8601 timestamp of the probe. */
	checkedAt: string;
	/**
	 * Non-fatal warnings the operator must act on (e.g. "ingress port 80 is
	 * taken; the app is running headless"). The app KEEPS running — warnings
	 * are surfaced to the web app for remediation.
	 */
	warnings: string[];
	/** Zod-validated rich payload (typed per supervisor). */
	payload: z.output<TSchema>;
}

export interface BackoffOptions {
	maxAttempts?: number;
	baseDelayMs?: number;
	maxDelayMs?: number;
}

const DEFAULT_BACKOFF: Required<BackoffOptions> = {
	maxAttempts: 5,
	baseDelayMs: 1_000,
	maxDelayMs: 60_000,
};

/**
 * A supervisor is generic over its own payload schema. `z.output<T>` keeps the
 * inferred TS type in sync with the runtime-validated shape. Subclasses extend
 * `baseSupervisorPayloadSchema`, so every payload carries the shared probe meta
 * (checkedAt, latencyMs).
 */
/** Anything a supervisor can identify itself by: a plain key, or a record of
 *  instance-specific fields (e.g. { prefix: "acme" } for multi-instance classes). */
export type SupervisorIdentifierInput = string | number | Record<string, unknown> | null | undefined;

/**
 * A supervisor is generic over its own payload schema. `z.output<T>` keeps the
 * inferred TS type in sync with the runtime-validated shape. Subclasses extend
 * `baseSupervisorPayloadSchema`, so every payload carries the shared probe meta
 * (checkedAt, latencyMs).
 *
 * IDENTIFIERS
 * -----------
 * Every supervisor class declares a static `identifier` (its stable base id)
 * and exposes `getIdentifier(input?)`:
 *
 *   TraefikSupervisorService.getIdentifier()                  → "platform-ingress-traefik"
 *   MultiInstanceSupervisor.getIdentifier({ prefix: "acme" }) → "multi:acme:ab12cd34" (hashed)
 *
 * The instance `supervisorId` is computed ONCE from that same static (via
 * `getIdentifierInput()`), so registry keys are deterministic and referencing
 * an id is always `SomeSupervisor.getIdentifier(...)` — never a duplicated
 * literal.
 */
export abstract class BaseSupervisorService<
	TSchema extends z.ZodType = typeof baseSupervisorPayloadSchema,
	TProcessSchema extends z.ZodType = typeof baseSupervisorProcessInfoSchema,
> implements OnModuleInit {
	/**
	 * Stable base identifier for this supervisor class (no input).
	 * Subclasses MUST override with their unique id.
	 */
	static readonly identifier: string;

	/**
	 * Compute this supervisor class's identifier deterministically.
	 * No input → the static `identifier`. With input (multi-instance classes)
	 * → `${identifier}:<sha256(input) short>` so each instance is unique.
	 */
	static getIdentifier(input?: SupervisorIdentifierInput): string {
		const baseId = (this as unknown as { identifier?: string }).identifier;
		const resolved = baseId ?? this.name;
		if (input === undefined || input === null) return resolved;
		const serialized =
			typeof input === "string" || typeof input === "number"
				? String(input)
				: JSON.stringify(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)));
		const digest = createHash("sha256").update(`${resolved}:${serialized}`).digest("hex").slice(0, 12);
		return `${resolved}:${digest}`;
	}

	/** Unique, stable identifier used for registry dedupe and health reporting.
	 *  Computed ONCE (memoized) from the class static + instance identifier
	 *  input — subclasses NEVER hardcode a duplicated id. Lazy so instance
	 *  fields (used by getIdentifierInput) are initialized first. */
	get supervisorId(): string {
		if (this._supervisorId === undefined) {
			const ctor = this.constructor as unknown as typeof BaseSupervisorService;
			this._supervisorId = ctor.getIdentifier(this.getIdentifierInput());
		}
		return this._supervisorId;
	}
	private _supervisorId: string | undefined;
	abstract readonly description: string;

	/**
	 * Zod schema of the typed health payload this supervisor produces.
	 * SSOT for the shape reported through `getHealth().payload`.
	 */
	abstract readonly payloadSchema: TSchema;

	/**
	 * Zod schema of the PROCESS INFO this supervisor exposes (the entire
	 * config + reachability of the supervised process: docker process, entry
	 * points, connection URLs, …). SSOT for the shape returned through
	 * `getProcessInfo()` — mirrors the payload pattern.
	 */
	abstract readonly processInfoSchema: TProcessSchema;

	protected readonly logger: Logger;

	/**
	 * Auto-registration anchor. The global SupervisorsModule property-injects
	 * the orchestrator into every supervisor; `onModuleInit` then publishes the
	 * instance. Adding a supervisor to ANY module automatically surfaces it to
	 * boot convergence and health aggregation — zero manual registry edits.
	 *
	 * Direct construction (`new`, unit tests) leaves the property unset and
	 * registration is skipped harmlessly.
	 *
	 * Subclasses overriding `onModuleInit` MUST call `super.onModuleInit()`.
	 */
	@Inject(SupervisorOrchestratorService)
	protected readonly orchestrator: SupervisorOrchestratorService | undefined;

	/**
	 * Event bus for supervisor lifecycle/health. Emitted at the natural
	 * transition points (registered, state-changed, reconciled,
	 * health-snapshot). Direct construction (unit tests) leaves it unset and
	 * emission is skipped harmlessly.
	 */
	@Inject(SupervisorEventBus)
	protected readonly eventBus: SupervisorEventBus | undefined;

	private state: SupervisorState = "idle";
	private detail: string | null = null;

	constructor() {
		this.logger = new Logger(this.constructor.name);
	}

	/** Shared emit helper; no-op when the bus isn't injected. */
	protected emitEvent(type: "registered" | "state-changed" | "reconciled" | "health-snapshot", extra: Partial<import("./supervisor-event.bus").SupervisorEvent> = {}): void {
		this.eventBus?.emit({
			supervisorId: this.supervisorId,
			type,
			at: new Date().toISOString(),
			state: this.state,
			detail: this.detail,
			...extra,
		});
	}

	/**
	 * Instance-specific part of the identifier. Single-instance supervisors
	 * return undefined (→ the static identifier). Multi-instance classes
	 * (one supervisor instance per prefix/project/key) override this to return
	 * their distinguishing fields — each instance gets a unique hashed id.
	 */
	protected getIdentifierInput(): SupervisorIdentifierInput {
		return undefined;
	}

	/** @inheritdoc — publishes this supervisor into the global registry. */
	onModuleInit(): void {
		this.orchestrator?.register(this);
		this.emitEvent("registered");
	}

	/**
	 * One idempotent convergence pass towards the desired state.
	 * Must throw on failure so callers can apply backoff/retry policy.
	 */
	protected abstract reconcile(): Promise<void>;

	/**
	 * REAL health observation of the supervised resource: runs actual probes /
	 * measurements (HTTP checks, process state, container sizes) and reports
	 * them as a rich typed payload. Must NOT trigger reconciliation — read-only
	 * observation only. Should NOT throw for an unhealthy resource — return
	 * `healthy:false` with a payload describing the failure.
	 */
	protected abstract probe(): Promise<SupervisorProbeResult<TSchema>>;

	/**
	 * Shape of the payload to report when `probe()` itself throws (a probe
	 * mechanism failure, e.g. docker socket unreachable). Must satisfy
	 * `payloadSchema` — typically all measurements null / failure markers.
	 */
	protected abstract buildDegradedPayload(detail: string): z.output<TSchema>;

	/**
	 * Entire config + live information about the supervised process. Runs a
	 * REAL health probe first (so `healthy` reflects actual measurements) and
	 * validates the merged result against `processInfoSchema` at runtime.
	 *
	 *   const traefik = await orch.getSupervisor(TraefikSupervisorService);
	 *   const info = traefik && (await traefik.getProcessInfo());
	 *   // info.process.kind === "docker", info.urls.entryUrl, info.entry.port
	 */
	async getProcessInfo(): Promise<z.output<TProcessSchema>> {
		const health = await this.getHealth();
		return this.processInfoSchema.parse({
			supervisorId: health.supervisorId,
			description: health.description,
			state: health.state,
			healthy: health.healthy,
			detail: health.detail,
			warnings: health.warnings,
			checkedAt: health.checkedAt,
			...(await this.buildProcessInfo()),
		});
	}

	/**
	 * Supervisor-specific process description fragment — the kind of process
	 * (docker container, sqlite file, …), its desired config and how to reach
	 * it (entry port, URLs, connection string). The merged result is
	 * runtime-validated against `processInfoSchema` before return.
	 */
	protected abstract buildProcessInfo(): Promise<Record<string, unknown>>;

	/** Drive convergence once, recording state transitions. Never throws. */
	async ensureDesiredState(): Promise<SupervisorState> {
		this.state = "converging";
		this.emitEvent("state-changed");
		try {
			await this.reconcile();
			this.state = "converged";
			this.detail = null;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.state = "degraded";
			this.detail = message;
			this.logger.warn(`Convergence failed: ${message}`);
		}
		this.emitEvent("state-changed");
		this.emitEvent("reconciled");
		return this.state;
	}

	/** Full health snapshot; probe failures degrade gracefully instead of throwing. */
	async getHealth(): Promise<SupervisorHealthSnapshot<TSchema>> {
		let probeResult: SupervisorProbeResult<TSchema>;
		try {
			const raw = await this.probe();
			// Zod is the source of truth: the reported payload is validated at
			// runtime so consumers never see an unverified shape.
			probeResult = { ...raw, payload: this.payloadSchema.parse(raw.payload) };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			probeResult = {
				healthy: false,
				detail: message,
				payload: this.payloadSchema.parse(this.buildDegradedPayload(message)),
			};
		}
		return {
			supervisorId: this.supervisorId,
			description: this.description,
			healthy: this.state === "converged" && probeResult.healthy,
			state: this.state,
			detail: probeResult.detail ?? this.detail,
			// Snapshot timestamp = when getHealth ran; the payload carries its
			// own probe-time checkedAt.
			checkedAt: new Date().toISOString(),
			warnings: this.collectWarnings(probeResult),
			payload: probeResult.payload,
		};
	}

	/**
	 * Non-fatal warnings the operator must see. Default: a health-negative
	 * probe whose resource is RUNNING-ish still yields a warning (e.g. a
	 * degraded convergence). Subclasses override to add resource-specific
	 * warnings (Traefik headless on a port conflict, etc.).
	 */
	protected collectWarnings(_probe: SupervisorProbeResult<TSchema>): string[] {
		if (this.state === "degraded") {
			return [`${this.supervisorId}: convergence degraded — ${this.detail ?? "unknown"}`];
		}
		return [];
	}

	/**
	 * Full health snapshot + event publication (health-snapshot on the bus).
	 * Consumers that only need the snapshot call `getHealth()`; subscribers
	 * observe the same state transition through `health-snapshot` events.
	 */
	async getHealthAndNotify(): Promise<SupervisorHealthSnapshot<TSchema>> {
		const snapshot = await this.getHealth();
		this.emitEvent("health-snapshot", { healthy: snapshot.healthy, detail: snapshot.detail });
		return snapshot;
	}

	getStateSnapshot(): { state: SupervisorState; detail: string | null } {
		return { state: this.state, detail: this.detail };
	}

	/**
	 * Retry helper with exponential backoff for concrete reconcile()
	 * implementations. Rethrows the last error after exhausting attempts.
	 */
	protected async runWithBackoff(label: string, fn: () => Promise<void>, options?: BackoffOptions): Promise<void> {
		const opts = { ...DEFAULT_BACKOFF, ...options };
		let lastError: unknown = null;
		for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
			try {
				await fn();
				return;
			} catch (error) {
				lastError = error;
				const message = error instanceof Error ? error.message : String(error);
				this.logger.warn(`${label} attempt ${String(attempt)}/${String(opts.maxAttempts)} failed: ${message}`);
				// A FATAL error (deterministic conflict — e.g. entry port bound)
				// must not be retried; surface the DEGRADED state immediately.
				if (this.isFatalConvergenceError(error)) throw error;
				if (attempt < opts.maxAttempts) {
					await this.delay(Math.min(opts.baseDelayMs * 2 ** (attempt - 1), opts.maxDelayMs));
				}
			}
		}
		throw lastError;
	}

	/** Deterministic conflicts that the backoff must NOT retry. Default: none.
	 *  Subclasses override (e.g. Traefik's entry-port conflict). */
	protected isFatalConvergenceError(_error: unknown): boolean {
		return false;
	}

	protected delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
