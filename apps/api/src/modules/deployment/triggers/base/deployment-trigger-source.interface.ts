import type { DeploymentTriggerInput } from "@deployer/runtime-contracts/modules/deployment/crud";
import type { DeploymentSourceCheckoutContext } from "@/modules/providers/base/source-provider.interface";

/**
 * DeploymentTriggerSource — the public entry point for "what can START a deployment".
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 * Before this interface, "what triggers a deploy" was scattered across four call sites
 * with no shared abstraction:
 *
 *   `DeploymentService.triggerDeployment`   the API request path
 *   `github.webhooks.controller`           webhooks — and `push` was explicitly SKIPPED,
 *                                          with a `TODO(T032)` where repo→service
 *                                          resolution should have been
 *   `github-webhook-dispatch.dispatchPrEvent` PR events — provisions DNS/routes but
 *                                          never deploys the PR commit
 *   `rollbackDeployment` / `retryDeployment` separate methods with their own payloads
 *
 * Adding "deploy on push", "deploy on a schedule", or "deploy from a Docker Hub webhook"
 * therefore meant editing all of the callers rather than adding one file. This seam
 * inverts that: each origin becomes a `DeploymentTriggerSource`, registered under
 * `DEPLOYMENT_TRIGGER_SOURCES`, and the registry answers "which source owns this event,
 * and what trigger input does it produce?".
 *
 * ── WHY IT RETURNS A `DeploymentTriggerInput` AND NOT A DEPLOYMENT ─────────
 * A trigger source must NOT know how to deploy. It translates an external event into the
 * one input shape `DeploymentService.triggerDeployment` already accepts, so every
 * validation path (authz, runtime constraints, state machine, storage, builders) stays in
 * ONE place. A source that called the service directly would re-implement them and drift.
 *
 * ── WHY `matches()` IS SEPARATE FROM `toTriggerInput()` ────────────────────
 * A webhook payload can only decide "is this mine?" cheaply, while building the input may
 * need lookups (resolve the repo to a service, pick the branch). Splitting them lets the
 * registry choose a source without paying for those lookups, and keeps the "no source
 * matched" answer cheap and explicit.
 */
export interface DeploymentTriggerSource {
    /** Dispatch key, lowercase: "api" | "github-push" | "github-pull-request" | "schedule" | … */
    readonly sourceId: string;

    /**
     * Whether this source owns the given event.
     *
     * `event` is intentionally `unknown`: each source validates its own payload shape.
     * A source must return `false` rather than throw on a payload it does not recognise,
     * so one malformed delivery cannot break dispatch for the others.
     */
    matches(event: DeploymentTriggerEvent): boolean;

    /**
     * Translate the event into the input `triggerDeployment` accepts.
     *
     * Called only after `matches()` returned true, so it may assume the event shape —
     * and it SHOULD throw a domain error when the event is well-formed but the deployment
     * cannot be built (e.g. no service is linked to that repository).
     */
    toTriggerInput(event: DeploymentTriggerEvent): Promise<DeploymentTriggerInput | null>;

    /**
     * Whether this source can fire right now.
     *
     * Separating this from `matches()` is what lets a source be registered but inert —
     * for example a push source on a platform with no repo→service link — and report why
     * instead of silently never matching.
     */
    isEnabled(): boolean;

    /** Reason when `isEnabled()` is false. */
    disabledReason(): string;
}

/**
 * The event envelope a source receives.
 *
 * Deliberately generic rather than a union of every webhook body: a new source must be
 * addable without editing this file. `payload` is the provider's parsed webhook body or
 * the API request body; `kind` tells the source which one to expect.
 */
export interface DeploymentTriggerEvent {
    /** Where the event came from: "api" | "github" | "gitlab" | "schedule" | … */
    readonly provider: string;
    /** The provider's event name, e.g. "push" | "pull_request" | "deployment". */
    readonly eventName: string;
    /** The raw parsed body. Sources narrow it themselves. */
    readonly payload: unknown;
    /** Set when the caller already knows the service (API path). */
    readonly serviceId?: string | null;
    /** Set when the caller already knows the project. */
    readonly projectId?: string | null;
}

/**
 * Re-exported so a source implementation needs only this one import.
 *
 * `DeploymentTriggerInput` is the contract's own type — redefining it here would be a
 * second source of truth for the most important shape in the trigger path.
 */
export type { DeploymentTriggerInput, DeploymentSourceCheckoutContext };
