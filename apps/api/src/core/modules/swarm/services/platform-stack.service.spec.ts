import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { EnvService } from "@/config/env/env.service";
import { DockerService } from "@/core/modules/docker/services/docker.service";
import { SwarmClusterService } from "./swarm-cluster.service";
import { PlatformStackService, PLATFORM_OVERLAY_NETWORK, PLATFORM_TRAEFIK_SERVICE } from "./platform-stack.service";

const activeSnapshot = {
    localNodeState: "active",
    nodeCount: 1,
    managerCount: 1,
    localNode: { nodeId: "n1", swarmRole: "manager" },
} as never;

describe("PlatformStackService", () => {
    let service: PlatformStackService;
    let dockerService: {
        ensureOverlayNetwork: ReturnType<typeof vi.fn>;
        inspectSwarmService: ReturnType<typeof vi.fn>;
        createSwarmService: ReturnType<typeof vi.fn>;
        updateSwarmService: ReturnType<typeof vi.fn>;
    };
    let clusterService: { getLocalClusterSnapshot: ReturnType<typeof vi.fn> };
    let envService: { get: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        dockerService = {
            ensureOverlayNetwork: vi.fn().mockResolvedValue(undefined),
            inspectSwarmService: vi.fn().mockRejectedValue(new NotFoundException("not found")),
            createSwarmService: vi.fn().mockResolvedValue({ ID: "svc-1" }),
            updateSwarmService: vi.fn().mockResolvedValue({ ID: "svc-1" }),
        };
        clusterService = { getLocalClusterSnapshot: vi.fn().mockResolvedValue(activeSnapshot) };
        envService = {
            get: vi.fn((key: string) => {
                if (key === "SWARM_PLATFORM_STACK") return true;
                if (key === "MANAGED_TRAEFIK_IMAGE") return "traefik:v3.3";
                return undefined;
            }),
        };
        service = new PlatformStackService(
            dockerService as unknown as DockerService,
            clusterService as unknown as SwarmClusterService,
            envService as unknown as EnvService,
        );
    });

    it("is a no-op when the engine is not in an active cluster", async () => {
        clusterService.getLocalClusterSnapshot.mockResolvedValue({ localNodeState: "inactive" } as never);

        await service.ensurePlatformStack();

        expect(dockerService.ensureOverlayNetwork).not.toHaveBeenCalled();
        expect(dockerService.createSwarmService).not.toHaveBeenCalled();
    });

    it("is a no-op when SWARM_PLATFORM_STACK is disabled", async () => {
        envService.get.mockImplementation((key: string) =>
            key === "SWARM_PLATFORM_STACK" ? false : undefined,
        );

        await service.ensurePlatformStack();

        expect(clusterService.getLocalClusterSnapshot).not.toHaveBeenCalled();
        expect(dockerService.createSwarmService).not.toHaveBeenCalled();
    });

    it("ensures the platform overlay + creates the traefik ingress service (no CLI)", async () => {
        await service.ensurePlatformStack();

        expect(dockerService.ensureOverlayNetwork).toHaveBeenCalledWith(
            expect.objectContaining({ name: PLATFORM_OVERLAY_NETWORK, driver: "overlay", attachable: true }),
        );
        expect(dockerService.inspectSwarmService).toHaveBeenCalledWith(PLATFORM_TRAEFIK_SERVICE);
        expect(dockerService.createSwarmService).toHaveBeenCalledTimes(1);
        const spec = dockerService.createSwarmService.mock.calls[0]?.[0];
        expect(spec).toMatchObject({
            Name: PLATFORM_TRAEFIK_SERVICE,
            Labels: expect.objectContaining({ "deployer.platform": "true" }),
        });
        // Swarm provider + ingress constraint
        expect(spec.TaskTemplate?.Placement?.Constraints).toContain("node.labels.deployer.ingress == true");
        // SDK spec never carries a CLI stack deploy
        expect(dockerService.updateSwarmService).not.toHaveBeenCalled();
    });

    it("updates the traefik service when it already exists (idempotent)", async () => {
        dockerService.inspectSwarmService.mockResolvedValue({ ID: "svc-1", Version: { Index: 3 } });

        await service.ensurePlatformStack();

        expect(dockerService.updateSwarmService).toHaveBeenCalledWith(
            PLATFORM_TRAEFIK_SERVICE,
            3,
            expect.objectContaining({ Name: PLATFORM_TRAEFIK_SERVICE }),
            false,
        );
        expect(dockerService.createSwarmService).not.toHaveBeenCalled();
    });
});