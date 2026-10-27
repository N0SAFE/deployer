/**
 * Preview TTL Cleanup Service
 *
 * Periodically expires preview environments whose `expiresAt` has passed
 * (default TTL set at provision time — 7 days). For each expired preview it
 * deactivates the traefik route, removes the DNS record, and marks the row
 * inactive via PreviewProvisioningService.
 *
 * Uses a plain setInterval (no external scheduler dep), matching the
 * mesh-cluster-sync pattern. Interval is fixed at 10 minutes.
 */
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PreviewProvisioningService } from "./preview-provisioning.service";

const TTL_CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

@Injectable()
export class PreviewTtlCleanupService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(PreviewTtlCleanupService.name);
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor(
        private readonly previewProvisioningService: PreviewProvisioningService,
    ) {}

    onModuleInit(): void {
        if (this.timer) return;
        this.timer = setInterval(() => {
            void this.runCleanup();
        }, TTL_CLEANUP_INTERVAL_MS);
        this.logger.log(`Preview TTL cleanup scheduled every ${String(TTL_CLEANUP_INTERVAL_MS / 60000)} minutes`);
    }

    onModuleDestroy(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    async runCleanup(): Promise<void> {
        try {
            const expired = await this.previewProvisioningService.findExpiredPreviews();
            if (expired.length === 0) return;

            for (const preview of expired) {
                try {
                    await this.previewProvisioningService.expirePreview(
                        preview.id,
                        preview.serviceId,
                        preview.previewName,
                        preview.fullDomain,
                    );
                    this.logger.log(`Expired preview cleaned: ${preview.fullDomain}`);
                } catch (error) {
                    this.logger.warn(`Failed to expire preview ${preview.fullDomain}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        } catch (error) {
            this.logger.warn(`Preview TTL cleanup run failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
