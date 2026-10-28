import { Injectable } from "@nestjs/common";
import type { SystemMetricsSnapshot } from "@deployer/contracts-entities";
import { runPromiseUnwrapped } from "@deployer/effect-core";
import { makeSystemMetrics, type SystemMetricsShape } from "@deployer/system-metrics";

/**
 * The Promise face of `@deployer/system-metrics` for the Nest callers that are not on Effect yet.
 * The cache, the single-flight sampling and the typed failure are the Effect package's; `effect`
 * exposes it to Effect code.
 */
@Injectable()
export class SystemMetricsService {
	/** The Effect service this host exposes. */
	readonly effect: SystemMetricsShape = makeSystemMetrics();

	/** The machine's snapshot: a recent one is reused, `force` takes a fresh one. */
	getSnapshot(options?: { force?: boolean }): Promise<SystemMetricsSnapshot> {
		return runPromiseUnwrapped(this.effect.snapshot(options));
	}
}
