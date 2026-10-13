import type {
    DeploymentRuntimeRunner,
    DeploymentRuntimeRunnerType,
    RuntimeExecutionInput,
    RuntimeExecutionResult,
} from "../runtime-runner.interface";
import type { DockerRuntimeRunnerService } from "../docker/docker-runtime-runner.service";

export abstract class DelegatedRuntimeRunnerBase implements DeploymentRuntimeRunner {
    abstract readonly runnerType: DeploymentRuntimeRunnerType;
    protected abstract readonly dockerRuntimeRunnerService: DockerRuntimeRunnerService;

    protected abstract prepareExecutionInput(input: RuntimeExecutionInput): RuntimeExecutionInput;

    executeRuntime(input: RuntimeExecutionInput): Promise<RuntimeExecutionResult> {
        return this.dockerRuntimeRunnerService.executeRuntime(this.prepareExecutionInput(input));
    }
}
