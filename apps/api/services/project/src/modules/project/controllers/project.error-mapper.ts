import {
	BadRequestError,
	ConflictError,
	ForbiddenError,
	NotFoundError,
	ValidationError,
} from "@deployer/errors";
import { standardErrorActions } from "@deployer/orpc-utils";
import { ORPCError } from "@orpc/server";
import { Effect } from "effect";

/**
 * Project error → contract error.
 *
 * The shared domain errors are plain classes, so the mapping is `instanceof`.
 * Anything not listed is a bug in this service, not a client-visible condition:
 * it stays a 500 with the original message instead of being dressed up as
 * `NOT_FOUND`. An `ORPCError` that already reached here (a deliberate
 * `NOT_IMPLEMENTED`) is passed through untouched.
 */
export function toOrpcError(error: Error) {
	if (error instanceof ORPCError) return error;

	if (error instanceof NotFoundError) {
		return standardErrorActions.NOT_FOUND(error.message);
	}

	if (error instanceof ConflictError) {
		return standardErrorActions.CONFLICT(error.message);
	}

	if (error instanceof ForbiddenError) {
		return standardErrorActions.FORBIDDEN(error.message);
	}

	if (error instanceof ValidationError || error instanceof BadRequestError) {
		return standardErrorActions.BAD_REQUEST(error.message);
	}

	return new ORPCError("INTERNAL_SERVER_ERROR", { message: error.message });
}

/** Re-fail a project effect with the contract-shaped error. */
export const mapProjectFailures = <A, R>(effect: Effect.Effect<A, Error, R>) =>
	effect.pipe(Effect.catch((error) => Effect.fail(toOrpcError(error))));
