import { Module } from "@nestjs/common";
import { AppLifecycleModule } from "@deployer/nest-lifecycle";
import {
	DEPENDENCIES,
	HealthModule,
	PreflightModule,
	ServiceHealthModule,
	createOrpcModule,
} from "@deployer/shared/server";
import { registerSchemaCodecs } from "@/config/drizzle/schema-codecs";
import { EnvModule, EnvService } from "@/config/env/env.module";
import { GLOBAL_DATABASE_CONNECTION } from "@deployer/nest-database-core/database-connection";
import { DatabaseModule } from "@/core/modules/database/database.module";
import { AuthModule } from "@/core/modules/auth/auth.module";
import { createBetterAuth } from "@/config/auth/auth";

import { ClusterModule } from "./modules/cluster/cluster.module";
import { FleetModule } from "./modules/fleet/fleet.module";
import { MeshCoreModule } from "@/core/modules/mesh/mesh-core.module";
import { PlatformModule } from "./modules/platform/platform.module";
import { ProvidersModule } from "./modules/providers/providers.module";
import { ProviderSchemaModule } from "./modules/provider-schema/provider-schema.module";
import { ReachabilityModule } from "./modules/reachability/reachability.module";

// Module-load, not a lifecycle hook: the column codecs run at QUERY time and the
// first query can happen during bootstrap — before any `onModuleInit`.
registerSchemaCodecs();

/**
 * The fleet service.
 *
 * Owns: cluster, fleet, providers, provider-schema, reachability, platform.
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
@Module({
	imports: [
		EnvModule,
		AppLifecycleModule.forRoot(),
		DatabaseModule,
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
		AuthModule.forRootAsync({
			imports: [EnvModule],
			useFactory: createBetterAuth,
			inject: [GLOBAL_DATABASE_CONNECTION, EnvService],
		}),
		PreflightModule.forRoot({ dependencies: DEPENDENCIES.database }),
		ServiceHealthModule,
		HealthModule.forRoot({ indicators: "database" }),
		createOrpcModule(),

		ClusterModule,
		FleetModule,
		// ── WHY FLEET HOSTS THE MESH, AND RUNTIME MUST NOT ──────────────────────
		// `meshContract` is owned by `@deployer/fleet-contracts`, and the BFF
		// delegates the `mesh` and `meshResource` namespaces to "fleet"
		// (`clients.for("fleet", meshContract)`). `MeshCoreModule` is what
		// DECLARES those controllers — so without this import every mesh call
		// through the BFF 404s, because the delegation target served neither.
		//
		// `runtime` also imports it, for the dispatcher its docker stack needs
		// internally. Both register the controllers in their OWN process, which
		// is harmless: they are separate deployables, and only the one the BFF
		// targets is reachable from the public surface.
		MeshCoreModule,
		PlatformModule,
		ProvidersModule,
		ProviderSchemaModule,
		ReachabilityModule,
	],
})
export class FleetServiceModule {}
