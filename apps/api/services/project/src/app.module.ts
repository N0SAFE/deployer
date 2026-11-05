import {
	createModuleContext,
	EffectRuntimeModule,
	EffectHost,
	EffectHostModule,
} from "@deployer/nest-effect";
import { registerSchemaCodecs } from "@deployer/shared/config/drizzle/schema-codecs";
import { EnvModule } from "@deployer/shared/config/env/env.module";
import { AuthModule } from "@deployer/shared/core/modules/auth/auth.module";
import { DatabaseModule } from "@deployer/shared/core/modules/database/database.module";
import { RoleCatalogueModule } from "@deployer/shared/core/authz/role-catalogue.module";
import { AppLifecycleModule } from "@deployer/shared/core/modules/lifecycle/lifecycle.module";
import {
	DEPENDENCIES,
	HealthModule,
	PreflightModule,
	ServiceClientModule,
	ServiceHealthModule,
	createOrpcModule,
} from "@deployer/shared/server";

import { DatabasePortModule } from "@project/core/database/database.module";

import { DomainModule } from "./modules/domain/domain.module";
import { ProjectDomainModule } from "./modules/project/project.module";
import { ServiceDomainModule } from "./modules/service/service.module";

// Module-load, not a lifecycle hook: the column codecs run at QUERY time and the
// first query can happen during bootstrap — before any `onModuleInit`.
registerSchemaCodecs();

/**
 * The project service.
 *
 * Owns: project, service, domain.
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
export class ProjectServiceModule extends createModuleContext({
	imports: [
		EnvModule,
		AppLifecycleModule.forRoot(),
		DatabaseModule,
		// The authz gate decides from the `roles` table; without this it falls back to the code table
		// and would refuse every custom role (`SEC-062`, `SEC-055`).
		RoleCatalogueModule,
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
		PreflightModule.forRoot({ dependencies: DEPENDENCIES.database }),
		ServiceHealthModule,
		HealthModule.forRoot({ indicators: "database" }),
		// ── WHY A @Global MODULE STILL HAS TO BE IMPORTED ───────────────────────
		// `ProjectNetworkService` and `ServiceNetworkService` inject
		// `ServiceClient` — the transport for reaching a PEER's contract, which is
		// how this domain asks fleet for DNS facts without importing fleet's
		// internals. Global only means "visible everywhere once registered"; the
		// module must still be imported ONCE, and this service never did:
		//
		//   Nest can't resolve dependencies of the ProjectNetworkService
		//   (ProjectRepository, ProjectDomainRepository, ?) … ServiceClient at
		//   index [2] is available in the ProjectDomainModule module
		ServiceClientModule.forRoot(),
		// `.effect()` handlers resolve services from `effect/context`; the runtime
		// contributes that context per request without changing the shared policy.
		EffectHostModule,
		createOrpcModule({
			boundary: { service: 'svc-project' },
			extraContext: {
				inject: [EffectHost],
				resolve: (executionContext, host) => ({
					"effect/context": host.contextFor(executionContext.getClass()),
				}),
			},
		}),
		EffectRuntimeModule,

		ProjectDomainModule,
		ServiceDomainModule,
		DomainModule,
		DatabasePortModule,
	],
}) {}
