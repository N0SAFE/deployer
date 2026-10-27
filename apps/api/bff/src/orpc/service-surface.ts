/**
 * The SERVICE namespaces the public surface carries, in one place.
 *
 * ── WHY THIS FILE IS IN THE APPLICATION AND NOT IN THE CONTRACT PACKAGE ─────
 * A function returning the 315-procedure service router has an inferred type that
 * exceeds TypeScript's declaration serialization limit (TS7056). `@deployer/bff-contracts`
 * EMITS declarations, so exporting it from there fails the build with
 * `error TS7056: The inferred type of this node exceeds the maximum length the
 * compiler will serialize`. An application compiles with `declaration: false`, so the
 * type is never serialized here — which is the same reason `app-contract.ts` is local.
 *
 * ── WHY THE SAME LIST IS REPEATED IN THE OTHER APP ──────────────────────────
 * The BFF (which SERVES these) and the web app (which CALLS them) must agree on what
 * exists and under which key. Neither can import the other, and the package cannot
 * hold it, so the list is duplicated and `scripts/check-service-surface-parity.py`
 * fails the build if the two diverge. A test that compares them is the guarantee;
 * a comment saying "keep these in sync" is not.
 *
 * ── WHY THESE ARE NOT ORCHESTRATED ──────────────────────────────────────────
 * A namespace appears here when a screen genuinely wants the RESOURCE, not a join:
 * `docker.containers.list` IS the container list, and no composition makes it smaller.
 * Screens that need several sources joined call the BFF's own `bff.*` procedures —
 * see `packages/contracts/bff/modules/orchestration`. The two are complementary: this
 * carries the resource surface, that carries the screen surface.
 */

import { analyticsContract, pushContract, userContract } from "@deployer/identity-contracts";
import {
	domainContract,
	projectContract,
	serviceContract,
	servicePreviewTopologyContract,
} from "@deployer/project-contracts";
import { deploymentContract, dockerContract } from "@deployer/runtime-contracts";
import {
	clusterContract,
	meshContract,
	nodesContract,
	platformContract,
	providerSchemaContract,
	providersContract,
	reachabilityContract,
} from "@deployer/fleet-contracts";
import { meshBaseResourceContract } from "@deployer/fleet-contracts/modules/mesh/resource/mesh-base-resource.contract";
import { healthContract } from "@deployer/health-contracts";

/**
 * The SERVICE namespaces the API surface carries, in one place.
 *
 * ── WHY THIS IS A SHARED LIST AND NOT TWO ───────────────────────────────────
 * Both the BFF (which serves them) and the web app (which calls them) must agree on
 * what exists and what each namespace is called. Writing the list twice would mean a
 * namespace could be served under one key and called under another — a mismatch that
 * fails only at runtime, in whichever direction nobody tested.
 *
 * ── WHY IT IS A FUNCTION RETURNING AN OBJECT, NOT A ROUTER ──────────────────
 * It returns a PLAIN OBJECT, and the caller mounts it (`oc.router({ ...serviceSurface() })`).
 * That keeps the router construction in the application, where the composed type is never
 * serialized: the inferred type of a 290-procedure router exceeds TypeScript's declaration
 * serialization limit (TS7056), so it cannot be an exported CONSTANT of a package that
 * emits declarations. A function returning the object is what shares the list without
 * sharing the type.
 *
 * ── WHY THESE ARE NOT ORCHESTRATED ──────────────────────────────────────────
 * A namespace appears here when a screen genuinely wants the RESOURCE, not a join:
 * `docker.containers.list` is the container list, and no composition makes it smaller.
 * Screens that need several sources joined call the BFF's own `bff.*` procedures instead
 * — see `modules/orchestration`. The two are complementary, not alternatives: this
 * carries the resource surface, that carries the screen surface.
 */
export function serviceSurface() {
	return {
		// identity
		user: userContract,
		push: pushContract,
		analytics: analyticsContract,

		// project
		project: projectContract,
		service: serviceContract,
		servicePreviewTopology: servicePreviewTopologyContract,
		domain: domainContract,

		// runtime
		deployment: deploymentContract,
		docker: dockerContract,

		// fleet
		cluster: clusterContract,
		nodes: nodesContract,
		providers: providersContract,
		providerSchema: providerSchemaContract,
		reachability: reachabilityContract,
		mesh: meshContract,
		platform: platformContract,
		meshResource: meshBaseResourceContract,

		// health
		health: healthContract,
	};
}
