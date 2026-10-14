import {
    Injectable,
    NotFoundException,
    ConflictException,
    BadRequestException,
} from "@nestjs/common";
import type { OnModuleInit } from "@nestjs/common";
import { EMPTY, type Observable, concat, defer, from, map, mergeMap } from "rxjs";
import { filter as rxFilter } from "rxjs/operators";
import { CoreEventSyncService } from "@/core/modules/events";
import { ProjectAccessService } from "@/core/modules/project/services/project-access.service";
import { RuntimeConfigurationAccessorService } from "@/core/modules/configuration/services/runtime-configuration-accessor.service";
import { ServiceRepository } from "../repositories/service.repository";
import { ServiceEventService } from "./service-event.service";
import { PreviewTopologyService } from "./preview-topology.service";
import { defaultProviderConfig, defaultRunnerConfig } from "./service-config-defaults";
import { emptyEffectiveConfig, foldServiceChain, mergeServiceConfig } from "./service-effective-config";
import type { ServiceEffectiveConfig, ServiceWithEffectiveConfig } from "@repo/contracts-entities";
import type { ServiceListInput } from "@repo/api-contracts/modules/service/list";
import type { ServiceCreateInput } from "@repo/api-contracts/modules/service/crud/create";
import type { ServiceUpdateInput } from "@repo/api-contracts/modules/service/crud/update";
import type { ProjectRole } from "@repo/auth";
import type {
    ServiceStreamEvent,
    ServiceStreamQueryInput,
} from "@repo/api-contracts/modules/service/streams/query";
import type {
    ConfigurationProviderType,
    ConfigurationRunnerType,
} from "@/core/modules/configuration/schemas/runtime-configuration.schema";
import type { ServiceProviderType, ServiceRunnerType } from "@repo/contracts-common";

type StreamEventWithMeta<T extends object> = T & {
    sequence: number;
    replayed: boolean;
    emittedAt: Date;
};

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


@Injectable()
export class ServiceService implements OnModuleInit {
    constructor(
        private readonly serviceRepository: ServiceRepository,
        private readonly serviceEventService: ServiceEventService,
        private readonly coreEventSyncService: CoreEventSyncService,
        private readonly projectAccessService: ProjectAccessService,
        private readonly previewTopologyService: PreviewTopologyService,
        private readonly runtimeConfigurationAccessor: RuntimeConfigurationAccessorService,
    ) {}

    onModuleInit(): void {
        this.coreEventSyncService.registerNamespaceAdapter("service", ({ definition, replay, replayLimit }) =>
            this.toCoreAdapterStream(definition, replay, replayLimit),
        );
    }

    private async assertProjectAccess(projectId: string, requesterId: string, allowedRoles: readonly ProjectRole[]) {
        return this.projectAccessService.assertProjectAccess(projectId, requesterId, allowedRoles);
    }

    private async assertServiceAccess(serviceId: string, requesterId: string, allowedRoles: readonly ProjectRole[]) {
        const service = await this.serviceRepository.findById(serviceId);
        if (!service) {
            throw new NotFoundException(`Service ${serviceId} not found`);
        }
        await this.assertProjectAccess(service.projectId, requesterId, allowedRoles);
        return service;
    }

    async listServices(input: ServiceListInput = {} as ServiceListInput) {
        return this.serviceRepository.list(input);
    }

    async getServiceById(id: string): Promise<ServiceWithEffectiveConfig> {
        const service = await this.serviceRepository.findById(id);
        if (!service) {
            throw new NotFoundException(`Service ${id} not found`);
        }
        const ancestors = await this.serviceRepository.findAncestors(id);
        return {
            ...service,
            effectiveConfig: foldServiceChain(ancestors, service),
        };
    }

    async createService(
        input: ServiceCreateInput,
        requesterId: string,
    ) {
        await this.assertProjectAccess(input.projectId, requesterId, ["owner", "maintainer", "deployer"]);

        // Resolve runtime config constraints for the root service, and fill
        // default provider/runner configs when not provided. Children are
        // resolved recursively — each sub-service is a REAL service row.
        const createPayload = await this.resolveCreatePayload(input);

        const created = await this.serviceRepository.create(createPayload);
        const timestamp = new Date().toISOString();
        this.serviceEventService.emit(
            "serviceCreated",
            { projectId: created.projectId },
            {
                serviceId: created.id,
                projectId: created.projectId,
                name: created.name,
                type: created.type,
                isActive: created.isActive,
                timestamp,
            },
        );
        return created;
    }

