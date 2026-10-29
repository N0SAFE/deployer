/**
 * Preview TTL Cleanup Service
 *
 * Periodically expires preview environments whose `expiresAt` has passed
 * (default TTL set at provision time — 7 days). For each expired preview it
 * deactivates the traefik route, removes the DNS record, and marks the row
 * inactive via PreviewProvisioningService.
 *
 * `runCleanup` is the Effect service; the cadence is a registration (`startPreviewTtlCleanup`) the
 * module calls once when it is built, with a plain setInterval (no external scheduler dep), matching
 * `startIngressDnsReconciler`. Interval is fixed at 10 minutes.
 */
import { serviceOver, type Over } from "@deployer/effect-core";
import type { EffectRuntime } from "@deployer/nest-effect";
import { Logger } from "@nestjs/common";
import { Context, Effect } from "effect";

import { describeFailure, recover } from "@/core/effects";
import { PreviewProvisioningService, type PreviewProvisioningServiceShape } from "./preview-provisioning.service";

export const TTL_CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

function makePreviewTtlCleanupService(provisioning: PreviewProvisioningServiceShape) {
    return {
        /**
         * Expire every preview whose TTL has passed. One preview failing is logged and the next one
         * still runs; the run itself never fails.
         */
        runCleanup: Effect.fn("PreviewTtlCleanupService.runCleanup")(function* () {
            yield* recover(
                Effect.gen(function* () {
                    const expired = yield* provisioning.findExpiredPreviews();
                    for (const preview of expired) {
                        yield* recover(
                            provisioning
                                .expirePreview(preview.id, preview.serviceId, preview.previewName)
                                .pipe(Effect.andThen(Effect.logInfo(`Expired preview cleaned: ${preview.fullDomain}`))),
                            (error) => Effect.logWarning(`Failed to expire preview ${preview.fullDomain}: ${describeFailure(error)}`),
                        );
                    }
                }),
                (error) => Effect.logWarning(`Preview TTL cleanup run failed: ${describeFailure(error)}`),
            );
        }),
    };
}

export type PreviewTtlCleanupServiceShape = Over<ReturnType<typeof makePreviewTtlCleanupService>, PreviewProvisioningService>;

/** Tag and implementation together: the tag is the contract, `live` the one implementation. */
export class PreviewTtlCleanupService extends Context.Service<PreviewTtlCleanupService, PreviewTtlCleanupServiceShape>()(
    "fleet/PreviewTtlCleanupService",
) {
    /** The provisioning service is yielded when a method runs, so this is a constant the module provides with `useValue`. */
    static readonly live: PreviewTtlCleanupServiceShape = serviceOver(PreviewProvisioningService, makePreviewTtlCleanupService);
}

export const PREVIEW_TTL_CLEANUP = Symbol("fleet:preview-ttl-cleanup");

/**
 * Schedules the cleanup when the module is built and stops it with the application. The handle it
 * returns carries the shutdown hook, which Nest calls on a provider's instance whatever built it.
 */
export function startPreviewTtlCleanup(runtime: EffectRuntime, intervalMs: number = TTL_CLEANUP_INTERVAL_MS) {
    const logger = new Logger("PreviewTtlCleanup");
    const timer = setInterval(() => {
        runtime
            .runPromise(
                Effect.gen(function* () {
                    const cleanup = yield* PreviewTtlCleanupService;
                    yield* cleanup.runCleanup();
                }),
            )
            .catch((error: unknown) => {
                logger.warn(`Preview TTL cleanup run failed: ${describeFailure(error)}`);
            });
    }, intervalMs);
    timer.unref();
    logger.log(`Preview TTL cleanup scheduled every ${String(intervalMs / 60000)} minutes`);

    return {
        onModuleDestroy(): void {
            clearInterval(timer);
        },
    };
}
