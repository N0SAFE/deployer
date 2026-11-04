import { randomUUID } from "node:crypto";

import { Effect } from "effect";
import { beforeAll, describe, expect, it } from "vitest";

// ── WHY `@/e2e/runtime`, NOT `@/e2e-harness/shared-api-runtime` ─────────────
// The harness is app-agnostic and REQUIRES `nest.rootModuleLoader` — it lives in
// `shared`, where `@/app.module` resolves to nothing, so it cannot default. The
// app-local `@/e2e/runtime` wrapper binds this service's root module; importing the
// harness directly throws
// `SharedApiRuntimeOptions.nest.rootModuleLoader is required` at boot.
import { Actor, Correlation, CurrentActor, HttpRequest, systemRequest, type Ambient } from "@deployer/effect-core";
import { user } from "@deployer/nest-schema/global/identity/auth";
import { projects, services } from "@deployer/nest-schema/global/project/deployment";
import { GlobalDatabaseService } from "@deployer/shared/core/modules/database/services/global-database.service";

import { getSharedApiRuntimeContext, type SharedApiRuntimeContext } from "@/e2e/runtime";
import { AnalyticsRepository } from "@/modules/analytics/repositories/analytics.repository";
import { AnalyticsService, type AnalyticsServiceShape } from "@/modules/analytics/services/analytics.service";
import { UserRepository } from "@/modules/user/repositories/user.repository";
import { UserService, type UserServiceShape } from "@/modules/user/services/user.service";
import type { UserFailure } from "@/modules/user/services/user.service";

import { DatabasePort, type DatabaseShape } from "@identity/core/database/database.port";
import { ApprovalService } from "@identity/modules/approval/approval.service";
import { AuditService } from "@identity/modules/audit/audit.service";
import { RoleRepository } from "@identity/modules/role/role.repository";
import { RoleService } from "@identity/modules/role/role.service";
import { StepUpService } from "@identity/modules/step-up/step-up.service";


/** Run a user use case as `actor` against the real repository, outside the oRPC context. */
function runUsers<T>(
	database: DatabaseShape,
	actor: { userId: string; role: string },
	use: (users: UserServiceShape) => Effect.Effect<
		T,
		UserFailure,
		Ambient | UserRepository | DatabasePort | StepUpService | RoleService | AuditService | HttpRequest | ApprovalService
	>,
): Promise<T> {
	return Effect.runPromise(
		Effect.gen(function* () {
			const users = yield* UserService;
			return yield* use(users);
		}).pipe(
			Effect.provideService(UserService, UserService.live),
			Effect.provideService(UserRepository, UserRepository.live),
			Effect.provideService(DatabasePort, database),
			Effect.provideService(CurrentActor, Actor.user(actor.userId, actor.role)),
			Effect.provideService(HttpRequest, systemRequest),
			Effect.provideService(Correlation, { id: "e2e" }),
			// Critical actions (delete, role change, ban) require a passkey proof; this e2e is about the data layer.
			Effect.provideService(StepUpService, {
				assertCritical: () => Effect.void,
				status: () => Effect.die(new Error("unused")),
			} as unknown as StepUpService["Service"]),
			Effect.provideService(RoleService, RoleService.live),
			// The trail is not what this e2e proves; the write is fire-and-forget by design.
			Effect.provideService(AuditService, {
				record: () => Effect.void,
			} as unknown as AuditService["Service"]),
			// Approval enforcement is checked in its own spec; this e2e runs as an actor that holds the capability.
			Effect.provideService(ApprovalService, {
				require: () => Effect.void,
			} as unknown as ApprovalService["Service"]),
			Effect.provideService(RoleRepository, RoleRepository.live),
		),
	);
}

/** Run an analytics use case against the real repository, outside the oRPC context. */
function runAnalytics<A, E>(
	database: DatabaseShape,
	use: (analytics: AnalyticsServiceShape) => Effect.Effect<A, E, AnalyticsRepository | DatabasePort>,
): Promise<A> {
	return Effect.runPromise(
		Effect.gen(function* () {
			const analytics = yield* AnalyticsService;
			return yield* use(analytics);
		}).pipe(
			Effect.provideService(AnalyticsService, AnalyticsService.live),
			Effect.provideService(AnalyticsRepository, AnalyticsRepository.live),
			Effect.provideService(DatabasePort, database),
		),
	);
}

/**
 * The identity service's happy paths.
 *
 * ── WHY THE PROJECT/SERVICE CASE IS NOT HERE ────────────────────────────────
 * It used to create a project and a service, which only worked while every domain shared
 * one process. Those are the PROJECT service's rules now, so the case lives with that
 * service; exercising them here would assert another domain's behaviour from inside the
 * identity app, which is the coupling the split removes.
 */
