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

import { UserServiceFailure } from "../user.failures";

/** Translate one domain rule failure into the contract's declared errors. */
export function mapUserFailure(error: UserServiceFailure): ORPCError<string, unknown> {
  const cause = error.cause;

  if (cause instanceof NotFoundError) return standardErrorActions.NOT_FOUND(cause.message);
  if (cause instanceof ConflictError) return standardErrorActions.CONFLICT(cause.message);
  if (cause instanceof ForbiddenError) return standardErrorActions.FORBIDDEN(cause.message);
  if (cause instanceof ValidationError || cause instanceof BadRequestError) {
    return standardErrorActions.BAD_REQUEST(cause.message);
  }

  return new ORPCError("INTERNAL_SERVER_ERROR", {
    message: "Unexpected user service failure",
    cause,
  });
}

/** Pipeable recovery for every user use case. */
export const mapUserFailures = <A, R>(effect: Effect.Effect<A, UserServiceFailure, R>) =>
  Effect.catchTag(effect, "UserServiceFailure", (error: UserServiceFailure) =>
    Effect.fail(mapUserFailure(error)),
  );
