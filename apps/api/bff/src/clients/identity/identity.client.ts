/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging -- the interface/class merge below is how the flattened procedures get their types */
import { Injectable } from "@nestjs/common";

import { BaseClient, type FlatLeaves } from "@deployer/nest-service-client";
import type { ContractRouterClient } from "@orpc/contract";
import { identityContract } from "@deployer/identity-contracts";
import { ServiceClientRegistry } from "../service-registry";

/**
 * The identity service, with every procedure callable at the ROOT.
 *
 * ── WHAT THIS DECLARES, AND WHAT IT GETS FOR FREE ───────────────────────────
 * One contract. Everything else is derived by `BaseClient`:
 *
 *     this.identity.findById({ params })        // routes to user.findById
 *     this.identity.user.findById({ params })   // the namespaced path still works
 *     this.identity.getApiUsage({ query })      // routes to analytics.getApiUsage
 *
 * ── WHY A CLASS PER SERVICE AND NOT A REGISTRY LOOKUP ───────────────────────
 * `registry.for("identity", identityContract)` works, but it repeats the service
 * name AND the contract at every call site — two facts to keep in step, in every
 * service that reaches identity. Binding them once here means a caller injects
 * `IdentityClient` and cannot pair the wrong contract with the service.
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


// An interface, not a type alias, ON PURPOSE: only an interface merges with the class below, which is how
// the flattened procedures reach the class's type. Do not turn it into a `type` alias: the merge
// breaks with `Duplicate identifier`.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface IdentityClient extends FlatLeaves<ContractRouterClient<typeof identityContract>> {}

@Injectable()
export class IdentityClient extends BaseClient<typeof identityContract> {
	constructor(binder: ServiceClientRegistry) {
		super(binder, { service: "identity", contract: identityContract });
	}
}
