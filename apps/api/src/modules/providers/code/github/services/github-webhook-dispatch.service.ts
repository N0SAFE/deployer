import { Injectable, Logger } from "@nestjs/common";
import { PreviewNamingService } from "@/core/modules/deployment/services/preview-naming.service";
import { PreviewCleanupPolicyService } from "@/core/modules/deployment/services/preview-cleanup-policy.service";
import { DomainRoutingService } from "@/core/modules/domain/services/domain-routing.service";
import { PreviewLifecycleEventService } from "../events/preview-lifecycle-event.service";
import { PreviewProvisioningService } from "./preview-provisioning.service";
import { GithubDeploymentRuleService } from "./github-deployment-rule.service";

export type GithubPrAction =
    | "opened"
    | "synchronize"
    | "reopened"
    | "closed";

export interface GithubPrEvent {
    action: GithubPrAction;
    /** Project scope for rule evaluation; optional until repo→project resolution is wired. */
    projectId?: string;
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
        private readonly previewProvisioningService: PreviewProvisioningService,
        private readonly domainRoutingService: DomainRoutingService,
        private readonly deploymentRuleService: GithubDeploymentRuleService,
    ) {}

    async dispatchPrEvent(event: GithubPrEvent): Promise<PreviewDispatchResult> {
        const { action, prNumber, branchName, commitSha, merged, serviceId, projectId, previewTemplateId, previewUrlPattern, deliveryId } = event;

        // T0xx: Wire the per-project github_deployment_rules into the decision
        // before the default behavior, so an event can be gated (skip) or
        // explicitly routed (deploy/preview) by configured rules. Only runs
        // when a real projectId is available (repo→project resolution not yet
        // wired in the webhook controller).
        if (projectId) {
            const rule = await this.deploymentRuleService.resolveAction({
                projectId,
                event: "pull_request",
                branch: branchName,
                changedFiles: [],
            });
            if (rule.action === "skip") {
                this.logger.log(`PR #${prNumber} skipped by rule (${rule.reason})`);
                return { action: "skipped", reason: rule.reason };
            }
        }

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
        // B2: derive the preview base domain from the service's primary domain
        // mapping (data-driven — never env vars, never a `.local` fallback).
        const urls = await this.domainRoutingService.resolveServiceUrls(input.serviceId);
        const primary = urls.find((u) => u.isPrimary) ?? urls[0];
        const baseDomain = primary?.domain;
        const urlPattern = input.previewUrlPattern
            ?? (baseDomain ? `preview-pr-{{pr_number}}.${baseDomain}` : "preview-pr-{{pr_number}}");

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

        // Provision DNS + route + preview record (non-blocking for the webhook).
        void this.previewProvisioningService.provisionPreview({
            serviceId: input.serviceId,
            previewName: naming.previewName,
            branchName: input.branchName,
            prNumber: input.prNumber,
            commitSha: input.commitSha,
            deliveryId: input.deliveryId,
        }).catch((error: unknown) => {
            this.logger.warn(`Preview provisioning failed for ${naming.previewName}: ${error instanceof Error ? error.message : String(error)}`);
        });

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
        const previewName = `pr-${String(input.prNumber)}`;

        await this.previewLifecycleEventService.emit("previewCleaned", { serviceId: input.serviceId }, {
            serviceId: input.serviceId,
            previewName,
            trigger,
            reason: decision.reason,
            deliveryId: input.deliveryId,
            timestamp: new Date().toISOString(),
        });

        this.logger.log(`Preview cleaned: ${previewName} trigger=${trigger} reason=${decision.reason} (service=${input.serviceId})`);

        // Deactivate route + remove DNS record + mark preview rows inactive.
        void this.previewProvisioningService.cleanupPreview({
            serviceId: input.serviceId,
            previewName,
            branchName: input.branchName,
            prNumber: input.prNumber,
            trigger,
            reason: decision.reason,
            deliveryId: input.deliveryId,
        }).catch((error: unknown) => {
            this.logger.warn(`Preview cleanup failed for ${previewName}: ${error instanceof Error ? error.message : String(error)}`);
        });

        return { action: "cleaned", reason: decision.reason, previewName };
    }
}
