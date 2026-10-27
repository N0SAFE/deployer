import {
	BadRequestError,
	ConflictError,
	ForbiddenError,
	NotFoundError,
	ValidationError,
} from "@deployer/errors";
import { standardErrorActions } from "@deployer/orpc-utils";
import { HttpException } from "@nestjs/common";
import { ORPCError } from "@orpc/server";
import { Effect } from "effect";

/**
 * Service error → contract error.
 *
 * Two error families reach this mapper: the shared domain errors (plain classes,
 * so `instanceof`), and the NestJS exceptions `ProjectAccessService` throws —
 * that shared service is still promise-shaped and signals "no such project" with
 * `NotFoundException` and "not allowed" with `ForbiddenException`. Map both by
 * status so a missing project is a 404 here too.
 *
 * Anything unlisted is a bug in this service, not a client-visible condition: it
 * stays a 500 with the original message instead of being dressed up as
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

	if (error instanceof HttpException) {
		switch (error.getStatus()) {
			case 400:
				return standardErrorActions.BAD_REQUEST(error.message);
			case 403:
				return standardErrorActions.FORBIDDEN(error.message);
			case 404:
				return standardErrorActions.NOT_FOUND(error.message);
			case 409:
				return standardErrorActions.CONFLICT(error.message);
		}
	}

	return new ORPCError("INTERNAL_SERVER_ERROR", { message: error.message });
}

/** Re-fail a service effect with the contract-shaped error. */
export const mapServiceFailures = <A, R>(effect: Effect.Effect<A, Error, R>) =>
	effect.pipe(Effect.catch((error) => Effect.fail(toOrpcError(error))));
