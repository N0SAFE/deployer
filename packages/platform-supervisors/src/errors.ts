import { domainError } from "@deployer/effect-core";

/** The supervised resource cannot run in this deployment (no swarm and not deployment-managed). */
export class SupervisedResourceUnavailable extends domainError("SupervisedResourceUnavailable", "dependency_missing")<{
	readonly resource: string;
	readonly reason: string;
}>() {
	override publicMessage() {
		return `${this.resource}: ${this.reason}`;
	}
}

/** Convergence finished but the resource is not there: the engine accepted the spec and nothing exists. */
export class SupervisedResourceMissing extends domainError("SupervisedResourceMissing", "dependency_missing")<{
	readonly resource: string;
}>() {
	override publicMessage() {
		return `${this.resource} was not created`;
	}
}
