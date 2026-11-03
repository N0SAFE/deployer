import { Logger } from "@nestjs/common";

import { getErrorMessage } from "@deployer/errors";
import { stepUpEvents } from "@deployer/nest-schema/global/identity/step-up";

import type { StepUpSink } from "@deployer/auth/server";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

const logger = new Logger("AuthStepUp");

/**
 * Append step-up proofs to `step_up_events` (`AUTH-062`).
 *
 * Fire-and-forget, like the audit sink: the passkey ceremony already succeeded by the time the hook runs, so a failed
 * insert must not surface as a failed verification. It is logged, and the caller's next critical action is refused —
 * the safe direction.
 */
export function drizzleStepUpSink<TSchema extends Record<string, unknown>>(
	database: NodePgDatabase<TSchema>,
): StepUpSink {
	return {
		record: (event) => {
			void database
				.insert(stepUpEvents)
				.values({
					sessionId: event.sessionId,
					userId: event.userId,
					method: event.method,
					reason: event.reason ?? null,
				})
				.catch((error: unknown) => {
					logger.warn(`step-up write failed for session ${event.sessionId}: ${getErrorMessage(error)}`);
				});
		},
	};
}
