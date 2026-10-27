import { Module } from "@nestjs/common";

import { AnalyticsController } from "./controllers/analytics.controller";
import { AnalyticsRepository } from "./repositories/analytics.repository";
import { AnalyticsService } from "./services/analytics.service";

/**
 * The analytics domain.
 *
 * Usage metrics and reporting.
 *
 * Declares the three primitives and exports the SERVICE — not the repository.
 * A repository is this domain's private data access, and exporting it would let a
 * sibling domain couple to these tables, which is the cross-domain coupling the
 * split exists to remove.
 */
@Module({
	controllers: [AnalyticsController],
	providers: [AnalyticsService, AnalyticsRepository],
	exports: [AnalyticsService],
})
export class AnalyticsDomainModule {}
