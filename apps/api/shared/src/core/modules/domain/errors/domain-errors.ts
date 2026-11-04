import { domainError } from "@deployer/effect-core";

/** A project already owns a domain with the same name. */
export class DomainAlreadyExistsError extends domainError("DomainAlreadyExistsError", "conflict")<{
  readonly projectId: string;
  readonly domain: string;
}>() {
  override publicMessage() { return `Project '${this.projectId}' already owns domain '${this.domain}'`; }
}

/** An operation requires a verified domain. */
export class DomainNotVerifiedError extends domainError("DomainNotVerifiedError", "validation")<{
  readonly domain: string;
}>() {
  override publicMessage() { return `Domain '${this.domain}' is not verified`; }
}

/** The database (or another dependency of the domain module) failed; the cause stays server-side. */
export class DomainStorageFailure extends domainError("DomainStorageFailure", "dependency_missing")() {
  override publicMessage() { return "The domain store is unavailable."; }
}

/** The Traefik side of route sync (config store, file sync, certificates) refused; the cause stays server-side. */
export class DomainRoutingFailure extends domainError("DomainRoutingFailure", "dependency_missing")<{
  readonly operation: string;
}>() {
  override publicMessage() { return `Domain routing failed: ${this.operation}`; }
}
