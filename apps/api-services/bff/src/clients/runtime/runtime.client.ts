import { Injectable } from "@nestjs/common";

import { BaseClient, type FlatLeaves } from "@deployer/nest-service-client";
import type { ContractRouterClient } from "@orpc/contract";
import { runtimeContract } from "@deployer/runtime-contracts";
import { ServiceClientRegistry } from "../service-registry";

/**
 * The runtime service, with every procedure callable at the ROOT.
 *
 * Bound to the service's COMBINED contract, so both of its domains are reachable:
 * `this.runtime.list({ query })` (deployments) and
 * `this.runtime.docker.containers.list({ query })` (the namespaced path).
 */
/**
 * The client's TYPE: the class below supplies `service`/`contract`/`raw` and the
 * procedures the constructor copies on, and this supplies the FLATTENED surface.
 *
 * ── WHY DECLARATION MERGING ─────────────────────────────────────────────────
 * A class cannot extend a mapped type over its own type parameter, so the flattened
 * members (`listById`, `getApiUsage`, …) have no way to appear in the class's type
 * otherwise. Merging an interface of the same name is the standard TypeScript answer:
 * the class supplies the implementation, the interface supplies the members that the
 * runtime copy creates. No cast, and a typo'd procedure is still a compile error.
 */


export interface RuntimeClient extends Omit<FlatLeaves<ContractRouterClient<typeof runtimeContract>>, "list"> {}

@Injectable()
export class RuntimeClient extends BaseClient<typeof runtimeContract> {
	constructor(binder: ServiceClientRegistry) {
		super(binder, { service: "runtime", contract: runtimeContract });
	}
}
