import { Module } from "@nestjs/common";
import { makeSystemMetrics, SystemMetrics } from "@deployer/system-metrics";

/** Provides the machine-metrics Effect service under its own tag; callers inject the tag and run its Effects. */
@Module({
	providers: [{ provide: SystemMetrics, useFactory: () => makeSystemMetrics() }],
	exports: [SystemMetrics],
})
export class SystemMetricsModule {}
