import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { BadRequestError, ConflictError, TimeoutError } from "@repo/errors";
import type { RuntimeExecutionInput } from "../runtime-runner.interface";
import { SwarmRuntimeRunnerService, computeTaskStateCheck } from "./swarm-runtime-runner.service";

const baseInput: RuntimeExecutionInput = {
    deployment: {
        deploymentId: "deployment-1",
        serviceId: "service-1",
        projectId: "project-1",
        deploymentContainerName: null,
        deploymentContainerImage: null,
        healthCheckUrl: "http://localhost:3000/health",
        cpuShares: 1,
        memoryLimitBytes: 512 * 1024 * 1024,
    },
    artifact: {
        containerImage: "nginx:alpine",
        containerName: null,
        artifactDigest: null,
        artifactSizeBytes: null,
        buildLogsUrl: null,
    },
    healthGateConfig: { maxRetries: 3, retryIntervalMs: 100 },
    convergenceConfig: { traefikSyncMaxAttempts: 3, retryBaseDelayMs: 250 },
};

const serviceSummary = {
    ID: "service-abc",
    Version: { Index: 7 },
    CreatedAt: "2026-09-03T00:00:00Z",
    UpdatedAt: "2026-09-03T00:00:00Z",
    Spec: {
        Name: "deployer-service-1-<deployment>",
        Labels: {},
        TaskTemplate: {},
        Mode: {},
    },
    UpdateStatus: undefined,
};

const runningTask = {
    ID: "task-1",
    Version: { Index: 1 },
    ServiceID: "service-abc",
    NodeID: "node-1",
    Slot: 1,
    DesiredState: "running",
    Status: { State: "running" },
};

describe("computeTaskStateCheck", () => {
    it("is ready when required tasks are running with no failures", () => {
        expect(computeTaskStateCheck([runningTask], 1).ready).toBe(true);
    });

    it("is not ready when tasks are still starting", () => {
        const check = computeTaskStateCheck(
            [{ ...runningTask, Status: { State: "starting" } }],
            1,
        );
        expect(check.ready).toBe(false);
        expect(check.runningCount).toBe(0);
    });

    it("counts failed/rejected tasks", () => {
        const check = computeTaskStateCheck(
            [
                { ...runningTask, Status: { State: "failed", Err: "boom" } },
            ],
            1,
        );
        expect(check.failedCount).toBe(1);
        expect(check.ready).toBe(false);
    });
});

