import { Injectable, Logger } from "@nestjs/common";
import { PreviewNamingService } from "@/core/modules/deployment/services/preview-naming.service";
import { PreviewCleanupPolicyService } from "@/core/modules/deployment/services/preview-cleanup-policy.service";
import { PreviewLifecycleEventService } from "../events/preview-lifecycle-event.service";

export type GithubPrAction =
    | "opened"
    | "synchronize"
    | "reopened"
    | "closed";

export interface GithubPrEvent {
    action: GithubPrAction;
    prNumber: number;
    branchName: string;
    commitSha: string;
    merged: boolean;
    serviceId: string;
    previewTemplateId?: string | null;
    previewUrlPattern?: string | null;
    deliveryId: string;
}

export interface GithubPushEvent {
    branchName: string;
    commitSha: string;
    serviceId: string;
    deliveryId: string;
}

export interface PreviewDispatchResult {
    action: "created" | "updated" | "cleaned" | "skipped";
    reason: string;
    previewName?: string;
    resolvedUrl?: string;
}

// T032: Webhook-driven preview create/update orchestration.
// Dispatches GitHub PR events to the appropriate preview lifecycle action.
// T037: Emits typed lifecycle audit events via PreviewLifecycleEventService.
@Injectable()
export class GithubWebhookDispatchService {
    private readonly logger = new Logger(GithubWebhookDispatchService.name);

    constructor(
        private readonly previewNamingService: PreviewNamingService,
        private readonly previewCleanupPolicyService: PreviewCleanupPolicyService,
        private readonly previewLifecycleEventService: PreviewLifecycleEventService,
    ) {}

    async dispatchPrEvent(event: GithubPrEvent): Promise<PreviewDispatchResult> {
        const { action, prNumber, branchName, commitSha, merged, serviceId, previewTemplateId, previewUrlPattern, deliveryId } = event;

        if (action === "closed") {
            return this.handlePrClosed({ prNumber, branchName, merged, serviceId, previewTemplateId, deliveryId });
        }

        if (action === "opened" || action === "synchronize" || action === "reopened") {
            return this.handlePrOpenedOrUpdated({ prNumber, branchName, commitSha, serviceId, previewTemplateId, previewUrlPattern, deliveryId, action });
        }

        return { action: "skipped", reason: `unhandled_pr_action:${action}` };
    }

    private async handlePrOpenedOrUpdated(input: {
        prNumber: number;
        branchName: string;
        commitSha: string;
        serviceId: string;
        previewTemplateId?: string | null;
        previewUrlPattern?: string | null;
        deliveryId: string;
        action: string;
    }): Promise<PreviewDispatchResult> {
        const urlPattern = input.previewUrlPattern ?? "preview-pr-{{pr_number}}.preview.local";

        const naming = this.previewNamingService.buildPreviewName({
            serviceId: input.serviceId,
            branchName: input.branchName,
            prNumber: input.prNumber,
            commitSha: input.commitSha,
            urlPattern,
            namingStrategy: "pr",
        });

        const isCreate = input.action === "opened";
        const timestamp = new Date().toISOString();

        if (isCreate) {
            await this.previewLifecycleEventService.emit("previewCreated", { serviceId: input.serviceId }, {
                serviceId: input.serviceId,
                previewName: naming.previewName,
                resolvedUrl: naming.resolvedUrl,
                branchName: input.branchName,
                prNumber: input.prNumber,
                commitSha: input.commitSha,
                previewTemplateId: input.previewTemplateId ?? null,
                deliveryId: input.deliveryId,
                timestamp,
            });
            this.logger.log(`Preview created: ${naming.previewName} for PR #${input.prNumber} (service=${input.serviceId})`);
        } else {
            await this.previewLifecycleEventService.emit("previewUpdated", { serviceId: input.serviceId }, {
                serviceId: input.serviceId,
                previewName: naming.previewName,
                resolvedUrl: naming.resolvedUrl,
                branchName: input.branchName,
                prNumber: input.prNumber,
                commitSha: input.commitSha,
                deliveryId: input.deliveryId,
                timestamp,
            });
            this.logger.log(`Preview updated: ${naming.previewName} (service=${input.serviceId})`);
        }

        return {
            action: isCreate ? "created" : "updated",
            reason: isCreate ? "pr_opened" : "pr_synchronize",
            previewName: naming.previewName,
            resolvedUrl: naming.resolvedUrl,
        };
    }

    private async handlePrClosed(input: {
        prNumber: number;
        branchName: string;
        merged: boolean;
        serviceId: string;
        previewTemplateId?: string | null;
        deliveryId: string;
    }): Promise<PreviewDispatchResult> {
        const trigger = input.merged ? "merge" : "close";
        const decision = this.previewCleanupPolicyService.shouldCleanup(trigger, {
            autoDeleteOnMerge: true,
            autoDeleteOnClose: true,
            ttlHours: 168,
        });

        if (!decision.cleanup) {
            return { action: "skipped", reason: decision.reason };
        }

        // Resolve the preview name that was originally created for this PR
        const previewName = `pr-${input.prNumber}`;

        await this.previewLifecycleEventService.emit("previewCleaned", { serviceId: input.serviceId }, {
            serviceId: input.serviceId,
            previewName,
            trigger,
            reason: decision.reason,
            deliveryId: input.deliveryId,
            timestamp: new Date().toISOString(),
        });

        this.logger.log(`Preview cleaned: ${previewName} trigger=${trigger} reason=${decision.reason} (service=${input.serviceId})`);

        return { action: "cleaned", reason: decision.reason, previewName };
    }
}
