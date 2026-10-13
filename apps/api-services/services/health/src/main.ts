import "reflect-metadata";
// The oRPC context augmentation (`context.request`, `context.auth`), imported for
// its side effect and as `@/core/...` so it is the SAME module identity the
// shared code resolves. The package name would load a second copy.
import "@/core/orpc/context";

import {
	DEPENDENCIES,
	DependencyNotReadyError,
	apiServicePort,
	bootstrapApiServer,
} from "@deployer/shared/server";

import { HealthServiceModule } from "./app.module";

/**
 * The health service's process entry point.
 *
 * The port comes from the SHARED CATALOG (`apiServicePort("health")`) rather than
 * a literal: the same catalog decides where the orchestrator schedules this
 * service and where the BFF calls it, so a service cannot listen on one port and
 * be addressed on another.
 */
const PORT = apiServicePort("health");
const NAME = "svc-health";

/**
 * This service reads the database to answer readiness, so it declares the
 * database dependency — reachable AND migrated. It does not declare Redis:
 * requiring a dependency it never uses would make it un-startable for no gain,
 * and the first service to fall over would be the one reporting everyone else's
 * health.
 */
void bootstrapApiServer({
	rootModule: HealthServiceModule,
	port: PORT,
	name: NAME,
	dependencies: DEPENDENCIES.database,
}).catch((error: unknown) => {
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
