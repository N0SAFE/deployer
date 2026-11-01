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
  readonly reason: "malformed" | "expired" | "revoked";
}>() {
  override publicMessage() {
    if (this.reason === "expired") return "The join token has expired";
    if (this.reason === "revoked") return "The join token has been revoked";
    return "The join token is not valid";
  }
}

/**
 * No path to the node a call is pinned to: the direct link failed and no next hop answered. The target and the hops
 * tried are in the payload, so an operator can tell a dead node from a partition.
 */
export class MeshNoRoute extends domainError("MeshNoRoute", "dependency_missing")<{
  readonly nodeId: string;
  readonly hops: readonly string[];
}>() {
  override publicMessage() {
    return `No route to node ${this.nodeId} from this agent`;
  }
}

/**
 * A procedure that only this node's own socket may call was reached on another door: the peer websocket, or the Nest
 * HTTP surface (which carries no door marker at all). Joining a swarm and writing a setting are the two.
 */
export class MeshLocalOnly extends domainError("MeshLocalOnly", "forbidden")() {
  override publicMessage() {
    return "This action is only available on the node's own socket";
  }
}

/** A forwarded call came back to a node it had already been through. */
export class MeshRelayLoop extends domainError("MeshRelayLoop", "validation")<{
  readonly nodeId: string;
}>() {
  override publicMessage() {
    return `The relay looped back to ${this.nodeId}`;
  }
}
