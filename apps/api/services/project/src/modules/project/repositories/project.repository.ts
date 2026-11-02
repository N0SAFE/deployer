import { randomUUID } from "crypto";

import { and, asc, count, desc, eq, ilike, inArray } from "drizzle-orm";
import { Context, Effect } from "effect";

import { resolveNodeId } from "@deployer/env";
import { user } from "@deployer/nest-schema/global/identity/auth";
import { projectCollaborators, projects, services } from "@deployer/nest-schema/global/project/deployment";
import { environments, variableTemplates, serviceEnvironments } from "@deployer/nest-schema/global/project/environment";
import { deployments } from "@deployer/nest-schema/global/runtime/deployment";
import { localEventOutbox } from "@deployer/nest-schema/global/runtime/runtime";
import type { ProjectListInput } from "@deployer/project-contracts/modules/project/list";
import { listBuilder } from "@deployer/shared/core/utils/drizzle-filter.utils";



import { DatabasePort } from "@project/core/database/database.port";
import { ProjectDb } from "@project/core/database/project-db";

import { ProjectConflict } from "../domain/project.errors";
import { attempt } from "../project-effects";

import {
	transformCollaborator,
	transformEnvironment,
	transformProject,
	transformTemplate,
} from "./project.repository.mappers";

import type {
	CollaboratorCreateInput,
	CollaboratorUpdateInput,
	EnvironmentCreateInput,
	EnvironmentUpdateInput,
	ProjectCreateInput,
	ProjectUpdateInput,
	TemplateCreateInput,
	TemplateUpdateInput,
} from "./project.repository.types";

function buildDomainEventEnvelope(input: {
	aggregateType: string;
	aggregateId: string;
	eventType: string;
	payload: Record<string, unknown>;
}): Record<string, unknown> {
	return {
		eventId: randomUUID(),
		aggregateType: input.aggregateType,
		aggregateId: input.aggregateId,
		eventType: input.eventType,
		version: "1",
		occurredAt: new Date().toISOString(),
		payload: input.payload,
		metadata: {
			source: "project.repository",
		},
	};
}

/** The `project.<event>` outbox row, written in the same transaction as the change it announces. */
function outboxRow(eventType: string, aggregate: { id: string }, payload: Record<string, unknown>) {
	return {
		id: randomUUID(),
		nodeId: resolveNodeId(),
		topic: eventType,
		payload: buildDomainEventEnvelope({
			aggregateType: "project",
			aggregateId: aggregate.id,
			eventType,
			payload,
		}),
		state: "pending" as const,
		retryCount: 0,
		nextRetryAt: new Date(),
		createdAt: new Date(),
		updatedAt: new Date(),
	};
}

/** Drizzle implementation of the projects aggregate. No constructor DI: every method yields `DatabasePort`. */
export class ProjectStoreImpl {
	// ========================================
	// PROJECT CRUD
	// ========================================

	findMany(input: ProjectListInput = {} as ProjectListInput) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				const filter = input.filter ?? {};
				const sort = input.sortBy ?? "createdAt";
				const direction = input.sortDirection ?? "desc";
				const limit = input.limit;
				const offset = input.offset;

				const result = await listBuilder(filter)
					.filter({
						id: ({ operator, value }) => {
							if (operator === "eq") return eq(projects.id, value);
						},
						name: ({ operator, value }) => {
							switch (operator) {
								case "eq": return eq(projects.name, value);
								case "like": return ilike(projects.name, `%${value}%`);
								case "ilike": return ilike(projects.name, `%${value}%`);
							}
						},
						ownerId: ({ operator, value }) => {
							if (operator === "eq") return eq(projects.ownerId, value);
						},
					})
					.order(sort, direction, {
						name: projects.name,
						createdAt: projects.createdAt,
						updatedAt: projects.updatedAt,
					}, projects.createdAt)
					.pagination({ limit, offset })
					.execute(db, projects);

