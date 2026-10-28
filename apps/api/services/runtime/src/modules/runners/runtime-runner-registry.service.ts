import { Context, Effect, Layer } from "effect";

import { Injectable } from "@nestjs/common";
import { EffectRuntime } from "@deployer/nest-effect";
import { RuntimeInvalid } from "../../core/runtime.errors";
import { makeDelegatedRunner } from "./base/delegated-runner";
import { prepareBuildpackExecutionInput } from "./buildpack/buildpack-runtime-runner.service";
import { prepareDockerComposeExecutionInput } from "./docker-compose/docker-compose-runtime-runner.service";
import { DockerRuntimeRunner } from "./docker/docker-runtime-runner.service";
import { prepareDockerfileExecutionInput } from "./dockerfile/dockerfile-runtime-runner.service";
import { prepareNixpacksExecutionInput } from "./nixpacks/nixpacks-runtime-runner.service";
import { prepareRailpackExecutionInput } from "./railpack/railpack-runtime-runner.service";
import type { DeploymentRuntimeRunner, RuntimeExecutionInput, RuntimeExecutionResult } from "./runtime-runner.interface";
import { SwarmRuntimeRunner } from "./swarm/swarm-runtime-runner.service";

/**
 * Picks the runner for a deployment's runner kind and runs it.
 *
 * All seven runners are required: they are always built by `RunnersLive`, so a runner that was
 * removed from the layer is a startup failure rather than a deploy that fails the first time it
 * uses that kind. `null` and `undefined` mean the default, `docker`.
 */
export type RuntimeRunnerRegistryShape = {
    readonly execute: (
        runnerKind: string | null | undefined,
        input: RuntimeExecutionInput,
    ) => Effect.Effect<RuntimeExecutionResult, unknown>;
};

export class RuntimeRunnerRegistry extends Context.Service<RuntimeRunnerRegistry, RuntimeRunnerRegistryShape>()(
    "runtime/RuntimeRunnerRegistry",
) {
    static readonly Live: Layer.Layer<RuntimeRunnerRegistry, never, DockerRuntimeRunner | SwarmRuntimeRunner> =
        Layer.effect(
            RuntimeRunnerRegistry,
            Effect.gen(function* () {
                return makeRuntimeRunnerRegistry({
                    docker: yield* DockerRuntimeRunner,
                    swarm: yield* SwarmRuntimeRunner,
                });
            }),
        );
}

export function makeRuntimeRunnerRegistry(runners: {
    readonly docker: DeploymentRuntimeRunner;
    readonly swarm: DeploymentRuntimeRunner;
}): RuntimeRunnerRegistryShape {
    const { docker, swarm } = runners;
    const all: readonly DeploymentRuntimeRunner[] = [
        docker,
        makeDelegatedRunner("dockerfile", docker, prepareDockerfileExecutionInput),
        makeDelegatedRunner("docker_compose", docker, prepareDockerComposeExecutionInput),
        makeDelegatedRunner("nixpacks", docker, prepareNixpacksExecutionInput),
        makeDelegatedRunner("buildpack", docker, prepareBuildpackExecutionInput),
        makeDelegatedRunner("railpack", docker, prepareRailpackExecutionInput),
        swarm,
    ];

    return {
        execute: (runnerKind, input) => {
            const normalizedRunner = (runnerKind ?? "docker").toLowerCase();
            const selectedRunner = all.find((runner) => runner.runnerType === normalizedRunner);
            if (!selectedRunner) {
                // Every runner is listed above, so this means the caller asked for a kind none implements.
                return Effect.fail(new RuntimeInvalid({ reason: `Unsupported runtime runner '${normalizedRunner}'` }));
            }
            return selectedRunner.executeRuntime(input);
        },
    };
}

/**
 * The Promise face of the registry, for the deployment workflow, which is not on Effect yet.
 * Each call runs the registry on the app-wide runtime; the failure comes back as thrown.
 */
@Injectable()
export class RuntimeRunnerRegistryService {
    constructor(private readonly runtime: EffectRuntime) {}

    execute(runnerKind: string | null | undefined, input: RuntimeExecutionInput): Promise<RuntimeExecutionResult> {
        return this.runtime.runPromise(
            Effect.gen(function* () {
                const registry = yield* RuntimeRunnerRegistry;
                return yield* registry.execute(runnerKind, input);
            }),
        );
    }
}
