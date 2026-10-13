import { services } from "@deployer/nest-schema/global/project/deployment";
import { user } from "@deployer/nest-schema/global/identity/auth";

/**
 * Fixtures for the deployment workflow suite.
 *
 * ── WHY THIS SEEDS ROWS INSTEAD OF CALLING THE OTHER SERVICES ───────────────
 * A deployment run needs a project and a service to exist, and those rows are owned by the
 * PROJECT service — a different process. The earlier version called
 * `ProjectService.createProject()` in-process, which only worked while the monolith held
 * every domain; it is exactly the reach-across-a-boundary coupling the split removes.
 *
 * So the fixtures INSERT the rows directly. That is correct test setup, not a shortcut: a
 * suite that must bring up two more services to obtain a fixture would be testing THEIR
 * availability. What this suite exercises is deployment behaviour GIVEN a project and a
 * service, and a direct insert states that premise precisely.
 */
export class DeploymentFixtures {
	constructor(private readonly database: GlobalDatabaseService) {}

	/** An owner to hang fixtures off. */
	async owner(): Promise<string> {
		const ownerId = `e2e-owner-${randomUUID()}`;
		const now = new Date();
		await this.database.db.insert(user).values({
			id: ownerId,
			name: "E2E Owner",
			email: `${ownerId}@example.test`,
			emailVerified: true,
			createdAt: now,
			updatedAt: now,
			role: "admin",
		});
		return ownerId;
	}

	/** A project owned by `ownerId`. */
	async project(ownerId: string, overrides: { name?: string; baseDomain?: string } = {}) {
		const [created] = await this.database.db
			.insert(projects)
			.values({
				name: overrides.name ?? `e2e-project-${randomUUID()}`,
				description: "E2E deployment fixture",
				baseDomain: overrides.baseDomain ?? "e2e.example.test",
				ownerId,
			})
			.returning();
		if (created === undefined) throw new Error("failed to seed a project");
		return created;
	}

	/** A service inside `projectId`. */
	async service(
		projectId: string,
		overrides: { name?: string; port?: number; healthCheckPath?: string } = {},
	) {
		const [created] = await this.database.db
			.insert(services)
			.values({
				projectId,
				name: overrides.name ?? `svc-${randomUUID()}`,
				description: "E2E service fixture",
				type: "application",
				// `artifact-bundle` + `manual` because the flow under test deploys an uploaded
				// bundle with the manual runner. A github provider would need a live Git
				// installation, which belongs to a different suite.
				providerId: "artifact-bundle",
				builderId: "manual",
				port: overrides.port ?? 3000,
				healthCheckPath: overrides.healthCheckPath ?? "/health",
			})
			.returning();
		if (created === undefined) throw new Error("failed to seed a service");
		return created;
	}
}

/** The seeded world a deployment spec works against. */
export interface DeploymentCompleteStrategyContext {
	ownerId: string;
	workerId: string;
	fixtures: DeploymentFixtures;
}

export async function createDeploymentCompleteStrategyContext(
	context: SharedApiRuntimeContext,
): Promise<DeploymentCompleteStrategyContext> {
	const database = context.serviceMapper.get(GlobalDatabaseService);
	const fixtures = new DeploymentFixtures(database);

	return {
		ownerId: await fixtures.owner(),
		workerId: `e2e-worker-${randomUUID()}`,
		fixtures,
	};
}
