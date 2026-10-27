import { EMPTY, type Observable, concat, defer, from, map, mergeMap } from "rxjs";
import { filter as rxFilter } from "rxjs/operators";
import { BadRequestError, ConflictError, NotFoundError } from "@deployer/errors";
import { Context, Effect } from "effect";
import { CoreEventSync } from "@project/core/ports/core-event-sync.port";
import { ProjectAccess } from "@project/core/ports/project-access.port";
import { RuntimeConfigurationAccessor } from "@project/core/ports/runtime-configuration-accessor.port";
import { DatabasePort } from "@project/core/database/database.port";
import { attempt, guard } from "@project/core/effect/attempt";
import { ServiceStore, type ServiceStoreShape } from "../repositories/service.repository";
import {
	ServiceEventService,
	type ServiceEventServiceImpl,
} from "./service-event.service";
import { PreviewTopologyService } from "./preview-topology.service";
import { defaultProviderConfig, defaultRunnerConfig } from "./service-config-defaults";
import { emptyEffectiveConfig, foldServiceChain, mergeServiceConfig } from "./service-effective-config";
import type { ServiceEffectiveConfig, ServiceWithEffectiveConfig } from "@deployer/contracts-entities";
import type { ServiceListInput } from "@deployer/project-contracts/modules/service/list";
import type { ServiceCreateInput } from "@deployer/project-contracts/modules/service/crud/create";
import type { ServiceUpdateInput } from "@deployer/project-contracts/modules/service/crud/update";
import type { ProjectRole } from "@deployer/auth";
import type {
    ServiceStreamEvent,
    ServiceStreamQueryInput,
} from "@deployer/project-contracts/modules/service/streams/query";
import type {
    ConfigurationProviderType,
    ConfigurationRunnerType,
} from "@deployer/shared/core/modules/configuration/schemas/runtime-configuration.schema";
import type { ServiceProviderType, ServiceRunnerType } from "@deployer/contracts-common";

type StreamEventWithMeta<T extends object> = T & {
    sequence: number;
    replayed: boolean;
    emittedAt: Date;
};

/** One row of the service dependency table, as the store returns it. */
type ServiceDependency = Effect.Success<
    ReturnType<ServiceStoreShape["getDependencies"]>
>[number];

/** A node of the persisted subtree, as the store returns it. */
type SubtreeNode = NonNullable<
    Effect.Success<ReturnType<ServiceStoreShape["findWithSubtree"]>>
>;

/** Map a service provider type to the runtime configuration provider type. */
function mapProviderType(providerId: ServiceProviderType): ConfigurationProviderType {
    if (providerId === "github") return "github";
    if (providerId === "gitlab") return "gitlab";
    if (providerId === "bitbucket") return "git";
    return "custom";
}

/** Map a service builder/runner type to the runtime configuration runner type. */
function mapRunnerType(builderId: ServiceRunnerType): ConfigurationRunnerType {
    if (builderId === "static") return "static";
    // manual / compose / orchestrator all deploy containers through docker —
    // `compose` manages a whole compose stack as one unit, `orchestrator`
    // manages individual sub-services. Both are docker-based runtimes.
    if (builderId === "manual" || builderId === "compose" || builderId === "orchestrator") return "docker";
    return "custom";
}

/** Prove the caller may act on a project, through the shared access service. */
function assertProjectAccess(
    projectId: string,
    requesterId: string,
    allowedRoles: readonly ProjectRole[],
) {
    return Effect.gen(function* () {
        const access = yield* ProjectAccess;
        yield* attempt(() => access.assertProjectAccess(projectId, requesterId, allowedRoles));
    });
}

/** Load a service, then prove the caller may act on its project. */
function assertServiceAccess(
    serviceId: string,
    requesterId: string,
    allowedRoles: readonly ProjectRole[],
) {
    return Effect.gen(function* () {
        const services = yield* ServiceStore;
        const service = yield* services.findById(serviceId);
        if (!service) {
            return yield* Effect.fail(new NotFoundError("Service", serviceId));
        }
        yield* assertProjectAccess(service.projectId, requesterId, allowedRoles);
        return service;
    });
}

