/**
 * Providers Contracts
 *
 * Unified provider configuration system.
 *
 * Structure:
 *   providers/
 *     code/  — CODE providers (github, gitlab, ...) → orpc.providers.code.<variant>.*
 *     dns/   — DNS providers (cloudflare, route53, ...) → orpc.providers.dns.* + orpc.providers.dns.<variant>.*
 */
import { oc } from "@orpc/contract";
import { codeProvidersContract } from "./code";
import { dnsProvidersContract } from "./dns";

/**
 * Providers contract combines all provider-type sub-contracts.
 * - `providers.code.<variant>.*` — code providers (github, gitlab, ...)
 * - `providers.dns.<op>` — shared DNS provider-app CRUD
 * - `providers.dns.<variant>.*` — DNS provider variants (cloudflare, ...)
 */
export const providersContract = oc.router({
    code: codeProvidersContract,
    dns: dnsProvidersContract,
});

export type ProvidersContract = typeof providersContract;

export * from "./code";
export * from "./dns";
export {
    githubAppContract,
    githubWebhookContract,
    githubWebhookPayloadSchema,
    githubWebhookHeadersSchema,
    isPullRequestWebhook,
    isInstallationWebhook,
    runnerDetectionHintsSchema,
} from "./code/github/contracts";
export type { GithubWebhookInput } from "./code/github/contracts";
export type {
    WebhookEvent,
    WebhookEventMap,
    WebhookEventName,
    PullRequestEvent,
    InstallationEvent,
    InstallationRepositoriesEvent,
    PushEvent,
    CreateEvent,
    DeleteEvent,
} from "@octokit/webhooks-types";
export type { GitHubAppContract, RunnerDetectionHints } from "./code/github/contracts";
