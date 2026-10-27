/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging -- the interface/class merge below is how the flattened procedures get their types */
import { Injectable } from "@nestjs/common";

import { BaseClient, type FlatLeaves } from "@deployer/nest-service-client";
import type { ContractRouterClient } from "@orpc/contract";
import { analyticsContract } from "@deployer/identity-contracts";
import { ServiceClientRegistry } from "../service-registry";

/**
 * The identity service's ANALYTICS surface, as its own client.
 *
 * ── WHY THIS EXISTS BESIDE `IdentityClient` ─────────────────────────────────
 * Identity owns several domains and they are reached from different places.
 * `IdentityClient` already exposes all of them at the root, so this class is a
 * NARROWING: it declares the dependency as "analytics only", which is what a
 * dashboard composer actually needs. Depending on a service's whole client to call
 * one procedure is how a module ends up coupled to everything that client can do.
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
export interface AnalyticsClient extends FlatLeaves<ContractRouterClient<typeof analyticsContract>> {}

@Injectable()
export class AnalyticsClient extends BaseClient<typeof analyticsContract> {
	constructor(binder: ServiceClientRegistry) {
		super(binder, { service: "identity", contract: analyticsContract });
	}
}