				return {
					data: result.data.map(transformProject),
					meta: result.meta,
				};
			});
		});
	}

	findById(id: string) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				const [row] = await db
					.select()
					.from(projects)
					.where(eq(projects.id, id))
					.limit(1);
				return row ? transformProject(row) : null;
			});
		});
	}

	create(data: ProjectCreateInput) {
		return Effect.gen(function* () {
			const database = yield* ProjectDb;
			// The project and its `project.created` outbox row commit together or not at all.
			const row = yield* database.transaction(
				Effect.gen(function* () {
					const [created] = yield* database.use((tx) =>
						tx
							.insert(projects)
							.values({
								id: randomUUID(),
								name: data.name,
								description: data.description ?? null,
								baseDomain: data.baseDomain ?? null,
								network: data.network ?? null,
								ownerId: data.ownerId,
								settings: data.settings ?? null,
								createdAt: new Date(),
								updatedAt: new Date(),
							})
							.returning(),
					);
					if (!created) return undefined;

					yield* database.use((tx) =>
						tx.insert(localEventOutbox).values(
							outboxRow("project.created", created, {
								projectId: created.id,
								ownerId: created.ownerId,
								name: created.name,
							}),
						),
					);
					return created;
				}),
			);
			if (!row) return yield* Effect.fail(new ProjectConflict({ reason: "Failed to create project" }));
			return transformProject(row);
		});
	}

	update(id: string, data: ProjectUpdateInput) {
		return Effect.gen(function* () {
			const database = yield* ProjectDb;
			const updates: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() };
			if (data.name !== undefined) updates.name = data.name;
			if (data.description !== undefined) updates.description = data.description;
			if (data.baseDomain !== undefined) updates.baseDomain = data.baseDomain;
			if (data.network !== undefined) updates.network = data.network;
			if (data.settings !== undefined) updates.settings = data.settings;

			const row = yield* database.transaction(
				Effect.gen(function* () {
					const [updated] = yield* database.use((tx) =>
						tx.update(projects).set(updates).where(eq(projects.id, id)).returning(),
					);
					if (!updated) return undefined;

					yield* database.use((tx) =>
						tx.insert(localEventOutbox).values(
							outboxRow("project.updated", updated, {
								projectId: updated.id,
								ownerId: updated.ownerId,
							}),
						),
					);
					return updated;
				}),
			);
			return row ? transformProject(row) : null;
		});
	}

	delete(id: string) {
		return Effect.gen(function* () {
			const database = yield* ProjectDb;
			yield* database.transaction(
				Effect.gen(function* () {
					const [existing] = yield* database.use((tx) =>
						tx.select().from(projects).where(eq(projects.id, id)).limit(1),
					);

					yield* database.use((tx) => tx.delete(projects).where(eq(projects.id, id)));

					if (!existing) return;

					yield* database.use((tx) =>
						tx.insert(localEventOutbox).values(
							outboxRow("project.deleted", existing, {
								projectId: existing.id,
								ownerId: existing.ownerId,
							}),
						),
					);
				}),
			);
		});
	}

	// ========================================
	// PROJECT STATISTICS
	// ========================================

	getProjectStats(id: string) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				const [serviceCountRow] = await db
					.select({ count: count() })
					.from(services)
					.where(eq(services.projectId, id));

				const [collaboratorCountRow] = await db
					.select({ count: count() })
					.from(projectCollaborators)
					.where(eq(projectCollaborators.projectId, id));

				// Get deployment count via services
				const projectServiceIds = await db
					.select({ id: services.id })
					.from(services)
					.where(eq(services.projectId, id));

				let deploymentCount = 0;
				type DeploymentStatus = "pending" | "queued" | "building" | "deploying" | "success" | "failed" | "cancelled";
				let latestDeployment: { id: string; status: DeploymentStatus; createdAt: string } | null = null;

				if (projectServiceIds.length > 0) {
					const ids = projectServiceIds.map((s) => s.id);

					const [deploymentCountRow] = await db
						.select({ count: count() })
						.from(deployments)
						.where(inArray(deployments.serviceId, ids));
					deploymentCount = deploymentCountRow?.count ?? 0;

					const [latestRow] = await db
						.select()
						.from(deployments)
						.where(inArray(deployments.serviceId, ids))
						.orderBy(desc(deployments.createdAt))
						.limit(1);

					if (latestRow) {
						latestDeployment = {
							id: latestRow.id,
							status: latestRow.status,
							createdAt: latestRow.createdAt.toISOString(),
						};
					}
				}

				return {
					_count: {
						services: serviceCountRow?.count ?? 0,
						deployments: deploymentCount,
						collaborators: collaboratorCountRow?.count ?? 0,
					},
					latestDeployment,
				};
			});
		});
	}

	// ========================================
	// COLLABORATORS
	// ========================================

	findCollaboratorsByProject(projectId: string) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				const rows = await db
					.select()
					.from(projectCollaborators)
					.where(eq(projectCollaborators.projectId, projectId))
					.orderBy(asc(projectCollaborators.createdAt));
				return rows.map(transformCollaborator);
			});
		});
	}

	findCollaboratorByUserAndProject(userId: string, projectId: string) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				const [row] = await db
					.select()
					.from(projectCollaborators)
					.where(
						and(
							eq(projectCollaborators.projectId, projectId),
							eq(projectCollaborators.userId, userId),
						),
					)
					.limit(1);
				return row ? transformCollaborator(row) : null;
			});
		});
	}

	createCollaborator(data: CollaboratorCreateInput) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			const row = yield* attempt(async () => {
				const [row] = await db
					.insert(projectCollaborators)
					.values({
						id: randomUUID(),
						projectId: data.projectId,
						userId: data.userId,
						role: data.role,
						permissions: data.permissions ?? null,
						invitedBy: data.invitedBy,
						invitedAt: new Date(),
						acceptedAt: null,
						createdAt: new Date(),
						updatedAt: new Date(),
					})
					.returning();
				return row;
			});
			if (!row) return yield* Effect.fail(new ProjectConflict({ reason: "Failed to create collaborator" }));
			return transformCollaborator(row);
		});
	}

	updateCollaborator(collaboratorId: string, data: CollaboratorUpdateInput) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				const updates: Partial<typeof projectCollaborators.$inferInsert> = { updatedAt: new Date() };
				if (data.role !== undefined) updates.role = data.role;
				if (data.permissions !== undefined) updates.permissions = data.permissions;

				const [row] = await db
					.update(projectCollaborators)
					.set(updates)
					.where(eq(projectCollaborators.id, collaboratorId))
					.returning();
				return row ? transformCollaborator(row) : null;
			});
		});
	}

	deleteCollaboratorByUserAndProject(userId: string, projectId: string) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			yield* attempt(async () => {
				await db
					.delete(projectCollaborators)
					.where(
						and(
							eq(projectCollaborators.projectId, projectId),
							eq(projectCollaborators.userId, userId),
						),
					);
			});
		});
	}

	// ========================================
	// ENVIRONMENTS
	// ========================================

	findEnvironmentsByProject(projectId: string, kind?: string) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				const conditions = [eq(environments.projectId, projectId)];
				if (kind) {
					conditions.push(
						eq(environments.kind, kind as "stable" | "preview" | "ephemeral"),
					);
				}
				const rows = await db
					.select()
					.from(environments)
					.where(and(...conditions))
					.orderBy(desc(environments.createdAt));
				return rows.map(transformEnvironment);
			});
		});
	}

	findEnvironmentById(environmentId: string) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				const [row] = await db
					.select()
					.from(environments)
					.where(eq(environments.id, environmentId))
					.limit(1);
				return row ? transformEnvironment(row) : null;
			});
		});
	}

	countEnabledServicesForEnvironment(environmentId: string) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				const [row] = await db
					.select({ count: count() })
					.from(serviceEnvironments)
					.where(
						and(
							eq(serviceEnvironments.environmentId, environmentId),
							eq(serviceEnvironments.isEnabled, true),
						),
					);
				return row?.count ?? 0;
			});
		});
	}

	createEnvironment(data: EnvironmentCreateInput) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			const row = yield* attempt(async () => {
				const slug = data.name.toLowerCase().replace(/[^a-z0-9]/g, "-");
				const [row] = await db
					.insert(environments)
					.values({
						id: randomUUID(),
						projectId: data.projectId,
						name: data.name,
						slug,
						description: data.description ?? null,
						kind: data.kind,
						type: data.type ?? "development",
						rules: data.rules ?? null,
						trigger: data.trigger ?? null,
						status: "pending",
						isActive: true,
						domainConfig: data.domainConfig ?? null,
						deploymentConfig: data.deploymentConfig ?? null,
						metadata: data.metadata ?? null,
						createdBy: data.createdBy,
						createdAt: new Date(),
						updatedAt: new Date(),
					})
					.returning();
				return row;
			});
			if (!row) return yield* Effect.fail(new ProjectConflict({ reason: "Failed to create environment" }));
			return transformEnvironment(row);
		});
	}

	updateEnvironment(environmentId: string, data: EnvironmentUpdateInput) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				const updates: Partial<typeof environments.$inferInsert> = { updatedAt: new Date() };
				if (data.name !== undefined) {
					updates.name = data.name;
					updates.slug = data.name.toLowerCase().replace(/[^a-z0-9]/g, "-");
				}
				if (data.kind !== undefined) updates.kind = data.kind;
				if (data.rules !== undefined) updates.rules = data.rules;
				if (data.trigger !== undefined) updates.trigger = data.trigger;
				if (data.type !== undefined) updates.type = data.type;
				if (data.description !== undefined) updates.description = data.description;
				if (data.domainConfig !== undefined) updates.domainConfig = data.domainConfig;
				if (data.deploymentConfig !== undefined) updates.deploymentConfig = data.deploymentConfig;
				if (data.metadata !== undefined) updates.metadata = data.metadata;

				const [row] = await db
					.update(environments)
					.set(updates)
					.where(eq(environments.id, environmentId))
					.returning();
				return row ? transformEnvironment(row) : null;
			});
		});
	}

	deleteEnvironment(environmentId: string) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			yield* attempt(async () => {
				await db.delete(environments).where(eq(environments.id, environmentId));
			});
		});
	}

	// ========================================
	// SERVICE × ENVIRONMENT LINKS
	// ========================================

	/** Resolve a service's owning project id (for link ownership checks). */
	findServiceProjectId(serviceId: string) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				const [row] = await db
					.select({ projectId: services.projectId })
					.from(services)
					.where(eq(services.id, serviceId))
					.limit(1);
				return row?.projectId ?? null;
			});
		});
	}

	/** List all service↔environment links for a project (with names). */
	findServiceEnvironmentLinksByProject(projectId: string) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				return db
					.select({
						id: serviceEnvironments.id,
						serviceId: serviceEnvironments.serviceId,
						environmentId: serviceEnvironments.environmentId,
						isEnabled: serviceEnvironments.isEnabled,
						overrides: serviceEnvironments.overrides,
						serviceName: services.name,
						environmentName: environments.name,
						environmentKind: environments.kind,
					})
					.from(serviceEnvironments)
					.innerJoin(services, eq(services.id, serviceEnvironments.serviceId))
					.innerJoin(environments, eq(environments.id, serviceEnvironments.environmentId))
					.where(eq(services.projectId, projectId))
					.orderBy(asc(environments.name), asc(services.name));
			});
		});
	}

	/** Upsert a service↔environment link (enable/disable + overrides). */
	upsertServiceEnvironmentLink(input: {
		serviceId: string;
		environmentId: string;
		isEnabled: boolean;
		overrides?: Record<string, unknown> | null;
	}) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			const row = yield* attempt(async () => {
				const [row] = await db
					.insert(serviceEnvironments)
					.values({
						id: randomUUID(),
						serviceId: input.serviceId,
						environmentId: input.environmentId,
						isEnabled: input.isEnabled,
						overrides: (input.overrides ?? null) as typeof serviceEnvironments.$inferInsert["overrides"],
						createdAt: new Date(),
						updatedAt: new Date(),
					})
					.onConflictDoUpdate({
						target: [serviceEnvironments.serviceId, serviceEnvironments.environmentId],
						set: {
							isEnabled: input.isEnabled,
							overrides: (input.overrides ?? null),
							updatedAt: new Date(),
						},
					})
					.returning();
				return row;
			});
			if (!row) return yield* Effect.fail(new ProjectConflict({ reason: "Failed to upsert service-environment link" }));
			return row;
		});
	}

	// ========================================
	// VARIABLE TEMPLATES
	// ========================================

	findTemplatesByProject(_projectId: string) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				// Variable templates are not project-scoped in the DB; return all non-system ones
				// TODO: consider adding projectId to variableTemplates if project-scoped templates needed
				const rows = await db
					.select()
					.from(variableTemplates)
					.orderBy(desc(variableTemplates.updatedAt));
				return rows.map(transformTemplate);
			});
		});
	}

	findTemplateById(templateId: string) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				const [row] = await db
					.select()
					.from(variableTemplates)
					.where(eq(variableTemplates.id, templateId))
					.limit(1);
				return row ? transformTemplate(row) : null;
			});
		});
	}

	createTemplate(data: TemplateCreateInput) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			const row = yield* attempt(async () => {
				const [row] = await db
					.insert(variableTemplates)
					.values({
						id: randomUUID(),
						name: data.name,
						description: data.description ?? null,
						variables: (data.variables ?? []),
						isSystem: false,
						usageCount: 0,
						createdBy: data.createdBy,
						createdAt: new Date(),
						updatedAt: new Date(),
					})
					.returning();
				return row;
			});
			if (!row) return yield* Effect.fail(new ProjectConflict({ reason: "Failed to create variable template" }));
			return transformTemplate(row);
		});
	}

	updateTemplate(templateId: string, data: TemplateUpdateInput) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				const updates: Partial<typeof variableTemplates.$inferInsert> = { updatedAt: new Date() };
				if (data.name !== undefined) updates.name = data.name;
				if (data.description !== undefined) updates.description = data.description;
				if (data.variables !== undefined)
					updates.variables = data.variables;

				const [row] = await db
					.update(variableTemplates)
					.set(updates)
					.where(eq(variableTemplates.id, templateId))
					.returning();
				return row ? transformTemplate(row) : null;
			});
		});
	}

	deleteTemplate(templateId: string) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			yield* attempt(async () => {
				await db.delete(variableTemplates).where(eq(variableTemplates.id, templateId));
			});
		});
	}

	// ========================================
	// USER LOOKUP
	// ========================================

	findUserByEmail(email: string) {
		return Effect.gen(function* () {
			const { db } = yield* DatabasePort;
			return yield* attempt(async () => {
				const [row] = await db
					.select()
					.from(user)
					.where(eq(user.email, email))
					.limit(1);
				return row ?? null;
			});
		});
	}
}

/** The store's public surface is exactly the implementation's methods. */
export type ProjectStoreShape = ProjectStoreImpl;

/** Effect key = NestJS token. */
export class ProjectStore extends Context.Service<ProjectStore, ProjectStoreShape>()(
	"project/ProjectStore",
) {
	/** Resolves the requirements the methods name when the layer is built. */
	static readonly live: ProjectStoreShape = new ProjectStoreImpl();
}
