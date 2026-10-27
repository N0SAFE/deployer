import { domainError } from "@deployer/effect-core";

/** The registry could not produce a snapshot at all. */
export class HealthCheckFailed extends domainError("HealthCheckFailed", "dependency_missing")<{
  readonly message: string;
}>() {}
