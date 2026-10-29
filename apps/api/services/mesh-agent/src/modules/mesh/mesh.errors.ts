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

/** The agent has no link to the node a call is pinned to. */
export class MeshNoNode extends domainError("MeshNoNode", "not_found")<{
  readonly nodeId: string;
}>() {
  override publicMessage() {
    return `Node ${this.nodeId} is not reachable from this agent`;
  }
}

/** A join token could not be redeemed: it is not one of ours, or it has expired. */
export class MeshJoinRejected extends domainError("MeshJoinRejected", "validation")<{
  readonly reason: "malformed" | "expired";
}>() {
  override publicMessage() {
    return this.reason === "expired" ? "The join token has expired" : "The join token is not valid";
  }
}
