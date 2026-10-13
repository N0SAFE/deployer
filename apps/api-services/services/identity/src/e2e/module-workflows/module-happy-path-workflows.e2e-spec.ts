import { services } from "@deployer/nest-schema/global/project/deployment";
import { user } from "@deployer/nest-schema/global/identity/auth";
import { UserService } from "@/modules/user/services/user.service";
import { AnalyticsService } from "@/modules/analytics/services/analytics.service";

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
	let userService: UserService;
	let analyticsService: AnalyticsService;

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

		const database = runtime.serviceMapper.get(GlobalDatabaseService);
		const now = new Date();
		await database.db.insert(user).values({
			id: ownerId,
			name: "E2E Owner",
			email: `${ownerId}@example.test`,
			emailVerified: true,
			createdAt: now,
			updatedAt: now,
			role: "admin",
		});

		userService = runtime.serviceMapper.get(UserService);
		analyticsService = runtime.serviceMapper.get(AnalyticsService);
	});

	it("creates, reads, updates and deletes a user", async () => {
		const email = `e2e-user-${randomUUID()}@example.test`;
		const created = await userService.create(admin, {
			name: "Module E2E User",
			email,
			// `viewer` is a real platform role; "user" is not in the enum, which is why the
			// contract rejects it.
			role: "viewer",
		});

		const fetched = await userService.findById(admin, created.id);
		expect(fetched?.email).toBe(email);

		const updated = await userService.update(
			admin,
			created.id,
			{ name: "Module E2E User Updated" },
			{},
		);
		expect(updated.name).toBe("Module E2E User Updated");

		await userService.delete(admin, created.id);
		// Read back rather than trusting the delete's return value: "it was removed" is the
		// claim being made.
		await expect(userService.findById(admin, created.id)).resolves.toBeNull();
	});

	it("returns a paginated user collection with a total", async () => {
		const page = await userService.list(admin, {
			limit: 20,
			offset: 0,
			sortField: "createdAt",
			sortDirection: "desc",
			filter: {},
		});

		expect(Array.isArray(page.data)).toBe(true);
		expect(page.total).toBeGreaterThanOrEqual(0);
	});

	it("returns resource and deployment metric series of the requested length", async () => {
		const resources = await analyticsService.resourceMetrics({ timeRange: "24h", granularity: "hour" });
		const deployments = await analyticsService.deploymentMetrics({ timeRange: "7d", granularity: "day" });

		// The bucket count IS the contract: a series that does not cover the window would make
		// a chart silently plot less than the range it labels.
		expect(resources.data).toHaveLength(24);
		expect(deployments.data).toHaveLength(7);
	});

	it("returns one realtime sample per requested service", async () => {
		// ── WHY THE FIXTURE SEEDS ITS OWN SERVICES ──────────────────────────────
		// The case asserts "one sample PER REQUESTED SERVICE", so the two rows it asks
		// for must exist. The rows are owned by the PROJECT service — a different
		// process — so the fixture inserts them directly rather than calling that
		// service: a suite that had to boot a second app to obtain a fixture would be
		// testing its availability, not analytics.
		//
		// Without them the query matches nothing and the assertion fails with
		// `expected [] to have a length of 2` — a missing fixture, not a broken rule.
		const database = runtime.serviceMapper.get(GlobalDatabaseService);
		const [project] = await database.db
			.insert(projects)
			.values({
				name: `e2e-analytics-${randomUUID()}`,
				description: "Identity analytics fixture",
				baseDomain: "analytics.e2e.example.test",
				ownerId: admin.userId,
			})
			.returning();
		if (project === undefined) throw new Error("failed to seed a project for the analytics fixture");

		const requested = ["api", "cache"] as const;
		await database.db.insert(services).values(
			requested.map((name) => ({
				projectId: project.id,
				name,
				description: "Identity analytics fixture service",
				type: "application" as const,
				// Real provider/builder ids: the columns are not-null enums, so a
				// placeholder would be rejected by the column type rather than by a rule.
				providerId: "artifact-bundle" as const,
				builderId: "manual" as const,
				port: 3000,
				healthCheckPath: "/health",
			})),
		);

		const realtime = await analyticsService.realtimeMetrics([...requested]);
		expect(realtime.services).toHaveLength(2);
	});

	it("generates a report and reads it back by id", async () => {
		const report = await analyticsService.generateReport({
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
		});

		expect(report.id).toBeTruthy();

		const status = await analyticsService.findReport(report.id);
		expect(status.id).toBe(report.id);
	});
});
