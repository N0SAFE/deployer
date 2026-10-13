import { Module } from "@nestjs/common";
import { PreviewCleanupPolicyService } from "@/core/modules/deployment/services/preview-cleanup-policy.service";
import { PreviewNamingService } from "@/core/modules/deployment/services/preview-naming.service";
import { DeploymentProviderBuilderRunnerStateMachineService } from "@/core/modules/deployment/services/deployment-provider-builder-runner-state-machine.service";

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