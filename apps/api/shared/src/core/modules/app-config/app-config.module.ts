/**
 * AppConfigModule
 *
 * Provides runtime application configuration from the `app_config` table.
 * Replaces env-var-based configuration for settings like GitHub OAuth.
 */
import { createGlobalModule } from '@deployer/nest-effect'

import { DatabasePort } from '../database/storage'

import { AppConfigService, makeAppConfigService } from './app-config.service'

import type { Context } from 'effect'

export const AppConfigModule = createGlobalModule({
    providers: [
        {
            provide: AppConfigService,
            useFactory: (
                database: Context.Service.Shape<typeof DatabasePort>
            ) => makeAppConfigService(database),
            inject: [DatabasePort],
        },
    ],
    exports: [AppConfigService],
})
