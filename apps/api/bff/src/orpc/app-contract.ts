/**
 * The BFF's PUBLIC contract — every procedure the outside world may call.
 *
 * ── WHAT CHANGED, AND WHY ───────────────────────────────────────────────────
 * This file used to compose every SERVICE's router (`project`, `docker`, `mesh`, …)
 * and a middleware forwarded each request to the service that owned the namespace.
 * That made the BFF a PROXY: it published an API it did not own, and the front
 * learned the service topology — which namespace lives in which deployable — as a
 * side effect of being able to call anything.
 *
 * The public surface is now the BFF's OWN: the screens it composes (`/bff/...`) plus
 * the three domains it implements outright (setup, test, template). The service
 * contracts are still imported by the BFF — as the TYPED CLIENTS its orchestrators
 * call — but they are no longer re-exported here. A caller cannot address a service
 * directly, because that is not something the public API offers.
 *
 * ── WHY THE ORCHESTRATION CONTRACT LIVES IN A PACKAGE BUT THIS DOES NOT ─────
 * `@deployer/bff-contracts` owns the screen procedures (they are a stable, declarative
 * shape). This file only MOUNTS them beside the BFF-owned domains, and it is the
 * composition's inferred type that exceeds TypeScript's declaration serialization
 * limit (TS7056) — so it stays in an application, which never emits declarations.
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
	// The composition surface. `dashboardOverview` answers a SCREEN, not a table: it
	// fans out to identity, project and runtime and joins the answers.
	bff: bffOrchestrationContract,

	// The management console's control panel. Separate from the screens above: those
	// JOIN several services, these expose one and exist because the BFF owns the page.
	console: bffConsoleContract,

	// ── THE RESOURCE SURFACE ────────────────────────────────────────────────
	// The service namespaces, served by the BFF through typed clients (see
	// `modules/delegation/`). A screen calls these when it wants the RESOURCE and not a
	// join — `docker.containers.list` is already the shape the container list renders.
	//
	// Mounted from the SHARED list so the front cannot call a namespace this does not
	// serve, or under a different key: a divergence there fails only at runtime, in
	// whichever direction nobody tested.
	...serviceSurface(),

	// The setup wizard must answer BEFORE auth and ORPC are up, and the test surface
	// exists to probe the transport itself — so both are the BFF's and nothing else's.
	setup: setupContract,
	test: testContract,
	template: templateContract,
});

export type AppContract = typeof appContract;
