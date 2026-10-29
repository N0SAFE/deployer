import type { EffectRuntime } from "@deployer/nest-effect";
import { Logger } from "@nestjs/common";
import { Effect } from "effect";

import { DNS_RECONCILE_INTERVAL_MS, IngressEdgeService } from "./ingress-edge.service";

export const INGRESS_DNS_RECONCILER = Symbol("fleet:ingress-dns-reconciler");

/**
 * Converges lane DNS on a cadence, because mesh and public addresses change on their own. The
 * ingress service is a constant with no lifetime, so the loop that outlives a request is a
 * registration the module calls once when it is built; the handle it returns stops the loop with the
 * application (Nest calls `onApplicationShutdown` on a provider's instance whatever built it).
 */
export function startIngressDnsReconciler(runtime: EffectRuntime, intervalMs: number = DNS_RECONCILE_INTERVAL_MS) {
	const logger = new Logger("IngressDnsReconciler");
	let timer: NodeJS.Timeout | undefined = setInterval(() => {
		runtime
			.runPromise(
				Effect.gen(function* () {
					const ingress = yield* IngressEdgeService;
					yield* ingress.reconcileDns();
				}),
			)
			.catch((error: unknown) => {
				logger.warn(`DNS reconcile failed: ${error instanceof Error ? error.message : String(error)}`);
			});
	}, intervalMs);
	timer.unref();

	return {
		onApplicationShutdown(): void {
			clearInterval(timer);
			timer = undefined;
		},
	};
}
