import "reflect-metadata";
import "@orpc/effect/extensions/effect";
// The oRPC context augmentation (`context.request`, `context.auth`), imported for
// its side effect and as `@/core/...` so it is the SAME module identity the shared
// code resolves. The package name would load a second copy.
import "@deployer/shared/core/orpc/context";

import {
	DEPENDENCIES,
	DependencyNotReadyError,
	bootstrapApiServer,
} from "@deployer/shared/server";
import { apiServicePort } from "@deployer/env";

import { projectServiceContract } from "@deployer/project-contracts";
import { assertRequirementsMet } from "@deployer/nest-effect";
import { joinServiceMeshOnNode } from "@deployer/mesh-service";
import type { Server } from "node:http";

import { ProjectServiceModule } from "./app.module";

/**
 * The project service's process entry point.
 *
 * The port comes from the SHARED CATALOG (`apiServicePort("project")`) rather than a
 * literal: the same catalog decides where the orchestrator schedules this service
 * and where the BFF calls it, so a service cannot listen on one port and be
 * addressed on another.
 */
const PORT = apiServicePort("project");
const NAME = "svc-project";

/**
 * Reads and writes the global Postgres.
 * No Redis: declaring it would make the service un-startable for a dependency it never uses.
 */
/**
 * The strict requirement gate: the root only compiles when every `[controller, services]` pair forwarded from
 * `ProjectServiceModule` is resolved. A missing provider names both the controller and the service on this line.
 */
const rootModule = assertRequirementsMet(ProjectServiceModule);

void bootstrapApiServer({
	rootModule,
	port: PORT,
	name: NAME,
	dependencies: DEPENDENCIES.database,
})
	.then((app) => {
		// The port is bound and the dependencies are proven: take the service onto the mesh of its node, if it has an agent.
		const membership = joinServiceMeshOnNode({ service: "project", port: PORT, server: app.getHttpServer() as Server, contracts: [projectServiceContract] as never });
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
