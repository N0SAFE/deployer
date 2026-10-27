import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { AppLifecycleModule } from "@deployer/nest-lifecycle";
import {
	createOrpcModule,
	PreflightModule,
	DEPENDENCIES,
	ServiceHealthModule,
} from "@deployer/shared/server";
import { GLOBAL_DATABASE_CONNECTION } from "@deployer/nest-database-core/database-connection";
import { registerSchemaCodecs } from "@/config/drizzle/schema-codecs";
import { EnvModule, EnvService } from "@/config/env/env.module";
import { DatabaseModule } from "@/core/modules/database/database.module";
import { AuthModule } from "@/core/modules/auth/auth.module";
import { createBetterAuth } from "@/config/auth/auth";

import { ServiceClientModule } from "./clients/service-client.module";
import { ServiceAuthContextMiddleware } from "./clients/service-auth-context.middleware";
import { DelegationModule } from "./modules/delegation/delegation.module";
import { DocsModule } from "./modules/docs/docs.module";
import { OrchestrationModule } from "./modules/dashboard/orchestration.module";
import { PlatformHealthModule } from "./modules/health/platform-health.module";
import { PlatformConsoleModule } from "./modules/console/platform-console.module";
import { SetupDomainModule } from "./domains/setup/setup.module";
// The boot coordinator (migrations, default admin). See the import note in
// `BootstrapModule`'s entry in the module list — without it nothing applies the
// global migrations on boot and no service can ever pass its `migrations` check.
import { BootstrapModule } from "@/core/modules/bootstrap/bootstrap.module";
import { TestDomainModule } from "./domains/test/test.module";
// ── THE PLATFORM SUPERVISORS, WHICH THE BFF IS THE ONLY APP TO RUN ────────
// In a supervised stack NOTHING but the platform runs the database, Redis or the
// ingress. Those supervisors shipped in the tier but were imported by NO
// APP — so a swarm-scheduled BFF booted, found no supervisor registry, and the
// platform never converged its own infrastructure:
//
//   deployer-postgres  0/1   (nobody created it)
//   deployer-redis     0/1
//   deployer-traefik   0/1   → every hostname answers 404 page not found
//
// The monolith has always imported these (`apps/api/src/app.module.ts`), which is
// why the supervised monolith profile worked and the microservices one could not.
// The BFF inherits the monolith's public role, so it inherits the duty.
import { SupervisorsModule } from "@deployer/nest-supervisor-core/supervisors.module";
import { SupervisorsDatabaseModule } from "@/core/modules/supervisors/database/database-supervisors.module";
import { SupervisorsPlatformModule } from "@/core/modules/supervisors/platform/platform-supervisors.module";
// ── THE INGRESS'S ROUTE SOURCE ──────────────────────────────────────────
// Traefik runs with its HTTP provider pointed at
// `/<TRAEFIK_CONFIG_PATH>` on THIS app, and `TraefikIngressConfigController` is
// what answers there. Without this module the ingress polls a 404, caches an
// empty routing table, and every hostname 404s while all seven services report
// healthy — the most misleading state a supervised stack can be in.
import { TraefikCoreModule } from "@/core/modules/traefik/traefik.module";
// Swarm primitives the supervisors schedule onto, plus the node's mesh agent —
// the same two the monolith imports beside the supervisors, for the same reason:
// the supervisors cannot converge overlay networks the engine has not joined.
import { SwarmCoreModule } from "@/core/modules/swarm/swarm.module";
import { CorePlatformIngressModule } from "@/core/modules/platform-ingress/platform-ingress.module";
import { MeshAgentModule } from "@/core/modules/mesh-agent/mesh-agent.module";

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
		// The TRANSPORT for that verdict. `PreflightModule` binds the port but
		// registers no route, so without this the BFF answers 404 on
		// `/health/ready` — while compose probes every app in
		// `docker-compose.config.services.yml` on that exact path. The BFF would
		// then be permanently unhealthy and any `depends_on: service_healthy` on
		// it unsatisfiable. Every service imports this; the BFF is the one app
		// that answers for the platform, so it needs it most.
		ServiceHealthModule,
		createOrpcModule(),

		// ── THE PLATFORM SUPERVISORS (WHAT "SUPERVISED" MEANS) ──────────────
		// Ordered ahead of the feature modules by INTENT; Nest resolves the graph
		// independently of this list, so the note records why they belong here rather
		// than in a service.
		//
		//   SupervisorsModule          the registry + event bus (lean: no Docker/Env)
		//   SupervisorsDatabaseModule  global Postgres, local databases
		//   SupervisorsPlatformModule  Traefik, Redis, managed web, app wiring
		//   SwarmCoreModule            the engine the supervisors schedule ONTO
		//   TraefikCoreModule          the routes Traefik POLLS from this app
		//   CorePlatformIngressModule  hostname/lane helpers the supervisors read
		//   MeshAgentModule            the node's mesh identity + control socket
		//
		// The BFF is the only app in this tier with a public role, so it is the only
		// one that both SERVES the ingress config and RUNS the supervisors. A service
		// importing them would create a second registry in a process Traefik never
		// talks to.
		SupervisorsModule.forRoot(),
		SupervisorsDatabaseModule,
		SupervisorsPlatformModule,
		SwarmCoreModule,
		TraefikCoreModule,
		CorePlatformIngressModule,
		MeshAgentModule,

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
		// implements: the wizard must answer BEFORE auth and ORPC come up, and the test surface
		// exists to probe the transport itself. Both are therefore the BFF's, and this is the
		// only place they are served.
		SetupDomainModule,
		TestDomainModule,
		// ── THE PUBLISHED API DOCUMENT ───────────────────────────────────
		// Serves `/openapi.json` and `/reference`. Nothing in this tier served a
		// spec (blocker 7 in the cutover status), and the monolith only ever wrote
		// one to stdout — so the web devtools iframe's `/reference` src 404'd.
		DocsModule,

		// ── THE BOOT PIPELINE ────────────────────────────────────────────────
		// `BootstrapOrchestratorService` is the RESTART path: swarm overlay → DB
		// probe → PENDING GLOBAL MIGRATIONS → default admin. The monolith imports
		// it (`apps/api/src/app.module.ts`); the BFF did not, and nothing else in
		// this tier did either — `docs/API-CUTOVER-STATUS.md` lists
		// this as open blocker #5, "`BootstrapModule` … imported by nothing".
		//
		// The consequence was not a missing feature, it was a platform that could
		// never become ready. A node whose wizard had written `setupState =
		// "setup_done"` still had an EMPTY database, because the only code that
		// applies the global migrations on boot was not in this graph:
		//
		//   relation "drizzle.__drizzle_migrations" does not exist
		//   relation "local_event_outbox" does not exist
		//   [preflight] preflight attempt 364 not ready — retrying in 2000ms
		//   docker compose up → "container nextjs-nestjs-bff-dev is unhealthy"
		//
		// Every `svc-*` declares `DEPENDENCIES.database` (reachable AND migrated),
		// so none of them could ever pass their own preflight. The stack had no
		// converging state at all — not "slow", not "waiting on setup", but
		// permanently un-ready — and `up -d` exited 1.
		//
		// `BootstrapModule` is `@Global()`, so importing it here makes the
		// orchestrator reachable without further wiring.
		BootstrapModule,
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
