import { Context, Effect } from "effect";
import { DockerEngine } from "@deployer/docker";
import { SwarmCluster } from "@deployer/swarm";

import { type EffectHostShape } from "@deployer/nest-effect";
import { RunnerEnvPort, RunnerTraefikPort } from "./runners.ports";
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
 * All seven runners are listed here. `null` and `undefined` mean the default, `docker`.
 */
export type RuntimeRunnerRegistryShape = {
    readonly execute: (
        runnerKind: string | null | undefined,
        input: RuntimeExecutionInput,
    ) => Effect.Effect<RuntimeExecutionResult, unknown, RunnerRegistryServices>;
};

/** The runners the registry picks between, and what they read while running. */
export type RunnerRegistryServices =
    | DockerRuntimeRunner
    | SwarmRuntimeRunner
    | DockerEngine
    | RunnerTraefikPort
    | SwarmCluster
    | RunnerEnvPort;

export class RuntimeRunnerRegistry extends Context.Service<RuntimeRunnerRegistry, RuntimeRunnerRegistryShape>()(
    "runtime/RuntimeRunnerRegistry",
) {
    /** The runners are yielded when `execute` runs, so this is a constant a module provides with `useValue`. */
    static readonly live = class RuntimeRunnerRegistryImpl implements RuntimeRunnerRegistryShape {
        execute = (runnerKind, input) =>
            Effect.gen(function* () {
                const docker = yield* DockerRuntimeRunner;
                const swarm = yield* SwarmRuntimeRunner;
                const normalizedRunner = (runnerKind ?? "docker").toLowerCase();
                const all: readonly DeploymentRuntimeRunner<RunnerRegistryServices>[] = [
                    docker,
                    makeDelegatedRunner("dockerfile", docker, prepareDockerfileExecutionInput),
                    makeDelegatedRunner("docker_compose", docker, prepareDockerComposeExecutionInput),
                    makeDelegatedRunner("nixpacks", docker, prepareNixpacksExecutionInput),
                    makeDelegatedRunner("buildpack", docker, prepareBuildpackExecutionInput),
                    makeDelegatedRunner("railpack", docker, prepareRailpackExecutionInput),
                    swarm,
                ];
                const selectedRunner = all.find((runner) => runner.runnerType === normalizedRunner);
                if (!selectedRunner) {
                    // Every runner is listed above, so this means the caller asked for a kind none implements.
                    return yield* Effect.fail(
                        new RuntimeInvalid({ reason: `Unsupported runtime runner '${normalizedRunner}'` }),
                    );
                }
                return yield* selectedRunner.executeRuntime(input);
            })
    };
}

/**
 * The Promise face of the registry, for the deployment workflow, which is not on Effect yet.
 * Each call runs the registry through the app-wide `EffectHost`; the failure comes back as thrown.
 */
export class RuntimeRunnerRegistryService {
    constructor(private readonly host: Pick<EffectHostShape, "run">) {}

    execute(runnerKind: string | null | undefined, input: RuntimeExecutionInput): Promise<RuntimeExecutionResult> {
        return this.host.run(
            Effect.gen(function* () {
                const registry = yield* RuntimeRunnerRegistry;
                return yield* registry.execute(runnerKind, input);
            }),
        );
    }
}
