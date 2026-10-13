import { Module } from "@nestjs/common";
import { SystemMetricsService } from "@/core/modules/system-metrics/services/system-metrics.service";

@Module({
    providers: [SystemMetricsService],
    exports: [SystemMetricsService],
})
export class SystemMetricsModule {}