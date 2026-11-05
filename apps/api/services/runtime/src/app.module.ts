import {
	createModuleContext,
	EffectRuntimeModule,
	EffectHostModule,
	EffectHost,
} from "@deployer/nest-effect";
import { registerSchemaCodecs } from "@deployer/shared/config/drizzle/schema-codecs";
import { EnvModule } from "@deployer/shared/config/env/env.module";
import { AuthModule } from "@deployer/shared/core/modules/auth/auth.module";
import { DatabaseModule } from "@deployer/shared/core/modules/database/database.module";
import { RoleCatalogueModule } from "@deployer/shared/core/authz/role-catalogue.module";
import { AppLifecycleModule } from "@deployer/shared/core/modules/lifecycle/lifecycle.module";
import { NodeStateModule } from "@deployer/shared/core/modules/node-state/node-state.module";
import { ServiceClientModule } from "@deployer/shared/server";
import {
	DEPENDENCIES,
	HealthModule,
	PreflightModule,
	ServiceHealthModule,
	createOrpcModule,
} from "@deployer/shared/server";

import { RuntimeDatabaseModule } from "./core/database/database.module";
import { DeploymentDomainModule } from "./modules/deployment/deployment.module";
import { DockerDomainModule } from "./modules/docker/docker.module";

// Module-load, not a lifecycle hook: the column codecs run at QUERY time and the
// first query can happen during bootstrap — before any `onModuleInit`.
registerSchemaCodecs();

/**
 * The runtime service.
 *
 * Owns: deployment, docker, runners.
 *
 * ── WHAT A SERVICE ROOT MODULE CONTAINS ─────────────────────────────────────
 * Imports only. No controllers, no providers: a domain module owns those, and a
 * root module that also declared some would be a second place to look for what
 * this app serves.
 *
 * ── THE SHARED IMPORTS, AND WHY EACH IS HERE ────────────────────────────────
 *   EnvModule, DatabaseModule   configuration + the pool
 *   PreflightModule             proves dependencies BEFORE serving (binds readiness)
 *   ServiceHealthModule         `/health` (liveness) and `/health/ready`
 *   HealthModule                the REAL indicators + their live stream
 *   createOrpcModule()          the transport policy, identical in every app
 */
export class RuntimeServiceModule extends createModuleContext({
	imports: [
		EnvModule,
		AppLifecycleModule.forRoot(),
		DatabaseModule,
		// The authz gate decides from the `roles` table; without this it falls back to the code table
		// and would refuse every custom role (`SEC-062`, `SEC-055`).
		RoleCatalogueModule,
		// ── WHY THE NODE-STATE MODULE ───────────────────────────────────────────
		// It is what registers the LOCAL SQLite database (`NODE_LOCAL_DB_PATH` +
		// migrations) and the node repositories over it. Shared modules read that
		// database — the mesh config, the health disk indicator, `node-status` — so
		// without this import the app boots and then fails at first read with
		// `no such table: node_config`, from a module that names neither the table nor
		// the missing registration.
		NodeStateModule,
		// Cross-service approval guard (`SEC-072`): reaching identity's ledger needs its client.
		ServiceClientModule.forRoot(),
		// ── WHY EVERY SERVICE IMPORTS THE AUTH MODULE ────────────────────────────
		// `createOrpcModule()` injects `AuthCoreService` to build the auth plugin that
		// populates `context.auth`, so the service it injects has to be in this app's
		// graph. Without it the boot fails with `Nest can't resolve dependencies of
		// the Symbol(ORPC_NEST_MODULE_CONFIG) … AuthCoreService at index [1]`, which
		// names neither this module nor the missing import.
		//
		// A service is NOT the session authority — the BFF is — but it must still be
		// able to RESOLVE a session from the request the BFF forwards, which is what
		// binding the same plugin everywhere buys. This is the identical wiring the
		// BFF uses, deliberately: the two sides must agree on what a session is.
		AuthModule,
		PreflightModule.forRoot({ dependencies: DEPENDENCIES.platform }),
		ServiceHealthModule,
		HealthModule.forRoot({ indicators: "platform" }),
		// `.effect()` handlers resolve services from `effect/context`; the runtime contributes that
		// context per request without changing the shared transport policy.
		EffectHostModule,
		createOrpcModule({
			boundary: { service: 'svc-runtime', passThroughFailures: true },
			extraContext: {
				inject: [EffectHost],
				// The request context is the context of the module that owns the controller being called: the
				// handler can only reach what its module provides or exports, exactly what the type audit checks.
				resolve: async (executionContext, host) => ({
					"effect/context": host.contextFor(executionContext.getClass()),
				}),
			},
		}),
		// Effect services are provided by the modules that own them; the runtime discovers them.
		EffectRuntimeModule,
    // The host is how a boundary (the oRPC transport here, a loop elsewhere) reaches the runtime as a service.

		// The database port every repository yields when a call runs: a root provider is invisible to a child
		// module, so it is declared global instead.
		RuntimeDatabaseModule,

		DeploymentDomainModule,
		DockerDomainModule,
	],
}) {}
