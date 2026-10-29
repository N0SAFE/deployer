import { EffectRuntime } from "@deployer/nest-effect";
import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { Effect } from "effect";

import { DNS_RECONCILE_INTERVAL_MS, IngressEdgeService } from "./ingress-edge.service";

/**
 * Converges lane DNS on a cadence, because mesh and public addresses change on their own. The
 * ingress service is a constant with no lifetime, so the loop that outlives a request lives here and
 * stops with the application.
 */
@Injectable()
export class IngressDnsReconciler implements OnApplicationBootstrap, OnApplicationShutdown {
	private readonly logger = new Logger(IngressDnsReconciler.name);
	private timer: NodeJS.Timeout | undefined;

	constructor(private readonly runtime: EffectRuntime) {}

	onApplicationBootstrap(): void {
		this.timer = setInterval(() => {
			this.runtime
				.runPromise(
					Effect.gen(function* () {
						const ingress = yield* IngressEdgeService;
						yield* ingress.reconcileDns();
					}),
				)
				.catch((error: unknown) => {
					this.logger.warn(`DNS reconcile failed: ${error instanceof Error ? error.message : String(error)}`);
				});
		}, DNS_RECONCILE_INTERVAL_MS);
		this.timer.unref();
	}

	onApplicationShutdown(): void {
		clearInterval(this.timer);
		this.timer = undefined;
	}
}
