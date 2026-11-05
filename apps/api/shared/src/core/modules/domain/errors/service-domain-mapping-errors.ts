import { domainError } from "@deployer/effect-core";

export class ServiceDomainMappingNotFoundError extends domainError("ServiceDomainMappingNotFoundError", "not_found")<{
  readonly identifier: string;
}>() {
  override publicMessage() { return `Service domain mapping with ID '${this.identifier}' not found`; }
}

export class ServiceMappingMismatchError extends domainError("ServiceMappingMismatchError", "validation")<{
  readonly mappingId: string;
  readonly serviceId: string;
}>() {
  override publicMessage() { return `Mapping '${this.mappingId}' does not belong to service '${this.serviceId}'`; }
}

export class SubdomainConflictError extends domainError("SubdomainConflictError", "conflict")<{
  readonly subdomain: string | null;
  readonly basePath: string | null;
  readonly conflicts: readonly string[];
  readonly availableBasePaths?: readonly string[];
}>() {
  override publicMessage() {
    const suggestion = this.availableBasePaths?.length ? ` Available base paths: ${this.availableBasePaths.join(", ")}` : "";
    return `Subdomain '${this.subdomain ?? "root"}' with base path '${this.basePath ?? "/"}' is already in use. Conflicting mappings: ${this.conflicts.join(", ")}.${suggestion}`;
  }
}

export class SubdomainNotAllowedError extends domainError("SubdomainNotAllowedError", "validation")<{
  readonly subdomain: string;
  readonly allowedSubdomains: readonly string[];
}>() {
  override publicMessage() {
    const allowed = this.allowedSubdomains.length > 0 ? this.allowedSubdomains.join(", ") : "none (no subdomains allowed)";
    return `Subdomain '${this.subdomain}' is not allowed. Allowed subdomains: ${allowed}`;
  }
}

export class InvalidSubdomainFormatError extends domainError("InvalidSubdomainFormatError", "validation")<{
  readonly subdomain: string;
  readonly reason?: string;
}>() {
  override publicMessage() {
    return `Invalid subdomain format: '${this.subdomain}'${this.reason ? `. ${this.reason}` : ""}`;
  }
}

export class InvalidBasePathFormatError extends domainError("InvalidBasePathFormatError", "validation")<{
  readonly basePath: string;
  readonly reason?: string;
}>() {
  override publicMessage() {
    return `Invalid base path format: '${this.basePath}'${this.reason ? `. ${this.reason}` : ""}`;
  }
}

export class ServiceDomainMappingUpdateError extends domainError("ServiceDomainMappingUpdateError", "dependency_missing")<{
  readonly mappingId: string;
  readonly reason?: string;
}>() {
  override publicMessage() {
    return `Failed to update service domain mapping with ID '${this.mappingId}'${this.reason ? `: ${this.reason}` : ""}`;
  }
}

export class ServiceDomainMappingDeletionError extends domainError("ServiceDomainMappingDeletionError", "dependency_missing")<{
  readonly mappingId: string;
  readonly reason?: string;
}>() {
  override publicMessage() {
    return `Failed to delete service domain mapping with ID '${this.mappingId}'${this.reason ? `: ${this.reason}` : ""}`;
  }
}

export class SetPrimaryDomainError extends domainError("SetPrimaryDomainError", "dependency_missing")<{
  readonly serviceId: string;
  readonly mappingId: string;
  readonly reason?: string;
}>() {
  override publicMessage() {
    return `Failed to set mapping '${this.mappingId}' as primary for service '${this.serviceId}'${this.reason ? `: ${this.reason}` : ""}`;
  }
}
