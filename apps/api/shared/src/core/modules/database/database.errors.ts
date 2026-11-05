import { domainError } from "@deployer/effect-core";

/** The global database handle was read before anything initialised it (the pool is built, the URL may not be known yet). */
export class DatabaseNotInitialized extends domainError("DatabaseNotInitialized", "dependency_missing")<{ readonly owner: string }>() {
	override publicMessage() { return `${this.owner} has not been initialized yet`; }
}

/** The boot gate refused to continue: the global database is not usable. `reason` is the operator-facing diagnostic. */
export class DatabaseStartupBlocked extends domainError("DatabaseStartupBlocked", "dependency_missing")<{ readonly reason: string }>() {
	override publicMessage() { return this.reason; }
}

/** The boot advisory lock could not be taken (the database could not answer); the cause stays server-side. */
export class AdvisoryLockFailed extends domainError("AdvisoryLockFailed", "dependency_missing")() {
	override publicMessage() { return "The boot lock could not be taken."; }
}