describe("SwarmRuntimeRunnerService", () => {
    let dockerService: {
        getSwarmInfo: ReturnType<typeof vi.fn>;
        ensureOverlayNetwork: ReturnType<typeof vi.fn>;
        inspectSwarmService: ReturnType<typeof vi.fn>;
        updateSwarmService: ReturnType<typeof vi.fn>;
        createSwarmService: ReturnType<typeof vi.fn>;
        listSwarmServiceTasks: ReturnType<typeof vi.fn>;
        removeSwarmService: ReturnType<typeof vi.fn>;
        scaleSwarmService: ReturnType<typeof vi.fn>;
        rollbackSwarmService: ReturnType<typeof vi.fn>;
    };
    let clusterService: {
        assertClusterReady: ReturnType<typeof vi.fn>;
    };
    let service: SwarmRuntimeRunnerService;

    beforeEach(() => {
        dockerService = {
            getSwarmInfo: vi.fn().mockResolvedValue({ LocalNodeState: "active" }),
            ensureOverlayNetwork: vi.fn().mockResolvedValue(undefined),
            inspectSwarmService: vi
                .fn()
                .mockRejectedValue(new NotFoundException("Swarm service not found: deployer-service-1-deployme")),
            updateSwarmService: vi.fn().mockResolvedValue(serviceSummary),
            createSwarmService: vi.fn().mockResolvedValue(serviceSummary),
            listSwarmServiceTasks: vi.fn().mockResolvedValue([runningTask]),
            removeSwarmService: vi.fn().mockResolvedValue(undefined),
            scaleSwarmService: vi.fn().mockResolvedValue(undefined),
            rollbackSwarmService: vi.fn().mockResolvedValue(undefined),
        };
        clusterService = {
            assertClusterReady: vi.fn().mockResolvedValue(undefined),
        };
        service = new SwarmRuntimeRunnerService(
            dockerService as never,
            clusterService as never,
        );
    });

    it("creates the service when it does not exist and waits for running tasks", async () => {
        const result = await service.executeRuntime(baseInput);

        expect(clusterService.assertClusterReady).toHaveBeenCalled();
        expect(dockerService.inspectSwarmService).toHaveBeenCalledWith(
            "deployer-service-1-deployme",
        );
        expect(dockerService.createSwarmService).toHaveBeenCalledOnce();
        expect(dockerService.createSwarmService).toHaveBeenCalledWith(
            expect.objectContaining({
                Name: "deployer-service-1-deployme",
                Labels: expect.objectContaining({ "deployer.managed": "true", "deployer.runtime_runner": "swarm" }),
            }),
        );
        expect(dockerService.listSwarmServiceTasks).toHaveBeenCalledWith("service-abc");
        expect(result.containerId).toBe("service-abc");
        expect(result.serviceId).toBe("service-abc");
        expect(result.serviceName).toBe("deployer-service-1-deployme");
        expect(result.taskIds).toEqual(["task-1"]);
        expect(result.healthGate.passed).toBe(true);
        expect(result.routeVerification.applied).toBe(true);
        expect(result.managedRuntime?.managedBy).toBe("deployment_service");
    });

    it("updates the service in place when it already exists", async () => {
        dockerService.inspectSwarmService.mockResolvedValue(serviceSummary);

        const result = await service.executeRuntime(baseInput);

        expect(dockerService.updateSwarmService).toHaveBeenCalledWith(
            "deployer-service-1-deployme",
            7,
            expect.objectContaining({ Name: "deployer-service-1-deployme" }),
            false,
        );
        expect(dockerService.createSwarmService).not.toHaveBeenCalled();
        expect(result.containerId).toBe("service-abc");
    });

    it("ensures the project overlay network when projectId is present", async () => {
        await service.executeRuntime(baseInput);

        expect(dockerService.ensureOverlayNetwork).toHaveBeenCalledWith(
            expect.objectContaining({
                name: "deployer-project-1",
                driver: "overlay",
                attachable: true,
            }),
        );
    });

    it("throws ConflictError when tasks fail during convergence", async () => {
        dockerService.listSwarmServiceTasks.mockResolvedValue([
            { ...runningTask, Status: { State: "rejected", Err: "image pull failed" } },
        ]);

        await expect(service.executeRuntime(baseInput)).rejects.toBeInstanceOf(ConflictError);
        expect(dockerService.createSwarmService).toHaveBeenCalledOnce();
    });

    it("throws TimeoutError when tasks never reach running within budget", async () => {
        dockerService.listSwarmServiceTasks.mockResolvedValue([
            { ...runningTask, Status: { State: "starting" } },
        ]);

        await expect(service.executeRuntime(baseInput)).rejects.toBeInstanceOf(TimeoutError);
    });

    it("rejects non-volume storage bindings with a typed error", async () => {
        await expect(
            service.executeRuntime({
                ...baseInput,
                storageBinding: {
                    storageType: "s3",
                    autoRedeployOnUpdate: false,
                    updateStrategy: "manual_update_button",
                    mountPath: "/workspace",
                    metadata: {},
                },
            }),
        ).rejects.toBeInstanceOf(BadRequestError);
        expect(dockerService.createSwarmService).not.toHaveBeenCalled();
    });

    it("maps volume storage bindings to a named-volume mount", async () => {
        await service.executeRuntime({
            ...baseInput,
            storageBinding: {
                storageType: "volume",
                autoRedeployOnUpdate: false,
                updateStrategy: "manual_update_button",
                mountPath: "/data",
                metadata: {},
            },
        });

        expect(dockerService.createSwarmService).toHaveBeenCalledWith(
            expect.objectContaining({
                TaskTemplate: expect.objectContaining({
                    ContainerSpec: expect.objectContaining({
                        Mounts: [
                            {
                                Type: "volume",
                                Source: "deployer-storage-deployment-1",
                                Target: "/data",
                                ReadOnly: false,
                            },
                        ],
                    }),
                }),
            }),
        );
    });

    it("propagates cluster unavailability", async () => {
        clusterService.assertClusterReady.mockRejectedValue(new Error("swarm inactive"));

        await expect(service.executeRuntime(baseInput)).rejects.toThrow("swarm inactive");
        expect(dockerService.createSwarmService).not.toHaveBeenCalled();
    });

    describe("lifecycle operations (SW-027)", () => {
        it("removes a service through the SDK with the cluster gate", async () => {
            await service.removeService("deployer-proj-svc");

            expect(clusterService.assertClusterReady).toHaveBeenCalled();
            expect(dockerService.removeSwarmService).toHaveBeenCalledWith("deployer-proj-svc");
        });

        it("scales a service to a target replica count", async () => {
            await service.scaleService("deployer-proj-svc", 3);

            expect(clusterService.assertClusterReady).toHaveBeenCalled();
            expect(dockerService.scaleSwarmService).toHaveBeenCalledWith("deployer-proj-svc", 3);
        });

        it("passes negative scale targets through to the SDK clamp", async () => {
            await service.scaleService("deployer-proj-svc", -2);

            expect(dockerService.scaleSwarmService).toHaveBeenCalledWith("deployer-proj-svc", -2);
        });

        it("rolls back a service through the SDK", async () => {
            await service.rollbackService("deployer-proj-svc");

            expect(clusterService.assertClusterReady).toHaveBeenCalled();
            expect(dockerService.rollbackSwarmService).toHaveBeenCalledWith("deployer-proj-svc");
        });

        it("propagates cluster unavailability for lifecycle ops", async () => {
            clusterService.assertClusterReady.mockRejectedValue(new Error("swarm inactive"));

            await expect(service.removeService("x")).rejects.toThrow("swarm inactive");
            await expect(service.scaleService("x", 1)).rejects.toThrow("swarm inactive");
            await expect(service.rollbackService("x")).rejects.toThrow("swarm inactive");
        });
    });
});