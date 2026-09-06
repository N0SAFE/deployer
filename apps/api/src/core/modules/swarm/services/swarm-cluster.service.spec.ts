import { describe, expect, it, vi } from "vitest";
import type { DockerodeSwarmInfo } from "@repo/contracts-entities";
import { DockerService } from "@/core/modules/docker/services/docker.service";
import { SwarmClusterService } from "./swarm-cluster.service";

const inactiveInfo: DockerodeSwarmInfo = {
    NodeID: "",
    NodeAddr: "",
    LocalNodeState: "inactive",
    ControlAvailable: false,
    Error: "",
    RemoteManagers: null,
    Nodes: 0,
    Managers: 0,
};

describe("SwarmClusterService.getLocalClusterSnapshot", () => {
    it("short-circuits on a NON-active engine — never probes swarmInspect/node list (503 fix)", async () => {
        const dockerService = {
            getSwarmInfo: vi.fn().mockResolvedValue(inactiveInfo),
            swarmInspect: vi.fn(),
            listSwarmNodes: vi.fn(),
        } as unknown as DockerService;

        const service = new SwarmClusterService(dockerService);

        const snapshot = await service.getLocalClusterSnapshot();

        expect(snapshot.localNodeState).toBe("inactive");
        expect(snapshot.nodeCount).toBe(0);
        expect(snapshot.managerCount).toBe(0);
        expect(snapshot.master).toBeNull();
        expect(snapshot.localNode.swarmRole).toBe("none");
        // The 503-throwing probes must NEVER be called on an inactive engine.
        expect(dockerService.swarmInspect).not.toHaveBeenCalled();
        expect(dockerService.listSwarmNodes).not.toHaveBeenCalled();
    });

    it("probes cluster state when the engine IS active", async () => {
        const dockerService = {
            getSwarmInfo: vi.fn().mockResolvedValue({
                ...inactiveInfo,
                NodeID: "node-1",
                LocalNodeState: "active",
                Nodes: 2,
                Managers: 2,
            }),
            swarmInspect: vi.fn().mockResolvedValue({
                ID: "cluster-1",
                Spec: { Name: "prod" },
                JoinTokens: { Worker: "w", Manager: "m" },
            }),
            listSwarmNodes: vi.fn().mockResolvedValue([
                {
                    ID: "node-1",
                    Version: { Index: 1 },
                    Spec: { Name: "n1", Labels: {}, Role: "manager", Availability: "active" },
                    Description: { Hostname: "h1" },
                    ManagerStatus: { Leader: true, Reachability: "reachable" },
                },
                {
                    ID: "node-2",
                    Version: { Index: 1 },
                    Spec: { Name: "n2", Labels: {}, Role: "worker", Availability: "active" },
                    Description: { Hostname: "h2" },
                    ManagerStatus: null,
                },
            ]),
        } as unknown as DockerService;

        const service = new SwarmClusterService(dockerService);
        const snapshot = await service.getLocalClusterSnapshot();

        expect(dockerService.swarmInspect).toHaveBeenCalledTimes(1);
        expect(dockerService.listSwarmNodes).toHaveBeenCalledTimes(1);
        expect(snapshot.nodeCount).toBe(2);
        expect(snapshot.managerCount).toBe(2);
        expect(snapshot.localNode.swarmRole).toBe("manager");
        expect(snapshot.master?.nodeId).toBe("node-1");
        expect(snapshot.joinTokens).toEqual({ worker: "w", manager: "m" });
    });
});