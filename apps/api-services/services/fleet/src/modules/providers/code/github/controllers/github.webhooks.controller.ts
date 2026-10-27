/**
 * GitHub Webhooks Controller
 *
 * Receives GitHub App webhook deliveries (POST /webhooks/github). The route
 * is guarded by the `githubWebhookAuth` ORPC middleware — signature
 * verification (the GitHub challenge) + idempotency — so the handler only
 * dispatches verified, first-seen events.
 *
 * File naming follows the webhook standard: `<provider>.webhooks.controller.ts`.
 * The guard middleware lives in `providers/middleware/`, NOT next to the
 * controllers.
 */
import { Controller, Logger } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { isPullRequestWebhook, isInstallationWebhook, providersContract } from "@deployer/fleet-contracts";
import { type PullRequestEvent, type InstallationEvent, type InstallationRepositoriesEvent } from "@deployer/fleet-contracts";
import { standardErrorOptions } from "@deployer/orpc-utils";
import { githubWebhookAuth } from "@/modules/providers/middleware/github-webhook-auth.middleware";
import { GithubWebhookDispatchService } from "../services/github-webhook-dispatch.service";
import { WebhookIdempotencyService } from "../services/webhook-idempotency.service";
import { GithubAppsRepository } from "../repositories/github-apps.repository";
import { DeploymentTriggerGateway } from "../services/deployment-trigger.gateway";

// T032: Webhook-driven preview create/update orchestration.
// T036: Webhook idempotency keys and duplicate-delivery handling.
@Controller()
export class GithubWebhooksController {
    private readonly logger = new Logger(GithubWebhooksController.name);

    constructor(
        private readonly idempotencyService: WebhookIdempotencyService,
        private readonly dispatchService: GithubWebhookDispatchService,
        private readonly githubAppsRepository: GithubAppsRepository,
        private readonly triggerGateway: DeploymentTriggerGateway,
    ) {}

    @Implement(providersContract.code.github.webhook)
    receive() {
        return implement(providersContract.code.github.webhook)
            .use(githubWebhookAuth({
                idempotencyService: this.idempotencyService,
                githubAppsRepository: this.githubAppsRepository,
            }))
            .handler(async ({ context, input, errors }) => {
                const { eventType, deliveryId, skippedReason } = context.webhook;

                // T036: duplicate delivery — middleware short-circuited
                if (skippedReason) {
                    return { received: true, deliveryId, action: "skipped", reason: skippedReason };
                }

                // `input` is the DETAILED webhook input:
                //   { body: WebhookEvent, headers: { "x-github-event"?, ... } }
                // `input.body` is typed as the SDK's `WebhookEvent` union via
                // the contract's passthrough schema (z.custom<WebhookEvent>).
                // The type guards narrow the union to the exact SDK payload
                // for the event — no blind casts.
                const payload = input.body;

                if (eventType === "pull_request") {
                    if (!isPullRequestWebhook(eventType, payload)) {
                        throw errors.BAD_REQUEST(
                            standardErrorOptions("validation", "Malformed pull_request webhook payload"),
                        );
                    }
                    return this.handlePullRequest(payload, deliveryId);
                }

                if (eventType === "installation" || eventType === "installation_repositories") {
                    if (!isInstallationWebhook(eventType, payload)) {
                        throw errors.BAD_REQUEST(
                            standardErrorOptions("validation", "Malformed installation webhook payload"),
                        );
                    }
                    return this.handleInstallation(payload, deliveryId, eventType);
                }

                // Everything else is offered to runtime's trigger registry: a `push` that
                // matches a linked service deploys it, anything no source claims (issues,
                // stars, releases…) is a normal skip.
                const relayed = await this.triggerGateway.relay({
                    provider: "github",
                    eventName: eventType,
                    deliveryId,
                    payload,
                });
                if (!relayed.dispatched) {
                    return { received: true, deliveryId, action: "skipped", reason: relayed.reason ?? `unhandled_event:${eventType}` };
                }
                return {
                    received: true,
                    deliveryId,
                    action: "deployed",
                    reason: `trigger:${relayed.sourceId ?? "unknown"}:${relayed.deploymentId ?? ""}`,
                };
            });
    }

    /**
     * Handle GitHub `installation` / `installation_repositories` webhooks.
     *
     * When a user installs the GitHub App on their repos (or adds repos to an
     * existing install), GitHub POSTs an `installation` event with the
     * installation payload. We match the row by `app_id` and persist the
     * `installation_id` so repo listing / checkout can use the app's
     * installation credentials.
     *
     * The payload is already narrowed by `isInstallationWebhook` (header +
     * `installation.id`/`app_id` numeric check), so no runtime guards remain.
     */
    private async handleInstallation(
        payload: InstallationEvent | InstallationRepositoriesEvent,
        deliveryId: string,
        eventType: string,
    ): Promise<{ received: true; deliveryId: string; action?: string; reason?: string }> {
        const action = payload.action;
        const { id: installationId, app_id: appId } = payload.installation;

        // Remove installation (app uninstalled / suspended).
        if (action === "deleted" || action === "suspend") {
            await this.githubAppsRepository.setInstallation(String(appId), null);
            this.logger.log(`GitHub App ${appId} installation ${action} — cleared installation id`);
            return { received: true, deliveryId, action, reason: `installation:${action}` };
        }

        // Persist the installation id on the matching app row (action: created / added / unsuspend).
        const updated = await this.githubAppsRepository.setInstallation(String(appId), String(installationId));

        if (updated) {
            this.logger.log(`GitHub App ${appId} installation recorded: ${installationId} (action=${action}, event=${eventType})`);
            return { received: true, deliveryId, action, reason: `installation:${action}` };
        }

        this.logger.warn(`GitHub App ${appId} not found in DB — installation ${installationId} not recorded`);
        return { received: true, deliveryId, action, reason: "installation:app_not_found" };
    }

    private async handlePullRequest(
        payload: PullRequestEvent,
        deliveryId: string,
    ): Promise<{ received: true; deliveryId: string; action?: string; reason?: string }> {
        const action = payload.action;

        // Only dispatch lifecycle actions we orchestrate; acknowledge the rest
        // (edited, labeled, review_requested, ...) without side effects.
        if (action !== "opened" && action !== "synchronize" && action !== "reopened" && action !== "closed") {
            return { received: true, deliveryId, action, reason: `pull_request:${action}` };
        }

        const { number: prNumber, head, merged } = payload.pull_request;
        const branchName = head.ref;
        const commitSha = head.sha;

        // Resolve the service the repository is linked to. Without a link there is nothing to
        // provision a preview for: say so rather than pass the repository name as a service id.
        const repositoryUrl = payload.repository?.html_url;
        const linked =
            typeof repositoryUrl === "string"
                ? await this.githubAppsRepository.findServiceBySourceUrl(repositoryUrl)
                : null;
        if (!linked) {
            this.logger.warn(
                `pull_request ${action} on ${payload.repository?.full_name ?? "unknown repository"} ignored: no service is linked to it`,
            );
            return { received: true, deliveryId, action, reason: "pull_request:no_linked_service" };
        }
        const serviceId = linked.id;

        const result = await this.dispatchService.dispatchPrEvent({
            // Narrowed by the equality checks above to GithubPrAction.
            action,
            prNumber,
            branchName,
            commitSha,
            merged: Boolean(merged),
            serviceId,
            deliveryId,
        });

        return { received: true, deliveryId, action: result.action, reason: result.reason };
    }
}
