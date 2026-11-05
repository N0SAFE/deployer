import { createModuleContext } from '@deployer/nest-effect'

import { DeploymentProviderBuilderRunnerStateMachineService } from './services/deployment-provider-builder-runner-state-machine.service'
import { PreviewCleanupPolicyService } from './services/preview-cleanup-policy.service'
import { PreviewNamingService } from './services/preview-naming.service'

export class DeploymentCoreModule extends createModuleContext({
    providers: [
        { provide: PreviewNamingService, useValue: PreviewNamingService.live },
        {
            provide: PreviewCleanupPolicyService,
            useValue: PreviewCleanupPolicyService.live,
        },
        {
            provide: DeploymentProviderBuilderRunnerStateMachineService,
            useValue: DeploymentProviderBuilderRunnerStateMachineService.live,
        },
    ],
    exports: [
        PreviewNamingService,
        PreviewCleanupPolicyService,
        DeploymentProviderBuilderRunnerStateMachineService,
    ],
}) {}
