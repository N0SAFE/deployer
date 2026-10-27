/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging -- the interface/class merge below is how the flattened procedures get their types */
import { Injectable } from "@nestjs/common";

import { BaseClient, type FlatLeaves } from "@deployer/nest-service-client";
import type { ContractRouterClient } from "@orpc/contract";
import { fleetServiceContract } from "@deployer/fleet-contracts";
import { ServiceClientRegistry } from "../service-registry";

/**
 * The fleet service, with every procedure callable at the ROOT.
 *
 * Bound to the service's COMBINED contract. `getManagedWebState` is reachable as
 * `this.fleet.getManagedWebState({})` as well as
 * `this.fleet.platform.getManagedWebState({})` — which is what lets the console
 * client drop the explicit `platformContract` pairing at every call.
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
export interface FleetClient extends FlatLeaves<ContractRouterClient<typeof fleetServiceContract>> {}

@Injectable()
export class FleetClient extends BaseClient<typeof fleetServiceContract> {
	constructor(binder: ServiceClientRegistry) {
		super(binder, { service: "fleet", contract: fleetServiceContract });
	}
}
