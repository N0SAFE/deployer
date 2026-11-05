import { domainError } from "@deployer/effect-core";

/** The boot pipeline (swarm overlay → database → migrations → default admin) failed; the API refuses to report READY. */
export class BootstrapFailed extends domainError("BootstrapFailed", "dependency_missing")<{ readonly reason: string }>() {
	override publicMessage() { return this.reason; }
}
