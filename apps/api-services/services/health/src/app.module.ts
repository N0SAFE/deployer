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

import { HealthDomainModule } from "./modules/health/health.module";

// Module-load, not a lifecycle hook: the column codecs run at QUERY time and the
// first query can happen during bootstrap — before any `onModuleInit`.
registerSchemaCodecs();

/**
 * The health service.
 *
 * ── WHAT A SERVICE ROOT MODULE CONTAINS ─────────────────────────────────────
 * Imports only. No controllers, no providers: a domain module owns those, and a
 * root module that also declared some would be a second place to look for what
 * this app serves.
 *
 * ── THE FIVE THINGS EVERY SERVICE IMPORTS, AND WHY EACH ─────────────────────
 *   1. `EnvModule`            validated configuration
 *   2. `DatabaseModule`       the pool (only when the service needs one)
 *   3. `PreflightModule`      proves dependencies BEFORE serving; binds readiness
 *   4. `ServiceHealthModule`  `/health` (liveness) and `/health/ready`
 *   5. `createOrpcModule()`   the transport policy, identical in every app
 *
 * Omitting any of these is not a compile error and fails as "the platform is
 * odd" rather than "this app is wrong" — which is why the set is stated here.
 *
 * ── PREFLIGHT *AND* HealthModule, DELIBERATELY ──────────────────────────────
 * They answer at different times using the SAME real indicators:
 *   - preflight runs ONCE at boot and gates the port (may the process serve?);
 *   - HealthModule streams continuously and answers `/health/detailed` (what is
 *     true now, and what changed?).
 * Preflight binds `SERVICE_READINESS`; `ServiceHealthModule` reads it OPTIONALLY,
 * so the two cannot conflict over the token.
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
		PreflightModule.forRoot({ dependencies: DEPENDENCIES.platform }),
		ServiceHealthModule,
		// The real probes: Terminus indicators with a streaming registry. Declared
		// `platform` (not `database`) because this service's entire job is to report
		// the platform's health, so it must check everything it can.
		HealthModule.forRoot({ indicators: "platform" }),
		createOrpcModule(),

		HealthDomainModule,
	],
})
export class HealthServiceModule {}
