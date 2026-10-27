import { Data } from "effect";

/**
 * The single failure the user domain produces. The original rule error
 * (`NotFoundError`, `ConflictError`, `ForbiddenError`, `ValidationError`) is
 * preserved as `cause`, so the controller maps it to the declared ORPC error.
 */
export class UserServiceFailure extends Data.TaggedError("UserServiceFailure")<{
  readonly cause: unknown;
}> {}

/** A database call failed; wraps the driver error for the controller boundary. */
export class UserRepositoryFailure extends Data.TaggedError("UserRepositoryFailure")<{
  readonly cause: unknown;
}> {}
