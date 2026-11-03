import { and, desc, eq, gte } from "drizzle-orm";
import { Context, Effect } from "effect";

import type { StepUpMethod } from "@deployer/auth/authz";
import { serviceOver } from "@deployer/effect-core";
import { stepUpEvents } from "@deployer/nest-schema/global/identity/step-up";

import { DatabasePort, type DatabaseShape } from "@identity/core/database/database.port";

/** The newest proof one session holds, if any arrived after `since`. */
export type StepUpProof = {
	readonly id: string;
	readonly method: StepUpMethod;
	readonly verifiedAt: Date;
};

export type StepUpRepositoryShape = {
	readonly latestForSession: (
		sessionId: string,
		since: Date,
	) => Effect.Effect<StepUpProof | null, never, DatabasePort>;
};

const makeStepUpRepository = (database: DatabaseShape): StepUpRepositoryShape => ({
	latestForSession: (sessionId, since) =>
		Effect.promise(async () => {
			const [row] = await database.db
				.select({ id: stepUpEvents.id, method: stepUpEvents.method, verifiedAt: stepUpEvents.verifiedAt })
				.from(stepUpEvents)
				.where(and(eq(stepUpEvents.sessionId, sessionId), gte(stepUpEvents.verifiedAt, since)))
				.orderBy(desc(stepUpEvents.verifiedAt))
				.limit(1);

			if (row === undefined) return null;
			return {
				id: row.id,
				method: row.method === "totp" ? "totp" : "passkey",
				verifiedAt: row.verifiedAt,
			};
		}),
});

/** Append-only reads over `step_up_events`. */
export class StepUpRepository extends Context.Service<StepUpRepository, StepUpRepositoryShape>()(
	"identity/StepUpRepository",
) {
	static readonly live = serviceOver(DatabasePort, makeStepUpRepository);
}
