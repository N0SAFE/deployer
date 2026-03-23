import { Module } from "@nestjs/common";
import { PreviewCleanupPolicyService } from "./services/preview-cleanup-policy.service";
import { PreviewNamingService } from "./services/preview-naming.service";
import { DeploymentProviderBuilderRunnerStateMachineService } from "./services/deployment-provider-builder-runner-state-machine.service";

@Module({
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
})
export class DeploymentCoreModule {}