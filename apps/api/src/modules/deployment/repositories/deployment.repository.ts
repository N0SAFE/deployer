import { Injectable } from "@nestjs/common";
import { GlobalDatabaseService } from "@/core/modules/database/services/global-database.service";
import {
    deployments,
    deploymentLogs,
    deploymentRollbacks,
    deploymentStreams,
    projects,
    serviceDependencies,
    services,
} from "@/config/drizzle/global/schema/deployment";
import { localEventOutbox } from "@/config/drizzle/global/schema/runtime";
import { and, asc, count, desc, eq, type SQL } from "drizzle-orm";
import { listBuilder } from "@/core/utils/drizzle-filter.utils";
import { randomUUID } from "crypto";
import type { DeploymentListInput } from "@repo/api-contracts/modules/deployment/list";
import type { DeploymentTriggerInput } from "@repo/api-contracts/modules/deployment/crud";
import type {
    DeploymentStreamListInput,
} from "@repo/api-contracts/modules/deployment/stream";
import { deploymentStreamSchema, type DeploymentStream } from "@repo/contracts-entities";

const DEFAULT_NODE_ID = "00000000-0000-4000-8000-000000000000";

// ─── Local types ─────────────────────────────────────────────────────────────

type DeploymentRow = typeof deployments.$inferSelect;
type DeploymentLogRow = typeof deploymentLogs.$inferSelect;
type DeploymentRollbackRow = typeof deploymentRollbacks.$inferSelect;
type DeploymentStreamRow = typeof deploymentStreams.$inferSelect;

type DeploymentStatus = DeploymentRow["status"];
type DeploymentPhase = DeploymentRow["phase"];

interface DeploymentCreateInput {
    serviceId: string;
    triggeredBy: string | null;
    environment: DeploymentRow["environment"];
    sourceType: DeploymentRow["sourceType"];
    sourceConfig?: DeploymentTriggerInput["sourceConfig"];
    metadata?: DeploymentRow["metadata"];
}

interface StreamFilters {
    deploymentId?: string;
    serviceId?: string;
    projectId?: string;
    status?: DeploymentStatus;
    environment?: DeploymentRow["environment"];
}

interface DeploymentLogFilters {
    level?: DeploymentLogRow["level"];
    phase?: string;
    step?: string;
}

interface CreateRollbackInput {
    fromDeploymentId: string;
    toDeploymentId: string;
    triggeredBy: string | null;
    reason?: string | null;
    metadata?: DeploymentRollbackRow["metadata"];
}

interface UpdateRollbackStatusInput {
    startedAt?: Date | null;
    completedAt?: Date | null;
    failedAt?: Date | null;
    errorMessage?: string | null;
    metadata?: DeploymentRollbackRow["metadata"];
}

// ─── Transform helpers ────────────────────────────────────────────────────────

