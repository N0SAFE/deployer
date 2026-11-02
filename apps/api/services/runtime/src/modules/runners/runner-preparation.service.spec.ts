import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { makeDelegatedRunner } from "./base/delegated-runner";
import { prepareBuildpackExecutionInput } from "./buildpack/buildpack-runtime-runner.service";
import { prepareDockerComposeExecutionInput } from "./docker-compose/docker-compose-runtime-runner.service";
import { prepareDockerfileExecutionInput } from "./dockerfile/dockerfile-runtime-runner.service";
import { prepareNixpacksExecutionInput } from "./nixpacks/nixpacks-runtime-runner.service";
import { prepareRailpackExecutionInput } from "./railpack/railpack-runtime-runner.service";
import { run } from "./testing";

import type { RuntimeExecutionInput, RuntimeExecutionResult } from "./runtime-runner.interface";

function makeInput(overrides?: Partial<RuntimeExecutionInput>): RuntimeExecutionInput {
    return {
        deployment: {
            deploymentId: "deployment-1",
            serviceId: "service-1234567890",
            deploymentContainerName: null,
            deploymentContainerImage: null,
            healthCheckUrl: null,
        },
        artifact: {
            containerImage: "ghcr.io/repo/image:latest",
            containerName: null,
            artifactDigest: null,
            artifactSizeBytes: null,
            buildLogsUrl: null,
        },
        healthGateConfig: {
            maxRetries: 3,
            retryIntervalMs: 200,
        },
        ...overrides,
    };
}

function makeResult(): RuntimeExecutionResult {
    return {
        containerId: "container-1",
        containerName: "container-name",
        containerImage: "ghcr.io/repo/image:latest",
        routeVerification: {
            applied: true,
            syncResult: {
                configId: "config-1",
                configName: "name",
                action: "updated",
                message: "ok",
                syncedAt: null,
            },
            healthSummary: {},
            attempts: 1,
            verifiedAt: new Date().toISOString(),
        },
        healthGate: {
            passed: true,
            containerId: "container-1",
            healthCheckUrl: null,
            maxRetries: 3,
            retryIntervalMs: 200,
            verifiedAt: new Date().toISOString(),
        },
    };
}

function delegated(
    runnerType: "dockerfile" | "docker_compose" | "nixpacks" | "buildpack" | "railpack",
    prepare: (input: RuntimeExecutionInput) => RuntimeExecutionInput,
    executeRuntime: (input: RuntimeExecutionInput) => Effect.Effect<RuntimeExecutionResult, unknown>,
) {
    const runner = makeDelegatedRunner(runnerType, { runnerType: "docker", executeRuntime }, prepare);
    return { executeRuntime: (input: RuntimeExecutionInput) => run(runner.executeRuntime(input)) };
}

