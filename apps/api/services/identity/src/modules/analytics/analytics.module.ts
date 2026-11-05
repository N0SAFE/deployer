import { createModuleContext } from '@deployer/nest-effect'

import { DatabasePort } from '@identity/core/database/database.port'

import { AnalyticsController } from './controllers/analytics.controller'
import { AnalyticsRepository } from './repositories/analytics.repository'
import { AnalyticsService } from './services/analytics.service'

/**
 * The analytics domain: usage metrics and reporting.
 *
 * `AnalyticsService` and `AnalyticsRepository` are Layers (`AnalyticsLive`), built by the app's Effect
 * runtime over `DatabasePort`; the module declares the controller and which services its handlers may use.
 * The repository is this domain's private data access, so it is not in the handler context.
 */
export class AnalyticsDomainModule extends createModuleContext(
    {
        controllers: [AnalyticsController],
        providers: [
            { provide: AnalyticsService, useValue: AnalyticsService.live },
            {
                provide: AnalyticsRepository,
                useValue: AnalyticsRepository.live,
            },
        ],
    },
    DatabasePort
) {}
