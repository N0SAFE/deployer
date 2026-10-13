/**
 * @deployer/nest-service-client — typed service clients for a split NestJS platform.
 *
 * ── WHAT PROBLEM THIS SOLVES ────────────────────────────────────────────────
 * Once the API is several services, every caller writes the same three lines:
 * pick a transport, build a link from a contract, and remember where the service
 * lives. Repeated per call site, that is where the drift lives — one caller passing
 * the wrong contract, another forgetting the caller's credentials.
 *
 * This package makes it one declaration:
 *
 * ```ts
 * @Injectable()
 * export class IdentityClient extends BaseClient<typeof identityContract> {
 *   constructor(binder: ServiceClientBinder) {
 *     super(binder, { service: "identity", contract: identityContract });
 *   }
 * }
 * ```
 *
 * ...after which every procedure is callable at the ROOT (`identity.findById(...)`)
 * as well as by its namespaced path (`identity.user.findById(...)`). The contract is
 * stated once; the routing, the flattening and the transport are derived from it.
 *
 * ── WHERE THE ENVIRONMENT FACTS LIVE ────────────────────────────────────────
 * Not here. `ServiceClientModule.forRoot` takes a resolver for service origins and a
 * provider for request headers, so this package knows HOW to call a service but
 * never WHICH service exists or WHERE it answers. That is what lets the same client
 * class work in dev, in swarm, and against a testcontainer.
 */

export { BaseClient } from "./base-client";
export {
	collectContractLeaves,
	isProcedure,
	resolveAtPath,
	type ContractLeaf,
} from "./contract-leaves";
export {
	ServiceClientRegistry,
	type ServiceOriginResolver,
	type ServiceRequestHeaderProvider,
} from "./service-client.registry";
export {
	ServiceClientModule,
	SERVICE_CLIENT_OPTIONS,
	SERVICE_CLIENT_REGISTRY,
	type ServiceClientModuleOptions,
} from "./service-client.module";
export type { FlatLeaves, ServiceClient, ServiceClientBinder } from "./types";
