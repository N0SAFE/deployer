import { createModuleContext } from '@deployer/nest-effect'

import { DatabasePort } from '@identity/core/database/database.port'

import { ApprovalDomainModule } from '../approval/approval.module'
import { AuditDomainModule } from '../audit/audit.module'
import { RoleDomainModule } from '../role/role.module'
import { StepUpDomainModule } from '../step-up/step-up.module'

import { UserController } from './controllers/user.controller'
import { UserRepository } from './repositories/user.repository'
import { UserService } from './services/user.service'

import type { UserRepositoryShape } from './repositories/user.repository'

/**
 * The user domain.
 *
 * `UserService` and `UserRepository` are constants provided here; the repository reads `DatabasePort`
 * and the service reads the repository from the Effect context when a method runs.
 */
export class UserDomainModule extends createModuleContext(
    {
        controllers: [UserController],
        imports: [
            StepUpDomainModule,
            RoleDomainModule,
            AuditDomainModule,
            ApprovalDomainModule,
        ],
        providers: [
            // The service takes its repository as a constructor argument (see the class doc).
            {
                provide: UserService,
                useFactory: (users: UserRepositoryShape) =>
                    new UserService.live(users),
                inject: [UserRepository],
            },
            { provide: UserRepository, useValue: UserRepository.live },
        ],
    },
    DatabasePort
) {}