/** A service row plus its resolved (ancestors folded down) configuration. */
function loadServiceWithConfig(id: string) {
    return Effect.gen(function* () {
        const services = yield* ServiceStore;
        const service = yield* services.findById(id);
        if (!service) {
            return yield* Effect.fail(new NotFoundError("Service", id));
        }
        const ancestors = yield* services.findAncestors(id);
        return {
            ...service,
            effectiveConfig: foldServiceChain(ancestors, service),
        };
    });
}

/**
 * Recursively validate runtime-config constraints + fill default configs
 * for a service and its whole children tree before persisting.
 */
function resolveCreatePayload(input: ServiceCreateInput): Effect.Effect<
    ServiceCreateInput,
    Error,
    RuntimeConfigurationAccessor
> {
    return Effect.gen(function* () {
        const configuration = yield* RuntimeConfigurationAccessor;

        const resolvedRuntimeConfiguration = yield* guard(() =>
            configuration.resolveStrict({
                scope: "project",
                context: {
                    projectId: input.projectId,
                    requestedProviderType: mapProviderType(input.providerId),
                    requestedRunnerType: mapRunnerType(input.builderId),
                },
                project: {},
                service: configuration.serviceConfigFromRecord({
                    providerId: input.providerId,
                    builderId: input.builderId,
                    customDomains: input.customDomains ?? null,
                    environmentVariables: input.environmentVariables ?? null,
                    resourceLimits: input.resourceLimits
                        ? {
                              memory: input.resourceLimits.memory ?? null,
                              cpu: input.resourceLimits.cpu ?? null,
                          }
                        : null,
                }),
            }),
        );

        if (!resolvedRuntimeConfiguration.effective.constraints.providerAllowed) {
            return yield* Effect.fail(
                new BadRequestError("Configured provider is not allowed by runtime configuration"),
            );
        }

        if (!resolvedRuntimeConfiguration.effective.constraints.runnerAllowed) {
            return yield* Effect.fail(
                new BadRequestError("Configured runner is not allowed by runtime configuration"),
            );
        }

        const children = input.children?.length
            ? yield* Effect.forEach(input.children, (child) => resolveCreatePayload(child))
            : undefined;

        return {
            ...input,
            providerConfig: input.providerConfig ?? defaultProviderConfig(input.providerId),
            builderConfig: input.builderConfig ?? defaultRunnerConfig(input.builderId),
            children,
        };
    });
}

/** Is `candidateId` a descendant of `ancestorId`? (the materialized path IS the chain) */
function isDescendant(ancestorId: string, candidateId: string) {
    return Effect.gen(function* () {
        const services = yield* ServiceStore;
        // `findAncestors` returns the whole chain from the materialized
        // `parentPath`, so this is one query instead of a walk up parent links.
        const ancestors = yield* services.findAncestors(candidateId);
        return ancestors.some((ancestor) => ancestor.id === ancestorId);
    });
}

/** One node of the sub-service dependency tree. */
type SubServiceDependencyNode = {
    serviceId: string;
    serviceName: string;
    serviceType: string;
    dependencies: ServiceDependency[];
    children?: SubServiceDependencyNode[];
};

/** Namespace-aware dependency tree for the sub-services below `parentId`. */
function buildSubServiceDependenciesTree(
    parentId: string,
): Effect.Effect<SubServiceDependencyNode[], Error, ServiceStore | DatabasePort> {
    return Effect.gen(function* () {
        const services = yield* ServiceStore;
        const children = yield* services.listChildren(parentId);
        const nodes: SubServiceDependencyNode[] = [];
        for (const child of children) {
            const dependencies = yield* services.getDependencies(child.id);
            const grandchildren = yield* buildSubServiceDependenciesTree(child.id);
            nodes.push({
                serviceId: child.id,
                serviceName: child.name,
                serviceType: child.type,
                dependencies,
                ...(grandchildren.length > 0 ? { children: grandchildren } : {}),
            });
        }
        return nodes;
    });
}

