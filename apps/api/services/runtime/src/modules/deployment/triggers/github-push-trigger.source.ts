import { Effect } from "effect";

import type { DeploymentTriggerInput } from "@deployer/runtime-contracts/modules/deployment/crud";

import { attempt } from "../../../core/effects";

import { TriggerServiceLinkPort } from "./deployment-trigger.ports";

import type { DeploymentTriggerEvent, DeploymentTriggerSource } from "./base/deployment-trigger-source.interface";

/**
 * GitHub `push` → deployment.
 *
 * ── THIS WAS ABSENT, DELIBERATELY NOT-BUILT ──────────────────────────────
 * `github.webhooks.controller.ts:74-78` explicitly logged and SKIPPED `push`, and the
 * repo→service resolution it needs was left as `TODO(T032)`. So "auto-deploy on push" —
 * the single most expected feature of a PaaS — did not exist, and could not be added
 * without editing the webhook controller.
 *
 * This source is the other half of that: it claims `github/push`, resolves the repository
 * to a linked service, and produces the trigger input the API path would have produced.
 * The webhook controller calls the registry; it no longer contains push logic.
 *
 * ── CORRECTION (this file previously reported itself DISABLED) ─────────────
 * An earlier version of this source claimed the repo→service bridge did not exist and
 * had `isEnabled()` return `typeof repo.findServiceBySourceUrl === "function"` through a
 * duck-typed cast. That was wrong in a way that made a working feature inert:
 *
 *   DeploymentRepository.findServiceBySourceUrl(sourceUrl)
 *     → selects services, matches normalized `providerConfig.sourceUrl`, returns the row
 *
 * It is fully implemented and has been all along. The source therefore reports ENABLED,
 * and whether a particular push deploys depends on whether a service has a `sourceUrl`
 * configured — a normal runtime condition (logged and skipped), not a capability gap.
 */
export class GithubPushTriggerSource implements DeploymentTriggerSource<TriggerServiceLinkPort> {
    readonly sourceId = "github-push";

    isEnabled(): boolean {
        // The bridge exists (see the correction above). A push that matches no service is
        // a runtime no-match, handled in `toTriggerInput`, not a disabled source.
        return true;
    }

    disabledReason(): string {
        return "GitHub push triggering is enabled; a push deploys only when its repository matches a service's configured sourceUrl.";
    }

    matches(event: DeploymentTriggerEvent): boolean {
        return event.provider === "github" && event.eventName === "push";
    }

    toTriggerInput(event: DeploymentTriggerEvent) {
        const payload = this.asPushPayload(event.payload);
        if (!payload) return Effect.succeed(null);

        // A push to a deleted branch, or a deleted repo, is not deployable.
        if (payload.deleted === true) return Effect.succeed(null);
        const commitSha = payload.head_commit?.id ?? payload.after;
        if (typeof commitSha !== "string" || commitSha.length === 0) return Effect.succeed(null);

        const branch = typeof payload.ref === "string" ? payload.ref.replace(/^refs\/heads\//, "") : null;
        if (branch === null) return Effect.succeed(null);

        const repositoryUrl = payload.repository?.html_url;
        if (typeof repositoryUrl !== "string") return Effect.succeed(null);

        const findLinkedService = this.findLinkedService;
        return Effect.gen(function* () {
            const linked = yield* findLinkedService(repositoryUrl);
            if (!linked) {
                yield* Effect.logWarning(
                    `push to ${repositoryUrl} ignored: no service is linked to this repository (branch ${branch}, ${commitSha.slice(0, 7)})`,
                );
                return null;
            }

            return {
                serviceId: linked.serviceId,
                environment: linked.environment,
                source: {
                    sourceType: "github",
                    repositoryUrl,
                    branch,
                    commitSha,
                },
            } as DeploymentTriggerInput;
        });
    }

    /** The bridge to repo→service mapping, kept in one place so the shape is type-checked. */
    private readonly findLinkedService = (repositoryUrl: string) => {
        return Effect.gen(function* () {
            const links = yield* TriggerServiceLinkPort;
            const found = yield* attempt(() => links.findServiceBySourceUrl(repositoryUrl));
            if (!found) return null;
            // `services` has no `environment` column — environments are separate rows. The
            // target environment for a push is therefore the default, unless the service's
            // provider config pins one.
            const pinnedEnvironment = (found.providerConfig as { environment?: string } | null)?.environment;
            return {
                serviceId: found.id,
                environment: typeof pinnedEnvironment === "string" ? pinnedEnvironment : "production",
            };
        });
    };

    private asPushPayload(payload: unknown): {
        ref?: unknown;
        after?: unknown;
        deleted?: unknown;
        head_commit?: { id?: unknown } | null;
        repository?: { html_url?: unknown } | null;
    } | null {
        if (payload === null || typeof payload !== "object") return null;
        return payload;
    }
}
