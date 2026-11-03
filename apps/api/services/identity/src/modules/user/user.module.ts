import { createModuleContext } from '@deployer/nest-effect'

import { DatabasePort } from '@identity/core/database/database.port'

import { AuditDomainModule } from '../audit/audit.module'
import { RoleDomainModule } from '../role/role.module'
import { StepUpDomainModule } from '../step-up/step-up.module'

import { UserController } from './controllers/user.controller'
import { UserRepository } from './repositories/user.repository'
import { UserService } from './services/user.service'

/**
 * The user domain.
 *
 * `UserService` and `UserRepository` are constants provided here; the repository reads `DatabasePort`
 * and the service reads the repository from the Effect context when a method runs.
 */
export class UserDomainModule extends createModuleContext(
    {
        controllers: [UserController],
        imports: [StepUpDomainModule, RoleDomainModule, AuditDomainModule],
        providers: [
            { provide: UserService, useValue: UserService.live },
            { provide: UserRepository, useValue: UserRepository.live },
        ],
    },
    DatabasePort
) {}