function toDto(row: DeploymentRow) {
    return {
        ...row,
        observability: null,
        progress: null,
        connectivityStatus: null,
        buildStartedAt: row.buildStartedAt?.toISOString() ?? null,
        buildCompletedAt: row.buildCompletedAt?.toISOString() ?? null,
        deployStartedAt: row.deployStartedAt?.toISOString() ?? null,
        deployCompletedAt: row.deployCompletedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

function toLogDto(row: DeploymentLogRow) {
    const metadataRecord =
        row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
            ? (row.metadata as Record<string, unknown>)
            : null;

    const correlationId =
        metadataRecord && typeof metadataRecord.correlationId === "string"
            ? metadataRecord.correlationId
            : null;
    const traceId = metadataRecord && typeof metadataRecord.traceId === "string" ? metadataRecord.traceId : null;
    const spanId = metadataRecord && typeof metadataRecord.spanId === "string" ? metadataRecord.spanId : null;

    return {
        ...row,
        correlationId,
        traceId,
        spanId,
        timestamp: row.timestamp.toISOString(),
    };
}

function toRollbackDto(row: DeploymentRollbackRow) {
    return {
        ...row,
        startedAt: row.startedAt?.toISOString() ?? null,
        completedAt: row.completedAt?.toISOString() ?? null,
        failedAt: row.failedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

function toStreamDto(row: DeploymentStreamRow) {
    return deploymentStreamSchema.parse({
        ...row,
        coreStreamId: row.coreStreamId,
        description: row.description ?? null,
        deploymentId: row.deploymentId ?? null,
        serviceId: row.serviceId ?? null,
        projectId: row.projectId ?? null,
        statusFilter: row.statusFilter ?? null,
        environmentFilter: row.environmentFilter ?? null,
        eventTypes: row.eventTypes ?? null,
        createdBy: row.createdBy ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    });
}

// ─── Repository ───────────────────────────────────────────────────────────────

@Injectable()
export class DeploymentRepository {
    constructor(private readonly databaseService: GlobalDatabaseService) {}

    async findMany(input: DeploymentListInput) {
        const db = this.databaseService.db;
        const filter = input.filter ?? {};
        const sort = input.sortBy ?? "createdAt";
        const direction = input.sortDirection ?? "desc";

        const conditions: SQL[] = [];

        if (filter.serviceId?.operator === "eq" && typeof filter.serviceId.value === "string") {
            conditions.push(eq(deployments.serviceId, filter.serviceId.value));
        }

        if (filter.status?.operator === "eq" && typeof filter.status.value === "string") {
            conditions.push(eq(deployments.status, filter.status.value));
        }

        if (filter.environment?.operator === "eq" && typeof filter.environment.value === "string") {
            conditions.push(eq(deployments.environment, filter.environment.value));
        }

        if (filter.sourceType?.operator === "eq" && typeof filter.sourceType.value === "string") {
            conditions.push(eq(deployments.sourceType, filter.sourceType.value));
        }

        if (filter.projectId?.operator === "eq" && typeof filter.projectId.value === "string") {
            conditions.push(eq(services.projectId, filter.projectId.value));
        }

        const whereClause =
            conditions.length === 0
                ? undefined
                : conditions.length === 1
                  ? conditions[0]
                  : and(...conditions);

        const sortColumn =
            sort === "updatedAt"
                ? deployments.updatedAt
                : sort === "status"
                  ? deployments.status
                  : deployments.createdAt;
        const orderClause = direction === "asc" ? asc(sortColumn) : desc(sortColumn);

        const dataQuery = db
            .select({ deployment: deployments })
            .from(deployments)
            .leftJoin(services, eq(services.id, deployments.serviceId));

        const countQuery = db
            .select({ count: count() })
            .from(deployments)
            .leftJoin(services, eq(services.id, deployments.serviceId));

        const [rows, totalResult] = await Promise.all([
            (whereClause ? dataQuery.where(whereClause) : dataQuery)
                .orderBy(orderClause)
                .limit(input.limit)
                .offset(input.offset),
            whereClause ? countQuery.where(whereClause) : countQuery,
        ]);

        const total = totalResult[0]?.count ?? 0;

        return {
            data: rows.map((row) => toDto(row.deployment)),
            meta: {
                total,
                limit: input.limit,
                offset: input.offset,
                hasMore: input.offset + input.limit < total,
            },
        };
    }

    async findById(id: string) {
        const db = this.databaseService.db;
        const [row] = await db
            .select()
            .from(deployments)
            .where(eq(deployments.id, id))
            .limit(1);
        return row ? toDto(row) : null;
    }

    async getServiceProjectId(serviceId: string): Promise<string | null> {
        const db = this.databaseService.db;
        const [row] = await db
            .select({ projectId: services.projectId })
            .from(services)
            .where(eq(services.id, serviceId))
            .limit(1);
        return row?.projectId ?? null;
    }

    async getRuntimeConfigurationSeed(serviceId: string): Promise<{
        projectId: string;
        projectSettings: Record<string, unknown> | null;
        service: {
            providerId: string | null;
            builderId: string | null;
            customDomains: string[] | null;
            environmentVariables: Record<string, string> | null;
            resourceLimits: {
                memory?: string | null;
                cpu?: string | null;
            } | null;
            metadata?: Record<string, unknown> | null;
        };
    } | null> {
        const db = this.databaseService.db;
        const [row] = await db
            .select({
                projectId: services.projectId,
                projectSettings: projects.settings,
                providerId: services.providerId,
                builderId: services.builderId,
                customDomains: services.customDomains,
                environmentVariables: services.environmentVariables,
                resourceLimits: services.resourceLimits,
                metadata: services.metadata,
            })
            .from(services)
            .innerJoin(projects, eq(projects.id, services.projectId))
            .where(eq(services.id, serviceId))
            .limit(1);

        if (!row) {
            return null;
        }

        return {
            projectId: row.projectId,
            projectSettings: (row.projectSettings) ?? null,
            service: {
                providerId: row.providerId,
                builderId: row.builderId,
                customDomains: (row.customDomains) ?? null,
                environmentVariables:
                    (row.environmentVariables) ?? null,
                resourceLimits:
                    (row.resourceLimits) ??
                    null,
                metadata:
                    (row.metadata) ?? null,
            },
        };
    }

    async getServiceDependencies(serviceId: string): Promise<
        {
            dependsOnServiceId: string;
            isRequired: boolean;
            dependsOnProjectId: string;
        }[]
    > {
        const db = this.databaseService.db;
        const rows = await db
            .select({
                dependsOnServiceId: serviceDependencies.dependsOnServiceId,
                isRequired: serviceDependencies.isRequired,
                dependsOnProjectId: services.projectId,
            })
            .from(serviceDependencies)
            .innerJoin(services, eq(services.id, serviceDependencies.dependsOnServiceId))
            .where(eq(serviceDependencies.serviceId, serviceId));

        return rows;
    }

    async create(data: DeploymentCreateInput) {
        const db = this.databaseService.db;
        const [row] = await db.transaction(async (tx) => {
            const [created] = await tx
                .insert(deployments)
                .values({
                    id: randomUUID(),
                    serviceId: data.serviceId,
                    triggeredBy: data.triggeredBy,
                    status: "queued",
                    environment: data.environment,
                    sourceType: data.sourceType,
                    sourceConfig: data.sourceConfig ?? null,
                    metadata: data.metadata ?? null,
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
                topic: "deployment.created",
                payload: this.buildDomainEventEnvelope({
                    aggregateType: "deployment",
                    aggregateId: created.id,
                    eventType: "deployment.created",
                    payload: {
                        deploymentId: created.id,
                        serviceId: created.serviceId,
                        status: created.status,
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
        if (!row) throw new Error("Failed to create deployment");
        return toDto(row);
    }

    async updateStatus(id: string, status: DeploymentStatus, metadata?: DeploymentRow["metadata"]) {
        const db = this.databaseService.db;
        const updates: Partial<typeof deployments.$inferInsert> = {
            status,
            updatedAt: new Date(),
        };
        if (metadata !== undefined) {
            updates.metadata = metadata;
        }
        const [row] = await db.transaction(async (tx) => {
            const [updated] = await tx
                .update(deployments)
                .set(updates)
                .where(eq(deployments.id, id))
                .returning();

            if (!updated) {
                return [];
            }

            await tx.insert(localEventOutbox).values({
                id: randomUUID(),
                nodeId: this.resolveNodeId(),
                topic: "deployment.status.updated",
                payload: this.buildDomainEventEnvelope({
                    aggregateType: "deployment",
                    aggregateId: updated.id,
                    eventType: "deployment.status.updated",
                    payload: {
                        deploymentId: updated.id,
                        serviceId: updated.serviceId,
                        status: updated.status,
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
        return row ? toDto(row) : null;
    }

    async updatePhase(
        id: string,
        phase: DeploymentPhase,
        progress: number,
        metadata?: DeploymentRow["phaseMetadata"],
    ) {
        const db = this.databaseService.db;
        const updates: Partial<typeof deployments.$inferInsert> = {
            phase,
            phaseProgress: progress,
            phaseUpdatedAt: new Date(),
            updatedAt: new Date(),
        };
        if (metadata !== undefined) {
            updates.phaseMetadata = metadata;
        }
        const [row] = await db
            .update(deployments)
            .set(updates)
            .where(eq(deployments.id, id))
            .returning();
        return row ? toDto(row) : null;
    }

    async persistBuildArtifacts(
        id: string,
        data: {
            buildStartedAt?: Date;
            buildCompletedAt?: Date;
            deployStartedAt?: Date;
            deployCompletedAt?: Date;
            containerImage?: string | null;
            containerName?: string | null;
            domainUrl?: string | null;
            healthCheckUrl?: string | null;
            status?: DeploymentStatus;
            phase?: DeploymentPhase;
            phaseProgress?: number;
            metadata?: DeploymentRow["metadata"];
        },
    ) {
        const db = this.databaseService.db;
        const updates: Partial<typeof deployments.$inferInsert> = {
            updatedAt: new Date(),
        };

        if (data.buildStartedAt !== undefined) {
            updates.buildStartedAt = data.buildStartedAt;
        }
        if (data.buildCompletedAt !== undefined) {
            updates.buildCompletedAt = data.buildCompletedAt;
        }
        if (data.deployStartedAt !== undefined) {
            updates.deployStartedAt = data.deployStartedAt;
        }
        if (data.deployCompletedAt !== undefined) {
            updates.deployCompletedAt = data.deployCompletedAt;
        }
        if (data.containerImage !== undefined) {
            updates.containerImage = data.containerImage;
        }
        if (data.containerName !== undefined) {
            updates.containerName = data.containerName;
        }
        if (data.domainUrl !== undefined) {
            updates.domainUrl = data.domainUrl;
        }
        if (data.healthCheckUrl !== undefined) {
            updates.healthCheckUrl = data.healthCheckUrl;
        }
        if (data.status !== undefined) {
            updates.status = data.status;
        }
        if (data.phase !== undefined) {
            updates.phase = data.phase;
            updates.phaseUpdatedAt = new Date();
        }
        if (data.phaseProgress !== undefined) {
            updates.phaseProgress = data.phaseProgress;
        }
        if (data.metadata !== undefined) {
            updates.metadata = data.metadata;
        }

        const [row] = await db
            .update(deployments)
            .set(updates)
            .where(eq(deployments.id, id))
            .returning();

        return row ? toDto(row) : null;
    }

    async delete(id: string) {
        const db = this.databaseService.db;
        await db.transaction(async (tx) => {
            const [existing] = await tx
                .select()
                .from(deployments)
                .where(eq(deployments.id, id))
                .limit(1);

            await tx.delete(deployments).where(eq(deployments.id, id));

            if (!existing) {
                return;
            }

            await tx.insert(localEventOutbox).values({
                id: randomUUID(),
                nodeId: this.resolveNodeId(),
                topic: "deployment.deleted",
                payload: this.buildDomainEventEnvelope({
                    aggregateType: "deployment",
                    aggregateId: existing.id,
                    eventType: "deployment.deleted",
                    payload: {
                        deploymentId: existing.id,
                        serviceId: existing.serviceId,
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
                source: "deployment.repository",
            },
        };
    }

    async findLogs(
        deploymentId: string,
        limit: number,
        offset: number,
        filters?: DeploymentLogFilters,
    ) {
        const db = this.databaseService.db;
        const conditions: SQL[] = [eq(deploymentLogs.deploymentId, deploymentId)];

        if (filters?.level) {
            conditions.push(eq(deploymentLogs.level, filters.level));
        }
        if (filters?.phase) {
            conditions.push(eq(deploymentLogs.phase, filters.phase));
        }
        if (filters?.step) {
            conditions.push(eq(deploymentLogs.step, filters.step));
        }

        const whereClause =
            conditions.length === 1
                ? conditions[0]
                : and(...conditions);

        const rows = await db
            .select()
            .from(deploymentLogs)
            .where(whereClause)
            .limit(limit)
            .offset(offset)
            .orderBy(deploymentLogs.timestamp);
        return rows.map(toLogDto);
    }

    async countLogs(deploymentId: string, filters?: DeploymentLogFilters) {
        const db = this.databaseService.db;
        const conditions: SQL[] = [eq(deploymentLogs.deploymentId, deploymentId)];

        if (filters?.level) {
            conditions.push(eq(deploymentLogs.level, filters.level));
        }
        if (filters?.phase) {
            conditions.push(eq(deploymentLogs.phase, filters.phase));
        }
        if (filters?.step) {
            conditions.push(eq(deploymentLogs.step, filters.step));
        }

        const whereClause =
            conditions.length === 1
                ? conditions[0]
                : and(...conditions);

        const [row] = await db
            .select({ count: count() })
            .from(deploymentLogs)
            .where(whereClause);
        return row?.count ?? 0;
    }

    async insertLog(
        deploymentId: string,
        data: {
            level?: DeploymentLogRow["level"];
            message: string;
            phase?: string | null;
            step?: string | null;
            service?: string | null;
            stage?: string | null;
            correlationId?: string | null;
            traceId?: string | null;
            spanId?: string | null;
            metadata?: Record<string, unknown> | null;
        },
    ) {
        const db = this.databaseService.db;
        const baseMetadata =
            data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
                ? { ...data.metadata }
                : {};

        const metadata = {
            ...baseMetadata,
            ...(data.correlationId ? { correlationId: data.correlationId } : {}),
            ...(data.traceId ? { traceId: data.traceId } : {}),
            ...(data.spanId ? { spanId: data.spanId } : {}),
        };

        const now = new Date();

        const [row] = await db.transaction(async (tx) => {
            const [created] = await tx
                .insert(deploymentLogs)
                .values({
                    id: randomUUID(),
                    deploymentId,
                    level: data.level ?? "info",
                    message: data.message,
                    phase: data.phase ?? null,
                    step: data.step ?? null,
                    service: data.service ?? null,
                    stage: data.stage ?? null,
                    metadata:
                        Object.keys(metadata).length > 0
                            ? (metadata as unknown as DeploymentLogRow["metadata"])
                            : null,
                    timestamp: now,
                })
                .returning();

            if (!created) {
                return [];
            }

            const lifecycleEventType = this.buildLifecycleEventType({
                stage: created.stage,
                step: created.step,
                level: created.level,
            });

            await tx.insert(localEventOutbox).values({
                id: randomUUID(),
                nodeId: this.resolveNodeId(),
                topic: "deployment.lifecycle",
                payload: this.buildDomainEventEnvelope({
                    aggregateType: "deployment",
                    aggregateId: deploymentId,
                    eventType: lifecycleEventType,
                    payload: {
                        deploymentId,
                        logId: created.id,
                        level: created.level,
                        message: created.message,
                        phase: created.phase,
                        step: created.step,
                        stage: created.stage,
                        timestamp: created.timestamp.toISOString(),
                        metadata: created.metadata ?? null,
                    },
                }),
                state: "pending",
                retryCount: 0,
                nextRetryAt: now,
                createdAt: now,
                updatedAt: now,
            });

            return [created];
        });
        if (!row) throw new Error("Failed to insert deployment log");
        return toLogDto(row);
    }

    private buildLifecycleEventType(input: {
        stage: string | null;
        step: string | null;
        level: string;
    }): string {
        const sanitize = (value: string | null | undefined): string | null => {
            if (!value) {
                return null;
            }
            const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
            return normalized.length > 0 ? normalized : null;
        };

        const stage = sanitize(input.stage) ?? "general";
        const step = sanitize(input.step) ?? sanitize(input.level) ?? "event";
        return `deployment.lifecycle.${stage}.${step}`;
    }

    async findRollbacks(fromDeploymentId: string) {
        const db = this.databaseService.db;
        const rows = await db
            .select()
            .from(deploymentRollbacks)
            .where(eq(deploymentRollbacks.fromDeploymentId, fromDeploymentId))
            .orderBy(deploymentRollbacks.createdAt);
        return rows.map(toRollbackDto);
    }

    async createRollback(input: CreateRollbackInput) {
        const db = this.databaseService.db;
        const [row] = await db
            .insert(deploymentRollbacks)
            .values({
                id: randomUUID(),
                fromDeploymentId: input.fromDeploymentId,
                toDeploymentId: input.toDeploymentId,
                triggeredBy: input.triggeredBy,
                status: "pending",
                reason: input.reason ?? null,
                metadata: input.metadata ?? null,
                createdAt: new Date(),
                updatedAt: new Date(),
            })
            .returning();

        if (!row) {
            throw new Error("Failed to create deployment rollback");
        }

        return toRollbackDto(row);
    }

    async updateRollbackStatus(
        rollbackId: string,
        status: DeploymentRollbackRow["status"],
        input?: UpdateRollbackStatusInput,
    ) {
        const db = this.databaseService.db;
        const updates: Partial<typeof deploymentRollbacks.$inferInsert> = {
            status,
            updatedAt: new Date(),
        };

        if (input?.startedAt !== undefined) {
            updates.startedAt = input.startedAt;
        }
        if (input?.completedAt !== undefined) {
            updates.completedAt = input.completedAt;
        }
        if (input?.failedAt !== undefined) {
            updates.failedAt = input.failedAt;
        }
        if (input?.errorMessage !== undefined) {
            updates.errorMessage = input.errorMessage;
        }
        if (input?.metadata !== undefined) {
            updates.metadata = input.metadata;
        }

        const [row] = await db
            .update(deploymentRollbacks)
            .set(updates)
            .where(eq(deploymentRollbacks.id, rollbackId))
            .returning();

        return row ? toRollbackDto(row) : null;
    }

    async findServiceIdsByProject(projectId: string) {
        const db = this.databaseService.db;
        const rows = await db
            .select({ id: services.id })
            .from(services)
            .where(eq(services.projectId, projectId));
        return rows.map((row) => row.id);
    }

    async findRecentDeployments(filters: StreamFilters, limit: number) {
        const db = this.databaseService.db;
        const conditions: SQL[] = [];

        if (filters.deploymentId) {
            conditions.push(eq(deployments.id, filters.deploymentId));
        }
        if (filters.serviceId) {
            conditions.push(eq(deployments.serviceId, filters.serviceId));
        }
        if (filters.status) {
            conditions.push(eq(deployments.status, filters.status));
        }
        if (filters.environment) {
            conditions.push(eq(deployments.environment, filters.environment));
        }
        if (filters.projectId) {
            conditions.push(eq(services.projectId, filters.projectId));
        }

        const baseQuery = db
            .select({
                deployment: deployments,
                projectId: services.projectId,
            })
            .from(deployments)
            .leftJoin(services, eq(services.id, deployments.serviceId));

        const whereClause =
            conditions.length === 0
                ? undefined
                : conditions.length === 1
                  ? conditions[0]
                  : and(...conditions);

        const rows = await (whereClause ? baseQuery.where(whereClause) : baseQuery)
            .orderBy(desc(deployments.createdAt))
            .limit(limit);

        return rows.map((row) => ({
            deployment: toDto(row.deployment),
            projectId: row.projectId ?? null,
        }));
    }

    async findRecentLogs(filters: StreamFilters, limit: number) {
        const db = this.databaseService.db;
        const conditions: SQL[] = [];

        if (filters.deploymentId) {
            conditions.push(eq(deploymentLogs.deploymentId, filters.deploymentId));
        }
        if (filters.serviceId) {
            conditions.push(eq(deployments.serviceId, filters.serviceId));
        }
        if (filters.projectId) {
            conditions.push(eq(services.projectId, filters.projectId));
        }
        if (filters.status) {
            conditions.push(eq(deployments.status, filters.status));
        }
        if (filters.environment) {
            conditions.push(eq(deployments.environment, filters.environment));
        }

        const baseQuery = db
            .select({
                log: deploymentLogs,
                deploymentId: deployments.id,
                serviceId: deployments.serviceId,
                projectId: services.projectId,
            })
            .from(deploymentLogs)
            .innerJoin(deployments, eq(deployments.id, deploymentLogs.deploymentId))
            .leftJoin(services, eq(services.id, deployments.serviceId));

        const whereClause =
            conditions.length === 0
                ? undefined
                : conditions.length === 1
                  ? conditions[0]
                  : and(...conditions);

        const rows = await (whereClause ? baseQuery.where(whereClause) : baseQuery)
            .orderBy(desc(deploymentLogs.timestamp))
            .limit(limit);

        return rows.map((row) => ({
            log: toLogDto(row.log),
            deploymentId: row.deploymentId,
            serviceId: row.serviceId,
            projectId: row.projectId ?? null,
        }));
    }

    async findStreamMany(input: DeploymentStreamListInput): Promise<{
        data: DeploymentStream[];
        meta: {
            total: number;
            limit: number;
            offset: number;
            hasMore: boolean;
        };
    }> {
        const db = this.databaseService.db;
        const filter = input.filter ?? {};
        const sort = input.sortBy ?? "createdAt";
        const direction = input.sortDirection ?? "desc";

        const result = await listBuilder(filter)
            .filter({
                name: (entry) => {
                    switch (entry.operator) {
                        case "eq":
                            return entry.common.eq(deploymentStreams.name);
                        case "like":
                            return entry.common.like(deploymentStreams.name);
                        case "ilike":
                            return entry.common.ilike(deploymentStreams.name);
                    }
                },
                isActive: (entry) => entry.common.eq(deploymentStreams.isActive),
                deploymentId: (entry) => entry.common.eq(deploymentStreams.deploymentId),
                serviceId: (entry) => entry.common.eq(deploymentStreams.serviceId),
                projectId: (entry) => entry.common.eq(deploymentStreams.projectId),
                statusFilter: (entry) => entry.common.eq(deploymentStreams.statusFilter),
                environmentFilter: (entry) => entry.common.eq(deploymentStreams.environmentFilter),
                createdBy: (entry) => entry.common.eq(deploymentStreams.createdBy),
            })
            .order(
                sort,
                direction,
                {
                    createdAt: deploymentStreams.createdAt,
                    updatedAt: deploymentStreams.updatedAt,
                    name: deploymentStreams.name,
                },
                deploymentStreams.createdAt,
            )
            .pagination({ limit: input.limit, offset: input.offset })
            .execute(db, deploymentStreams);

        return {
            data: result.data.map(toStreamDto),
            meta: result.meta,
        };
    }

    async findStreamById(id: string): Promise<DeploymentStream | null> {
        const db = this.databaseService.db;
        const [row] = await db
            .select()
            .from(deploymentStreams)
            .where(eq(deploymentStreams.id, id))
            .limit(1);

        return row ? toStreamDto(row) : null;
    }

}