function wouldIntroduceDependencyCycle(serviceId: string, dependsOnServiceId: string) {
    return Effect.gen(function* () {
        const services = yield* ServiceStore;
        const queue: string[] = [dependsOnServiceId];
        const visited = new Set<string>();

        while (queue.length > 0) {
            const currentServiceId = queue.shift();
            if (!currentServiceId || visited.has(currentServiceId)) {
                continue;
            }

            if (currentServiceId === serviceId) {
                return true;
            }

            visited.add(currentServiceId);

            const dependencies = yield* services.getDependencies(currentServiceId);
            for (const dependency of dependencies) {
                const downstreamServiceId = dependency.dependsOnServiceId;
                if (
                    typeof downstreamServiceId === "string" &&
                    downstreamServiceId.length > 0 &&
                    !visited.has(downstreamServiceId)
                ) {
                    queue.push(downstreamServiceId);
                }
            }
        }

        return false;
    });
}

/** Narrow a core envelope to a service stream event, dropping unknown names. */
function toServiceStreamEvent(
    envelope: {
        eventName: string;
        payload: unknown;
    } | null,
): ServiceStreamEvent | null {
    if (!envelope) return null;

    switch (envelope.eventName) {
        case "serviceCreated": {
            const payload = envelope.payload as {
                serviceId: string;
                projectId: string;
                name: string;
                type: string;
                isActive: boolean;
                timestamp: string;
            };
            return {
                type: "serviceCreated",
                serviceId: payload.serviceId,
                projectId: payload.projectId,
                name: payload.name,
                serviceType: payload.type,
                isActive: payload.isActive,
                timestamp: toDate(payload.timestamp),
            };
        }
        case "serviceUpdated": {
            const payload = envelope.payload as {
                serviceId: string;
                projectId: string;
                changedFields: string[];
                timestamp: string;
            };
            return {
                type: "serviceUpdated",
                serviceId: payload.serviceId,
                projectId: payload.projectId,
                changedFields: payload.changedFields,
                timestamp: toDate(payload.timestamp),
            };
        }
        case "serviceDeleted": {
            const payload = envelope.payload as {
                serviceId: string;
                projectId: string;
                timestamp: string;
            };
            return {
                type: "serviceDeleted",
                serviceId: payload.serviceId,
                projectId: payload.projectId,
                timestamp: toDate(payload.timestamp),
            };
        }
        case "serviceActivationChanged": {
            const payload = envelope.payload as {
                serviceId: string;
                projectId: string;
                isActive: boolean;
                timestamp: string;
            };
            return {
                type: "serviceActivationChanged",
                serviceId: payload.serviceId,
                projectId: payload.projectId,
                isActive: payload.isActive,
                timestamp: toDate(payload.timestamp),
            };
        }
        case "serviceDependencyAdded": {
            const payload = envelope.payload as {
                serviceId: string;
                dependsOnServiceId: string;
                isRequired: boolean;
                timestamp: string;
            };
            return {
                type: "serviceDependencyAdded",
                serviceId: payload.serviceId,
                dependsOnServiceId: payload.dependsOnServiceId,
                isRequired: payload.isRequired,
                timestamp: toDate(payload.timestamp),
            };
        }
        case "serviceDependencyRemoved": {
            const payload = envelope.payload as {
                serviceId: string;
                dependencyId: string;
                timestamp: string;
            };
            return {
                type: "serviceDependencyRemoved",
                serviceId: payload.serviceId,
                dependencyId: payload.dependencyId,
                timestamp: toDate(payload.timestamp),
            };
        }
        default:
            return null;
    }
}

