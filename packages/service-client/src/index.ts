/**
 * @deployer/service-client — typed service clients for a split platform.
 *
 * Once the API is several services, every caller writes the same three lines: pick a transport,
 * build a link from a contract, remember where the service lives. This package makes it one
 * declaration:
 *
 * ```ts
 * export class IdentityClient extends BaseClient<typeof identityContract> {
 *   constructor(binder: ServiceClientBinder) {
 *     super(binder, { service: "identity", contract: identityContract });
 *   }
 * }
 * ```
 *
 * after which every procedure is callable at the root (`identity.findById(...)`) as well as by its
 * namespaced path. The contract is stated once; routing, flattening and transport are derived from it.
 *
 * Framework-free. The environment facts (where a service answers, which credentials to attach) are
 * supplied by the app through `ServiceClientOptions`; a Nest app mounts the registry with
 * `ServiceClientModule` from `@deployer/nest-effect/service-client`.
 */
export { BaseClient } from "./client/base-client";
export { collectContractLeaves, isProcedure, resolveAtPath, type ContractLeaf } from "./client/contract-leaves";
export type { FlatLeaves, ServiceClient, ServiceClientBinder } from "./client/types";
export { ServiceUnreachable } from "./errors";
export {
	ServiceClientRegistry,
	type ServiceClientOptions,
	type ServiceLinkFactory,
	type ServiceOriginResolver,
	type ServiceRequestHeaderProvider,
} from "./registry/service-client.registry";
export { callService, makeServiceFetch } from "./transport/service-fetch";
export { reviveDates } from "./transport/revive-dates";
export type { ServiceFetchOptions } from "./transport/service-fetch";
