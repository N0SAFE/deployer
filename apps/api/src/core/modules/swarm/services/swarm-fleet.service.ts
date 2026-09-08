/**
 * SwarmFleetService — mesh-wide fleet aggregation for the `cluster` contract.
 *
 * Answers the live workload surface of the Swarm fleet:
 *   - `listServices()`  — every swarm service (mode global/replicated,
 *     desired vs running task counts) — services are cluster objects.
 *   - `listTasks(filter)` — swarm tasks, optionally filtered by service or
 *     node — tasks carry the scheduling slot and node.
 *   - `getNodeResources(nodeId)` — per-node aggregation: the services &
 *     tasks scheduled on that node plus, ONLY when the queried node is the
 *     engine this API answers for (`dockerScope: 'local'`), the node's own
 *     docker artifacts (images/networks/volumes via the local socket).
 *
 * Everything is dockerode SDK + canonical `entities/swarm` runtime schemas —
 * no raw engine shapes leak past this boundary, and no re-declared schemas.
 */

import { Injectable, Logger } from "@nestjs/common";
import {
    swarmNodeResourcesSchema,
    swarmServiceRuntimeSchema,
    swarmTaskRuntimeSchema,
    type DockerodeServiceSummary,
    type DockerodeTaskSummary,
    type SwarmNodeResources,
    type SwarmServiceRuntime,
    type SwarmTaskRuntime,
} from "@repo/contracts-entities";
import { DockerService } from "@/core/modules/docker/services/docker.service";

@Injectable()
export class SwarmFleetService {
    private readonly logger = new Logger(SwarmFleetService.name);

    constructor(private readonly dockerService: DockerService) {}

    /** All swarm services with desired/running task counts. */
    async listServices(): Promise<SwarmServiceRuntime[]> {
        const [services, tasks] = await Promise.all([
            this.dockerService.listSwarmServices(),
            this.dockerService.listAllSwarmTasks().catch(() => []),
        ]);

        return services.map((service) => this.toServiceRuntime(service, tasks));
    }

    /**
     * Swarm tasks, filtered by `serviceId` and/or `nodeId` (swarm NodeID).
     */
    async listTasks(filter: { serviceId?: string; nodeId?: string } = {}): Promise<SwarmTaskRuntime[]> {
        const [tasks, services] = await Promise.all([
            this.dockerService.listAllSwarmTasks({
                serviceId: filter.serviceId,
                nodeId: filter.nodeId,
            }),
            this.dockerService.listSwarmServices(),
        ]);

        const nameById = new Map(services.map((s) => [s.ID, s.Spec.Name]));
        const imageById = new Map(
            services.map((s) => [s.ID, s.Spec.TaskTemplate?.ContainerSpec?.Image ?? ""]),
        );

        return tasks.map((task) =>
            swarmTaskRuntimeSchema.parse({
                id: task.ID,
                serviceId: task.ServiceID,
                nodeId: task.NodeID ?? null,
                slot: task.Slot ?? null,
                state: task.Status?.State ?? "",
                desiredState: task.DesiredState,
                error: task.Status?.Err ?? null,
                containerId: task.Status?.ContainerStatus?.ContainerID ?? null,
                updatedAt: task.Status?.Timestamp ?? "",
                serviceName: nameById.get(task.ServiceID) ?? "",
                image: imageById.get(task.ServiceID) ?? "",
            }),
        );
    }