/** Number the merged replay + live stream so consumers can order it. */
function toSequencedObservable<TEvent extends object>(input: {
    replay$: Observable<TEvent>;
    live$: Observable<TEvent>;
}): Observable<StreamEventWithMeta<TEvent>> {
    let sequence = 0;
    const stream$ = concat(
        input.replay$.pipe(map((event) => ({ event, replayed: true }))),
        input.live$.pipe(map((event) => ({ event, replayed: false }))),
    ).pipe(
        map(({ event, replayed }) => {
            sequence += 1;
            return {
                ...event,
                sequence,
                replayed,
                emittedAt: new Date(),
            };
        }),
    );

    return stream$;
}

/** The stored services that match the query, replayed as `serviceCreated` events. */
function replayEvents(
    store: ServiceStoreShape,
    input: ServiceStreamQueryInput,
): Effect.Effect<ServiceStreamEvent[], Error, DatabasePort> {
    return Effect.gen(function* () {
        const list = yield* store.list({
            limit: input.replayLimit,
            offset: 0,
            filter: {
                ...(input.projectId ? { projectId: { value: input.projectId, operator: "eq" as const } } : {}),
                ...(input.serviceType ? { type: { value: input.serviceType, operator: "eq" as const } } : {}),
                ...(input.fuzzy ? { name: { value: input.fuzzy, operator: "ilike" as const } } : {}),
            },
            sortBy: "updatedAt",
            sortDirection: "desc",
        });

        let events = list.data
            .filter((service) => !input.serviceId || service.id === input.serviceId)
            .filter((service) => input.isActive === undefined || service.isActive === input.isActive)
            .map((service) => ({
                type: "serviceCreated" as const,
                serviceId: service.id,
                projectId: service.projectId,
                name: service.name,
                serviceType: service.type,
                isActive: service.isActive,
                timestamp: toDate(service.updatedAt),
            }));

        if (input.eventTypes && input.eventTypes.length > 0) {
            const accepted = new Set(input.eventTypes);
            events = events.filter((event) => accepted.has(event.type));
        }

        return events.slice(0, input.replayLimit);
    });
}

function toDate(value: string | Date): Date {
    return value instanceof Date ? value : new Date(value);
}

/** Map a core namespace definition to the stream query input it describes. */
export function toStreamQueryInput(
    definition: {
        scope: "global" | "tenant" | "project" | "service" | "deployment";
        scopeId: string | null;
        filters: Record<string, unknown> | null;
    },
    replay: boolean,
    replayLimit: number,
): ServiceStreamQueryInput {
    const filters = definition.filters ?? {};
    const scopedServiceId = definition.scope === "service" ? definition.scopeId ?? undefined : undefined;
    const scopedProjectId = definition.scope === "project" ? definition.scopeId ?? undefined : undefined;

    return {
        serviceId: typeof filters.serviceId === "string" ? filters.serviceId : scopedServiceId,
        projectId: typeof filters.projectId === "string" ? filters.projectId : scopedProjectId,
        serviceType: typeof filters.serviceType === "string" ? filters.serviceType as ServiceStreamQueryInput["serviceType"] : undefined,
        isActive: typeof filters.isActive === "boolean" ? filters.isActive : undefined,
        eventTypes: Array.isArray(filters.eventTypes)
            ? filters.eventTypes.filter((v): v is ServiceStreamEvent["type"] => typeof v === "string")
            : undefined,
        fuzzy: typeof filters.fuzzy === "string" ? filters.fuzzy : undefined,
        replay,
        replayLimit,
    };
}

/** The service use cases, composed as Effects over the store. */
export class ServiceServiceImpl {
    listServices(input: ServiceListInput = {} as ServiceListInput) {
        return Effect.gen(function* () {
            const services = yield* ServiceStore;
            return yield* services.list(input);
        });
    }

    getServiceById(id: string) {
        return loadServiceWithConfig(id);
    }

