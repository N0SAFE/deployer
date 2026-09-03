import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../core/modules/database/database.module";
import { AnalyticsController } from "./controllers/analytics.controller";
import { AnalyticsDownloadController } from "./controllers/analytics-download.controller";
import { AnalyticsService } from "./services/analytics.service";
import { AnalyticsRepository } from "./repositories/analytics.repository";

@Module({
    imports: [DatabaseModule],
    controllers: [AnalyticsController, AnalyticsDownloadController],
    providers: [AnalyticsService, AnalyticsRepository],
    exports: [AnalyticsService],
})
export class AnalyticsModule {}
