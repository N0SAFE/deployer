import { createModuleContext } from "@deployer/nest-effect";
import { PreviewCleanupPolicyService } from "./services/preview-cleanup-policy.service";
import { PreviewNamingService } from "./services/preview-naming.service";
import { DeploymentProviderBuilderRunnerStateMachineService } from "./services/deployment-provider-builder-runner-state-machine.service";

export class DeploymentCoreModule extends createModuleContext({
    providers: [
        PreviewNamingService,
        PreviewCleanupPolicyService,
        DeploymentProviderBuilderRunnerStateMachineService,
    ],
    exports: [
        PreviewNamingService,
        PreviewCleanupPolicyService,
        DeploymentProviderBuilderRunnerStateMachineService,
    ],
}) {}