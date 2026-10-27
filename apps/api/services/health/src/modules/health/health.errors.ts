import { Data } from "effect";

/** The registry could not produce a snapshot at all. */
export class HealthCheckFailed extends Data.TaggedError("HealthCheckFailed")<{
  readonly message: string;
  readonly cause: unknown;
}> {}
