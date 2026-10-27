// Public surface of @deployer/identity-contracts.
//
// Owned by the identity service: the service serves these procedures and
// nothing else, so the contract cannot drift from the implementation. The BFF
// composes this into its public router.

export * from "./modules/analytics";
export * from "./modules/push";
export * from "./modules/user";

// Convenience input/output aliases derived from the user contracts.
export * from "./types";

import { oc } from "@orpc/contract";
import { analyticsContract } from "./modules/analytics";
import { pushContract } from "./modules/push";
import { userContract } from "./modules/user";

/**
 * The WHOLE identity service, as one contract.
 *
 * ── WHY THIS EXISTS BESIDE THE PER-DOMAIN ROUTERS ───────────────────────────
 * A per-domain router (`userContract`, `analyticsContract`, …) is what the service
 * IMPLEMENTS. This is what a CLIENT binds: naming one contract for a service means a
 * caller cannot pair the wrong domain with the wrong service, and `BaseClient` can
 * hoist every procedure to the root from it.
 *
 * The keys are the namespaces the platform already uses, so a nested path
 * (`identity.user.findById`) stays valid and matches the HTTP route.
 */
export const identityContract = oc.router({
	analytics: analyticsContract,
	push: pushContract,
	user: userContract,
});

export type IdentityContract = typeof identityContract;
