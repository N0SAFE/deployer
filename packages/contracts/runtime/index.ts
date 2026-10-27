// Public surface of @deployer/runtime-contracts.
//
// Owned by the runtime service: the service serves these procedures and
// nothing else, so the contract cannot drift from the implementation. The BFF
// composes this into its public router.

export * from "./modules/deployment";
export * from "./modules/docker";

import { oc } from "@orpc/contract";
import { deploymentContract } from "./modules/deployment";
import { dockerContract } from "./modules/docker";

/**
 * The WHOLE runtime service, as one contract.
 *
 * ── WHY THIS EXISTS BESIDE THE PER-DOMAIN ROUTERS ───────────────────────────
 * A per-domain router (`userContract`, `analyticsContract`, …) is what the service
 * IMPLEMENTS. This is what a CLIENT binds: naming one contract for a service means a
 * caller cannot pair the wrong domain with the wrong service, and `BaseClient` can
 * hoist every procedure to the root from it.
 *
 * The keys are the namespaces the platform already uses, so a nested path
 * (`runtime.user.findById`) stays valid and matches the HTTP route.
 */
export const runtimeContract = oc.router({
	deployment: deploymentContract,
	docker: dockerContract,
});

export type RuntimeContract = typeof runtimeContract;