    /**
     * Recursively validate runtime-config constraints + fill default configs
     * for a service and its whole children tree before persisting.
     */
    private async resolveCreatePayload(input: ServiceCreateInput): Promise<ServiceCreateInput> {
        const resolvedRuntimeConfiguration = this.runtimeConfigurationAccessor.resolveStrict({
            scope: "project",
            context: {
                projectId: input.projectId,
                requestedProviderType: mapProviderType(input.providerId),
                requestedRunnerType: mapRunnerType(input.builderId),
            },
            project: {},
            service: this.runtimeConfigurationAccessor.serviceConfigFromRecord({
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
        });

        if (!resolvedRuntimeConfiguration.effective.constraints.providerAllowed) {
            throw new BadRequestException("Configured provider is not allowed by runtime configuration");
        }

        if (!resolvedRuntimeConfiguration.effective.constraints.runnerAllowed) {
            throw new BadRequestException("Configured runner is not allowed by runtime configuration");
        }

        const children = input.children?.length
            ? await Promise.all(input.children.map((child) => this.resolveCreatePayload(child)))
            : undefined;

        return {
            ...input,
            providerConfig: input.providerConfig ?? defaultProviderConfig(input.providerId),
            builderConfig: input.builderConfig ?? defaultRunnerConfig(input.builderId),
            children,
        };
    }

    async updateService(id: string, input: Omit<ServiceUpdateInput, 'id'>, requesterId: string) {
        const existing = await this.assertServiceAccess(id, requesterId, ["owner", "maintainer", "deployer"]);

        // Reparenting: a service cannot be moved under itself or under one of
        // its own descendants (would create a cycle in the hierarchy).
        if (input.parentId !== undefined && input.parentId !== null && input.parentId !== existing.parentId) {
            if (input.parentId === id) {
                throw new BadRequestException("A service cannot be its own parent");
            }
            const isDescendant = await this.isDescendant(id, input.parentId);
            if (isDescendant) {
                throw new BadRequestException("A service cannot be moved under one of its own children");
            }
            // Moving across projects is forbidden — children stay in the parent's project.
            const newParent = await this.getServiceById(input.parentId);
            if (newParent.projectId !== existing.projectId) {
                throw new BadRequestException("A sub-service must belong to the same project as its parent");
            }
        }

        const resolvedRuntimeConfiguration = this.runtimeConfigurationAccessor.resolveStrict({
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
            service: this.runtimeConfigurationAccessor.serviceConfigFromRecord({
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
        });

        if (!resolvedRuntimeConfiguration.effective.constraints.providerAllowed) {
            throw new BadRequestException("Configured provider is not allowed by runtime configuration");
        }

        if (!resolvedRuntimeConfiguration.effective.constraints.runnerAllowed) {
            throw new BadRequestException("Configured runner is not allowed by runtime configuration");
        }

        const updated = await this.serviceRepository.update(id, input);
        if (!updated) {
            throw new NotFoundException(`Service ${id} not found`);
        }

        const changedFields = Object.keys(input).filter(
            (key) => input[key as keyof typeof input] !== undefined,
        );
        this.serviceEventService.emit(
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
    }

    /** Is `candidateId` a descendant of `ancestorId`? (walk up parent links) */
    private async isDescendant(ancestorId: string, candidateId: string): Promise<boolean> {
        let currentId: string | null = candidateId;
        const visited = new Set<string>();
        while (currentId) {
            if (currentId === ancestorId) {
                return true;
            }
            if (visited.has(currentId)) {
                return false;
            }
            visited.add(currentId);
            const current = await this.serviceRepository.findById(currentId);
            currentId = current?.parentId ?? null;
        }
        return false;
    }

    /** List the direct children (sub-services) of a service, with effective config. */
    async listChildren(serviceId: string, requesterId: string) {
        const service = await this.assertServiceAccess(serviceId, requesterId, ["owner", "maintainer", "deployer"]);
        const children = await this.serviceRepository.listChildren(service.id);
        const ancestors = await this.serviceRepository.findAncestors(service.id);
        // Each child inherits the parent's (already resolved) effective config,
        // then applies its own overrides.
        const parentEffective = foldServiceChain(ancestors, service);
        return {
            children: children.map((child) => ({
                ...child,
                effectiveConfig: mergeServiceConfig(parentEffective, child),
            })),
        };
    }

    /**
     * Get the whole descendant subtree as a nested tree. Every node carries its
     * resolved `effectiveConfig` (ancestors' config folded down, node's own
     * overrides applied).
     */
    async getSubtree(serviceId: string, requesterId: string) {
        await this.assertServiceAccess(serviceId, requesterId, ["owner", "maintainer", "deployer"]);
        const subtree = await this.serviceRepository.findWithSubtree(serviceId);
        if (!subtree) {
            return null;
        }

        // Ancestors ABOVE the root are not part of the subtree — fetch them
        // separately, then fold down the tree with a memo cache.
        const rootAncestors = await this.serviceRepository.findAncestors(serviceId);
        type IncomingNode = NonNullable<Awaited<ReturnType<ServiceRepository["findWithSubtree"]>>>;
        const byId = new Map<string, IncomingNode>();
        const collect = (node: IncomingNode): void => {
            byId.set(node.id, node);
            node.children.forEach(collect);
        };
        collect(subtree);

        const cache = new Map<string, ServiceEffectiveConfig>();
        const resolveNode = (node: IncomingNode): ServiceEffectiveConfig => {
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
        type SubtreeNode = Omit<ServiceWithEffectiveConfig, "children"> & {
            children?: SubtreeNode[];
        };
        const toTyped = (node: IncomingNode): SubtreeNode => {
            const { children, ...rest } = node;
            return {
                ...rest,
                effectiveConfig: resolveNode(node),
                children: children.length > 0 ? children.map(toTyped) : undefined,
            };
        };

        return toTyped(subtree);
    }

    async deleteService(id: string, requesterId: string) {
        const existing = await this.assertServiceAccess(id, requesterId, ["owner", "maintainer"]);
        await this.serviceRepository.delete(id);

        this.serviceEventService.emit(
            "serviceDeleted",
            { serviceId: id },
            {
                serviceId: id,
                projectId: existing.projectId,
                timestamp: new Date().toISOString(),
            },
        );
    }

    async toggleActive(id: string, isActive: boolean, requesterId: string) {
        await this.assertServiceAccess(id, requesterId, ["owner", "maintainer", "deployer"]);
        const updated = await this.serviceRepository.toggleActive(id, isActive);
        if (!updated) {
            throw new NotFoundException(`Service ${id} not found`);
        }

        this.serviceEventService.emit(
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
    }

    /**
     * Namespace-aware dependency view. A service "is a namespace for
     * everything below it": the response contains the service's OWN dependency
     * edges PLUS a `subServices` tree — one node per sub-service, each with its
     * own dependencies (and recursively its own sub-services).
     */
    async getDependencies(serviceId: string) {
        await this.getServiceById(serviceId);
        const dependencies = await this.serviceRepository.getDependencies(serviceId);
        const subServices = await this.buildSubServiceDependenciesTree(serviceId);
        return { dependencies, subServices };
    }

    /**
     * DRY-RUN preview topology — resolve how a preview of this service WOULD
     * link its dependencies (new instances, reused staging, mocks). Does NOT
     * deploy; the lifecycle engine consumes the same config later.
     */
    async resolvePreviewTopology(
        serviceId: string,
        requesterId: string,
        input: { environment: "production" | "staging" | "preview" | "development"; pullRequestNumber?: number; branch?: string },
    ) {
        const service = await this.assertServiceAccess(serviceId, requesterId, ["owner", "maintainer", "deployer"]);
        return this.previewTopologyService.resolve(service.id, {
            environment: input.environment,
            pullRequestNumber: input.pullRequestNumber,
            branch: input.branch,
        });
    }

    private async buildSubServiceDependenciesTree(parentId: string) {
        type Dependency = Awaited<ReturnType<ServiceRepository["getDependencies"]>>[number];
        type SubServiceNode = {
            serviceId: string;
            serviceName: string;
            serviceType: string;
            dependencies: Dependency[];
            children?: SubServiceNode[];
        };
        const children = await this.serviceRepository.listChildren(parentId);
        const nodes: SubServiceNode[] = [];
        for (const child of children) {
            const dependencies = await this.serviceRepository.getDependencies(child.id);
            const grandchildren = await this.buildSubServiceDependenciesTree(child.id);
            nodes.push({
                serviceId: child.id,
                serviceName: child.name,
                serviceType: child.type,
                dependencies,
                ...(grandchildren.length > 0 ? { children: grandchildren } : {}),
            });
        }
        return nodes;
    }

    private async wouldIntroduceDependencyCycle(
        serviceId: string,
        dependsOnServiceId: string,
    ): Promise<boolean> {
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

            const dependencies = await this.serviceRepository.getDependencies(currentServiceId);
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
    }

    async addDependency(serviceId: string, dependsOnServiceId: string, isRequired: boolean, requesterId: string) {
        if (serviceId === dependsOnServiceId) {
            throw new BadRequestException("A service cannot depend on itself");
        }

        const service = await this.assertServiceAccess(serviceId, requesterId, ["owner", "maintainer", "deployer"]);
        const dependsOnService = await this.getServiceById(dependsOnServiceId);

        if (service.projectId !== dependsOnService.projectId) {
            throw new BadRequestException("Service dependencies must reference services in the same project");
        }

        const exists = await this.serviceRepository.dependencyExists(serviceId, dependsOnServiceId);
        if (exists) {
            throw new ConflictException("Dependency already exists");
        }

        const introducesCycle = await this.wouldIntroduceDependencyCycle(serviceId, dependsOnServiceId);
        if (introducesCycle) {
            throw new BadRequestException("Dependency introduces a cycle in the service graph");
        }

        const created = await this.serviceRepository.addDependency(serviceId, dependsOnServiceId, isRequired);
        this.serviceEventService.emit(
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
    }

    async removeDependency(serviceId: string, dependencyId: string, requesterId: string) {
        await this.assertServiceAccess(serviceId, requesterId, ["owner", "maintainer", "deployer"]);
        await this.serviceRepository.removeDependency(dependencyId, serviceId);

        this.serviceEventService.emit(
            "serviceDependencyRemoved",
            { serviceId },
            {
                serviceId,
                dependencyId,
                timestamp: new Date().toISOString(),
            },
        );
    }

    streamQueryEvents(input: ServiceStreamQueryInput): Observable<StreamEventWithMeta<ServiceStreamEvent>> {
        let query = this.coreEventSyncService.selectMany({
            service: this.serviceEventService,
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
                map((row) => this.toServiceStreamEvent(row.service)),
                rxFilter((event): event is ServiceStreamEvent => event !== null),
            );

        return this.toSequencedObservable({
            replay$: input.replay
                ? defer(() => from(this.getReplayEvents(input))).pipe(mergeMap((events) => from(events)))
                : EMPTY,
            live$,
        });
    }

    private async getReplayEvents(input: ServiceStreamQueryInput): Promise<ServiceStreamEvent[]> {
        const list = await this.serviceRepository.list({
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
                timestamp: this.toDate(service.updatedAt),
            }));

        if (input.eventTypes && input.eventTypes.length > 0) {
            const accepted = new Set(input.eventTypes);
            events = events.filter((event) => accepted.has(event.type));
        }

        return events.slice(0, input.replayLimit);
    }

    private toServiceStreamEvent(
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
                    timestamp: this.toDate(payload.timestamp),
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
                    timestamp: this.toDate(payload.timestamp),
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
                    timestamp: this.toDate(payload.timestamp),
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
                    timestamp: this.toDate(payload.timestamp),
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
                    timestamp: this.toDate(payload.timestamp),
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
                    timestamp: this.toDate(payload.timestamp),
                };
            }
            default:
                return null;
        }
    }

    private toSequencedObservable<TEvent extends object>(input: {
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

    private toCoreAdapterStream(
        definition: {
            scope: "global" | "tenant" | "project" | "service" | "deployment";
            scopeId: string | null;
            filters: Record<string, unknown> | null;
        },
        replay: boolean,
        replayLimit: number,
    ): Observable<{ eventName: string; payload: unknown; replayed?: boolean; emittedAt?: string }> {
        const filters = definition.filters ?? {};
        const scopedServiceId = definition.scope === "service" ? definition.scopeId ?? undefined : undefined;
        const scopedProjectId = definition.scope === "project" ? definition.scopeId ?? undefined : undefined;

        const source$ = this.streamQueryEvents({
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
        });

        return source$.pipe(
            map((event) => ({
                eventName: event.type,
                payload: event,
                replayed: event.replayed,
                emittedAt: event.emittedAt.toISOString(),
            })),
        );
    }

    private toDate(value: string | Date): Date {
        return value instanceof Date ? value : new Date(value);
    }
}
