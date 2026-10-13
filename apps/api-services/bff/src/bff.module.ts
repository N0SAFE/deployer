import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { AppLifecycleModule } from "@deployer/nest-lifecycle";
import { createOrpcModule, PreflightModule, DEPENDENCIES } from "@deployer/shared/server";
import { GLOBAL_DATABASE_CONNECTION } from "@deployer/nest-database-core/database-connection";
import { registerSchemaCodecs } from "@/config/drizzle/schema-codecs";
import { EnvModule, EnvService } from "@/config/env/env.module";
import { DatabaseModule } from "@/core/modules/database/database.module";
import { AuthModule } from "@/core/modules/auth/auth.module";
import { createBetterAuth } from "@/config/auth/auth";

import { ServiceClientModule } from "./clients/service-client.module";
import { ServiceAuthContextMiddleware } from "./clients/service-auth-context.middleware";
import { DelegationModule } from "./modules/delegation/delegation.module";
import { OrchestrationModule } from "./modules/dashboard/orchestration.module";
import { PlatformHealthModule } from "./modules/health/platform-health.module";
import { PlatformConsoleModule } from "./modules/console/platform-console.module";
import { SetupDomainModule } from "./domains/setup/setup.module";
import { TestDomainModule } from "./domains/test/test.module";

// Registered at MODULE LOAD, not in a lifecycle hook: the column codecs run at
// QUERY time and the first query can happen during bootstrap — before any
// `onModuleInit`. Doing it here means it cannot be ordered wrong.
registerSchemaCodecs();

/**
 * The Backend For Frontend.
 *
 * ── WHAT THE BFF OWNS, AND WHAT IT DELIBERATELY DOES NOT ────────────────────
 * It owns the public edge and the things that MUST have a single owner:
 *
 *   env + database    — the BFF is what Traefik points at, so it is the process
 *                       that answers for the platform's readiness;
 *   auth + session    — ONLY the BFF parses a browser session. Services receive
 *                       the forwarded request and read the resolved actor, so
 *                       there is one session authority rather than N;
 *   front-facing reads — a screen module composes several services into the one
 *                       shape the front needs (see `modules/`), which is what
 *                       makes "the BFF is not a proxy" true rather than a slogan.
 *
 * ── WHY IT DECLARES THE PLATFORM DEPENDENCY SET ─────────────────────────────
 * `PreflightModule.forRoot(DEPENDENCIES.platform)` is what turns "the graph
 * assembled" into "the app can serve": Postgres reachable, the schema migrated,
 * Redis up. Without it the BFF would bind its port, report itself healthy, and
 * forward traffic into services that are about to fail it.
 */
@Module({
	imports: [
		EnvModule,
		// `forRoot()` IS REQUIRED: the class is `@Module({})`, so importing it bare
		// registers no providers and every consumer of `AppLifecycleService` fails
		// to resolve at boot.
		AppLifecycleModule.forRoot(),
		DatabaseModule,
		AuthModule.forRootAsync({
			imports: [EnvModule],
			useFactory: createBetterAuth,
			inject: [GLOBAL_DATABASE_CONNECTION, EnvService],
		}),
		// The dependency gate. Binds `SERVICE_READINESS`, so `/health/ready` and
		// the boot check are the same answer by construction.
		PreflightModule.forRoot({ dependencies: DEPENDENCIES.platform }),
		createOrpcModule(),

		// ── THE SERVICE CLIENT REGISTRY ──────────────────────────────────────
		// Imported (not declared as a provider below) because the modules that
		// CONSUME it — every screen that composes a service — are imported BY this
		// module. A provider declared here would be visible only here, and Nest
		// resolves providers UPWARD, not downward: declaring it on `BffModule`
		// cannot satisfy a dependency in a module `BffModule` imports.
		ServiceClientModule,

		// ── THE RESOURCE SURFACE ──────────────────────────────────────
		// The service namespaces, owned by the BFF and served through typed clients.
		// A screen calls these when it wants the RESOURCE rather than a join; the
		// modules below serve the JOINED, screen-shaped procedures.
		DelegationModule,

		// Front-facing composition. Each screen module owns the shape the front
		// consumes and calls whatever services it needs.
		OrchestrationModule,
		PlatformHealthModule,
		PlatformConsoleModule,

		// ── Domains the BFF owns OUTRIGHT ────────────────────────────────
		// `setup` and `test` are the two namespaces in the public contract that no service
		// implements: the wizard must answer BEFORE auth and ORPC come up, and the test surface
		// exists to probe the transport itself. Both are therefore the BFF's, and this is the
		// only place they are served.
		SetupDomainModule,
		TestDomainModule,
	],
	providers: [ServiceAuthContextMiddleware],
})
export class BffModule implements NestModule {
	/**
	 * Bind the CALLER's credentials to the request, for every fan-out to come.
	 *
	 * ── WHY THE BFF HAS A MIDDLEWARE AT ALL, NOW THAT IT DOES NOT FORWARD ────
	 * The old edge copied each inbound request onto the owning service, so the
	 * caller's session cookie reached the service BECAUSE THE REQUEST DID. The BFF no
	 * longer relays requests — it calls services itself and composes the answers — so
	 * the cookie has to travel another route, or every fan-out would be anonymous and
	 * every service would answer 401. This captures it once, here, where the inbound
	 * request provably exists: `ServiceClientRegistry` then sends it on each leg.
	 *
	 * ── WHY `forRoutes("*")` RATHER THAN THE ORPC PATHS ─────────────────────
	 * Any handler may compose, including ones reached outside the oRPC surface (the
	 * console pages, the health roll-up). Enumerating paths would be a list that has to
	 * be kept in step with every future orchestrator — and the failure mode of getting
	 * it wrong is a silent 401 deep inside a fan-out, not a startup error.
	 */
	configure(consumer: MiddlewareConsumer): void {
		consumer.apply(ServiceAuthContextMiddleware).forRoutes("*");
	}
}
