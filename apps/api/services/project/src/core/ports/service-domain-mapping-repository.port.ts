import { Context } from "effect";

import type { ServiceDomainMappingRepository } from "@deployer/shared/core/modules/domain/repositories/service-domain-mapping.repository";

/** Effect view of the shared service-domain mapping table. */
export type ServiceDomainMappingRepositoryShape = Pick<
	ServiceDomainMappingRepository,
	| "hasProjectDomainMappings"
	| "findByProjectDomainId"
	| "getFullUrl"
	| "countByProjectDomainId"
	| "findByServiceIdWithUrls"
	| "create"
	| "findBySubdomain"
	| "findById"
	| "update"
	| "findByServiceId"
	| "delete"
>;

export class ServiceDomainMappingRepo extends Context.Service<
	ServiceDomainMappingRepo,
	ServiceDomainMappingRepositoryShape
>()("project/ServiceDomainMappingRepository") {}
