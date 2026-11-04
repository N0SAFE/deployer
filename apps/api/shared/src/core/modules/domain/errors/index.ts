/** Tagged domain errors of the domain module (`domainError`): each is an Effect failure with a kind and a client-safe message. */

// Domain errors (project-owned, mesh-wide tenant)
export { DomainAlreadyExistsError, DomainNotVerifiedError, DomainRoutingFailure } from "./domain-errors";

// Verification errors
export { VerificationAttemptError } from "./verification-errors";

// Project domain errors
export { ProjectDomainNotFoundError, ProjectDomainUpdateError, ProjectDomainDeletionError } from "./project-domain-errors";

// Service domain mapping errors
export {
  ServiceDomainMappingNotFoundError,
  ServiceMappingMismatchError,
  SubdomainConflictError,
  SubdomainNotAllowedError,
  InvalidSubdomainFormatError,
  InvalidBasePathFormatError,
  ServiceDomainMappingUpdateError,
  ServiceDomainMappingDeletionError,
  SetPrimaryDomainError,
} from "./service-domain-mapping-errors";
