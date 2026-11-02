import { Context } from "effect";

import type { ProjectDomainRepository } from "@deployer/shared/core/modules/domain/repositories/project-domain.repository";

/** Effect view of the shared project-domain table. */
export type ProjectDomainRepositoryShape = Pick<
	ProjectDomainRepository,
	| "findByProjectAndDomain"
	| "create"
	| "findByProjectId"
	| "getAvailableDomainsForProject"
	| "findById"
	| "update"
	| "delete"
>;

export class ProjectDomainRepo extends Context.Service<
	ProjectDomainRepo,
	ProjectDomainRepositoryShape
>()("project/ProjectDomainRepository") {}
