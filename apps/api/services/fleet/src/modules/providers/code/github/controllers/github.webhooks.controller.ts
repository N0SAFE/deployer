/**
 * GitHub Webhooks Controller
 *
 * Receives GitHub App webhook deliveries (POST /webhooks/github). The handler runs the
 * `guardGithubWebhook` route guard first — signature verification (the GitHub challenge) +
 * idempotency — so it only dispatches verified, first-seen events.
 *
 * File naming follows the webhook standard: `<provider>.webhooks.controller.ts`.
 * The guard lives in `providers/middleware/`, NOT next to the controllers.
 */
import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { Effect } from "effect";

import { isPullRequestWebhook, isInstallationWebhook, providersContract } from "@deployer/fleet-contracts";
import { type PullRequestEvent, type InstallationEvent, type InstallationRepositoriesEvent } from "@deployer/fleet-contracts";
import { procedure } from "@deployer/nest-effect";

import { FleetInvalid } from "@/core/fleet.errors";
import { serveAnonymous } from "@/core/orpc/serve";
import { guardGithubWebhook } from "@/modules/providers/middleware/github-webhook-auth.middleware";

import { GithubAppsStore } from "../repositories/github-apps.repository";
import { DeploymentTriggerGateway } from "../services/deployment-trigger.gateway";
import { GithubWebhookDispatchService } from "../services/github-webhook-dispatch.service";

type WebhookAck = { received: true; deliveryId: string; action?: string; reason?: string };

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
const handleInstallation = Effect.fn("GithubWebhooksController.handleInstallation")(function* (
    payload: InstallationEvent | InstallationRepositoriesEvent,
    deliveryId: string,
    eventType: string,
) {
    const apps = yield* GithubAppsStore;
    const action = payload.action;
    const { id: installationId, app_id: appId } = payload.installation;

    // Remove installation (app uninstalled / suspended).
    if (action === "deleted" || action === "suspend") {
        yield* apps.setInstallation(String(appId), null);
        yield* Effect.logInfo(`GitHub App ${appId} installation ${action} — cleared installation id`);
        return { received: true, deliveryId, action, reason: `installation:${action}` } satisfies WebhookAck;
    }

    // Persist the installation id on the matching app row (action: created / added / unsuspend).
    const updated = yield* apps.setInstallation(String(appId), String(installationId));

    if (updated) {
        yield* Effect.logInfo(`GitHub App ${appId} installation recorded: ${installationId} (action=${action}, event=${eventType})`);
        return { received: true, deliveryId, action, reason: `installation:${action}` } satisfies WebhookAck;
    }

    yield* Effect.logWarning(`GitHub App ${appId} not found in DB — installation ${installationId} not recorded`);
    return { received: true, deliveryId, action, reason: "installation:app_not_found" } satisfies WebhookAck;
});

const handlePullRequest = Effect.fn("GithubWebhooksController.handlePullRequest")(function* (
    payload: PullRequestEvent,
    deliveryId: string,
) {
    const apps = yield* GithubAppsStore;
    const dispatch = yield* GithubWebhookDispatchService;
    const action = payload.action;

    // Only dispatch lifecycle actions we orchestrate; acknowledge the rest
    // (edited, labeled, review_requested, ...) without side effects.
    if (action !== "opened" && action !== "synchronize" && action !== "reopened" && action !== "closed") {
        return { received: true, deliveryId, action, reason: `pull_request:${action}` } satisfies WebhookAck;
    }

    const { number: prNumber, head, merged } = payload.pull_request;
    const branchName = head.ref;
    const commitSha = head.sha;

    // Resolve the service the repository is linked to. Without a link there is nothing to
    // provision a preview for: say so rather than pass the repository name as a service id.
    const repositoryUrl = payload.repository?.html_url;
    const linked = typeof repositoryUrl === "string" ? yield* apps.findServiceBySourceUrl(repositoryUrl) : null;
    if (!linked) {
        yield* Effect.logWarning(
            `pull_request ${action} on ${payload.repository?.full_name ?? "unknown repository"} ignored: no service is linked to it`,
        );
        return { received: true, deliveryId, action, reason: "pull_request:no_linked_service" } satisfies WebhookAck;
    }
    const serviceId = linked.id;

    const result = yield* dispatch.dispatchPrEvent({
        // Narrowed by the equality checks above to GithubPrAction.
        action,
        prNumber,
        branchName,
        commitSha,
        merged: Boolean(merged),
        serviceId,
        deliveryId,
    });

    return { received: true, deliveryId, action: result.action, reason: result.reason } satisfies WebhookAck;
});

// T032: Webhook-driven preview create/update orchestration.
// T036: Webhook idempotency keys and duplicate-delivery handling.
@Controller()
export class GithubWebhooksController {
    @Implement(providersContract.code.github.webhook)
    receive() {
        return procedure(providersContract.code.github.webhook)
            .effect(function* ({ context, input }) {
                return yield* serveAnonymous(context)(
                    Effect.gen(function* () {
                        const { eventType, deliveryId, skippedReason } = yield* guardGithubWebhook(input);

                        // T036: duplicate delivery — the guard short-circuited
                        if (skippedReason) {
                            return { received: true, deliveryId, action: "skipped", reason: skippedReason } satisfies WebhookAck;
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
                                return yield* new FleetInvalid({ reason: "Malformed pull_request webhook payload" });
                            }
                            return yield* handlePullRequest(payload, deliveryId);
                        }

                        if (eventType === "installation" || eventType === "installation_repositories") {
                            if (!isInstallationWebhook(eventType, payload)) {
                                return yield* new FleetInvalid({ reason: "Malformed installation webhook payload" });
                            }
                            return yield* handleInstallation(payload, deliveryId, eventType);
                        }

                        // Everything else is offered to runtime's trigger registry: a `push` that
                        // matches a linked service deploys it, anything no source claims (issues,
                        // stars, releases…) is a normal skip.
                        const gateway = yield* DeploymentTriggerGateway;
                        const relayed = yield* gateway.relay({
                            provider: "github",
                            eventName: eventType,
                            deliveryId,
                            payload,
                        });
                        if (!relayed.dispatched) {
                            return { received: true, deliveryId, action: "skipped", reason: relayed.reason ?? `unhandled_event:${eventType}` } satisfies WebhookAck;
                        }
                        return {
                            received: true,
                            deliveryId,
                            action: "deployed",
                            reason: `trigger:${relayed.sourceId ?? "unknown"}:${relayed.deploymentId ?? ""}`,
                        } satisfies WebhookAck;
                    }),
                );
            });
    }
}
