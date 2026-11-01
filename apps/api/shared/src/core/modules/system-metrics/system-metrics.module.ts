import { createModuleContext } from "@deployer/nest-effect";
import { makeSystemMetrics, SystemMetrics } from "@deployer/system-metrics";

/** Provides the machine-metrics Effect service under its own tag; callers inject the tag and run its Effects. */
export class SystemMetricsModule extends createModuleContext({
	providers: [{ provide: SystemMetrics, useFactory: () => makeSystemMetrics() }],
	exports: [SystemMetrics],
}) {}
