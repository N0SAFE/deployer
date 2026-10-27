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
import { ModuleRef } from "@nestjs/core";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { isPullRequestWebhook, isInstallationWebhook, providersContract } from "@deployer/fleet-contracts";
import type { PullRequestEvent, InstallationEvent, InstallationRepositoriesEvent } from "@deployer/fleet-contracts";
import { standardErrorOptions } from "@deployer/orpc-utils";
import { githubWebhookAuth } from "@/modules/providers/middleware/github-webhook-auth.middleware";
import { GithubWebhookDispatchService } from "../services/github-webhook-dispatch.service";
import { WebhookIdempotencyService } from "../services/webhook-idempotency.service";
import { GithubAppsRepository } from "../repositories/github-apps.repository";
import { DeploymentTriggerRegistryService } from "@/modules/deployment/triggers/deployment-trigger-registry.service";

// T032: Webhook-driven preview create/update orchestration.
// T036: Webhook idempotency keys and duplicate-delivery handling.
@Controller()
export class GithubWebhooksController {
    private readonly logger = new Logger(GithubWebhooksController.name);

    constructor(
        private readonly idempotencyService: WebhookIdempotencyService,
        private readonly dispatchService: GithubWebhookDispatchService,
        private readonly githubAppsRepository: GithubAppsRepository,
        private readonly moduleRef: ModuleRef,
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

                // ── Everything else goes through the trigger registry ────────────
                // Previously: `logger.log("unhandled event type")` and return skipped.
                // That is how "auto-deploy on push" — the most expected feature of a
                // PaaS — silently did not exist: the controller had no idea a
                // `GithubPushTriggerSource` was registered, and the registry had no way
                // to be reached from here.
                //
                // Now the controller asks the registry whether any source claims the
                // event. The answer is still a normal skip when nothing matches (GitHub
                // delivers issues, stars, releases…), but a push that resolves to a
                // service produces a real `DeploymentTriggerInput`.
                const triggerRegistry = await this.resolveTriggerRegistry();
                const resolution = triggerRegistry
                    ? await triggerRegistry.toTriggerInput({
                          provider: "github",
                          eventName: eventType,
                          payload,
                      })
                    : null;

                if (!resolution) {
                    this.logger.log(
                        `No deployment trigger source matched event type=${eventType} delivery=${deliveryId}`,
                    );
                    return { received: true, deliveryId, action: "skipped", reason: `unhandled_event:${eventType}` };
                }

                // ── The remaining gap, stated rather than hidden ────────────────
                // `triggerDeployment(input, userId, role)` requires an ACTING USER for
                // the project-access check, and a webhook has none — it carries a
                // repository, not a session. Deploying from here therefore needs a
                // service-account / system-actor concept that does not exist yet
                // (`assertDeploymentServiceAccess` has no system bypass).
                //
                // Rather than fake a user id (which would either trip the access check
                // or, worse, pass it for the wrong reason), the resolved trigger is
                // logged with everything needed to act on it. This is strictly better
                // than the previous behaviour: the input is now COMPUTED and correct,
                // so wiring the actor later is a single call, and operators can see
                // exactly what would have deployed.
                this.logger.log(
                    `Trigger '${resolution.sourceId}' matched event=${eventType} delivery=${deliveryId}: ` +
                        `service=${resolution.input?.serviceId ?? "none"} ` +
                        `environment=${resolution.input?.environment ?? "none"} — not dispatched (no system actor for webhook-initiated deploys yet)`,
                );

                return {
                    received: true,
                    deliveryId,
                    action: "skipped",
                    reason: `trigger_resolved_no_system_actor:${resolution.sourceId}`,
                };
            });
    }

    /**
     * Resolve the deployment trigger registry lazily.
     *
     * `DeploymentModule` already imports `ProvidersModule`, so injecting the registry
     * directly here would create a module cycle. `ModuleRef.get` with `{ strict: false }`
     * reaches the instance the app already built, without declaring the dependency
     * statically. The registry is optional: if the deployment module is not loaded in a
     * given process (e.g. the webhook-only worker), the handler degrades to "no source
     * matched", which is the same answer it gives for an unrelated event type.
     */
    private async resolveTriggerRegistry(): Promise<DeploymentTriggerRegistryService | null> {
        try {
            return this.moduleRef.get(DeploymentTriggerRegistryService, { strict: false });
        } catch {
            this.logger.warn(
                "DeploymentTriggerRegistryService is not available in this context — webhook events will not be routed to deployment triggers",
            );
            return null;
        }
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

        // Resolve the REAL service from the repository, using the same bridge the push
        // trigger uses: `findServiceBySourceUrl` matches the normalized
        // `services.providerConfig.sourceUrl`.
        //
        // This was `const serviceId = payload.repository?.full_name ?? "unknown"` with a
        // `TODO(T032)`. A `full_name` ("owner/repo") is not a service id, so every PR
        // preview was dispatched against a service that cannot exist and silently did
        // nothing — the bridge already existed, it just was not called.
        const repositoryUrl = payload.repository?.html_url;
        const linkedService =
            typeof repositoryUrl === "string"
                ? await this.githubAppsRepository.findServiceBySourceUrl(repositoryUrl)
                : null;

        if (!linkedService) {
            this.logger.log(
                `pull_request #${String(prNumber)} ignored: no service is linked to ${repositoryUrl ?? "an unknown repository"}`,
            );
            return { received: true, deliveryId, action, reason: `pull_request:no_linked_service` };
        }

        const result = await this.dispatchService.dispatchPrEvent({
            // Narrowed by the equality checks above to GithubPrAction.
            action,
            prNumber,
            branchName,
            commitSha,
            merged: Boolean(merged),
            serviceId: linkedService.id,
            deliveryId,
        });

        return { received: true, deliveryId, action: result.action, reason: result.reason };
    }
}
