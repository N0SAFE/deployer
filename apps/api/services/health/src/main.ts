import "reflect-metadata";
import "@orpc/effect/extensions/effect";
// The oRPC context augmentation (`context.request`, `context.auth`), imported for
// its side effect and as `@/core/...` so it is the SAME module identity the
// shared code resolves. The package name would load a second copy.
import "@deployer/shared/core/orpc/context";
// Adds `effect/context` to `DefaultInitialContext` for `.effect()` handlers.

import { apiServicePort } from "@deployer/env";
import { healthContract } from "@deployer/health-contracts";
import { joinServiceMeshOnNode } from "@deployer/mesh-service";
import { assertRequirementsMet, EffectRuntime } from "@deployer/nest-effect";
import {
	DEPENDENCIES,
	DependencyNotReadyError,
	bootstrapApiServer,
} from "@deployer/shared/server";


import { HealthServiceModule } from "./app.module";

import type { Server } from "node:http";

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
/**
 * The strict check, before a single provider is built.
 *
 * `assertRequirementsMet` is a type gate: it accepts a module only when every `[controller, services]` pair its subtree
 * forwarded is resolved. Here it is empty — `HealthDomainModule` provides `HealthService` and
 * `HealthRegistryRepository` — and a missing provider is a compile error on this line, naming both.
 */
const rootModule = assertRequirementsMet(HealthServiceModule);

void bootstrapApiServer({
	rootModule,
	port: PORT,
	name: NAME,
	dependencies: DEPENDENCIES.database,
})
	.then((app) => {
		// Which services a controller reaches today that its module does not allow once the scope is enforced.
		if (process.env.EFFECT_SCOPE_REPORT === "1") {
			for (const row of app.get(EffectRuntime).scopeReport()) {
				console.log(`[scope] ${row.controller} → out of scope: ${row.outOfScope.join(", ")}`);
			}
		}

		// The port is bound and the dependencies are proven: take the service onto the mesh of its node, if it has an agent.
		const membership = joinServiceMeshOnNode({ service: "health", port: PORT, server: app.getHttpServer() as Server, contracts: [healthContract] as never });
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
