/**
 * SwarmFleetService spec — fleet aggregation (services/tasks/node resources).
 */

import { describe, expect, it, vi } from "vitest";
import type {
    DockerodeServiceSummary,
    DockerodeTaskSummary,
    DockerodeSwarmInfo,
    DockerodeImageSummary,
    DockerodeNetworkSummary,
} from "@repo/contracts-entities";
import { DockerService } from "@/core/modules/docker/services/docker.service";
import { SwarmFleetService } from "./swarm-fleet.service";

type ServiceTaskTemplate = NonNullable<DockerodeServiceSummary["Spec"]["TaskTemplate"]>;

type ServiceSummaryOverrides = {
    ID?: string;
    Spec?: {
        Name?: string;
        Labels?: Record<string, string>;
        Mode?: DockerodeServiceSummary["Spec"]["Mode"];
        TaskTemplate?: {
            ContainerSpec?: { Image?: string; Labels?: Record<string, string> };
            Networks?: ServiceTaskTemplate["Networks"];
        };
    };
    UpdateStatus?: DockerodeServiceSummary["UpdateStatus"];
};

function serviceSummary(overrides: ServiceSummaryOverrides = {}): DockerodeServiceSummary {
    const specOverride = overrides.Spec ?? {};
    const containerOverride = specOverride.TaskTemplate?.ContainerSpec;

    return {
        ID: overrides.ID ?? "svc-1",
        Version: { Index: 3 },
        CreatedAt: "2026-01-01T00:00:00Z",
        UpdatedAt: "2026-01-01T00:00:01Z",
        Spec: {
            Name: specOverride.Name ?? "api",
            Labels: specOverride.Labels ?? { "deployer.managed": "true" },
            TaskTemplate: {
                ContainerSpec: {
                    Image: containerOverride?.Image ?? "nginx:1.25",
                    Labels: containerOverride?.Labels ?? {},
                },
                Networks: specOverride.TaskTemplate?.Networks,
            },
            Mode: specOverride.Mode ?? { Replicated: { Replicas: 2 } },
        },
        UpdateStatus: overrides.UpdateStatus,
        Endpoint: { VirtualIPs: [] },
    };
}

type TaskSummaryOverrides = {
    ID?: string;
    ServiceID?: string;
    NodeID?: string | null;
    Slot?: number | null;
    DesiredState?: string;
    Status?: DockerodeTaskSummary["Status"];
};

function taskSummary(overrides: TaskSummaryOverrides = {}): DockerodeTaskSummary {
    const status = overrides.Status;

    return {
        ID: overrides.ID ?? "task-1",
        Version: { Index: 1 },
        ServiceID: overrides.ServiceID ?? "svc-1",
        NodeID: overrides.NodeID ?? "node-1",
        Slot: overrides.Slot ?? 1,
        DesiredState: overrides.DesiredState ?? "running",
        Status: {
            State: status?.State ?? "running",
            Err: status?.Err,
            Timestamp: status?.Timestamp ?? "2026-01-01T00:00:00Z",
            ContainerStatus: status?.ContainerStatus ?? { ContainerID: "abc123" },
        },
    };
}

const services: DockerodeServiceSummary[] = [
    serviceSummary({ ID: "svc-1", Spec: { Name: "api", Mode: { Replicated: { Replicas: 2 } } } }),
    serviceSummary({
        ID: "svc-2",
        Spec: {
            Name: "scanner",
            Mode: { Global: {} },
            TaskTemplate: { ContainerSpec: { Image: "alpine:3.19" } },
        },
    }),
];

const tasks: DockerodeTaskSummary[] = [
    // api · replicated — one task on node-1 (running), one on node-2 (running)
    taskSummary({ ID: "t1", ServiceID: "svc-1", NodeID: "node-1", Slot: 1 }),
    taskSummary({ ID: "t2", ServiceID: "svc-1", NodeID: "node-2", Slot: 2 }),
    // scanner · global — one task on each node
    taskSummary({ ID: "t3", ServiceID: "svc-2", NodeID: "node-1", Slot: 1 }),
    taskSummary({ ID: "t4", ServiceID: "svc-2", NodeID: "node-2", Slot: 2 }),
];

const swarmInfo: DockerodeSwarmInfo = {
    NodeID: "node-1",
    NodeAddr: "10.0.0.1",
    LocalNodeState: "active",
    ControlAvailable: true,
    Error: "",
    RemoteManagers: [{ NodeID: "node-1", Addr: "10.0.0.1" }],
    Nodes: 2,
    Managers: 2,
};

