import "reflect-metadata";
import "@orpc/effect/extensions/effect";
// The oRPC context augmentation (`context.request`, `context.auth`), imported for
// its side effect and as `@/core/...` so it is the SAME module identity the shared
// code resolves. The package name would load a second copy.
import "@deployer/shared/core/orpc/context";
// Adds `effect/context` to `DefaultInitialContext` for `.effect()` handlers.

import { apiServicePort } from "@deployer/env";
import { analyticsContract, identityContract } from "@deployer/identity-contracts";
import { joinServiceMeshOnNode } from "@deployer/mesh-service";
import { assertRequirementsMet } from "@deployer/nest-effect";
import {
	DEPENDENCIES,
	DependencyNotReadyError,
	bootstrapApiServer,
} from "@deployer/shared/server";

import { IdentityServiceModule } from "./app.module";

import type { Server } from "node:http";


/**
 * The identity service's process entry point.
 *
 * The port comes from the SHARED CATALOG (`apiServicePort("identity")`) rather than a
 * literal: the same catalog decides where the orchestrator schedules this service
 * and where the BFF calls it, so a service cannot listen on one port and be
 * addressed on another.
 */
const PORT = apiServicePort("identity");
const NAME = "svc-identity";

/**
 * The strict requirement gate: the root only compiles when every `[controller, services]` pair forwarded from its
 * domain modules is resolved. A missing provider names both the controller and the service on this line.
 */
const rootModule = assertRequirementsMet(IdentityServiceModule);

/**
 * Reads and writes the global Postgres. Redis is required: this service's
 * queues/coordination run through it.
 */
void bootstrapApiServer({
	rootModule,
	port: PORT,
	name: NAME,
	dependencies: DEPENDENCIES.platform,
})
	.then((app) => {
		// The port is bound and the dependencies are proven: take the service onto the mesh of its node, if it has an agent.
		const membership = joinServiceMeshOnNode({ service: "identity", port: PORT, server: app.getHttpServer() as Server, contracts: [identityContract, analyticsContract] as never });
		(app.getHttpServer() as Server).once("close", () => void membership?.stop());
	})
	.catch((error: unknown) => {
	// A missing dependency is a KNOWN, reportable condition — not an unhandled boot
	// crash. Exit 5 (the documented "dependency unavailable" code) so the
	// orchestrator and the swarm branch on it without parsing a stack trace.
	if (error instanceof DependencyNotReadyError) {
		console.error(error.message);
		process.exit(5);
	}
	console.error(error);
	process.exit(1);
});
