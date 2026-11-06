import { createModuleContext } from '@deployer/nest-effect'

import { DatabasePort } from '@identity/core/database/database.port'

import { AnalyticsController } from './controllers/analytics.controller'
import { AnalyticsRepository } from './repositories/analytics.repository'
import { AnalyticsService } from './services/analytics.service'

/**
 * The analytics domain: usage metrics and reporting.
 *
 * `AnalyticsService` yields `AnalyticsRepository` when a method runs, and the repository yields `DatabasePort`
 * for the connection it opens, so both are plain classes the runtime builds per request. The module declares the
 * controller and which services its handlers may use. The repository is this domain's private data access, so it
 * is not in the handler context.
 */
export class AnalyticsDomainModule extends createModuleContext(
    {
        controllers: [AnalyticsController],
        providers: [
            { provide: AnalyticsService, useClass: AnalyticsService.live },
            {
                provide: AnalyticsRepository,
                useClass: AnalyticsRepository.live,
            },
        ],
    },
    DatabasePort
) {}
