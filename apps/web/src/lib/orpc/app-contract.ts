/**
 * The API contract the web client talks to.
 *
 * ── WHAT CHANGED, AND WHY IT IS SMALLER ─────────────────────────────────────
 * This used to be a LOCAL COMPOSITION of 21 service contracts. The web app therefore
 * addressed services DIRECTLY (`orpc.project.list`, `orpc.docker.containers.list`) and
 * reached them through the BFF's forwarding middleware, which relayed each request to
 * whichever deployable owned that namespace. Two consequences followed, both wrong:
 *
 *   the front knew the SERVICE TOPOLOGY — which namespace lives in which deployable —
 *   as a side effect of being able to call anything, so a service could not be split,
 *   merged or renamed without editing the browser's data layer; and
 *
 *   every screen did its OWN joining, because a screen needs several namespaces and
 *   nothing joined them. That is orchestration performed in components: untestable
 *   there, re-decided per screen, and impossible to make consistent.
 *
 * The contract is now the BFF's OWN surface. A screen asks for a screen
 * (`orpc.bff.projectDetail`), the BFF fans out to the services that own the data and
 * joins the answers into the shape the screen renders.
 *
 * ── WHY IT IS COMPOSED LOCALLY RATHER THAN RE-EXPORTED ──────────────────────
 * It imports the BFF's contract PACKAGE (`@deployer/bff-contracts`) and MOUNTS its routers
 * — it does not re-declare them. Mounting is required because the inferred type of the
 * composition exceeds TypeScript's declaration serialization limit (TS7056), so it
 * cannot live in a package that emits declarations. The web app never emits them, so
 * the type is never serialized.
 */

import { oc } from "@orpc/contract";

import {
	bffConsoleContract,
	bffOrchestrationContract,
	setupContract,
	templateContract,
	testContract,
} from "@deployer/bff-contracts";
import { serviceSurface } from "./service-surface";

export const appContract = oc.router({
	// The composition surface — each key answers a SCREEN, not a table.
	bff: bffOrchestrationContract,

	// The management console. Present because the front links operators INTO it and
	// renders its state in the settings screen; it is still the BFF's surface.
	console: bffConsoleContract,

	// ── THE RESOURCE SURFACE ────────────────────────────────────────────────
	// The same namespaces the BFF serves, mounted from the SHARED list. A screen calls
	// these when it wants the RESOURCE, and `bff.*` when it wants a join. Sharing the
	// list is what makes "the front can only call what the BFF serves" true by
	// construction rather than by review.
	...serviceSurface(),

	// BFF-owned domains: the wizard answers BEFORE auth exists, and the test surface
	// exists to probe the transport itself.
	setup: setupContract,
	test: testContract,
	template: templateContract,
});

export type AppContract = typeof appContract;