    createService(input: ServiceCreateInput, requesterId: string) {
        return Effect.gen(function* () {
            const services = yield* ServiceStore;
            const events = yield* ServiceEventService;

            yield* assertProjectAccess(input.projectId, requesterId, ["owner", "maintainer", "deployer"]);

            // Resolve runtime config constraints for the root service, and fill
            // default provider/runner configs when not provided. Children are
            // resolved recursively — each sub-service is a REAL service row.
            const createPayload = yield* resolveCreatePayload(input);

            const created = yield* services.create(createPayload);
            yield* events.emitEffect(
                "serviceCreated",
                { projectId: created.projectId },
                {
                    serviceId: created.id,
                    projectId: created.projectId,
                    name: created.name,
                    type: created.type,
                    isActive: created.isActive,
                    timestamp: new Date().toISOString(),
                },
            );
            return created;
        });
    }

    updateService(id: string, input: Omit<ServiceUpdateInput, 'id'>, requesterId: string) {
        return Effect.gen(function* () {
            const services = yield* ServiceStore;
            const events = yield* ServiceEventService;
            const configuration = yield* RuntimeConfigurationAccessor;

            const existing = yield* assertServiceAccess(id, requesterId, ["owner", "maintainer", "deployer"]);

            // Reparenting: a service cannot be moved under itself or under one of
            // its own descendants (would create a cycle in the hierarchy).
            if (input.parentId !== undefined && input.parentId !== null && input.parentId !== existing.parentId) {
                if (input.parentId === id) {
                    return yield* Effect.fail(
                        new BadRequestError("A service cannot be its own parent"),
                    );
                }
                const descendant = yield* isDescendant(id, input.parentId);
                if (descendant) {
                    return yield* Effect.fail(
                        new BadRequestError("A service cannot be moved under one of its own children"),
                    );
                }
                // Moving across projects is forbidden — children stay in the parent's project.
                const newParent = yield* loadServiceWithConfig(input.parentId);
                if (newParent.projectId !== existing.projectId) {
                    return yield* Effect.fail(
                        new BadRequestError("A sub-service must belong to the same project as its parent"),
                    );
                }
            }

            const resolvedRuntimeConfiguration = yield* guard(() =>
                configuration.resolveStrict({
                    scope: "service",
                    context: {
                        projectId: existing.projectId,
                        serviceId: existing.id,
                        requestedProviderType: input.providerId
                            ? mapProviderType(input.providerId)
                            : undefined,
                        requestedRunnerType: input.builderId
                            ? mapRunnerType(input.builderId)
                            : undefined,
                    },
                    service: configuration.serviceConfigFromRecord({
                        providerId: input.providerId ?? existing.providerId,
                        builderId: input.builderId ?? existing.builderId,
                        customDomains: input.customDomains ?? existing.customDomains,
                        environmentVariables: input.environmentVariables ?? existing.environmentVariables,
                        resourceLimits: input.resourceLimits
                            ? {
                                  memory: input.resourceLimits.memory ?? null,
                                  cpu: input.resourceLimits.cpu ?? null,
                              }
                            : (existing.resourceLimits as { memory?: string | null; cpu?: string | null } | null),
                    }),
                }),
            );

            if (!resolvedRuntimeConfiguration.effective.constraints.providerAllowed) {
                return yield* Effect.fail(
                    new BadRequestError("Configured provider is not allowed by runtime configuration"),
                );
            }

            if (!resolvedRuntimeConfiguration.effective.constraints.runnerAllowed) {
                return yield* Effect.fail(
                    new BadRequestError("Configured runner is not allowed by runtime configuration"),
                );
            }

            const updated = yield* services.update(id, input);
            if (!updated) {
                return yield* Effect.fail(new NotFoundError("Service", id));
            }

            const changedFields = Object.keys(input).filter(
                (key) => input[key as keyof typeof input] !== undefined,
            );
            yield* events.emitEffect(
                "serviceUpdated",
                { serviceId: id },
                {
                    serviceId: id,
                    projectId: updated.projectId,
                    changedFields,
                    timestamp: new Date().toISOString(),
                },
            );
            return updated;
        });
    }

