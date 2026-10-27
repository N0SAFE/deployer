import { Data } from "effect";

/** A permission database call failed; wraps the driver error for the service boundary. */
export class PermissionRepositoryFailure extends Data.TaggedError("PermissionRepositoryFailure")<{
  readonly cause: unknown;
}> {}

/**
 * The single failure the permission domain produces. An engine denial
 * (`ForbiddenError`) is preserved as `cause`, so callers can still discriminate.
 */
export class PermissionServiceFailure extends Data.TaggedError("PermissionServiceFailure")<{
  readonly cause: unknown;
}> {}
