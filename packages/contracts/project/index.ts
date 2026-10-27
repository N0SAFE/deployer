// Public surface of @deployer/project-contracts.
//
// Owned by the project service: the service serves these procedures and
// nothing else, so the contract cannot drift from the implementation. The BFF
// composes this into its public router.

export * from "./modules/domain";
export * from "./modules/project";
export * from "./modules/service";

import { oc } from "@orpc/contract";
import { domainContract } from "./modules/domain";
import { projectContract } from "./modules/project";
import { serviceContract } from "./modules/service";

/**
 * The WHOLE project service, as one contract.
 *
 * ── WHY THIS EXISTS BESIDE THE PER-DOMAIN ROUTERS ───────────────────────────
 * A per-domain router (`userContract`, `analyticsContract`, …) is what the service
 * IMPLEMENTS. This is what a CLIENT binds: naming one contract for a service means a
 * caller cannot pair the wrong domain with the wrong service, and `BaseClient` can
 * hoist every procedure to the root from it.
 *
 * The keys are the namespaces the platform already uses, so a nested path
 * (`project.user.findById`) stays valid and matches the HTTP route.
 */
export const projectServiceContract = oc.router({
	domain: domainContract,
	project: projectContract,
	service: serviceContract,
});

export type ProjectServiceContract = typeof projectServiceContract;
