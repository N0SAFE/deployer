// Public surface of @deployer/fleet-contracts.
//
// Owned by the fleet service: the service serves these procedures and
// nothing else, so the contract cannot drift from the implementation. The BFF
// composes this into its public router.

export * from "./modules/cluster";
export * from "./modules/events";
export * from "./modules/mesh";
export * from "./modules/nodes";
export * from "./modules/platform";
export * from "./modules/provider-schema";
export * from "./modules/providers";
export * from "./modules/reachability";

import { oc } from "@orpc/contract";
import { clusterContract } from "./modules/cluster";
import { nodesContract } from "./modules/nodes";
import { platformContract } from "./modules/platform";
import { providerSchemaContract } from "./modules/provider-schema";
import { providersContract } from "./modules/providers";
import { reachabilityContract } from "./modules/reachability";

/**
 * The WHOLE fleet service, as one contract.
 *
 * ── WHY THIS EXISTS BESIDE THE PER-DOMAIN ROUTERS ───────────────────────────
 * A per-domain router (`userContract`, `analyticsContract`, …) is what the service
 * IMPLEMENTS. This is what a CLIENT binds: naming one contract for a service means a
 * caller cannot pair the wrong domain with the wrong service, and `BaseClient` can
 * hoist every procedure to the root from it.
 *
 * The keys are the namespaces the platform already uses, so a nested path
 * (`fleet.user.findById`) stays valid and matches the HTTP route.
 */
export const fleetServiceContract = oc.router({
	cluster: clusterContract,
	nodes: nodesContract,
	platform: platformContract,
	providerSchema: providerSchemaContract,
	providers: providersContract,
	reachability: reachabilityContract,
});

export type FleetServiceContract = typeof fleetServiceContract;
