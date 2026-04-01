import { Module } from "@nestjs/common";
import { SystemMetricsService } from "./services/system-metrics.service";

@Module({
    providers: [SystemMetricsService],
    exports: [SystemMetricsService],
})
export class SystemMetricsModule {}