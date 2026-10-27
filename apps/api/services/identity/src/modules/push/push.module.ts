import { createModuleContext } from '@deployer/nest-effect'
import { DatabasePort } from '@identity/core/database/database.port'

import { PushController } from './controllers/push.controller'
import {
    PushRepository,
    PushRepositoryImpl,
} from './repositories/push.repository'
import { PushService, PushServiceImpl } from './services/push.service'

/**
 * The push domain.
 *
 * Web-push subscriptions.
 *
 * Every dependency is an Effect token backed by a normal NestJS provider:
 * - `DatabasePort` is provided once by the root module;
 * - `PushRepository` is the Drizzle implementation, with no constructor DI;
 * - `PushService` is the domain use case.
 *
 * Exports the SERVICE — not the repository. A repository is this domain's private
 * data access, and exporting it would let a sibling domain couple to these tables.
 */
export class PushDomainModule extends createModuleContext(
    {
        controllers: [PushController],
        providers: [
            { provide: PushRepository, useClass: PushRepositoryImpl },
            { provide: PushService, useClass: PushServiceImpl },
        ],
        exports: [PushService],
    },
    DatabasePort
) {}
