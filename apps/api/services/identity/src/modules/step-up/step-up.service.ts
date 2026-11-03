import { Context, Effect } from "effect";

import { STEP_UP_WINDOW_SECONDS, isCriticalStepUp, type StepUpMethod } from "@deployer/auth/authz";
import { CurrentActor, serviceOver } from "@deployer/effect-core";
import { ForbiddenError } from "@deployer/errors";

import { DatabasePort } from "@identity/core/database/database.port";

import { StepUpRepository } from "./step-up.repository";

export type StepUpStatus = {
	readonly steppedUp: boolean;
	readonly critical: boolean;
	readonly method: StepUpMethod | null;
	readonly verifiedAt: Date | null;
	readonly expiresAt: Date | null;
	readonly windowSeconds: number;
};

export type StepUpServiceShape = {
	readonly status: () => Effect.Effect<StepUpStatus, ForbiddenError, CurrentActor | DatabasePort>;
	/**
	 * The guard a destructive action calls first (`AUTH-062`, `SEC-070`).
	 *
	 * Passkey only: a TOTP proof is a step-up but not a CRITICAL one. Failure is the typed `ForbiddenError`, so the
	 * boundary answers a refusal, never a 500.
	 */
	readonly assertCritical: () => Effect.Effect<void, ForbiddenError, CurrentActor | DatabasePort>;
	/**
	 * The proof `assertCritical` just accepted, for callers that must bind a decision to it (`SEC-072`).
	 *
	 * `null` when the session has none — a caller that already passed `assertCritical` will not see null, but the value
	 * stays nullable so the shape is honest.
	 */
	readonly latestProof: () => Effect.Effect<
		{ readonly id: string; readonly method: StepUpMethod; readonly verifiedAt: Date } | null,
		never,
		CurrentActor | DatabasePort
	>;
};

const makeStepUpService = (repository: StepUpRepository["Service"]): StepUpServiceShape => ({
	status: (): ReturnType<StepUpServiceShape["status"]> =>
		Effect.gen(function* () {
			const actor = yield* CurrentActor;
			// A proof belongs to a SESSION. A system caller, or an anonymous one, has none — answering "not stepped up"
			// would hide that, so it is refused as a caller error.
			if (actor.kind !== "user" || actor.sessionId === null) {
				return yield* Effect.fail(new ForbiddenError("step-up status needs a user session"));
			}

			const now = Date.now();
			const since = new Date(now - STEP_UP_WINDOW_SECONDS * 1000);
			const proof = yield* repository.latestForSession(actor.sessionId, since);

			if (proof === null) {
				return {
					steppedUp: false,
					critical: false,
					method: null,
					verifiedAt: null,
					expiresAt: null,
					windowSeconds: STEP_UP_WINDOW_SECONDS,
				};
			}

			return {
				steppedUp: true,
				critical: isCriticalStepUp(proof.method),
				method: proof.method,
				verifiedAt: proof.verifiedAt,
				expiresAt: new Date(proof.verifiedAt.getTime() + STEP_UP_WINDOW_SECONDS * 1000),
				windowSeconds: STEP_UP_WINDOW_SECONDS,
			};
		}),

	latestProof: (): ReturnType<StepUpServiceShape["latestProof"]> =>
		Effect.gen(function* () {
			const actor = yield* CurrentActor;
			if (actor.kind !== "user" || actor.sessionId === null) return null;
			const proof = yield* repository.latestForSession(
				actor.sessionId,
				new Date(Date.now() - STEP_UP_WINDOW_SECONDS * 1000),
			);
			return proof === null ? null : { id: proof.id, method: proof.method, verifiedAt: proof.verifiedAt };
		}),

	assertCritical: (): ReturnType<StepUpServiceShape["assertCritical"]> =>
		Effect.gen(function* () {
			const actor = yield* CurrentActor;
			if (actor.kind !== "user" || actor.sessionId === null) {
				return yield* Effect.fail(new ForbiddenError("step-up needs a user session"));
			}

			const since = new Date(Date.now() - STEP_UP_WINDOW_SECONDS * 1000);
			const proof = yield* repository.latestForSession(actor.sessionId, since);
			if (proof === null || !isCriticalStepUp(proof.method)) {
				return yield* Effect.fail(
					new ForbiddenError("step-up required: verify with a passkey and retry"),
				);
			}
		}),
});

/** Answers what THIS session has proved recently (`AUTH-062`). */
export class StepUpService extends Context.Service<StepUpService, StepUpServiceShape>()(
	"identity/StepUpService",
) {
	static readonly live = serviceOver(StepUpRepository, makeStepUpService);
}
