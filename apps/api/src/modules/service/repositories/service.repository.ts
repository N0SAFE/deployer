import { Injectable } from "@nestjs/common";
import { GlobalDatabaseService } from "@/core/modules/database/services/global-database.service";
import { services, serviceDependencies } from "@/config/drizzle/global/schema/deployment";
import { localEventOutbox } from "@/config/drizzle/global/schema/runtime";
import { and, eq, ilike } from "drizzle-orm";
import { listBuilder } from "@/core/utils/drizzle-filter.utils";
import { TraefikConfigBuilder } from "@/core/modules/traefik/config-builder/builders";
import type { ServiceListInput } from "@repo/api-contracts/modules/service/list";
import type { ServiceCreateInput } from "@repo/api-contracts/modules/service/crud/create";
import type { ServiceUpdateInput } from "@repo/api-contracts/modules/service/crud/update";
import * as crypto from "node:crypto";
import { isRecord, isObjectLike } from "@repo/type-guards"


/**
 * Type guard that narrows `unknown` to a record-like object so we can
 * index it with string keys. Used in place of `as Record<string, unknown>`
 * to avoid the runtime lie.
 */
const DEFAULT_NODE_ID = "00000000-0000-4000-8000-000000000000";

type ServiceRow = typeof services.$inferSelect;

