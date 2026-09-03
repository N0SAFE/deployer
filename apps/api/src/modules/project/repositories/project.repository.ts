import { Injectable } from "@nestjs/common";
import { GlobalDatabaseService } from "@/core/modules/database/services/global-database.service";
import {
    deployments,
    projectCollaborators,
    projects,
    services,
} from "@/config/drizzle/global/schema/deployment";
import { environments, variableTemplates, serviceEnvironments } from "@/config/drizzle/global/schema/environment";
import { user } from "@/config/drizzle/global/schema/auth";
import { localEventOutbox } from "@/config/drizzle/global/schema/runtime";
import { and, asc, count, desc, eq, ilike, inArray } from "drizzle-orm";
import { listBuilder } from "@/core/utils/drizzle-filter.utils";
import { randomUUID } from "crypto";
import { ConflictError } from "@repo/errors";
import { environmentRulesSchema, projectNetworkConfigSchema } from "@repo/contracts-entities";
import type { ProjectListInput } from "@repo/api-contracts/modules/project/list";

// ---------------------------------------------------------------------------
// Input types (derived from Drizzle schema)
// ---------------------------------------------------------------------------

type ProjectRow = typeof projects.$inferSelect;
type CollaboratorRow = typeof projectCollaborators.$inferSelect;
type EnvironmentRow = typeof environments.$inferSelect;
type TemplateRow = typeof variableTemplates.$inferSelect;

type ProjectCreateInput = Pick<ProjectRow, "name" | "ownerId"> & {
    description?: string | null;
    baseDomain?: string | null;
    network?: ProjectRow["network"];
    settings?: ProjectRow["settings"];
};

type ProjectUpdateInput = Partial<
    Pick<ProjectRow, "name" | "description" | "baseDomain" | "network" | "settings">
>;

interface CollaboratorCreateInput {
    projectId: string;
    userId: string;
    role: "owner" | "admin" | "developer" | "viewer";
    permissions?: CollaboratorRow["permissions"];
    invitedBy: string;
}

type CollaboratorUpdateInput = Partial<{
    role: "owner" | "admin" | "developer" | "viewer";
    permissions: CollaboratorRow["permissions"];
}>;

interface EnvironmentCreateInput {
    projectId: string;
    name: string;
    /** The primitive KIND: stable | preview | ephemeral. */
    kind: "stable" | "preview" | "ephemeral";
    /** Legacy built-in name (back-compat), e.g. development for custom envs. */
    type?: "production" | "staging" | "preview" | "development";
    /** Per-env rules (profiles, autoDeploy, strategy…). */
    rules?: EnvironmentRow["rules"];
    /** Trigger for preview/ephemeral envs. */
    trigger?: EnvironmentRow["trigger"];
    description?: string | null;
    domainConfig?: EnvironmentRow["domainConfig"];
    deploymentConfig?: EnvironmentRow["deploymentConfig"];
    metadata?: EnvironmentRow["metadata"];
    createdBy: string;
}

type EnvironmentUpdateInput = Partial<{
    name: string;
    kind: "stable" | "preview" | "ephemeral";
    type: "production" | "staging" | "preview" | "development";
    rules: EnvironmentRow["rules"];
    trigger: EnvironmentRow["trigger"];
    description: string | null;
    domainConfig: EnvironmentRow["domainConfig"];
    deploymentConfig: EnvironmentRow["deploymentConfig"];
    metadata: EnvironmentRow["metadata"];
}>;

interface TemplateCreateInput {
    name: string;
    description?: string | null;
    variables?: TemplateRow["variables"];
    createdBy: string;
}

type TemplateUpdateInput = Partial<{
    name: string;
    description: string | null;
    variables: TemplateRow["variables"];
}>;

const DEFAULT_NODE_ID = "00000000-0000-4000-8000-000000000000";

// ---------------------------------------------------------------------------
// Transform helpers — DB Date fields → ISO string
// ---------------------------------------------------------------------------

