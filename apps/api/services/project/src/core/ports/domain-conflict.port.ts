import { Context } from "effect";

import type { DomainConflictService } from "@deployer/shared/core/modules/domain/services/domain-conflict.service";

/** Effect view of the shared subdomain-conflict checks. */
export type DomainConflictShape = Pick<
	DomainConflictService,
	"checkSubdomainAvailability"
>;

export class DomainConflict extends Context.Service<DomainConflict, DomainConflictShape>()(
	"project/DomainConflict",
) {}
