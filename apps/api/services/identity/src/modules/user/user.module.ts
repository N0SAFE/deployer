import { createModuleContext } from '@deployer/nest-effect'
import { DatabasePort } from '@identity/core/database/database.port'

import { UserController } from './controllers/user.controller'
import { UserService } from './services/user.service'

/**
 * The user domain.
 *
 * `UserService` and `UserRepository` are Layers (`UserService.Live`, `UserRepository.Live`), built
 * by the app's Effect runtime over `DatabasePort`; the module only declares the controller and
 * which services its handlers may use.
 */
export class UserDomainModule extends createModuleContext(
    { controllers: [UserController] },
    UserService,
    DatabasePort
) {}