function transformProject(row: ProjectRow) {
    return {
        ...row,
        // Fill per-project network defaults (DB null → entity requires the
        // full network object).
        network: row.network
            ? projectNetworkConfigSchema.safeParse(row.network).success
                ? row.network
                : projectNetworkConfigSchema.parse({})
            : null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

/**
 * Map legacy DB role names to the canonical project roles (SSOT:
 * `PROJECT_ROLES` from `@repo/auth` → `projectRoleSchema`). The DB enum now
 * stores canonical names; the map preserves any legacy (`admin`, `developer`)
 * rows and guarantees the result is a canonical `ProjectRole`.
 */
type ProjectRole = import("zod/v4").infer<typeof import("@repo/contracts-entities").projectRoleSchema>;
const LEGACY_TO_CANONICAL_ROLE: Partial<Record<CollaboratorRow["role"], ProjectRole>> = {
    admin: "maintainer",
    developer: "deployer",
    owner: "owner",
    maintainer: "maintainer",
    deployer: "deployer",
    viewer: "viewer",
};

function transformCollaborator(row: CollaboratorRow) {
    return {
        ...row,
        role: LEGACY_TO_CANONICAL_ROLE[row.role] ?? (row.role as ProjectRole),
        invitedAt: row.invitedAt.toISOString(),
        acceptedAt: row.acceptedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

function transformEnvironment(row: EnvironmentRow) {
    return {
        ...row,
        projectId: row.projectId,
        // Fill per-env rule defaults (the DB may store null → entity requires
        // the full rules object). `parse` yields a guaranteed EnvironmentRules
        // (defaults filled), so the returned `rules` is never null.
        rules: environmentRulesSchema.parse(row.rules ?? undefined),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

function transformTemplate(row: TemplateRow) {
    return {
        ...row,
        variables: (row.variables ?? []).map((v) => ({
            key: v.key,
            template: v.template,
            description: v.description ?? null,
            category: v.category ?? null,
            required: v.required ?? false,
            defaultValue: v.defaultValue ?? null,
        })),
        lastUsed: row.lastUsed?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

@Injectable()
export class ProjectRepository {
    constructor(private readonly databaseService: GlobalDatabaseService) {}

    // ========================================
    // PROJECT CRUD
    // ========================================

    async findMany(input: ProjectListInput = {} as ProjectListInput) {
        const db = this.databaseService.db;
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
    }

    async findById(id: string) {
        const db = this.databaseService.db;
        const [row] = await db
            .select()
            .from(projects)
            .where(eq(projects.id, id))
            .limit(1);
        return row ? transformProject(row) : null;
    }

    async create(data: ProjectCreateInput) {
        const db = this.databaseService.db;
        const [row] = await db.transaction(async (tx) => {
            const [created] = await tx
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
                .returning();

            if (!created) {
                return [];
            }

            await tx.insert(localEventOutbox).values({
                id: randomUUID(),
                nodeId: this.resolveNodeId(),
                topic: "project.created",
                payload: this.buildDomainEventEnvelope({
                    aggregateType: "project",
                    aggregateId: created.id,
                    eventType: "project.created",
                    payload: {
                        projectId: created.id,
                        ownerId: created.ownerId,
                        name: created.name,
                    },
                }),
                state: "pending",
                retryCount: 0,
                nextRetryAt: new Date(),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            return [created];
        });
        if (!row) throw new ConflictError("Failed to create project");
        return transformProject(row);
    }

    async update(id: string, data: ProjectUpdateInput) {
        const db = this.databaseService.db;
        const updates: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() };
        if (data.name !== undefined) updates.name = data.name;
        if (data.description !== undefined) updates.description = data.description;
        if (data.baseDomain !== undefined) updates.baseDomain = data.baseDomain;
        if (data.network !== undefined) updates.network = data.network;
        if (data.settings !== undefined) updates.settings = data.settings;

        const [row] = await db.transaction(async (tx) => {
            const [updated] = await tx
                .update(projects)
                .set(updates)
                .where(eq(projects.id, id))
                .returning();

            if (!updated) {
                return [];
            }

            await tx.insert(localEventOutbox).values({
                id: randomUUID(),
                nodeId: this.resolveNodeId(),
                topic: "project.updated",
                payload: this.buildDomainEventEnvelope({
                    aggregateType: "project",
                    aggregateId: updated.id,
                    eventType: "project.updated",
                    payload: {
                        projectId: updated.id,
                        ownerId: updated.ownerId,
                    },
                }),
                state: "pending",
                retryCount: 0,
                nextRetryAt: new Date(),
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            return [updated];
        });
        return row ? transformProject(row) : null;
    }

    async delete(id: string) {
        const db = this.databaseService.db;
        await db.transaction(async (tx) => {
            const [existing] = await tx
                .select()
                .from(projects)
                .where(eq(projects.id, id))
                .limit(1);

            await tx.delete(projects).where(eq(projects.id, id));

            if (!existing) {
                return;
            }

            await tx.insert(localEventOutbox).values({
                id: randomUUID(),
                nodeId: this.resolveNodeId(),
                topic: "project.deleted",
                payload: this.buildDomainEventEnvelope({
                    aggregateType: "project",
                    aggregateId: existing.id,
                    eventType: "project.deleted",
                    payload: {
                        projectId: existing.id,
                        ownerId: existing.ownerId,
                    },
                }),
                state: "pending",
                retryCount: 0,
                nextRetryAt: new Date(),
                createdAt: new Date(),
                updatedAt: new Date(),
            });
        });
    }

    private resolveNodeId(): string {
        const configured = process.env.MESH_NODE_ID?.trim();
        return configured && configured.length > 0 ? configured : DEFAULT_NODE_ID;
    }

    private buildDomainEventEnvelope(input: {
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

    // ========================================
    // PROJECT STATISTICS
    // ========================================

    async getProjectStats(id: string) {
        const db = this.databaseService.db;

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
    }

    // ========================================
    // COLLABORATORS
    // ========================================

    async findCollaboratorsByProject(projectId: string) {
        const db = this.databaseService.db;
        const rows = await db
            .select()
            .from(projectCollaborators)
            .where(eq(projectCollaborators.projectId, projectId))
            .orderBy(asc(projectCollaborators.createdAt));
        return rows.map(transformCollaborator);
    }

    async findCollaboratorByUserAndProject(userId: string, projectId: string) {
        const db = this.databaseService.db;
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
    }

    async createCollaborator(data: CollaboratorCreateInput) {
        const db = this.databaseService.db;
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
        if (!row) throw new ConflictError("Failed to create collaborator");
        return transformCollaborator(row);
    }

    async updateCollaborator(collaboratorId: string, data: CollaboratorUpdateInput) {
        const db = this.databaseService.db;
        const updates: Partial<typeof projectCollaborators.$inferInsert> = { updatedAt: new Date() };
        if (data.role !== undefined) updates.role = data.role;
        if (data.permissions !== undefined) updates.permissions = data.permissions;

        const [row] = await db
            .update(projectCollaborators)
            .set(updates)
            .where(eq(projectCollaborators.id, collaboratorId))
            .returning();
        return row ? transformCollaborator(row) : null;
    }

    async deleteCollaboratorByUserAndProject(userId: string, projectId: string) {
        const db = this.databaseService.db;
        await db
            .delete(projectCollaborators)
            .where(
                and(
                    eq(projectCollaborators.projectId, projectId),
                    eq(projectCollaborators.userId, userId),
                ),
            );
    }

    // ========================================
    // ENVIRONMENTS
    // ========================================

    async findEnvironmentsByProject(projectId: string, kind?: string) {
        const db = this.databaseService.db;
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
    }

    async findEnvironmentById(environmentId: string) {
        const db = this.databaseService.db;
        const [row] = await db
            .select()
            .from(environments)
            .where(eq(environments.id, environmentId))
            .limit(1);
        return row ? transformEnvironment(row) : null;
    }

    async createEnvironment(data: EnvironmentCreateInput) {
        const db = this.databaseService.db;
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
        if (!row) throw new ConflictError("Failed to create environment");
        return transformEnvironment(row);
    }

    async updateEnvironment(environmentId: string, data: EnvironmentUpdateInput) {
        const db = this.databaseService.db;
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
    }

    async deleteEnvironment(environmentId: string) {
        const db = this.databaseService.db;
        await db.delete(environments).where(eq(environments.id, environmentId));
    }

    // ========================================
    // SERVICE × ENVIRONMENT LINKS
    // ========================================

    /** Resolve a service's owning project id (for link ownership checks). */
    async findServiceProjectId(serviceId: string): Promise<string | null> {
        const db = this.databaseService.db;
        const [row] = await db
            .select({ projectId: services.projectId })
            .from(services)
            .where(eq(services.id, serviceId))
            .limit(1);
        return row?.projectId ?? null;
    }

    /** List all service↔environment links for a project (with names). */
    async findServiceEnvironmentLinksByProject(projectId: string) {
        const db = this.databaseService.db;
        const rows = await db
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
        return rows;
    }

    /** Upsert a service↔environment link (enable/disable + overrides). */
    async upsertServiceEnvironmentLink(input: {
        serviceId: string;
        environmentId: string;
        isEnabled: boolean;
        overrides?: Record<string, unknown> | null;
    }) {
        const db = this.databaseService.db;
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
        if (!row) throw new ConflictError("Failed to upsert service-environment link");
        return row;
    }

    // ========================================
    // VARIABLE TEMPLATES
    // ========================================

    async findTemplatesByProject(_projectId: string) {
        // Variable templates are not project-scoped in the DB; return all non-system ones
        // TODO: consider adding projectId to variableTemplates if project-scoped templates needed
        const db = this.databaseService.db;
        const rows = await db
            .select()
            .from(variableTemplates)
            .orderBy(desc(variableTemplates.updatedAt));
        return rows.map(transformTemplate);
    }

    async findTemplateById(templateId: string) {
        const db = this.databaseService.db;
        const [row] = await db
            .select()
            .from(variableTemplates)
            .where(eq(variableTemplates.id, templateId))
            .limit(1);
        return row ? transformTemplate(row) : null;
    }

    async createTemplate(data: TemplateCreateInput) {
        const db = this.databaseService.db;
        const [row] = await db
            .insert(variableTemplates)
            .values({
                id: randomUUID(),
                name: data.name,
                description: data.description ?? null,
                variables: (data.variables ?? []) as typeof variableTemplates.$inferInsert["variables"],
                isSystem: false,
                usageCount: 0,
                createdBy: data.createdBy,
                createdAt: new Date(),
                updatedAt: new Date(),
            })
            .returning();
        if (!row) throw new ConflictError("Failed to create variable template");
        return transformTemplate(row);
    }

    async updateTemplate(templateId: string, data: TemplateUpdateInput) {
        const db = this.databaseService.db;
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
    }

    async deleteTemplate(templateId: string) {
        const db = this.databaseService.db;
        await db.delete(variableTemplates).where(eq(variableTemplates.id, templateId));
    }

    // ========================================
    // USER LOOKUP
    // ========================================

    async findUserByEmail(email: string) {
        const db = this.databaseService.db;
        const [row] = await db
            .select()
            .from(user)
            .where(eq(user.email, email))
            .limit(1);
        return row ?? null;
    }
}
