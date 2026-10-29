import { RuntimeConflict, RuntimeInvalid } from "../../../core/runtime.errors";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DockerNotFound } from "@deployer/docker";
import { Effect } from "effect";
import { TimeoutError } from "@deployer/errors";
import type { RuntimeExecutionInput } from "../runtime-runner.interface";
import { provideTo, run } from "../testing";
import { computeTaskStateCheck } from "./swarm-runner.helpers";
import { DockerEngine } from "@deployer/docker";
import { SwarmCluster } from "@deployer/swarm";
import { RunnerEnvPort } from "../runners.ports";
import { SwarmRuntimeRunner } from "./swarm-runtime-runner.service";

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

describe("SwarmRuntimeRunner", () => {
    let swarmServices: {
        inspect: ReturnType<typeof vi.fn>;
        update: ReturnType<typeof vi.fn>;
        create: ReturnType<typeof vi.fn>;
        listTasks: ReturnType<typeof vi.fn>;
        remove: ReturnType<typeof vi.fn>;
        scale: ReturnType<typeof vi.fn>;
        rollback: ReturnType<typeof vi.fn>;
    };
    let networks: { ensureOverlay: ReturnType<typeof vi.fn> };
    let clusterService: {
        assertClusterReady: ReturnType<typeof vi.fn>;
    };
    let service: ReturnType<typeof provideTo<typeof SwarmRuntimeRunner.live>>;

    beforeEach(() => {
        swarmServices = {
            inspect: vi.fn(() => Effect.fail(new DockerNotFound({ resource: "swarm service 'deployer-service-1-deployme'" }))),
            update: vi.fn(() => Effect.void),
            create: vi.fn(() => Effect.succeed(serviceSummary)),
            listTasks: vi.fn(() => Effect.succeed([runningTask])),
            remove: vi.fn(() => Effect.void),
            scale: vi.fn(() => Effect.void),
            rollback: vi.fn(() => Effect.void),
        };
        networks = { ensureOverlay: vi.fn(() => Effect.void) };
        clusterService = {
            assertClusterReady: vi.fn(() => Effect.void),
        };
        service = provideTo(SwarmRuntimeRunner.live, (effect) =>
            effect.pipe(
                Effect.provideService(DockerEngine, { swarmServices, networks } as never),
                Effect.provideService(SwarmCluster, clusterService as never),
                // The runner resolves the PLATFORM OVERLAY name through `EnvService`; only `DEPLOYER_PREFIX` is
                // read, and "" is the default unprefixed install.
                Effect.provideService(RunnerEnvPort, { get: vi.fn(() => "") } as never),
            ),
        );
    });

    it("creates the service when it does not exist and waits for running tasks", async () => {
        const result = await run(service.executeRuntime(baseInput));

        expect(clusterService.assertClusterReady).toHaveBeenCalled();
        expect(swarmServices.inspect).toHaveBeenCalledWith(
            "deployer-service-1-deployme",
        );
        expect(swarmServices.create).toHaveBeenCalledOnce();
        expect(swarmServices.create).toHaveBeenCalledWith(
            expect.objectContaining({
                Name: "deployer-service-1-deployme",
                Labels: expect.objectContaining({ "deployer.managed": "true", "deployer.runtime_runner": "swarm" }),
            }),
        );
        expect(swarmServices.listTasks).toHaveBeenCalledWith("service-abc");
        expect(result.containerId).toBe("service-abc");
        expect(result.serviceId).toBe("service-abc");
        expect(result.serviceName).toBe("deployer-service-1-deployme");
        expect(result.taskIds).toEqual(["task-1"]);
        expect(result.healthGate.passed).toBe(true);
        expect(result.routeVerification.applied).toBe(true);
        expect(result.managedRuntime?.managedBy).toBe("deployment_service");
    });

    it("fails loudly instead of running nginx when the build produced no image", async () => {
        // Regression (DEPLOY-001): the runner used to fall back to `nginx:alpine`,
        // so a deploy whose builder produced nothing started a stock nginx and
        // reported success.
        await expect(
            run(service.executeRuntime({
                ...baseInput,
                deployment: { ...baseInput.deployment, deploymentContainerImage: null },
                artifact: { ...baseInput.artifact, containerImage: null },
            })),
        ).rejects.toThrow(/No container image was produced/);

        expect(swarmServices.create).not.toHaveBeenCalled();
        expect(swarmServices.update).not.toHaveBeenCalled();
    });

    it("updates the service in place when it already exists", async () => {
        swarmServices.inspect.mockReturnValue(Effect.succeed(serviceSummary));

        const result = await run(service.executeRuntime(baseInput));

        expect(swarmServices.update).toHaveBeenCalledWith(
            "deployer-service-1-deployme",
            7,
            expect.objectContaining({ Name: "deployer-service-1-deployme" }),
            false,
        );
        expect(swarmServices.create).not.toHaveBeenCalled();
        expect(result.containerId).toBe("service-abc");
    });

    it("ensures the project overlay network when projectId is present", async () => {
        await run(service.executeRuntime(baseInput));

        expect(networks.ensureOverlay).toHaveBeenCalledWith(
            expect.objectContaining({
                name: "deployer-project-1",
                driver: "overlay",
                attachable: true,
            }),
        );
    });

    it("throws RuntimeConflict when tasks fail during convergence", async () => {
        swarmServices.listTasks.mockReturnValue(Effect.succeed([
            { ...runningTask, Status: { State: "rejected", Err: "image pull failed" } },
        ]));

        await expect(run(service.executeRuntime(baseInput))).rejects.toBeInstanceOf(RuntimeConflict);
        expect(swarmServices.create).toHaveBeenCalledOnce();
    });

    it("throws TimeoutError when tasks never reach running within budget", async () => {
        swarmServices.listTasks.mockReturnValue(Effect.succeed([
            { ...runningTask, Status: { State: "starting" } },
        ]));

        await expect(run(service.executeRuntime(baseInput))).rejects.toBeInstanceOf(TimeoutError);
    });

    it("rejects non-volume storage bindings with a typed error", async () => {
        await expect(
            run(service.executeRuntime({
                ...baseInput,
                storageBinding: {
                    storageType: "s3",
                    autoRedeployOnUpdate: false,
                    updateStrategy: "manual_update_button",
                    mountPath: "/workspace",
                    metadata: {},
                },
            })),
        ).rejects.toBeInstanceOf(RuntimeInvalid);
        expect(swarmServices.create).not.toHaveBeenCalled();
    });

    it("maps volume storage bindings to a named-volume mount", async () => {
        await run(service.executeRuntime({
            ...baseInput,
            storageBinding: {
                storageType: "volume",
                autoRedeployOnUpdate: false,
                updateStrategy: "manual_update_button",
                mountPath: "/data",
                metadata: {},
            },
        }));

        expect(swarmServices.create).toHaveBeenCalledWith(
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
        clusterService.assertClusterReady.mockReturnValue(Effect.fail(new Error("swarm inactive")));

        await expect(run(service.executeRuntime(baseInput))).rejects.toThrow("swarm inactive");
        expect(swarmServices.create).not.toHaveBeenCalled();
    });

    describe("lifecycle operations (SW-027)", () => {
        it("removes a service through the SDK with the cluster gate", async () => {
            await run(service.removeService("deployer-proj-svc"));

            expect(clusterService.assertClusterReady).toHaveBeenCalled();
            expect(swarmServices.remove).toHaveBeenCalledWith("deployer-proj-svc");
        });

        it("scales a service to a target replica count", async () => {
            await run(service.scaleService("deployer-proj-svc", 3));

            expect(clusterService.assertClusterReady).toHaveBeenCalled();
            expect(swarmServices.scale).toHaveBeenCalledWith("deployer-proj-svc", 3);
        });

        it("passes negative scale targets through to the SDK clamp", async () => {
            await run(service.scaleService("deployer-proj-svc", -2));

            expect(swarmServices.scale).toHaveBeenCalledWith("deployer-proj-svc", -2);
        });

        it("rolls back a service through the SDK", async () => {
            await run(service.rollbackService("deployer-proj-svc"));

            expect(clusterService.assertClusterReady).toHaveBeenCalled();
            expect(swarmServices.rollback).toHaveBeenCalledWith("deployer-proj-svc");
        });

        it("propagates cluster unavailability for lifecycle ops", async () => {
            clusterService.assertClusterReady.mockReturnValue(Effect.fail(new Error("swarm inactive")));

            await expect(run(service.removeService("x"))).rejects.toThrow("swarm inactive");
            await expect(run(service.scaleService("x", 1))).rejects.toThrow("swarm inactive");
            await expect(run(service.rollbackService("x"))).rejects.toThrow("swarm inactive");
        });
    });
});