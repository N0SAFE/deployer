import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeploymentQueueProcessor } from "./deployment-queue.processor";
import { mkdtempSync } from "node:fs";
import path from "node:path";

describe("DeploymentQueueProcessor", () => {
    const claimedJob = {
        id: "queue-job-1",
        idempotencyKey: "deploy:job:1",
        lockToken: "lock-token-1",
    };

    let deploymentService: {
        claimQueueJobByIdempotencyKey: ReturnType<typeof vi.fn>;
        heartbeatQueueJob: ReturnType<typeof vi.fn>;
        completeQueueJob: ReturnType<typeof vi.fn>;
        failQueueJob: ReturnType<typeof vi.fn>;
    };
    let deploymentArtifactBuilderService: {
        buildContainerizedArtifact: ReturnType<typeof vi.fn>;
    };
    let processor: DeploymentQueueProcessor;

    beforeEach(() => {
        vi.useFakeTimers();
        deploymentService = {
            claimQueueJobByIdempotencyKey: vi.fn(),
            heartbeatQueueJob: vi.fn().mockReturnValue({ acknowledged: true }),
            completeQueueJob: vi.fn().mockResolvedValue({ updated: true }),
            failQueueJob: vi.fn(),
        };
        deploymentArtifactBuilderService = {
            buildContainerizedArtifact: vi.fn().mockResolvedValue(null),
        };
        processor = new DeploymentQueueProcessor(
            deploymentService as never,
            deploymentArtifactBuilderService as never,
        );
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it("claims the matching lifecycle job by idempotency key and completes it", async () => {
        deploymentService.claimQueueJobByIdempotencyKey.mockResolvedValue(claimedJob);

        await processor.processDeploy(createBullJob("bull-1", "deploy:job:1") as never);

        expect(deploymentService.claimQueueJobByIdempotencyKey).toHaveBeenCalledWith(
            "deploy:job:1",
            expect.objectContaining({
                limit: 1,
                leaseDurationSec: 120,
                types: ["deploy"],
            }),
        );
        expect(deploymentService.completeQueueJob).toHaveBeenCalledWith(
            "queue-job-1",
            expect.objectContaining({
                lockToken: "lock-token-1",
                result: expect.objectContaining({
                    bullJobId: "bull-1",
                    bullJobName: "deploy",
                    runtimeRunner: "docker",
                }),
            }),
        );
    });

    it("does nothing when no lifecycle job matches the Bull delivery", async () => {
        deploymentService.claimQueueJobByIdempotencyKey.mockResolvedValue(null);

        await processor.processDeploy(createBullJob("bull-2", "deploy:job:2") as never);

        expect(deploymentService.completeQueueJob).not.toHaveBeenCalled();
        expect(deploymentService.failQueueJob).not.toHaveBeenCalled();
        expect(deploymentService.heartbeatQueueJob).not.toHaveBeenCalled();
    });

    it("sends heartbeats while the lifecycle job is still running", async () => {
        deploymentService.claimQueueJobByIdempotencyKey.mockResolvedValue(claimedJob);

        let resolveCompletion: (() => void) | undefined;
        const completionPromise = new Promise<{ updated: boolean }>((resolve) => {
            resolveCompletion = () => resolve({ updated: true });
        });
        deploymentService.completeQueueJob.mockReturnValue(completionPromise);

        const processing = processor.processDeploy(createBullJob("bull-3", "deploy:job:1") as never);

        await vi.advanceTimersByTimeAsync(30_000);

        expect(deploymentService.heartbeatQueueJob).toHaveBeenCalledWith(
            "queue-job-1",
            expect.objectContaining({
                lockToken: "lock-token-1",
                extendLeaseSec: 120,
            }),
        );

        if (resolveCompletion) {
            resolveCompletion();
        }
        await processing;
    });

    it("fails the lifecycle job when completion throws", async () => {
        deploymentService.claimQueueJobByIdempotencyKey.mockResolvedValue(claimedJob);
        deploymentService.completeQueueJob.mockRejectedValue(new Error("runtime exploded"));

        await expect(
            processor.processDeploy(createBullJob("bull-4", "deploy:job:1") as never),
        ).rejects.toThrow("runtime exploded");

        expect(deploymentService.failQueueJob).toHaveBeenCalledWith(
            "queue-job-1",
            expect.objectContaining({
                lockToken: "lock-token-1",
                error: "runtime exploded",
                retryable: true,
            }),
        );
    });

    it("forwards storageBinding from Bull payload context into completion result", async () => {
        deploymentService.claimQueueJobByIdempotencyKey.mockResolvedValue(claimedJob);

        await processor.processDeploy(
            createBullJob("bull-5", "deploy:job:1", {
                context: {
                    storageBinding: {
                        storageType: "volume",
                        autoRedeployOnUpdate: true,
                        updateStrategy: "auto_redeploy",
                        mountPath: "/workspace/storage",
                        metadata: {
                            volumeName: "deployer-test-volume",
                            driver: "local",
                        },
                    },
                },
            }) as never,
        );

        expect(deploymentService.completeQueueJob).toHaveBeenCalledWith(
            "queue-job-1",
            expect.objectContaining({
                lockToken: "lock-token-1",
                result: expect.objectContaining({
                    storageBinding: expect.objectContaining({
                        storageType: "volume",
                        mountPath: "/workspace/storage",
                        updateStrategy: "auto_redeploy",
                    }),
                }),
            }),
        );
    });

    it("forwards runtime runner and typed options from source checkout context", async () => {
        deploymentService.claimQueueJobByIdempotencyKey.mockResolvedValue(claimedJob);

        await processor.processDeploy(
            createBullJob("bull-6", "deploy:job:1", {
                context: {
                    sourceCheckout: {
                        provider: "custom",
                        containerImage: "ghcr.io/acme/api:latest",
                        runtimeRunner: "buildpack",
                        runtimeRunnerOptions: {
                            memoryLimitBytes: 1024 * 1024 * 1024,
                            healthCheckMaxRetries: 6,
                            healthCheckRetryIntervalMs: 500,
                            buildpack: {
                                memoryLimitBytes: 768 * 1024 * 1024,
                                builder: "paketo-buildpacks/builder-jammy-base",
                            },
                        },
                    },
                },
            }) as never,
        );

        expect(deploymentService.completeQueueJob).toHaveBeenCalledWith(
            "queue-job-1",
            expect.objectContaining({
                result: expect.objectContaining({
                    runtimeRunner: "buildpack",
                    runtimeRunnerOptions: expect.objectContaining({
                        memoryLimitBytes: 1024 * 1024 * 1024,
                        healthCheckMaxRetries: 6,
                        healthCheckRetryIntervalMs: 500,
                        buildpack: {
                            memoryLimitBytes: 768 * 1024 * 1024,
                            builder: "paketo-buildpacks/builder-jammy-base",
                        },
                    }),
                }),
            }),
        );
    });

    it("hydrates runtime runner network mode from runtime configuration when absent from source options", async () => {
        deploymentService.claimQueueJobByIdempotencyKey.mockResolvedValue(claimedJob);

        await processor.processDeploy(
            createBullJob("bull-6b", "deploy:job:1", {
                context: {
                    sourceCheckout: {
                        provider: "custom",
                        containerImage: "ghcr.io/acme/api:latest",
                        runtimeRunner: "docker",
                    },
                    runtimeConfiguration: {
                        environmentDomains: {
                            network: {
                                DEPLOYER_NETWORK_MODE: "bridge",
                            },
                        },
                    },
                },
            }) as never,
        );

        expect(deploymentService.completeQueueJob).toHaveBeenCalledWith(
            "queue-job-1",
            expect.objectContaining({
                result: expect.objectContaining({
                    runtimeRunnerOptions: expect.objectContaining({
                        networkMode: "bridge",
                    }),
                }),
            }),
        );
    });

    it("forwards runtime environment variables from runtime configuration context", async () => {
        deploymentService.claimQueueJobByIdempotencyKey.mockResolvedValue(claimedJob);

        await processor.processDeploy(
            createBullJob("bull-6c", "deploy:job:1", {
                context: {
                    sourceCheckout: {
                        provider: "custom",
                        containerImage: "ghcr.io/acme/api:latest",
                        runtimeRunner: "docker",
                    },
                    runtimeConfiguration: {
                        environment: {
                            NODE_ENV: "production",
                            API_URL: "https://api.example.test",
                        },
                    },
                },
            }) as never,
        );

        expect(deploymentService.completeQueueJob).toHaveBeenCalledWith(
            "queue-job-1",
            expect.objectContaining({
                result: expect.objectContaining({
                    runtimeEnvironmentVariables: {
                        NODE_ENV: "production",
                        API_URL: "https://api.example.test",
                    },
                }),
            }),
        );
    });

    it("retries build phase according to execution plan build health policy", async () => {
        deploymentService.claimQueueJobByIdempotencyKey.mockResolvedValue(claimedJob);
        const uploadDir = mkdtempSync(path.join("/tmp", "deployer-upload-retry-build-"));
        deploymentArtifactBuilderService.buildContainerizedArtifact
            .mockRejectedValueOnce(new Error("build attempt 1 failed"))
            .mockRejectedValueOnce(new Error("build attempt 2 failed"))
            .mockResolvedValueOnce("deployer/service-bull-10:deployment-bull-10-dockerfile");

        const processing = processor.processDeploy(
            createBullJob("bull-10", "deploy:job:1", {
                context: {
                    sourceCheckout: {
                        provider: "upload",
                        uploadId: "upload-10",
                        uploadPath: uploadDir,
                    },
                    executionPlan: {
                        builder: "dockerfile",
                        healthChecks: {
                            build: {
                                maxRetries: 3,
                                retryIntervalMs: 100,
                            },
                        },
                    },
                },
            }) as never,
        );

        await vi.runAllTimersAsync();
        await processing;

        expect(deploymentArtifactBuilderService.buildContainerizedArtifact).toHaveBeenCalledTimes(3);
        expect(deploymentService.completeQueueJob).toHaveBeenCalled();
        expect(deploymentService.failQueueJob).not.toHaveBeenCalled();
    });

    it("fails queue job when build health policy retries are exhausted", async () => {
        deploymentService.claimQueueJobByIdempotencyKey.mockResolvedValue(claimedJob);
        const uploadDir = mkdtempSync(path.join("/tmp", "deployer-upload-retry-fail-"));
        deploymentArtifactBuilderService.buildContainerizedArtifact
            .mockRejectedValue(new Error("build failed permanently"));

        const processing = processor.processDeploy(
            createBullJob("bull-11", "deploy:job:1", {
                context: {
                    sourceCheckout: {
                        provider: "upload",
                        uploadId: "upload-11",
                        uploadPath: uploadDir,
                    },
                    executionPlan: {
                        builder: "dockerfile",
                        healthChecks: {
                            build: {
                                maxRetries: 2,
                                retryIntervalMs: 100,
                            },
                        },
                    },
                },
            }) as never,
        );

        const rejectionAssertion = expect(processing).rejects.toThrow("build failed permanently");

        await vi.runAllTimersAsync();
        await rejectionAssertion;
        expect(deploymentArtifactBuilderService.buildContainerizedArtifact).toHaveBeenCalledTimes(2);
        expect(deploymentService.failQueueJob).toHaveBeenCalledWith(
            "queue-job-1",
            expect.objectContaining({
                error: "build failed permanently",
                retryable: true,
            }),
        );
    });

    it("forwards container image and container name from source checkout context", async () => {
        deploymentService.claimQueueJobByIdempotencyKey.mockResolvedValue(claimedJob);
        deploymentArtifactBuilderService.buildContainerizedArtifact.mockResolvedValue(
            "ghcr.io/acme/web:sha-123",
        );

        await processor.processDeploy(
            createBullJob("bull-7", "deploy:job:1", {
                context: {
                    sourceCheckout: {
                        provider: "upload",
                        uploadId: "upload-1",
                        containerImage: "ghcr.io/acme/web:sha-123",
                        containerName: "web-runtime-1",
                        runtimeRunner: "dockerfile",
                    },
                },
            }) as never,
        );

        expect(deploymentService.completeQueueJob).toHaveBeenCalledWith(
            "queue-job-1",
            expect.objectContaining({
                result: expect.objectContaining({
                    runtimeRunner: "dockerfile",
                    containerImage: "ghcr.io/acme/web:sha-123",
                    containerName: "web-runtime-1",
                }),
            }),
        );
    });

    it("prefers execution plan runner/options over provider checkout hints", async () => {
        deploymentService.claimQueueJobByIdempotencyKey.mockResolvedValue(claimedJob);
        const uploadDir = mkdtempSync(path.join("/tmp", "deployer-upload-"));
        deploymentArtifactBuilderService.buildContainerizedArtifact.mockResolvedValue(
            "deployer/service-bull-8:deployment-bull-8-nixpacks",
        );

        await processor.processDeploy(
            createBullJob("bull-8", "deploy:job:1", {
                context: {
                    sourceCheckout: {
                        provider: "upload",
                        uploadId: "upload-1",
                        uploadPath: uploadDir,
                        runtimeRunner: "dockerfile",
                        runtimeRunnerOptions: {
                            healthCheckMaxRetries: 2,
                            healthCheckRetryIntervalMs: 100,
                        },
                    },
                    executionPlan: {
                        builder: "nixpacks",
                        runner: "buildpack",
                        runtimeRunnerOptions: {
                            memoryLimitBytes: 1024,
                        },
                        healthChecks: {
                            build: {
                                maxRetries: 3,
                                retryIntervalMs: 600,
                            },
                            deploy: {
                                maxRetries: 4,
                                retryIntervalMs: 900,
                            },
                            runtime: {
                                maxRetries: 9,
                                retryIntervalMs: 750,
                            },
                        },
                    },
                },
            }) as never,
        );

        expect(deploymentService.completeQueueJob).toHaveBeenCalledWith(
            "queue-job-1",
            expect.objectContaining({
                result: expect.objectContaining({
                    runtimeRunner: "buildpack",
                    buildRunner: "nixpacks",
                    runtimeRunnerOptions: expect.objectContaining({
                        memoryLimitBytes: 1024,
                    }),
                    containerImage: expect.stringContaining("deployer/"),
                    buildHealthCheckMaxRetries: 3,
                    buildHealthCheckRetryIntervalMs: 600,
                    deployHealthCheckMaxRetries: 4,
                    deployHealthCheckRetryIntervalMs: 900,
                    healthCheckMaxRetries: 9,
                    healthCheckRetryIntervalMs: 750,
                }),
            }),
        );
        expect(deploymentArtifactBuilderService.buildContainerizedArtifact).toHaveBeenCalledWith(
            expect.objectContaining({
                builder: "nixpacks",
                fallbackContainerImage: null,
            }),
        );
    });

    it("forwards custom build/run commands and cli policy from execution plan", async () => {
        deploymentService.claimQueueJobByIdempotencyKey.mockResolvedValue(claimedJob);
        const uploadDir = mkdtempSync(path.join("/tmp", "deployer-upload-custom-"));
        deploymentArtifactBuilderService.buildContainerizedArtifact.mockResolvedValue(
            "deployer/service-bull-9:deployment-bull-9-buildpack",
        );

        await processor.processDeploy(
            createBullJob("bull-9", "deploy:job:1", {
                context: {
                    sourceCheckout: {
                        provider: "upload",
                        uploadId: "upload-9",
                        uploadPath: uploadDir,
                    },
                    executionPlan: {
                        builder: "buildpack",
                        runner: "docker",
                        customCommands: {
                            cli: {
                                node: true,
                                npm: true,
                                bun: false,
                            },
                            buildCommand: "npm ci && npm run build",
                            runCommand: "node dist/server.js",
                        },
                    },
                },
            }) as never,
        );

        expect(deploymentArtifactBuilderService.buildContainerizedArtifact).toHaveBeenCalledWith(
            expect.objectContaining({
                customCommands: expect.objectContaining({
                    buildCommand: "npm ci && npm run build",
                    runCommand: "node dist/server.js",
                    cli: expect.objectContaining({
                        node: true,
                        npm: true,
                        bun: false,
                    }),
                }),
            }),
        );

        expect(deploymentService.completeQueueJob).toHaveBeenCalledWith(
            "queue-job-1",
            expect.objectContaining({
                result: expect.objectContaining({
                    customRunCommand: "node dist/server.js",
                }),
            }),
        );
    });

    function createBullJob(
        id: string,
        idempotencyKey: string,
        payload?: Record<string, unknown>,
    ) {
        return {
            id,
            name: "deploy",
            data: {
                deploymentId: `deployment-${id}`,
                serviceId: `service-${id}`,
                environment: "production",
                payload: payload ?? {},
                idempotencyKey,
            },
        };
    }
});