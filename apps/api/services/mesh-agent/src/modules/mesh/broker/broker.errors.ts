import { domainError } from "@deployer/effect-core";

/** No live replica of the service is known to the directory. */
export class MeshNoReplica extends domainError("MeshNoReplica", "not_found")<{
  readonly service: string;
}>() {
  override publicMessage() {
    return `No replica of ${this.service} is available`;
  }
}

/** Redirects kept bouncing: the hop limit was reached, or every replica had already been tried. */
export class MeshRedirectExhausted extends domainError("MeshRedirectExhausted", "dependency_missing")<{
  readonly service: string;
  readonly hops: number;
}>() {
  override publicMessage() {
    return `${this.service} kept redirecting the call`;
  }
}