function toDto(row: ServiceRow) {
    return {
        ...row,
        traefikConfig: row.traefikConfig
            ? (row.traefikConfig.build() as unknown as Record<string, unknown>)
            : null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

@Injectable()
export class ServiceRepository {
    constructor(private readonly databaseService: GlobalDatabaseService) {}

    async list(input: ServiceListInput) {
        const db = this.databaseService.db;
        const filter = input.filter ?? {};
        const sort = input.sortBy ?? "createdAt";
        const direction = input.sortDirection ?? "desc";
        const limit = input.limit;
        const offset = input.offset;

        const result = await listBuilder(filter)
            .filter({
                projectId: ({ value }) => {
                    return eq(services.projectId, value);
                },
                name: ({ operator, value }) => {
                    switch (operator) {
                        case "eq": return eq(services.name, value);
                        case "like": return ilike(services.name, `%${value}%`);
                        case "ilike": return ilike(services.name, `%${value}%`);
                    }
                },
                type: ({ value }) => {
                    return eq(services.type, value);
                },
            })
            .order(sort, direction, {
                name: services.name,
                type: services.type,
                createdAt: services.createdAt,
                updatedAt: services.updatedAt,
            }, services.createdAt)
            .pagination({ limit, offset })
            .execute(db, services);

        return {
            data: result.data.map(toDto),
            meta: result.meta,
        };
    }

    async findById(id: string) {
        const [row] = await this.databaseService.db
            .select()
            .from(services)
            .where(eq(services.id, id))
            .limit(1);
        return row ? toDto(row) : null;
    }

    async create(input: ServiceCreateInput) {
        const [row] = await this.databaseService.db.transaction(async (tx) => {
            const [created] = await tx
                .insert(services)
                .values({
                    projectId: input.projectId,
                    name: input.name,
                    type: input.type,
                    providerId: input.providerId,
                    builderId: input.builderId,
                    description: input.description ?? null,
                    providerConfig: input.providerConfig ?? null,
                    builderConfig: input.builderConfig ?? null,
                    port: input.port ?? null,
                    environmentVariables: input.environmentVariables ?? null,
                    resourceLimits: input.resourceLimits ?? null,
                    healthCheckPath: input.healthCheckPath ?? "/health",
                    healthCheckInterval: input.healthCheckInterval ?? 30,
                    healthCheckTimeout: input.healthCheckTimeout ?? 10,
                    healthCheckRetries: input.healthCheckRetries ?? 3,
                    deploymentRetention: input.deploymentRetention ?? undefined,
                    traefikConfig: input.traefikConfig
                        ? TraefikConfigBuilder.load(JSON.stringify(input.traefikConfig))
                        : undefined,
                    customDomains: input.customDomains ?? null,
                    metadata: input.metadata as ServiceRow["metadata"] ?? null,
                })
                .returning();

            if (!created) {
                return [];
            }

            await tx.insert(localEventOutbox).values({
                id: crypto.randomUUID(),
                nodeId: this.resolveNodeId(),
                topic: "service.created",
                payload: this.buildDomainEventEnvelope({
                    aggregateType: "service",
                    aggregateId: created.id,
                    eventType: "service.created",
                    payload: {
                        serviceId: created.id,
                        projectId: created.projectId,
                        type: created.type,
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
        if (!row) {
            throw new Error("Failed to create service");
        }
        return toDto(row);
    }

    async update(id: string, input: Omit<ServiceUpdateInput, 'id'>) {
        const { traefikConfig: rawTraefikConfig, metadata, ...restInput } = input;
        const [row] = await this.databaseService.db.transaction(async (tx) => {
            const [updated] = await tx
                .update(services)
                .set({
                    ...restInput,
                    ...(rawTraefikConfig !== undefined ? {
                        traefikConfig: rawTraefikConfig
                            ? TraefikConfigBuilder.load(JSON.stringify(rawTraefikConfig))
                            : null,
                    } : {}),
                    ...(metadata !== undefined ? {
                        metadata: metadata,
                    } : {}),
                    updatedAt: new Date(),
                })
                .where(eq(services.id, id))
                .returning();

            if (!updated) {
                return [];
            }

            await tx.insert(localEventOutbox).values({
                id: crypto.randomUUID(),
                nodeId: this.resolveNodeId(),
                topic: "service.updated",
                payload: this.buildDomainEventEnvelope({
                    aggregateType: "service",
                    aggregateId: updated.id,
                    eventType: "service.updated",
                    payload: {
                        serviceId: updated.id,
                        projectId: updated.projectId,
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

    async delete(id: string) {
        await this.databaseService.db.transaction(async (tx) => {
            const [existing] = await tx
                .select()
                .from(services)
                .where(eq(services.id, id))
                .limit(1);

            await tx.delete(services).where(eq(services.id, id));

            if (!existing) {
                return;
            }

            await tx.insert(localEventOutbox).values({
                id: crypto.randomUUID(),
                nodeId: this.resolveNodeId(),
                topic: "service.deleted",
                payload: this.buildDomainEventEnvelope({
                    aggregateType: "service",
                    aggregateId: existing.id,
                    eventType: "service.deleted",
                    payload: {
                        serviceId: existing.id,
                        projectId: existing.projectId,
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

    async toggleActive(id: string, isActive: boolean) {
        const [row] = await this.databaseService.db.transaction(async (tx) => {
            const [updated] = await tx
                .update(services)
                .set({ isActive, updatedAt: new Date() })
                .where(eq(services.id, id))
                .returning();

            if (!updated) {
                return [];
            }

            await tx.insert(localEventOutbox).values({
                id: crypto.randomUUID(),
                nodeId: this.resolveNodeId(),
                topic: "service.activation.updated",
                payload: this.buildDomainEventEnvelope({
                    aggregateType: "service",
                    aggregateId: updated.id,
                    eventType: "service.activation.updated",
                    payload: {
                        serviceId: updated.id,
                        projectId: updated.projectId,
                        isActive: updated.isActive,
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
            eventId: crypto.randomUUID(),
            aggregateType: input.aggregateType,
            aggregateId: input.aggregateId,
            eventType: input.eventType,
            version: "1",
            occurredAt: new Date().toISOString(),
            payload: input.payload,
            metadata: {
                source: "service.repository",
            },
        };
    }

    // -------------------------
    // Dependencies
    // -------------------------

    async getDependencies(serviceId: string) {
        const rows = await this.databaseService.db
            .select({
                dep: serviceDependencies,
                dependsOnService: { id: services.id, name: services.name, type: services.type },
            })
            .from(serviceDependencies)
            .innerJoin(
                services,
                eq(serviceDependencies.dependsOnServiceId, services.id),
            )
            .where(eq(serviceDependencies.serviceId, serviceId));

        return rows.map((r) => ({
            id: r.dep.id,
            serviceId: r.dep.serviceId,
            dependsOnServiceId: r.dep.dependsOnServiceId,
            dependsOnService: r.dependsOnService,
            isRequired: r.dep.isRequired,
            createdAt: r.dep.createdAt.toISOString(),
        }));
    }

    async addDependency(serviceId: string, dependsOnServiceId: string, isRequired: boolean) {
        const [row] = await this.databaseService.db
            .insert(serviceDependencies)
            .values({ serviceId, dependsOnServiceId, isRequired })
            .returning();
        if (!row) {
            throw new Error("Failed to add dependency");
        }
        return {
            id: row.id,
            serviceId: row.serviceId,
            dependsOnServiceId: row.dependsOnServiceId,
            isRequired: row.isRequired,
            createdAt: row.createdAt.toISOString(),
        };
    }

    async removeDependency(dependencyId: string, serviceId: string) {
        await this.databaseService.db
            .delete(serviceDependencies)
            .where(
                and(eq(serviceDependencies.id, dependencyId), eq(serviceDependencies.serviceId, serviceId)),
            );
    }

    async dependencyExists(serviceId: string, dependsOnServiceId: string) {
        const [row] = await this.databaseService.db
            .select()
            .from(serviceDependencies)
            .where(
                and(
                    eq(serviceDependencies.serviceId, serviceId),
                    eq(serviceDependencies.dependsOnServiceId, dependsOnServiceId),
                ),
            )
            .limit(1);
        return !!row;
    }
}
