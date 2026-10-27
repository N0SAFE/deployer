import { ConflictError } from "@deployer/errors";
import { services, serviceDependencies, projects } from "@deployer/nest-schema/global/project/deployment";
import { localEventOutbox } from "@deployer/nest-schema/global/runtime/runtime";
import { and, eq, ilike, asc, isNull, inArray } from "drizzle-orm";
import type { GlobalTransaction } from "@deployer/shared/core/modules/database/global/global-database.service";
import { listBuilder } from "@deployer/shared/core/utils/drizzle-filter.utils";
import { TraefikConfigBuilder } from "@deployer/shared/core/modules/traefik/config-builder/builders/index";
import type { ServiceListInput } from "@deployer/project-contracts/modules/service/list";
import type { ServiceCreateInput } from "@deployer/project-contracts/modules/service/crud/create";
import type { ServiceUpdateInput } from "@deployer/project-contracts/modules/service/crud/update";
import { serviceNetworkConfigSchema } from "@deployer/contracts-entities";
import { serviceProviderConfigUnionSchema, serviceRunnerConfigUnionSchema, implementedContractSchema, previewSourceTemplateSchema } from "@deployer/contracts-entities";
import * as crypto from "node:crypto";
import { isRecord } from "@deployer/type-guards"
import { readTraefikConfig } from "@deployer/nest-schema/codecs/codec-registry";
import { Context, Effect } from "effect";
import { DatabasePort } from "@project/core/database/database.port";
import { attempt } from "@project/core/effect/attempt";



const DEFAULT_NODE_ID = "00000000-0000-4000-8000-000000000000";

type ServiceRow = typeof services.$inferSelect;

type DbTransaction = GlobalTransaction;

