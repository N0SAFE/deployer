import { BadRequestError, ConflictError, NotFoundError, ValidationError } from "@deployer/errors";
import { standardErrorActions } from "@deployer/orpc-utils";
import { ORPCError } from "@orpc/server";
import { Effect } from "effect";

import { PushServiceFailure } from "../push.failures";

/** Translate one domain rule failure into the contract's declared errors. */
export function mapPushFailure(error: PushServiceFailure): ORPCError<string, unknown> {
	const cause = error.cause;

	if (cause instanceof NotFoundError) return standardErrorActions.NOT_FOUND(cause.message);
	if (cause instanceof ConflictError) return standardErrorActions.CONFLICT(cause.message);
	if (cause instanceof ValidationError || cause instanceof BadRequestError) {
		return standardErrorActions.BAD_REQUEST(cause.message);
	}

	return new ORPCError("INTERNAL_SERVER_ERROR", {
		message: "Unexpected push service failure",
		cause,
	});
}

/** Pipeable recovery for every push use case. */
export const mapPushFailures = <A, R>(effect: Effect.Effect<A, PushServiceFailure, R>) =>
	Effect.catchTag(effect, "PushServiceFailure", (error: PushServiceFailure) =>
		Effect.fail(mapPushFailure(error)),
	);
