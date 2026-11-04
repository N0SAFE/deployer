import { domainError } from "@deployer/effect-core";

/** The cluster settings that hold the ingress lanes could not be read or written; the cause stays server-side. */
export class IngressLanesUnavailable extends domainError("IngressLanesUnavailable", "dependency_missing")<{ readonly operation: string }>() {
	override publicMessage() { return `The ingress lanes could not be ${this.operation}.`; }
}

/** The routes the platform derived from its tables do not match the contract the ingress publishes (a bug in a source). */
export class PlatformRoutesInvalid extends domainError("PlatformRoutesInvalid", "dependency_missing")() {
	override publicMessage() { return "The platform routes could not be built."; }
}
