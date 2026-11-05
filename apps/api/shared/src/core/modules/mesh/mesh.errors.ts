import { domainError } from "@deployer/effect-core";

/** The mesh URL a caller gave is not a URL. */
export class MeshPeerUrlInvalid extends domainError("MeshPeerUrlInvalid", "validation")() {
	override publicMessage() { return "The provided mesh URL is invalid."; }
}

/** A remote mesh node did not answer (or answered with an error); `reason` is the peer-facing explanation. */
export class MeshPeerUnreachable extends domainError("MeshPeerUnreachable", "validation")<{ readonly url: string; readonly reason: string }>() {
	override publicMessage() { return `Cannot reach mesh at ${this.url}: ${this.reason}`; }
}

/** A cluster join grant could not be recorded. */
export class JoinGrantNotCreated extends domainError("JoinGrantNotCreated", "dependency_missing")() {
	override publicMessage() { return "Failed to create join grant record."; }
}

/** The node has no database URL to hand to a joining peer: the setup wizard has not run. */
export class ClusterDatabaseUrlMissing extends domainError("ClusterDatabaseUrlMissing", "dependency_missing")() {
	override publicMessage() {
		return "No database URL in node_config — the receiving mesh node cannot return it to the joining peer. Run the setup wizard first.";
	}
}
