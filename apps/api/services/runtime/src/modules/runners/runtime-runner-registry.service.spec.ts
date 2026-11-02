import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { RuntimeInvalid } from "../../core/runtime.errors";

import { DockerRuntimeRunner } from "./docker/docker-runtime-runner.service";
import { RuntimeRunnerRegistry } from "./runtime-runner-registry.service";
import { SwarmRuntimeRunner } from "./swarm/swarm-runtime-runner.service";
import { provideTo, run } from "./testing";

import type { DeploymentRuntimeRunner, RuntimeExecutionInput, RuntimeExecutionResult } from "./runtime-runner.interface";

const input = {
    deployment: {
        deploymentId: "deployment-1",
        serviceId: "service-1234567890",
        deploymentContainerName: null,
        deploymentContainerImage: "ghcr.io/repo/image:latest",
        healthCheckUrl: null,
    },
    artifact: { containerImage: null, containerName: null, artifactDigest: null, artifactSizeBytes: null, buildLogsUrl: null },
    healthGateConfig: { maxRetries: 1, retryIntervalMs: 100 },
} satisfies RuntimeExecutionInput;

function fakeRunner(runnerType: DeploymentRuntimeRunner["runnerType"]) {
    const executeRuntime = vi.fn(() => Effect.succeed({ containerId: runnerType } as RuntimeExecutionResult));
    return { runner: { runnerType, executeRuntime } satisfies DeploymentRuntimeRunner, executeRuntime };
}

describe("RuntimeRunnerRegistry", () => {
    const docker = fakeRunner("docker");
    const swarm = fakeRunner("swarm");
    const registry = provideTo(new RuntimeRunnerRegistry.live(), (effect) =>
        effect.pipe(
            Effect.provideService(DockerRuntimeRunner, docker.runner as never),
            Effect.provideService(SwarmRuntimeRunner, swarm.runner as never),
        ),
    );

    it("runs the docker runner when no kind is given", async () => {
        expect((await run(registry.execute(null, input))).containerId).toBe("docker");
        expect((await run(registry.execute(undefined, input))).containerId).toBe("docker");
    });

    it("matches the kind case-insensitively", async () => {
        expect((await run(registry.execute("SWARM", input))).containerId).toBe("swarm");
    });

    it("sends image-based kinds through the docker runner", async () => {
        await run(registry.execute("nixpacks", input));

        expect(docker.executeRuntime).toHaveBeenCalledWith(
            expect.objectContaining({ deployment: expect.objectContaining({ cpuShares: 1 }) }),
        );
    });

    it("fails with RuntimeInvalid for a kind no runner implements", async () => {
        await expect(run(registry.execute("kubernetes", input))).rejects.toBeInstanceOf(RuntimeInvalid);
    });
});
