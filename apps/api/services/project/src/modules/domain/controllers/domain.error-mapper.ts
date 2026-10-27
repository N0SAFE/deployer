import {
	DomainAlreadyExistsError,
	DomainNotVerifiedError,
	InvalidBasePathFormatError,
	InvalidSubdomainFormatError,
	ProjectDomainNotFoundError,
	ServiceDomainMappingNotFoundError,
	ServiceMappingMismatchError,
	SubdomainConflictError,
	SubdomainNotAllowedError,
} from "@deployer/shared/core/modules/domain/errors/index";
import { standardErrorActions } from "@deployer/orpc-utils";
import { ORPCError } from "@orpc/server";
import { Effect } from "effect";

/**
 * Domain error → contract error.
 *
 * The shared domain errors are plain classes, so the mapping is `instanceof`.
 * Anything not listed is a bug in this service, not a client-visible condition:
 * it stays a 500 with the original message instead of being dressed up as
 * `NOT_FOUND`.
 */
export function toOrpcError(error: Error) {
	if (
		error instanceof ProjectDomainNotFoundError ||
		error instanceof ServiceDomainMappingNotFoundError
	) {
		return standardErrorActions.NOT_FOUND(error.message);
	}

	if (
		error instanceof DomainAlreadyExistsError ||
		error instanceof SubdomainConflictError
	) {
		return standardErrorActions.CONFLICT(error.message);
	}

	if (
		error instanceof DomainNotVerifiedError ||
		error instanceof ServiceMappingMismatchError ||
		error instanceof SubdomainNotAllowedError ||
		error instanceof InvalidSubdomainFormatError ||
		error instanceof InvalidBasePathFormatError
	) {
		return standardErrorActions.BAD_REQUEST(error.message);
	}

	return new ORPCError("INTERNAL_SERVER_ERROR", { message: error.message });
}

/** Re-fail a domain effect with the contract-shaped error. */
export const mapDomainFailures = <A, R>(effect: Effect.Effect<A, Error, R>) =>
	effect.pipe(Effect.catch((error) => Effect.fail(toOrpcError(error))));