    /** List the direct children (sub-services) of a service, with effective config. */
    listChildren(serviceId: string, requesterId: string) {
        return Effect.gen(function* () {
            const services = yield* ServiceStore;

            const service = yield* assertServiceAccess(serviceId, requesterId, ["owner", "maintainer", "deployer"]);
            const children = yield* services.listChildren(service.id);
            const ancestors = yield* services.findAncestors(service.id);
            // Each child inherits the parent's (already resolved) effective config,
            // then applies its own overrides.
            const parentEffective = foldServiceChain(ancestors, service);
            return {
                children: children.map((child) => ({
                    ...child,
                    effectiveConfig: mergeServiceConfig(parentEffective, child),
                })),
            };
        });
    }

    /**
     * Get the whole descendant subtree as a nested tree. Every node carries its
     * resolved `effectiveConfig` (ancestors' config folded down, node's own
     * overrides applied).
     */
    getSubtree(serviceId: string, requesterId: string) {
        return Effect.gen(function* () {
            const services = yield* ServiceStore;

            yield* assertServiceAccess(serviceId, requesterId, ["owner", "maintainer", "deployer"]);
            const subtree = yield* services.findWithSubtree(serviceId);
            if (!subtree) {
                return null;
            }

            // Ancestors ABOVE the root are not part of the subtree — fetch them
            // separately, then fold down the tree with a memo cache.
            const rootAncestors = yield* services.findAncestors(serviceId);
            const byId = new Map<string, SubtreeNode>();
            const collect = (node: SubtreeNode): void => {
                byId.set(node.id, node);
                node.children.forEach(collect);
            };
            collect(subtree);

            const cache = new Map<string, ServiceEffectiveConfig>();
            const resolveNode = (node: SubtreeNode): ServiceEffectiveConfig => {
                const cached = cache.get(node.id);
                if (cached) {
                    return cached;
                }
                let inherited = emptyEffectiveConfig();
                const parent = node.parentId ? byId.get(node.parentId) : undefined;
                if (parent) {
                    inherited = resolveNode(parent);
                } else {
                    // Node's parent is outside the subtree (or null) → fold the
                    // ancestors fetched above the root.
                    for (const ancestor of rootAncestors) {
                        inherited = mergeServiceConfig(inherited, ancestor);
                    }
                }
                const effective = mergeServiceConfig(inherited, node);
                cache.set(node.id, effective);
                return effective;
            };

            // Build a fresh, fully-typed tree where every node (including nested
            // children) carries its resolved `effectiveConfig`. This recursive
            // node type matches `serviceSubtreeNodeSchema` in the contract (each
            // level requires `effectiveConfig`), unlike `ServiceWithEffectiveConfig`
            // whose `children` are plain `Service[]`.
            type TypedSubtreeNode = Omit<ServiceWithEffectiveConfig, "children"> & {
                children?: TypedSubtreeNode[];
            };
            const toTyped = (node: SubtreeNode): TypedSubtreeNode => {
                const { children, ...rest } = node;
                return {
                    ...rest,
                    effectiveConfig: resolveNode(node),
                    children: children.length > 0 ? children.map(toTyped) : undefined,
                };
            };

            return toTyped(subtree);
        });
    }

    deleteService(id: string, requesterId: string) {
        return Effect.gen(function* () {
            const services = yield* ServiceStore;
            const events = yield* ServiceEventService;

            const existing = yield* assertServiceAccess(id, requesterId, ["owner", "maintainer"]);
            yield* services.delete(id);

            yield* events.emitEffect(
                "serviceDeleted",
                { serviceId: id },
                {
                    serviceId: id,
                    projectId: existing.projectId,
                    timestamp: new Date().toISOString(),
                },
            );
        });
    }