describe("Identity happy-path workflows e2e: the domains this service owns", () => {
	let runtime: SharedApiRuntimeContext;
	let admin: { userId: string; role: string };
	let database: DatabaseShape;

	beforeAll(async () => {
		runtime = await getSharedApiRuntimeContext();

		// The user domain's mutations are admin-only — `assertCanAdminister` is the rule, so the
		// fixture is given an admin actor rather than the rule being relaxed for the test.
		//
		// The role MUST be one `ADMIN_ROLES` names (`admin` | `superAdmin`), not a
		// platform-sounding synonym: `platform-admin` reads right but is not a member,
		// so `assertCanAdminister` throws `ForbiddenError` and every mutation below
		// fails. The rule is the source of truth for the vocabulary.
		const ownerId = `e2e-owner-${randomUUID()}`;
		admin = { userId: ownerId, role: "admin" };

		const globalDatabase = runtime.serviceMapper.get(GlobalDatabaseService);
		const now = new Date();
		await globalDatabase.db.insert(user).values({
			id: ownerId,
			name: "E2E Owner",
			email: `${ownerId}@example.test`,
			emailVerified: true,
			createdAt: now,
			updatedAt: now,
			role: "admin",
		});

		database = { db: globalDatabase.db };

		// The realtime assertion below asks for two services BY NAME, so they have to
		// exist. Seeded directly rather than through the project service: `identity`
		// reads these tables to aggregate analytics, and a fixture that called the
		// project service would make this suite depend on another service being up.
		const [project] = await database.db
			.insert(projects)
			.values({
				name: `e2e-analytics-${randomUUID()}`,
				description: "E2E analytics fixture",
				baseDomain: "e2e.example.test",
				ownerId,
			})
			.returning();
		if (project === undefined) throw new Error("failed to seed the analytics project");

		await database.db.insert(services).values(
			["api", "cache"].map((name) => ({
				projectId: project.id,
				name,
				description: "E2E analytics fixture",
				type: "application" as const,
				providerId: "artifact-bundle" as const,
				// `as const`, not a widened `string`: both columns are enums
				// (`compose | kubernetes | manual | …`, `github | gitlab | …`), so a
				// plain literal widens to `string` and the insert stops type-checking
				// against the table.
				builderId: "manual" as const,
				port: 3000,
				healthCheckPath: "/health",
			})),
		);
	});

	it("creates, reads, updates and deletes a user", async () => {
		const email = `e2e-user-${randomUUID()}@example.test`;
		const created = await runUsers(database, admin, (users) => users.create({
			name: "Module E2E User",
			email,
			// `viewer` is a real platform role; "user" is not in the enum, which is why the
			// contract rejects it.
			role: "viewer",
		}));

		const fetched = await runUsers(database, admin, (users) => users.findById(created.id));
		expect(fetched?.email).toBe(email);

		const updated = await runUsers(database, admin, (users) => users.update(created.id,
			{ name: "Module E2E User Updated" },
			{},
		));
		expect(updated.name).toBe("Module E2E User Updated");

		await runUsers(database, admin, (users) => users.delete(created.id));
		// Read back rather than trusting the delete's return value: "it was removed" is the
		// claim being made.
		await expect(runUsers(database, admin, (users) => users.findById(created.id))).resolves.toBeNull();
	});

	it("returns a paginated user collection with a total", async () => {
		const page = await runUsers(database, admin, (users) => users.list({
			limit: 20,
			offset: 0,
			sortField: "createdAt",
			sortDirection: "desc",
			filter: {},
		}));

		expect(Array.isArray(page.data)).toBe(true);
		expect(page.total).toBeGreaterThanOrEqual(0);
	});

	it("returns resource and deployment metric series of the requested length", async () => {
		const resources = await runAnalytics(database, (analytics) => analytics.resourceMetrics({ timeRange: "1d", granularity: "hour" }));
		const deployments = await runAnalytics(database, (analytics) => analytics.deploymentMetrics({ timeRange: "7d", granularity: "day" }));

		// The bucket count IS the contract: a series that does not cover the window would make
		// a chart silently plot less than the range it labels.
		expect(resources.data).toHaveLength(24);
		expect(deployments.data).toHaveLength(7);
	});

	it("returns one realtime sample per requested service", async () => {
		const realtime = await runAnalytics(database, (analytics) => analytics.realtimeMetrics(["api", "cache"]));
		expect(realtime.services).toHaveLength(2);
	});

	it("generates a report and reads it back by id", async () => {
		const report = await runAnalytics(database, (analytics) => analytics.generateReport({
			period: {
				start: new Date(Date.now() - 24 * 60 * 60 * 1000),
				end: new Date(),
			},
			// Every section flag is part of the input schema, so a report request must state
			// which sections it wants. The schema declares defaults, but the SERVICE takes the
			// parsed (output) type, where a defaulted field is present — so they are passed
			// explicitly rather than relying on a default that never reaches the call.
			includeResourceUsage: true,
			includeApplicationMetrics: false,
			includeDatabaseMetrics: false,
			includeDeploymentAnalytics: false,
			includeServiceHealth: false,
			includeUserActivity: false,
			format: "json",
		}));

		expect(report.id).toBeTruthy();

		const status = await runAnalytics(database, (analytics) => analytics.findReport(report.id));
		expect(status.id).toBe(report.id);
	});
});
