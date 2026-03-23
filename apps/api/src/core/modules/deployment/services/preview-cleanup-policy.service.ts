import { Injectable } from "@nestjs/common";
import type { PreviewTemplateConfig } from "@repo/api-contracts/common/template";

export type PreviewCleanupTrigger = "merge" | "close" | "ttl_expired";

export interface PreviewCleanupDecision {
    cleanup: boolean;
    reason: string;
}

@Injectable()
export class PreviewCleanupPolicyService {
    shouldCleanup(
        trigger: PreviewCleanupTrigger,
        config: Pick<PreviewTemplateConfig, "autoDeleteOnMerge" | "autoDeleteOnClose" | "ttlHours">,
    ): PreviewCleanupDecision {
        switch (trigger) {
            case "merge":
                return config.autoDeleteOnMerge
                    ? { cleanup: true, reason: "pr_merged_auto_delete" }
                    : { cleanup: false, reason: "pr_merged_auto_delete_disabled" };

            case "close":
                return config.autoDeleteOnClose
                    ? { cleanup: true, reason: "pr_closed_auto_delete" }
                    : { cleanup: false, reason: "pr_closed_auto_delete_disabled" };

            case "ttl_expired":
                return { cleanup: true, reason: `ttl_expired_after_${String(config.ttlHours)}h` };
        }
    }

    computeExpiryDate(createdAt: Date, ttlHours: number): Date {
        return new Date(createdAt.getTime() + ttlHours * 60 * 60 * 1000);
    }

    isTtlExpired(createdAt: Date, ttlHours: number, now: Date = new Date()): boolean {
        return now >= this.computeExpiryDate(createdAt, ttlHours);
    }
}