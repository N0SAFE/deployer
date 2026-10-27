import type { ServiceDomainMappingRepository } from "@deployer/shared/core/modules/domain/repositories/service-domain-mapping.repository";
import { Context } from "effect";

/**
 * Effect view of the service-domain mapping's subdomain lookup.
 *
 * Kept separate from `ServiceDomainMappingRepo` because the network view is the
 * only caller: it needs the join with service names, which the CRUD-shaped port
 * in `service-domain-mapping-repository.port.ts` deliberately leaves out.
 */
export type ServiceDomainMappingLookupShape = Pick<
	ServiceDomainMappingRepository,
	"findByProjectDomainAndPathWithServiceNames"
>;

export class ServiceDomainMappingLookup extends Context.Service<
	ServiceDomainMappingLookup,
	ServiceDomainMappingLookupShape
>()("project/ServiceDomainMappingLookup") {}
