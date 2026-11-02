import { createModuleContext } from '@deployer/nest-effect'

import { DatabasePort } from '@identity/core/database/database.port'

import { PushController } from './controllers/push.controller'
import { PushRepository } from './repositories/push.repository'
import { PushService } from './services/push.service'

/**
 * The push domain: web-push subscriptions.
 *
 * `PushService` and `PushRepository` are Layers (see `push.layers.ts`) built by the app's Effect
 * runtime over `DatabasePort`; the module declares the controller and which services its handlers
 * may use. A repository is this domain's private data access: nothing exports it.
 */
export class PushDomainModule extends createModuleContext(
    {
        controllers: [PushController],
        providers: [
            { provide: PushService, useValue: PushService.live },
            { provide: PushRepository, useValue: PushRepository.live },
        ],
    },
    DatabasePort
) {}