    toggleActive(id: string, isActive: boolean, requesterId: string) {
        return Effect.gen(function* () {
            const services = yield* ServiceStore;
            const events = yield* ServiceEventService;

            yield* assertServiceAccess(id, requesterId, ["owner", "maintainer", "deployer"]);
            const updated = yield* services.toggleActive(id, isActive);
            if (!updated) {
                return yield* Effect.fail(new NotFoundError("Service", id));
            }

            yield* events.emitEffect(
                "serviceActivationChanged",
                { serviceId: id },
                {
                    serviceId: id,
                    projectId: updated.projectId,
                    isActive: updated.isActive,
                    timestamp: new Date().toISOString(),
                },
            );
            return updated;
        });
    }

    /**
     * Namespace-aware dependency view. A service "is a namespace for
     * everything below it": the response contains the service's OWN dependency
     * edges PLUS a `subServices` tree — one node per sub-service, each with its
     * own dependencies (and recursively its own sub-services).
     */
    getDependencies(serviceId: string) {
        return Effect.gen(function* () {
            const services = yield* ServiceStore;

            yield* loadServiceWithConfig(serviceId);
            const dependencies = yield* services.getDependencies(serviceId);
            const subServices = yield* buildSubServiceDependenciesTree(serviceId);
            return { dependencies, subServices };
        });
    }

    /**
     * DRY-RUN preview topology — resolve how a preview of this service WOULD
     * link its dependencies (new instances, reused staging, mocks). Does NOT
     * deploy; the lifecycle engine consumes the same config later.
     */
    resolvePreviewTopology(
        serviceId: string,
        requesterId: string,
        input: { environment: "production" | "staging" | "preview" | "development"; pullRequestNumber?: number; branch?: string },
    ) {
        return Effect.gen(function* () {
            const topology = yield* PreviewTopologyService;

            const service = yield* assertServiceAccess(serviceId, requesterId, ["owner", "maintainer", "deployer"]);
            return yield* topology.resolve(service.id, {
                environment: input.environment,
                pullRequestNumber: input.pullRequestNumber,
                branch: input.branch,
            });
        });
    }

    addDependency(serviceId: string, dependsOnServiceId: string, isRequired: boolean, requesterId: string) {
        return Effect.gen(function* () {
            const services = yield* ServiceStore;
            const events = yield* ServiceEventService;

            if (serviceId === dependsOnServiceId) {
                return yield* Effect.fail(new BadRequestError("A service cannot depend on itself"));
            }

            const service = yield* assertServiceAccess(serviceId, requesterId, ["owner", "maintainer", "deployer"]);
            const dependsOnService = yield* loadServiceWithConfig(dependsOnServiceId);

            if (service.projectId !== dependsOnService.projectId) {
                return yield* Effect.fail(
                    new BadRequestError("Service dependencies must reference services in the same project"),
                );
            }

            const exists = yield* services.dependencyExists(serviceId, dependsOnServiceId);
            if (exists) {
                return yield* Effect.fail(new ConflictError("Dependency already exists"));
            }

            const introducesCycle = yield* wouldIntroduceDependencyCycle(serviceId, dependsOnServiceId);
            if (introducesCycle) {
                return yield* Effect.fail(
                    new BadRequestError("Dependency introduces a cycle in the service graph"),
                );
            }

            const created = yield* services.addDependency(serviceId, dependsOnServiceId, isRequired);
            yield* events.emitEffect(
                "serviceDependencyAdded",
                { serviceId },
                {
                    serviceId,
                    dependsOnServiceId,
                    isRequired,
                    timestamp: new Date().toISOString(),
                },
            );
            return created;
        });
    }

