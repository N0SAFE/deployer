import { domainError } from "@deployer/effect-core";

export class VerificationAttemptError extends domainError("VerificationAttemptError", "dependency_missing")<{
  readonly domainId: string;
  readonly reason: string;
}>() {
  override publicMessage() {
    return `Verification attempt failed for domain ID '${this.domainId}': ${this.reason}`;
  }
}