describe("Dedicated runtime runner preparation", () => {
    it("applies docker-compose defaults", async () => {
        const executeRuntime = vi.fn(() => Effect.succeed(makeResult()));
        const runner = delegated("docker_compose", prepareDockerComposeExecutionInput, executeRuntime);

        await runner.executeRuntime(makeInput());

        expect(executeRuntime).toHaveBeenCalledWith(
            expect.objectContaining({
                deployment: expect.objectContaining({
                    networkMode: "bridge",
                    deploymentContainerName: "service-12345678-compose-runtime",
                }),
            }),
        );
    });

    it("applies dockerfile default container naming", async () => {
        const executeRuntime = vi.fn(() => Effect.succeed(makeResult()));
        const runner = delegated("dockerfile", prepareDockerfileExecutionInput, executeRuntime);

        await runner.executeRuntime(makeInput());

        expect(executeRuntime).toHaveBeenCalledWith(
            expect.objectContaining({
                deployment: expect.objectContaining({
                    deploymentContainerName: "service-12345678-dockerfile-runtime",
                }),
            }),
        );
    });

    it("enforces image availability for dockerfile-like runners", async () => {
        const executeRuntime = vi.fn(() => Effect.succeed(makeResult()));
        const missingImageInput = makeInput({
            artifact: {
                containerImage: null,
                containerName: null,
                artifactDigest: null,
                artifactSizeBytes: null,
                buildLogsUrl: null,
            },
        });

        await expect(
            delegated("dockerfile", prepareDockerfileExecutionInput, executeRuntime).executeRuntime(missingImageInput),
        ).rejects.toThrow("Dockerfile runner requires a prepared container image from build stage");

        await expect(
            delegated("nixpacks", prepareNixpacksExecutionInput, executeRuntime).executeRuntime(missingImageInput),
        ).rejects.toThrow("Nixpacks runner requires a prepared runtime image");

        await expect(
            delegated("buildpack", prepareBuildpackExecutionInput, executeRuntime).executeRuntime(missingImageInput),
        ).rejects.toThrow("Buildpack runner requires a prepared runtime image");

        await expect(
            delegated("railpack", prepareRailpackExecutionInput, executeRuntime).executeRuntime(missingImageInput),
        ).rejects.toThrow("Railpack runner requires a prepared runtime image");
    });

    it("applies runner-specific defaults for nixpacks/buildpack/railpack", async () => {
        const executeRuntime = vi.fn(() => Effect.succeed(makeResult()));

        await delegated("nixpacks", prepareNixpacksExecutionInput, executeRuntime).executeRuntime(makeInput());
        expect(executeRuntime).toHaveBeenLastCalledWith(
            expect.objectContaining({
                deployment: expect.objectContaining({
                    cpuShares: 1,
                }),
            }),
        );

        await delegated("buildpack", prepareBuildpackExecutionInput, executeRuntime).executeRuntime(makeInput());
        expect(executeRuntime).toHaveBeenLastCalledWith(
            expect.objectContaining({
                deployment: expect.objectContaining({
                    memoryLimitBytes: 512 * 1024 * 1024,
                }),
            }),
        );

        await delegated("railpack", prepareRailpackExecutionInput, executeRuntime).executeRuntime(makeInput());
        expect(executeRuntime).toHaveBeenLastCalledWith(
            expect.objectContaining({
                deployment: expect.objectContaining({
                    healthCheckUrl: "/internal/health/service-1234567890",
                }),
            }),
        );
    });

    it("applies typed runtimeRunnerOptions per runner", async () => {
        const executeRuntime = vi.fn(() => Effect.succeed(makeResult()));

        await delegated("dockerfile", prepareDockerfileExecutionInput, executeRuntime).executeRuntime(
            makeInput({
                runtimeRunnerOptions: {
                    runner: "dockerfile",
                    containerName: "dockerfile-override",
                },
            }),
        );
        expect(executeRuntime).toHaveBeenLastCalledWith(
            expect.objectContaining({
                deployment: expect.objectContaining({
                    deploymentContainerName: "dockerfile-override",
                }),
            }),
        );

        await delegated("docker_compose", prepareDockerComposeExecutionInput, executeRuntime).executeRuntime(
            makeInput({
                runtimeRunnerOptions: {
                    runner: "docker_compose",
                    networkMode: "bridge",
                    dockerCompose: {
                        networkMode: "host",
                        containerName: "compose-override",
                        profiles: ["prod", "canary"],
                    },
                },
            }),
        );
        expect(executeRuntime).toHaveBeenLastCalledWith(
            expect.objectContaining({
                deployment: expect.objectContaining({
                    networkMode: "host",
                    deploymentContainerName: "compose-override",
                }),
                executorOptions: expect.objectContaining({
                    labels: expect.objectContaining({
                        "deployer.runner.compose_profiles": "prod,canary",
                    }),
                }),
            }),
        );

        await delegated("nixpacks", prepareNixpacksExecutionInput, executeRuntime).executeRuntime(
            makeInput({
                runtimeRunnerOptions: {
                    runner: "nixpacks",
                    nixpacks: {
                        cpuShares: 4,
                    },
                },
            }),
        );
        expect(executeRuntime).toHaveBeenLastCalledWith(
            expect.objectContaining({
                deployment: expect.objectContaining({
                    cpuShares: 4,
                }),
            }),
        );

        await delegated("buildpack", prepareBuildpackExecutionInput, executeRuntime).executeRuntime(
            makeInput({
                runtimeRunnerOptions: {
                    runner: "buildpack",
                    buildpack: {
                        memoryLimitBytes: 1024 * 1024 * 1024,
                        builder: "paketo-buildpacks/builder-jammy-base",
                    },
                },
            }),
        );
        expect(executeRuntime).toHaveBeenLastCalledWith(
            expect.objectContaining({
                deployment: expect.objectContaining({
                    memoryLimitBytes: 1024 * 1024 * 1024,
                }),
                executorOptions: expect.objectContaining({
                    labels: expect.objectContaining({
                        "deployer.runner.buildpack_builder": "paketo-buildpacks/builder-jammy-base",
                    }),
                }),
            }),
        );

        await delegated("railpack", prepareRailpackExecutionInput, executeRuntime).executeRuntime(
            makeInput({
                runtimeRunnerOptions: {
                    runner: "railpack",
                    railpack: {
                        healthCheckUrl: "http://service.local/custom-health",
                        startupCommand: "node server.js",
                    },
                },
            }),
        );
        expect(executeRuntime).toHaveBeenLastCalledWith(
            expect.objectContaining({
                deployment: expect.objectContaining({
                    healthCheckUrl: "http://service.local/custom-health",
                }),
                executorOptions: expect.objectContaining({
                    startupCommand: "node server.js",
                }),
            }),
        );
    });

    it("rejects runner options that do not match selected runner policy", async () => {
        const executeRuntime = vi.fn(() => Effect.succeed(makeResult()));

        await expect(
            delegated("nixpacks", prepareNixpacksExecutionInput, executeRuntime).executeRuntime(
                // Negative fixture: options mismatch the runner type at RUNTIME
                // (the strict union can't express it — cast at the spec boundary).
                makeInput({
                    runtimeRunnerOptions: {
                        runner: "nixpacks",
                        buildpack: { builder: "paketo-buildpacks/builder-jammy-base" },
                    } as never,
                }),
            ),
        ).rejects.toThrow("Nixpacks runner options are invalid for runner type 'nixpacks'");

        await expect(
            delegated("buildpack", prepareBuildpackExecutionInput, executeRuntime).executeRuntime(
                makeInput({
                    runtimeRunnerOptions: {
                        runner: "buildpack",
                        nixpacks: { cpuShares: 4 },
                    } as never,
                }),
            ),
        ).rejects.toThrow("Buildpack runner options are invalid for runner type 'buildpack'");
    });
});