    removeDependency(serviceId: string, dependencyId: string, requesterId: string) {
        return Effect.gen(function* () {
            const services = yield* ServiceStore;
            const events = yield* ServiceEventService;

            yield* assertServiceAccess(serviceId, requesterId, ["owner", "maintainer", "deployer"]);
            yield* services.removeDependency(dependencyId, serviceId);

            yield* events.emitEffect(
                "serviceDependencyRemoved",
                { serviceId },
                {
                    serviceId,
                    dependencyId,
                    timestamp: new Date().toISOString(),
                },
            );
        });
    }

    /** The event stream. RxJS on the outside, Effect services on the inside. */
    streamQueryEvents(input: ServiceStreamQueryInput) {
        return Effect.gen(function* () {
            const store = yield* ServiceStore;
            const serviceEvents = yield* ServiceEventService;
            const coreEventSync = yield* CoreEventSync;
            const database = yield* DatabasePort;

            let query = coreEventSync.selectMany({
                // The port exposes the emitter surface; `selectMany` needs the
                // concrete service object for its type-level contract map. They are
                // the same Nest instance (`useExisting`), so the cast is identity.
                service: serviceEvents as unknown as ServiceEventServiceImpl,
                selections: [
                    { eventName: "serviceCreated" },
                    { eventName: "serviceUpdated" },
                    { eventName: "serviceDeleted" },
                    { eventName: "serviceActivationChanged" },
                    { eventName: "serviceDependencyAdded" },
                    { eventName: "serviceDependencyRemoved" },
                ] as const,
            });

            if (input.eventTypes && input.eventTypes.length > 0) {
                const accepted = new Set(input.eventTypes);
                query = query.whereEventName((eventName) => accepted.has(eventName));
            }

            if (input.serviceId) {
                query = query.wherePayload((payload) => {
                    const value = payload as { serviceId?: string };
                    return value.serviceId === input.serviceId;
                });
            }

            if (input.projectId) {
                query = query.wherePayload((payload) => {
                    const value = payload as { projectId?: string };
                    return value.projectId === input.projectId;
                });
            }

            if (input.serviceType) {
                query = query.wherePayload((payload) => {
                    const value = payload as { type?: string };
                    return value.type === input.serviceType;
                });
            }

            if (input.isActive !== undefined) {
                query = query.wherePayload((payload) => {
                    const value = payload as { isActive?: boolean };
                    return value.isActive === input.isActive;
                });
            }

            if (input.fuzzy) {
                query = query.whereFuzzy(input.fuzzy);
            }

            const live$ = query
                .execute()
                .pipe(
                    map((row) => toServiceStreamEvent(row.service)),
                    rxFilter((event): event is ServiceStreamEvent => event !== null),
                );

            const replay$ = input.replay
                ? defer(() =>
                        from(
                            Effect.runPromise(
                                Effect.provideService(replayEvents(store, input), DatabasePort, database),
                            ),
                        ),
                    ).pipe(mergeMap((events) => from(events)))
                : EMPTY;

            return toSequencedObservable({ replay$, live$ });
        });
    }

    /**
     * The same stream, shaped for the core event bus.
     *
     * Registered at boot by `ServiceEventAdapter`: the bus speaks
     * `{ eventName, payload }` envelopes and never sees a domain event.
     */
    streamCoreAdapter(
        definition: {
            scope: "global" | "tenant" | "project" | "service" | "deployment";
            scopeId: string | null;
            filters: Record<string, unknown> | null;
        },
        replay: boolean,
        replayLimit: number,
    ) {
        return this.streamQueryEvents(toStreamQueryInput(definition, replay, replayLimit)).pipe(
            Effect.map((source$) =>
                source$.pipe(
                    map((event) => ({
                        eventName: event.type,
                        payload: event,
                        replayed: event.replayed,
                        emittedAt: event.emittedAt.toISOString(),
                    })),
                ),
            ),
        );
    }
}

/** The service's public surface is exactly the implementation's methods. */
export type ServiceServiceShape = ServiceServiceImpl;

/** Effect key = NestJS token. */
export class ServiceService extends Context.Service<ServiceService, ServiceServiceShape>()(
    "project/ServiceService",
) {}
