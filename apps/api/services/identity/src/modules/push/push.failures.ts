import { Data } from "effect";

/** A push database call failed; wraps the driver error for the service boundary. */
export class PushRepositoryFailure extends Data.TaggedError("PushRepositoryFailure")<{
	readonly cause: unknown;
}> {}

/**
 * The single failure the push domain produces. The original rule error
 * (`NotFoundError`, `ConflictError`, `ValidationError`) is preserved as `cause`,
 * so the controller maps it to the declared ORPC error.
 */
export class PushServiceFailure extends Data.TaggedError("PushServiceFailure")<{
	readonly cause: unknown;
}> {}
