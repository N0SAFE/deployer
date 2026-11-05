import { domainError } from "@deployer/effect-core";

/**
 * A setup run (local or remote) stopped. `reason` is what the wizard shows the operator: the step's own message, which is
 * written for them (a version mismatch, an unreachable fleet, a non-empty database…).
 */
export class SetupInitializationFailed extends domainError("SetupInitializationFailed", "dependency_missing")<{ readonly reason: string }>() {
	override publicMessage() { return this.reason; }
}

/** Setup procedures are closed once the node is configured (SEC-012 / SETUP-002). */
export class SetupAlreadyComplete extends domainError("SetupAlreadyComplete", "conflict")() {
	override publicMessage() {
		return "Setup is already complete on this node, so setup procedures are closed. Use the dashboard, or reset the node from the host to run setup again.";
	}
}

/** The SSRF policy forbids probing this database address (SEC-012). */
export class DatabaseProbeRefused extends domainError("DatabaseProbeRefused", "validation")<{ readonly reason: string }>() {
	override publicMessage() { return this.reason; }
}

/** The node config row setup writes to is not there (it should exist by the time a post-setup hint is dismissed). */
export class NodeConfigNotFound extends domainError("NodeConfigNotFound", "dependency_missing")() {
	override publicMessage() { return "Cannot dismiss hint — node config not found"; }
}
