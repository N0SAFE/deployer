import { createModuleContext } from '@deployer/nest-effect'
import { DatabasePort } from '@identity/core/database/database.port'

import { UserController } from './controllers/user.controller'
import {
    UserRepository,
    UserRepositoryImpl,
} from './repositories/user.repository'
import { UserService, UserServiceImpl } from './services/user.service'

/**
 * The user domain.
 *
 * Every dependency is an Effect token backed by a normal NestJS provider:
 * - `DatabasePort` is provided once by the root module;
 * - `UserRepository` is the Drizzle implementation, with no constructor DI;
 * - `UserService` is the domain use case.
 */
export class UserDomainModule extends createModuleContext(
    {
        controllers: [UserController],
        providers: [
            { provide: UserRepository, useClass: UserRepositoryImpl },
            { provide: UserService, useClass: UserServiceImpl },
        ],
        exports: [UserService],
    },
    DatabasePort
) {}
