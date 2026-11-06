import { createModuleContext } from '@deployer/nest-effect'
import { ApprovalGuard } from '@deployer/shared/core/modules/approval/approval.guard'
import {
    PlatformSecret,
    type PlatformSecretShape,
} from '@deployer/shared/core/modules/auth/orpc/secrets'
import { CoreDockerModule } from '@deployer/shared/core/modules/docker/docker.module'
import { ServiceClient, type ServiceClientShape } from '@deployer/shared/server'

import { DockerCatalogModule } from './catalog/docker-catalog.module'
import { DockerCommonModule } from './common/docker-common.module'
import { DockerController } from './controllers/docker.controller'
import { DockerContainersModule } from './domains/containers/docker-containers.module'
import { DockerEntityModule } from './domains/entity/docker-entity.module'
import { DockerImagesModule } from './domains/images/docker-images.module'
import { DockerRuntimeModule } from './domains/runtime/docker-runtime.module'
import { DockerRepositoriesModule } from './repositories/docker-repositories.module'

export class DockerDomainModule extends createModuleContext(
    {
        imports: [
            CoreDockerModule,
            DockerCommonModule,
            DockerRepositoriesModule,
            DockerContainersModule,
            DockerRuntimeModule,
            DockerImagesModule,
            DockerCatalogModule,
            DockerEntityModule,
        ],
        controllers: [DockerController],
        providers: [
            // Opening a shell in a container is destructive-adjacent: `container:exec` may need a second person (`SEC-072`).
            {
                provide: ApprovalGuard,
                useFactory: (
                    services: ServiceClientShape,
                    secrets: PlatformSecretShape
                ) => new ApprovalGuard.live(services, secrets),
                inject: [ServiceClient, PlatformSecret],
            },
        ],
        exports: [
            DockerCommonModule,
            DockerRepositoriesModule,
            DockerContainersModule,
            DockerRuntimeModule,
            DockerImagesModule,
            DockerCatalogModule,
            DockerEntityModule,
        ],
    },
    ApprovalGuard
) {}