function toDto(row: ServiceRow) {
    // The schema package's column is typed `unknown` (it cannot name this app's
    // builder), so the type is re-applied here through the package's generic
    // reader — no cast at the call site, and the app's builder type is enforced.
    const builtConfig = row.traefikConfig
        ? readTraefikConfig<TraefikConfigBuilder>(JSON.stringify(row.traefikConfig)).build()
        : undefined;
    // Parse configs through the contract union schemas so the DTO type IS the
    // entity schema's inferred type (Zod-as-source-of-truth). Invalid legacy
    // configs degrade to null rather than crashing the whole list.
    const providerConfig = row.providerConfig
        ? serviceProviderConfigUnionSchema.safeParse(row.providerConfig).data ?? null
        : null;
    const builderConfig = row.builderConfig
        ? serviceRunnerConfigUnionSchema.safeParse(row.builderConfig).data ?? null
        : null;
    const implementsContract = row.implementsContract
        ? implementedContractSchema.safeParse(row.implementsContract).data ?? null
        : null;
    const preview = row.preview
        ? previewSourceTemplateSchema.safeParse(row.preview).data ?? null
        : null;
    const network = row.network
        ? serviceNetworkConfigSchema.safeParse(row.network).data ?? null
        : null;
    return {
        ...row,
        providerConfig,
        builderConfig,
        traefikConfig: builtConfig && isRecord(builtConfig) ? builtConfig : null,
        implementsContract,
        preview,
        network,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

/** Compute the materialized parent path for a child of `parentPath` at `depth`. */
export function computeChildPath(parentPath: string | null | undefined, parentDepth: number, selfId: string): string {
    const path = parentPath && parentPath.length > 0 ? parentPath : "";
    const base = path.length > 0 ? `${path}/` : "";
    return `${base}${selfId}`;
}

function buildChildPath(parentPath: string | null, parentId: string): string {
    return parentPath && parentPath.length > 0 ? `${parentPath}/${parentId}` : parentId;
}

function resolveNodeId(): string {
    const configured = process.env.MESH_NODE_ID?.trim();
    return configured && configured.length > 0 ? configured : DEFAULT_NODE_ID;
}

function buildDomainEventEnvelope(input: {
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

async function insertCreatedEvent(tx: DbTransaction, row: ServiceRow): Promise<void> {
    await tx.insert(localEventOutbox).values({
        id: crypto.randomUUID(),
        nodeId: resolveNodeId(),
        topic: "service.created",
        payload: buildDomainEventEnvelope({
            aggregateType: "service",
            aggregateId: row.id,
            eventType: "service.created",
            payload: {
                serviceId: row.id,
                projectId: row.projectId,
                type: row.type,
            },
        }),
        state: "pending",
        retryCount: 0,
        nextRetryAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
    });
}

/** Extract the `subServices` manifest (name + dependsOn) from a builder config. */
function extractSubServiceManifest(
    builderConfig: unknown,
): { name: string; dependsOn?: string[] }[] {
    if (!builderConfig || typeof builderConfig !== "object") {
        return [];
    }
    const bc = builderConfig as { subServices?: { name?: string; dependsOn?: string[] }[] };
    if (!Array.isArray(bc.subServices)) {
        return [];
    }
    return bc.subServices.filter(
        (s): s is { name: string; dependsOn?: string[] } =>
            typeof s.name === "string" && s.name.length > 0,
    );
}

/**
 * Reconcile a parent orchestrator's sub-service dependencies into real
 * `service_dependencies` edges right after insertion.
 *
 * 1. **Implicit parent edge** — every child depends on its parent stack.
 * 2. **Manifest reconciliation** — the parent's `builderConfig.subServices`
 *    entries declare `dependsOn: string[]` by NAME (docker-compose style).
 *    Names are resolved against the just-inserted sibling rows, turning the
 *    name-based ordering into real UUID edges.
 *
 * No-ops when the parent has no subServices manifest.
 */
async function autoLinkSubServiceDependencies(
    tx: DbTransaction,
    parent: ServiceRow,
    children: { input: ServiceCreateInput; row: ServiceRow }[],
): Promise<void> {
    if (children.length === 0) {
        return;
    }

    // name → row id for THIS subtree level (siblings share one namespace).
    const nameToId = new Map<string, string>();
    for (const { input, row } of children) {
        nameToId.set(input.name, row.id);
    }

    const edges: { serviceId: string; dependsOnServiceId: string; isRequired: boolean }[] = [];
    const seen = new Set<string>();

    const addEdge = (serviceId: string, dependsOnServiceId: string) => {
        if (serviceId === dependsOnServiceId) {
            return;
        }
        const key = `${serviceId}:${dependsOnServiceId}`;
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        edges.push({ serviceId, dependsOnServiceId, isRequired: true });
    };

    // 1) Implicit child → parent edge (deployment order: parent first).
    for (const { row } of children) {
        addEdge(row.id, parent.id);
    }

    // 2) Reconcile the orchestrator manifest's name-based dependsOn.
    const manifest = extractSubServiceManifest(parent.builderConfig);
    for (const entry of manifest) {
        const serviceId = nameToId.get(entry.name);
        if (!serviceId) {
            continue;
        }
        for (const depName of entry.dependsOn ?? []) {
            const dependsOnId = nameToId.get(depName);
            if (dependsOnId) {
                addEdge(serviceId, dependsOnId);
            }
        }
    }

    if (edges.length > 0) {
        await tx.insert(serviceDependencies).values(edges);
    }
}

/** Insert a nested children tree; returns all inserted rows in depth-first order. */
async function insertChildrenRecursive(
    tx: DbTransaction,
    parent: ServiceRow,
    children: ServiceCreateInput[],
): Promise<ServiceRow[]> {
    const inserted: ServiceRow[] = [];
    const childDepth = parent.depth + 1;
    const childPath = buildChildPath(parent.parentPath, parent.id);

    // ── Pass 1: insert all sibling rows (so name-based dependsOn can
    //    resolve against any sibling, regardless of manifest order). ──
    const insertedLevel: { input: ServiceCreateInput; row: ServiceRow }[] = [];
    for (const child of children) {
        const [row] = await tx
            .insert(services)
            .values({
                projectId: child.projectId,
                name: child.name,
                type: child.type,
                providerId: child.providerId,
                builderId: child.builderId,
                description: child.description ?? null,
                providerConfig: child.providerConfig ?? null,
                builderConfig: child.builderConfig ?? null,
                port: child.port ?? null,
                environmentVariables: child.environmentVariables ?? null,
                resourceLimits: child.resourceLimits ?? null,
                healthCheckPath: child.healthCheckPath ?? "/health",
                healthCheckInterval: child.healthCheckInterval ?? 30,
                healthCheckTimeout: child.healthCheckTimeout ?? 10,
                healthCheckRetries: child.healthCheckRetries ?? 3,
                deploymentRetention: child.deploymentRetention ?? undefined,
                traefikConfig: child.traefikConfig
                    ? TraefikConfigBuilder.load(JSON.stringify(child.traefikConfig))
                    : undefined,
                customDomains: child.customDomains ?? null,
                network: child.network ?? null,
                implementsContract: child.implementsContract ?? null,
                preview: child.preview ?? null,
                parentId: parent.id,
                parentPath: childPath,
                depth: childDepth,
                metadata: child.metadata ?? null,
            })
            .returning();

        if (row) {
            await insertCreatedEvent(tx, row);
            insertedLevel.push({ input: child, row });
            inserted.push(row);
        }
    }

    // ── Pass 2: recurse into grandchildren (each child is a namespace). ──
    for (const { input: child, row } of insertedLevel) {
        if (child.children && child.children.length > 0) {
            const grand = await insertChildrenRecursive(tx, row, child.children);
            inserted.push(...grand);
        }
    }

    // ── Pass 3: AUTO-LINK sub-services to their depends_on. ──
    //  - Every sub-service gets an implicit edge to its parent (the parent
    //    stack must deploy before the child starts).
    //  - The orchestrator's name-based `subServices[].dependsOn` manifest
    //    (compose-import style) is reconciled into real UUID edges between
    //    the sibling rows inserted above — no manual edge creation needed.
    await autoLinkSubServiceDependencies(tx, parent, insertedLevel);

    return inserted;
}

/** After reparenting, recompute depth + parentPath for every descendant (BFS). */
async function rebuildSubtreePaths(tx: DbTransaction, root: ServiceRow): Promise<void> {
    const queue: { id: string; parentPath: string | null; depth: number }[] = [{
        id: root.id,
        parentPath: root.parentPath,
        depth: root.depth,
    }];

    while (queue.length > 0) {
        const next = queue.shift();
        if (!next) {
            continue;
        }
        const children = await tx
            .select()
            .from(services)
            .where(eq(services.parentId, next.id));

        for (const child of children) {
            const childPath = buildChildPath(next.parentPath, next.id);
            const childDepth = next.depth + 1;
            await tx
                .update(services)
                .set({ parentPath: childPath, depth: childDepth, updatedAt: new Date() })
                .where(eq(services.id, child.id));
            queue.push({ id: child.id, parentPath: childPath, depth: childDepth });
        }
    }
}

/** Drizzle implementation of the services aggregate. No constructor DI: every method yields `DatabasePort`. */
export class ServiceStoreImpl {
    list(input: ServiceListInput = {} as ServiceListInput) {
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
                        parentId: ({ operator, value }) => {
                            switch (operator) {
                                case "eq": return eq(services.parentId, value);
                                case "isNull": return isNull(services.parentId);
                            }
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
            });
        });
    }

    findById(id: string) {
        return Effect.gen(function* () {
            const { db } = yield* DatabasePort;
            return yield* attempt(async () => {
                const [row] = await db
                    .select()
                    .from(services)
                    .where(eq(services.id, id))
                    .limit(1);
                return row ? toDto(row) : null;
            });
        });
    }

    /**
     * Read a project's raw settings JSONB (for the contract registry used by
     * the preview-topology dry-run resolver).
     */
    getProjectSettings(projectId: string) {
        return Effect.gen(function* () {
            const { db } = yield* DatabasePort;
            return yield* attempt(async () => {
                const [row] = await db
                    .select({ settings: projects.settings })
                    .from(projects)
                    .where(eq(projects.id, projectId))
                    .limit(1);
                return row?.settings ?? null;
            });
        });
    }

    /**
     * Fetch the ancestor chain of a service, root-first (topmost ancestor →
     * direct parent). Uses the materialized `parentPath` (its segments ARE the
     * ancestor ids) so the whole chain is resolved in ONE query.
     *
     * Used for effective-config inheritance: a sub-service inherits the
     * configuration of everything above it (its namespace), and each ancestor
     * may override values for its own subtree.
     */
    findAncestors(serviceId: string) {
        return Effect.gen(function* () {
            const { db } = yield* DatabasePort;
            return yield* attempt(async () => {
                const [row] = await db
                    .select({ parentPath: services.parentPath })
                    .from(services)
                    .where(eq(services.id, serviceId))
                    .limit(1);
                if (!row?.parentPath) {
                    return [];
                }
                const ancestorIds = row.parentPath.split("/").filter(Boolean);
                if (ancestorIds.length === 0) {
                    return [];
                }
                const rows = await db
                    .select()
                    .from(services)
                    .where(inArray(services.id, ancestorIds));
                const byId = new Map(rows.map((r) => [r.id, r]));
                return ancestorIds
                    .map((id) => byId.get(id))
                    .filter((r): r is ServiceRow => Boolean(r))
                    .map(toDto);
            });
        });
    }

    /**
     * Create a service and (optionally) its whole subtree in ONE transaction.
     * - `parentId`: attach the new service under an existing parent.
     * - `children`: recursively-created child rows (each may have its own children).
     * parentPath/depth are computed from the parent row, so any nesting depth works.
     */
    create(input: ServiceCreateInput & { parentId?: string | null; children?: ServiceCreateInput[] }) {
        return Effect.gen(function* () {
            const { db } = yield* DatabasePort;
            const rows = yield* attempt(async () => {
                return db.transaction(async (tx) => {
                    // 1) Resolve the parent row (if any) to compute path/depth.
                    let parentRow: ServiceRow | undefined;
                    if (input.parentId) {
                        const [parent] = await tx
                            .select()
                            .from(services)
                            .where(eq(services.id, input.parentId))
                            .limit(1);
                        parentRow = parent;
                        if (!parent) {
                            return [];
                        }
                    }
                    const depth = parentRow ? parentRow.depth + 1 : 0;
                    const parentPath = parentRow
                        ? buildChildPath(parentRow.parentPath, parentRow.id)
                        : null;

                    // 2) Insert the root row.
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
                            network: input.network ?? null,
                            implementsContract: input.implementsContract ?? null,
                            preview: input.preview ?? null,
                            parentId: input.parentId ?? null,
                            parentPath,
                            depth,
                            metadata: input.metadata ?? null,
                        })
                        .returning();

                    if (!created) {
                        return [];
                    }

                    await insertCreatedEvent(tx, created);

                    // 3) Recursively insert children in the same transaction.
                    const allRows: ServiceRow[] = [created];
                    if (input.children && input.children.length > 0) {
                        const childRows = await insertChildrenRecursive(tx, created, input.children);
                        allRows.push(...childRows);
                    }

                    return allRows;
                });
            });

            const firstRow = rows[0];
            if (!firstRow) {
                return yield* Effect.fail(new ConflictError("Failed to create service"));
            }
            return toDto(firstRow);
        });
    }

    /** List the DIRECT children of a service, ordered by name. */
    listChildren(parentId: string) {
        return Effect.gen(function* () {
            const { db } = yield* DatabasePort;
            return yield* attempt(async () => {
                const result = await db
                    .select()
                    .from(services)
                    .where(eq(services.parentId, parentId))
                    .orderBy(asc(services.name));
                return result.map(toDto);
            });
        });
    }

    /**
     * Fetch a service and its whole descendant subtree (materialized path query).
     * Returns the tree as nested DTOs: { ...service, children: [...] }.
     */
    findWithSubtree(id: string) {
        return Effect.gen(function* () {
            const { db } = yield* DatabasePort;
            return yield* attempt(async () => {
                const [root] = await db
                    .select()
                    .from(services)
                    .where(eq(services.id, id))
                    .limit(1);
                if (!root) {
                    return null;
                }

                const subtreePath = buildChildPath(root.parentPath, root.id);
                const descendants = await db
                    .select()
                    .from(services)
                    .where(and(
                        eq(services.projectId, root.projectId),
                        ilike(services.parentPath, `${subtreePath}%`),
                    ))
                    .orderBy(asc(services.name));

                type TreeNode = ReturnType<typeof toDto> & { children: TreeNode[] };
                const byId = new Map<string, TreeNode>();
                // Include the root itself so direct children can attach to it.
                byId.set(root.id, { ...toDto(root), children: [] });
                for (const row of descendants) {
                    byId.set(row.id, { ...toDto(row), children: [] });
                }

                const rootNode = byId.get(id);
                for (const node of byId.values()) {
                    if (node.id === id) {
                        continue;
                    }
                    const parentId = node.parentId;
                    const parentNode = parentId ? byId.get(parentId) : undefined;
                    if (parentNode) {
                        parentNode.children.push(node);
                    }
                }

                return rootNode ?? { ...toDto(root), children: [] };
            });
        });
    }

    update(id: string, input: Omit<ServiceUpdateInput, 'id'> & { parentId?: string | null }) {
        return Effect.gen(function* () {
            const { db } = yield* DatabasePort;
            return yield* attempt(async () => {
                const { traefikConfig: rawTraefikConfig, metadata, ...restInput } = input;
                const rows = await db.transaction(async (tx) => {
                    const [current] = await tx
                        .select()
                        .from(services)
                        .where(eq(services.id, id))
                        .limit(1);
                    if (!current) {
                        return [];
                    }

                    // Reparenting: compute the new depth/path and re-stamp the whole subtree.
                    let newDepth = current.depth;
                    let newParentPath = current.parentPath;
                    let needsSubtreeRebuild = false;
                    if (input.parentId !== undefined && input.parentId !== current.parentId) {
                        needsSubtreeRebuild = true;
                        if (input.parentId) {
                            if (input.parentId === id) {
                                // A service cannot be its own parent.
                                return [];
                            }
                            const [parent] = await tx
                                .select()
                                .from(services)
                                .where(eq(services.id, input.parentId))
                                .limit(1);
                            if (!parent) {
                                return [];
                            }
                            newDepth = parent.depth + 1;
                            newParentPath = buildChildPath(parent.parentPath, parent.id);
                        } else {
                            newDepth = 0;
                            newParentPath = null;
                        }
                    }

                    const [updated] = await tx
                        .update(services)
                        .set({
                            ...restInput,
                            ...(input.parentId !== undefined ? { parentId: input.parentId ?? null } : {}),
                            ...(needsSubtreeRebuild ? { depth: newDepth, parentPath: newParentPath } : {}),
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

                    // Re-stamp descendants so materialized paths stay consistent.
                    if (needsSubtreeRebuild) {
                        await rebuildSubtreePaths(tx, updated);
                    }

                    await tx.insert(localEventOutbox).values({
                        id: crypto.randomUUID(),
                        nodeId: resolveNodeId(),
                        topic: "service.updated",
                        payload: buildDomainEventEnvelope({
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
                return rows[0] ? toDto(rows[0]) : null;
            });
        });
    }

    delete(id: string) {
        return Effect.gen(function* () {
            const { db } = yield* DatabasePort;
            yield* attempt(async () => {
                await db.transaction(async (tx) => {
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
                        nodeId: resolveNodeId(),
                        topic: "service.deleted",
                        payload: buildDomainEventEnvelope({
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
            });
        });
    }

    toggleActive(id: string, isActive: boolean) {
        return Effect.gen(function* () {
            const { db } = yield* DatabasePort;
            const row = yield* attempt(async () => {
                const [updated] = await db.transaction(async (tx) => {
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
                        nodeId: resolveNodeId(),
                        topic: "service.activation.updated",
                        payload: buildDomainEventEnvelope({
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
                return updated;
            });
            return row ? toDto(row) : null;
        });
    }

    // -------------------------
    // Dependencies
    // -------------------------

    getDependencies(serviceId: string) {
        return Effect.gen(function* () {
            const { db } = yield* DatabasePort;
            return yield* attempt(async () => {
                const rows = await db
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
            });
        });
    }

    addDependency(serviceId: string, dependsOnServiceId: string, isRequired: boolean) {
        return Effect.gen(function* () {
            const { db } = yield* DatabasePort;
            const row = yield* attempt(async () => {
                const [row] = await db
                    .insert(serviceDependencies)
                    .values({ serviceId, dependsOnServiceId, isRequired })
                    .returning();
                return row;
            });
            if (!row) {
                return yield* Effect.fail(new ConflictError("Failed to add dependency"));
            }
            return {
                id: row.id,
                serviceId: row.serviceId,
                dependsOnServiceId: row.dependsOnServiceId,
                isRequired: row.isRequired,
                createdAt: row.createdAt.toISOString(),
            };
        });
    }

    removeDependency(dependencyId: string, serviceId: string) {
        return Effect.gen(function* () {
            const { db } = yield* DatabasePort;
            yield* attempt(async () => {
                await db
                    .delete(serviceDependencies)
                    .where(
                        and(eq(serviceDependencies.id, dependencyId), eq(serviceDependencies.serviceId, serviceId)),
                    );
            });
        });
    }

    dependencyExists(serviceId: string, dependsOnServiceId: string) {
        return Effect.gen(function* () {
            const { db } = yield* DatabasePort;
            return yield* attempt(async () => {
                const [row] = await db
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
            });
        });
    }
}

/** The store's public surface is exactly the implementation's methods. */
export type ServiceStoreShape = ServiceStoreImpl;

/** Effect key = NestJS token. */
export class ServiceStore extends Context.Service<ServiceStore, ServiceStoreShape>()(
    "project/ServiceStore",
) {}
