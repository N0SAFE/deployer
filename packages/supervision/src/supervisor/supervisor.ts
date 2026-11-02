import { Effect } from "effect";


import type { HealthSnapshot, SupervisorSpec } from "./spec";
import type { SupervisorState } from "./state";
import type { SupervisorEventBusShape } from "../events/event-bus";
import type { SupervisorEvent } from "../events/supervisor-event";
import type z from "zod/v4";

/**
 * A running supervisor: the spec plus the state it has reached. This is what the registry holds and
 * the orchestrator drives.
 */
export type Supervisor<TPayload = unknown, TProcess = unknown> = {
	readonly id: string;
	readonly description: string;
	/** What to call this supervisor in logs and duplicate-id errors. */
	readonly label: string;
	/** The object the supervisor was built from, so a caller can look it up by its type. */
	readonly source: unknown;
	/** One convergence pass, recording the state it ends in. Never fails. */
	readonly ensureDesiredState: Effect.Effect<SupervisorState>;
	/** Probes the resource. A probe that fails is reported as an unhealthy snapshot, not a failure. */
	readonly getHealth: Effect.Effect<HealthSnapshot<TPayload>>;
	/** `getHealth`, and publishes it as a `health-snapshot` event. */
	readonly getHealthAndNotify: Effect.Effect<HealthSnapshot<TPayload>>;
	/** Health plus the supervisor's own process description, validated against its schema. */
	readonly getProcessInfo: Effect.Effect<TProcess, unknown>;
	readonly getStateSnapshot: Effect.Effect<{ readonly state: SupervisorState; readonly detail: string | null }>;
	/** Publishes `registered`, so anyone waiting for this supervisor can stop waiting. */
	readonly announce: Effect.Effect<void>;
};

export type AnySupervisor = Supervisor;

export type MakeSupervisorOptions = {
	readonly bus?: SupervisorEventBusShape;
	readonly label?: string;
	readonly source?: unknown;
};

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Builds the running supervisor for `spec`. The state starts `idle`. */
export function makeSupervisor<TPayloadSchema extends z.ZodType, TProcessSchema extends z.ZodType>(
	spec: SupervisorSpec<TPayloadSchema, TProcessSchema>,
	options: MakeSupervisorOptions = {},
): Supervisor<z.output<TPayloadSchema>, z.output<TProcessSchema>> {
	let state: SupervisorState = "idle";
	let detail: string | null = null;

	const emit = (type: SupervisorEvent["type"], extra: Partial<SupervisorEvent> = {}) =>
		options.bus === undefined
			? Effect.void
			: options.bus.emit({ supervisorId: spec.id, type, at: new Date().toISOString(), state, detail, ...extra });

	const ensureDesiredState = Effect.gen(function* () {
		const blocker = spec.blocker === undefined ? null : yield* spec.blocker.pipe(Effect.catch(() => Effect.succeed(null)));
		if (blocker !== null) {
			state = "pending";
			detail = blocker;
			yield* emit("state-changed");
			return state;
		}
		state = "converging";
		yield* emit("state-changed");
		yield* spec.converge.pipe(
			Effect.map(() => {
				state = "converged";
				detail = null;
			}),
			Effect.catch((error) => {
				state = "degraded";
				detail = messageOf(error);
				return Effect.logWarning(`Convergence of ${spec.id} failed: ${detail}`);
			}),
		);
		yield* emit("state-changed");
		yield* emit("reconciled");
		return state;
	});

	const getHealth = Effect.gen(function* () {
		const base = { supervisorId: spec.id, description: spec.description, state, checkedAt: new Date().toISOString() };
		if (state === "pending") {
			return {
				...base,
				healthy: false,
				detail,
				warnings: [],
				payload: spec.payloadSchema.parse(spec.degradedPayload(detail ?? "deferred")),
			};
		}
		const probe = yield* spec.probe.pipe(
			Effect.flatMap((raw) =>
				Effect.try({ try: () => ({ ...raw, payload: spec.payloadSchema.parse(raw.payload) }), catch: (cause) => cause }),
			),
			Effect.catch((error) => {
				const message = messageOf(error);
				return Effect.succeed({
					healthy: false,
					detail: message,
					payload: spec.payloadSchema.parse(spec.degradedPayload(message)),
				});
			}),
		);
		const warnings =
			spec.warnings?.(probe, state, detail) ??
			(state === "degraded" ? [`${spec.id}: convergence degraded — ${detail ?? "unknown"}`] : []);
		return {
			...base,
			healthy: state === "converged" && probe.healthy,
			detail: probe.detail ?? detail,
			warnings,
			payload: probe.payload,
		};
	});

	return {
		id: spec.id,
		description: spec.description,
		label: options.label ?? spec.id,
		source: options.source ?? null,
		ensureDesiredState,
		getHealth,
		getHealthAndNotify: getHealth.pipe(
			Effect.tap((snapshot) => emit("health-snapshot", { healthy: snapshot.healthy, detail: snapshot.detail })),
		),
		getProcessInfo: Effect.gen(function* () {
			const health = yield* getHealth;
			const fragment = yield* spec.processInfo;
			return yield* Effect.try({
				try: () =>
					spec.processInfoSchema.parse({
						supervisorId: health.supervisorId,
						description: health.description,
						state: health.state,
						healthy: health.healthy,
						detail: health.detail,
						warnings: health.warnings,
						checkedAt: health.checkedAt,
						...fragment,
					}),
				catch: (cause) => cause,
			});
		}),
		getStateSnapshot: Effect.sync(() => ({ state, detail })),
		announce: emit("registered"),
	};
}
