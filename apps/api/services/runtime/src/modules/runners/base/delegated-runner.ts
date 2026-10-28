import { Effect } from "effect";

import type {
    DeploymentRuntimeRunner,
    DeploymentRuntimeRunnerType,
    RuntimeExecutionInput,
} from "../runtime-runner.interface";

/**
 * A runner that is the docker runner behind its own input preparation: it validates its options,
 * fills in the defaults its builder implies, and hands the result to the docker runner.
 *
 * `prepare` throws `RuntimeInvalid` for options that do not hold; that becomes the effect's failure.
 */
export function makeDelegatedRunner(
    runnerType: DeploymentRuntimeRunnerType,
    docker: DeploymentRuntimeRunner,
    prepare: (input: RuntimeExecutionInput) => RuntimeExecutionInput,
): DeploymentRuntimeRunner {
    return {
        runnerType,
        executeRuntime: (input) =>
            Effect.try({ try: () => prepare(input), catch: (cause) => cause }).pipe(
                Effect.flatMap((prepared) => docker.executeRuntime(prepared)),
            ),
    };
}