function makeService(docker: Partial<DockerService> = {}) {
    const dockerService = {
        listSwarmServices: vi.fn().mockResolvedValue(services),
        listAllSwarmTasks: vi.fn().mockImplementation(
            async (filter?: { serviceId?: string; nodeId?: string }) => {
                const f = filter ?? {};
                return tasks.filter(
                    (task) =>
                        (f.serviceId ? task.ServiceID === f.serviceId : true)
                        && (f.nodeId ? task.NodeID === f.nodeId : true),
                );
            },
        ),
        getSwarmInfo: vi.fn().mockResolvedValue(swarmInfo),
        listEngineImages: vi.fn().mockResolvedValue([
            { Id: "img-1", RepoTags: ["nginx:1.25"], Size: 1234 },
        ] as DockerodeImageSummary[]),
        listEngineNetworks: vi.fn().mockResolvedValue([
            { Id: "net-1", Name: "overlay", Driver: "overlay", Scope: "swarm" },
        ] as DockerodeNetworkSummary[]),
        listEngineVolumes: vi.fn().mockResolvedValue([
            { Name: "vol-1", Driver: "local", Mountpoint: "/var/lib/docker/volumes/vol-1" },
        ]),
        ...docker,
    } as unknown as DockerService;
    return new SwarmFleetService(dockerService);
}

describe("SwarmFleetService", () => {
    it("lists services with mode, replicas and task counts", async () => {
        const service = makeService();
        const result = await service.listServices();

        expect(result).toHaveLength(2);

        const api = result.find((s) => s.name === "api");
        expect(api?.mode).toBe("replicated");
        expect(api?.replicas).toBe(2);
        expect(api?.desiredTasks).toBe(2);
        expect(api?.runningTasks).toBe(2);

        const scanner = result.find((s) => s.name === "scanner");
        expect(scanner?.mode).toBe("global");
        expect(scanner?.replicas).toBeNull();
        expect(scanner?.desiredTasks).toBe(2);
        expect(scanner?.runningTasks).toBe(2);
    });

    it("filters tasks by serviceId", async () => {
        const service = makeService();
        const result = await service.listTasks({ serviceId: "svc-1" });

        expect(result).toHaveLength(2);
        expect(result.every((t) => t.serviceId === "svc-1")).toBe(true);
        expect(result.every((t) => t.serviceName === "api")).toBe(true);
    });

    it("filters tasks by nodeId", async () => {
        const service = makeService();
        const result = await service.listTasks({ nodeId: "node-1" });

        expect(result).toHaveLength(2);
        expect(result.every((t) => t.nodeId === "node-1")).toBe(true);
    });

    it("aggregates node resources for the LOCAL node with docker artifacts", async () => {
        const service = makeService();
        const result = await service.getNodeResources("node-1");

        expect(result.nodeId).toBe("node-1");
        expect(result.dockerScope).toBe("local");

        // scanner is global → runs on node-1; api has one task on node-1.
        expect(result.services.map((s) => s.name).sort()).toEqual(["api", "scanner"]);
        expect(result.tasks).toHaveLength(2);
        expect(result.images).toEqual([{ id: "img-1", repoTags: ["nginx:1.25"], sizeBytes: 1234 }]);
        expect(result.networks).toEqual([{ id: "net-1", name: "overlay", driver: "overlay", scope: "swarm" }]);
        expect(result.volumes).toEqual([{ name: "vol-1", driver: "local", mountpoint: "/var/lib/docker/volumes/vol-1" }]);
    });

    it("aggregates node resources for a REMOTE node without docker artifacts", async () => {
        const service = makeService();
        const result = await service.getNodeResources("node-2");

        expect(result.nodeId).toBe("node-2");
        expect(result.dockerScope).toBe("remote");
        expect(result.images).toEqual([]);
        expect(result.networks).toEqual([]);
        expect(result.volumes).toEqual([]);
        // node-1 is the connected engine, node-2 is remote → services from swarm only
        expect(result.services.map((s) => s.name).sort()).toEqual(["api", "scanner"]);
        expect(result.tasks).toHaveLength(2);
    });

    it("propagates engine failures as empty docker artifact lists", async () => {
        const service = makeService({
            listEngineImages: vi.fn().mockRejectedValue(new Error("engine down")),
        });
        const result = await service.getNodeResources("node-1");
        expect(result.dockerScope).toBe("local");
        expect(result.images).toEqual([]);
    });
});