    /**
     * Per-node resource aggregation. Services scheduled on the node are the
     * global services (run everywhere) plus replicated services that own at
     * least one task on this node (derived from task placement).
     */
    async getNodeResources(nodeId: string): Promise<SwarmNodeResources> {
        const [info, services, tasks] = await Promise.all([
            this.dockerService.getSwarmInfo(),
            this.dockerService.listSwarmServices(),
            this.dockerService.listAllSwarmTasks({ nodeId }),
        ]);

        // The API answers for ONE engine: the "connected node". Any node
        // other than that can only see swarm-visible data (services/tasks) —
        // its private images/networks/volumes are not reachable via this node.
        const isLocal = info.NodeID === nodeId;

        // Task summaries for this node.
        const taskRuntimes = tasks.map((task) => {
            const svc = services.find((s) => s.ID === task.ServiceID);
            return swarmTaskRuntimeSchema.parse({
                id: task.ID,
                serviceId: task.ServiceID,
                nodeId: task.NodeID ?? null,
                slot: task.Slot ?? null,
                state: task.Status?.State ?? "",
                desiredState: task.DesiredState,
                error: task.Status?.Err ?? null,
                containerId: task.Status?.ContainerStatus?.ContainerID ?? null,
                updatedAt: task.Status?.Timestamp ?? "",
                serviceName: svc?.Spec.Name ?? "",
                image: svc?.Spec.TaskTemplate?.ContainerSpec?.Image ?? "",
            });
        });

        const taskServiceIds = new Set(tasks.map((t) => t.ServiceID));
        const serviceRuntimes = services
            .filter((s) => {
                const mode = s.Spec.Mode;
                const isGlobal = Boolean(mode?.Global);
                return isGlobal || taskServiceIds.has(s.ID);
            })
            .map((s) => this.toServiceRuntime(s, tasks));

        const base = {
            nodeId,
            dockerScope: isLocal ? "local" : "remote",
            services: serviceRuntimes,
            tasks: taskRuntimes,
        };

        if (!isLocal) {
            return swarmNodeResourcesSchema.parse({
                ...base,
                images: [],
                networks: [],
                volumes: [],
            });
        }

        const [images, networks, volumes] = await Promise.all([
            this.dockerService.listEngineImages().catch(() => []),
            this.dockerService.listEngineNetworks().catch(() => []),
            this.dockerService.listEngineVolumes().catch(() => []),
        ]);

        return swarmNodeResourcesSchema.parse({
            ...base,
            images: images.map((img) => ({
                id: img.Id,
                repoTags: img.RepoTags,
                sizeBytes: img.Size ?? null,
            })),
            networks: networks.map((net) => ({
                id: net.Id,
                name: net.Name,
                driver: net.Driver ?? "",
                scope: net.Scope ?? "",
            })),
            volumes: volumes.map((vol) => ({
                name: vol.Name,
                driver: vol.Driver ?? "",
                mountpoint: vol.Mountpoint ?? "",
            })),
        });
    }

    /** Map a raw engine service + cluster-wide tasks to the runtime view. */
    private toServiceRuntime(
        service: DockerodeServiceSummary,
        tasks: DockerodeTaskSummary[],
    ): SwarmServiceRuntime {
        const spec = service.Spec;
        const mode = spec.Mode;
        const isGlobal = Boolean(mode?.Global);
        const replicas = isGlobal ? null : (mode?.Replicated?.Replicas ?? 0);

        const serviceTasks = tasks.filter((t) => t.ServiceID === service.ID);
        const runningTasks = serviceTasks.filter(
            (t) => t.Status?.State === "running",
        ).length;

        // Global = one task per eligible node; terminal bookkeeping states
        // (shutdown/remove) are not "desired" work.
        const desiredTasks = isGlobal
            ? serviceTasks.filter(
                  (t) => t.DesiredState !== "shutdown" && t.DesiredState !== "remove",
              ).length
            : (replicas ?? 0);

        return swarmServiceRuntimeSchema.parse({
            id: service.ID,
            name: spec.Name,
            versionIndex: service.Version?.Index ?? 0,
            image: spec.TaskTemplate?.ContainerSpec?.Image ?? "",
            labels: spec.Labels ?? {},
            replicas,
            networks: spec.TaskTemplate?.Networks?.map((n) => n.Target ?? "") ?? [],
            updateStatus: service.UpdateStatus
                ? {
                      state: service.UpdateStatus.State ?? "",
                      startedAt: service.UpdateStatus.StartedAt ?? null,
                      message: service.UpdateStatus.Message ?? null,
                  }
                : null,
            createdAt: service.CreatedAt ?? "",
            updatedAt: service.UpdatedAt ?? "",
            mode: isGlobal ? "global" : "replicated",
            desiredTasks,
            runningTasks,
        });
    }
}