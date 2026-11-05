import { Context } from "effect";

import type { PreviewTemplateConfig } from "@deployer/contracts-entities";

export type PreviewCleanupTrigger = "merge" | "close" | "ttl_expired";

export type PreviewCleanupDecision = {
    cleanup: boolean;
    reason: string;
}

export type PreviewCleanupPolicyShape = {
    readonly shouldCleanup: (
        trigger: PreviewCleanupTrigger,
        config: Pick<PreviewTemplateConfig, "autoDeleteOnMerge" | "autoDeleteOnClose" | "ttlHours">,
    ) => PreviewCleanupDecision;
    readonly computeExpiryDate: (createdAt: Date, ttlHours: number) => Date;
    readonly isTtlExpired: (createdAt: Date, ttlHours: number, now?: Date) => boolean;
};

/** Pure and total: no ports, no failure. */
export function makePreviewCleanupPolicy(): PreviewCleanupPolicyShape {
    const computeExpiryDate: PreviewCleanupPolicyShape["computeExpiryDate"] = (createdAt, ttlHours) =>
        new Date(createdAt.getTime() + ttlHours * 60 * 60 * 1000);
    return {
        computeExpiryDate,
        isTtlExpired: (createdAt, ttlHours, now = new Date()) => now >= computeExpiryDate(createdAt, ttlHours),
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
    };
}

export class PreviewCleanupPolicyService extends Context.Service<PreviewCleanupPolicyService, PreviewCleanupPolicyShape>()(
    "shared/PreviewCleanupPolicyService",
) {
    static readonly live: PreviewCleanupPolicyShape = makePreviewCleanupPolicy();
}
