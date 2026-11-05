import { domainError } from "@deployer/effect-core";

/** The node has no `node_config` row yet: the setup wizard has not run. */
export class NodeNotConfigured extends domainError("NodeNotConfigured", "validation")() {
	override publicMessage() { return "This node is not configured yet (missing node_config). Complete the setup wizard first."; }
}

/** A feature needs the platform to be publicly reachable and no public console lane is on. */
export class PublicUrlRequired extends domainError("PublicUrlRequired", "validation")<{ readonly what: string }>() {
	override publicMessage() {
		return `${this.what} requires the platform to be publicly reachable. Enable a public lane with a public console on the Network → Ingress page first.`;
	}
}

/** A declared public address does not answer as this node. */
export class PublicAddressUnreachable extends domainError("PublicAddressUnreachable", "validation")<{ readonly reason: string }>() {
	override publicMessage() { return this.reason; }
}

/** The database, the lanes store or the egress probe failed; the cause stays server-side. */
export class ReachabilityDependencyFailure extends domainError("ReachabilityDependencyFailure", "dependency_missing")<{
	readonly operation: string;
}>() {
	override publicMessage() { return `Reachability check failed: ${this.operation}`; }
}

/** An edge provider's call (`dnsRecords`, `connector`, `joinPath`) failed; the cause stays server-side. */
export class EdgeProviderFailure extends domainError("EdgeProviderFailure", "dependency_missing")<{
	readonly providerId: string;
	readonly operation: string;
}>() {
	override publicMessage() { return `Edge provider '${this.providerId}' failed: ${this.operation}`; }
}
