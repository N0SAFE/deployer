import { Context, Effect } from 'effect'

import type { RequirementsOf } from '@deployer/effect-core'

import { describeFailure, recover } from '@/core/effects'
import {
    DomainRouting,
    type DomainRoutingShape,
} from '@/core/ports/domain-routing.port'
import {
    PreviewCleanupPolicy,
    type PreviewCleanupPolicyShape,
    PreviewNaming,
    type PreviewNamingShape,
} from '@/core/ports/preview-policy.port'

import {
    PreviewLifecycleEventService,
} from '../events/preview-lifecycle-event.service'

import {
    GithubDeploymentRuleService,
    type GithubDeploymentRuleServiceShape,
} from './github-deployment-rule.service'
import {
    PreviewProvisioningService,
    type PreviewProvisioningServiceShape,
} from './preview-provisioning.service'

export type GithubPrAction = 'opened' | 'synchronize' | 'reopened' | 'closed'

export type GithubPrEvent = {
    action: GithubPrAction
    /** Project scope for rule evaluation; optional until repo→project resolution is wired. */
    projectId?: string
    prNumber: number
    branchName: string
    commitSha: string
    merged: boolean
    serviceId: string
    previewTemplateId?: string | null
    previewUrlPattern?: string | null
    deliveryId: string
}

export type GithubPushEvent = {
    branchName: string
    commitSha: string
    serviceId: string
    deliveryId: string
}

export type PreviewDispatchResult = {
    action: 'created' | 'updated' | 'cleaned' | 'skipped'
    reason: string
    previewName?: string
    resolvedUrl?: string
}

/** What the naming step reads: the naming policy and what it reads in turn. */
type NamingRequirements = PreviewNaming | RequirementsOf<PreviewNamingShape>

/** What the audit step reads: the lifecycle bus (no requirement of its own). */
type LifecycleRequirements = PreviewLifecycleEventService

/**
 * What provisioning a preview reads, backgrounded after the answer.
 *
 * Written as a distribute-over-members helper rather than `RequirementsOf<Shape>`:
 * `RequirementsOf` reads `T[K]` once across a union, so a shape whose members are themselves unions
 * (as this one's are) collapses and the collaborators silently disappear from the channel.
 */
type RequirementsOfShape<S> = {
    [K in keyof S]: S[K] extends (...args: never[]) => infer E
        ? E extends Effect.Effect<unknown, unknown, infer R>
            ? R
            : never
        : never
}[keyof S]

type ProvisioningRequirements =
    | PreviewProvisioningService
    | RequirementsOfShape<PreviewProvisioningServiceShape>

/**
 * The PR event dispatch. Rules are consulted first (they can skip the event entirely); a closed
 * PR cleans up, anything else creates or updates the preview and provisions it in the background.
 */
export type GithubWebhookDispatchServiceShape = {
    readonly dispatchPrEvent: (
        event: GithubPrEvent
    ) => Effect.Effect<
        PreviewDispatchResult,
        unknown,
        | GithubDeploymentRuleService
        | RequirementsOfShape<GithubDeploymentRuleServiceShape>
        | NamingRequirements
        | LifecycleRequirements
        | PreviewCleanupPolicy
        | RequirementsOfShape<PreviewCleanupPolicyShape>
        | DomainRouting
        | RequirementsOfShape<DomainRoutingShape>
        | ProvisioningRequirements
    >
}

// T032: Webhook-driven preview create/update orchestration.
// T037: Emits typed lifecycle audit events via PreviewLifecycleEventService.
/** Tag and implementation together: the tag is the contract, `live` the one implementation. */
export class GithubWebhookDispatchService extends Context.Service<
    GithubWebhookDispatchService,
    GithubWebhookDispatchServiceShape
>()('fleet/GithubWebhookDispatchService') {
    static readonly live = class GithubWebhookDispatchServiceImpl
        implements GithubWebhookDispatchServiceShape
    {
        private handlePrOpenedOrUpdated(input: {
            prNumber: number
            branchName: string
            commitSha: string
            serviceId: string
            previewTemplateId?: string | null
            previewUrlPattern?: string | null
            deliveryId: string
            action: string
        }): Effect.Effect<
            PreviewDispatchResult,
            unknown,
            | NamingRequirements
            | LifecycleRequirements
            | ProvisioningRequirements
            | DomainRouting
            | RequirementsOf<DomainRoutingShape>
        > {
            return Effect.gen(function* () {
                // B2: derive the preview base domain from the service's primary domain
                // mapping (data-driven — never env vars, never a `.local` fallback).
                const routing = yield* DomainRouting
                const urls = yield* routing.resolveServiceUrls(input.serviceId)
                const primary = urls.find((u) => u.isPrimary) ?? urls[0]
                const baseDomain = primary?.domain
                const urlPattern =
                    input.previewUrlPattern ??
                    (baseDomain
                        ? `preview-pr-{{pr_number}}.${baseDomain}`
                        : 'preview-pr-{{pr_number}}')

                const naming = yield* PreviewNaming
                const previewNaming = yield* naming.buildPreviewName({
                    serviceId: input.serviceId,
                    branchName: input.branchName,
                    prNumber: input.prNumber,
                    commitSha: input.commitSha,
                    urlPattern,
                    namingStrategy: 'pr',
                })

                const isCreate = input.action === 'opened'
                const timestamp = new Date().toISOString()
                const lifecycle = yield* PreviewLifecycleEventService

                if (isCreate) {
                    yield* lifecycle.emitEffect(
                        'previewCreated',
                        { serviceId: input.serviceId },
                        {
                            serviceId: input.serviceId,
                            previewName: previewNaming.previewName,
                            resolvedUrl: previewNaming.resolvedUrl,
                            branchName: input.branchName,
                            prNumber: input.prNumber,
                            commitSha: input.commitSha,
                            previewTemplateId: input.previewTemplateId ?? null,
                            deliveryId: input.deliveryId,
                            timestamp,
                        }
                    )
                    yield* Effect.logInfo(
                        `Preview created: ${previewNaming.previewName} for PR #${input.prNumber} (service=${input.serviceId})`
                    )
                } else {
                    yield* lifecycle.emitEffect(
                        'previewUpdated',
                        { serviceId: input.serviceId },
                        {
                            serviceId: input.serviceId,
                            previewName: previewNaming.previewName,
                            resolvedUrl: previewNaming.resolvedUrl,
                            branchName: input.branchName,
                            prNumber: input.prNumber,
                            commitSha: input.commitSha,
                            deliveryId: input.deliveryId,
                            timestamp,
                        }
                    )
                    yield* Effect.logInfo(
                        `Preview updated: ${previewNaming.previewName} (service=${input.serviceId})`
                    )
                }

                // Provision DNS + route + preview record (non-blocking for the webhook).
                const provisioning = yield* PreviewProvisioningService
                yield* Effect.forkDetach(
                    recover(
                        provisioning.provisionPreview({
                            serviceId: input.serviceId,
                            previewName: previewNaming.previewName,
                            branchName: input.branchName,
                            prNumber: input.prNumber,
                            commitSha: input.commitSha,
                            deliveryId: input.deliveryId,
                        }),
                        (error) =>
                            Effect.logWarning(
                                `Preview provisioning failed for ${previewNaming.previewName}: ${describeFailure(error)}`
                            )
                    )
                )

                return {
                    action: isCreate ? 'created' : 'updated',
                    reason: isCreate ? 'pr_opened' : 'pr_synchronize',
                    previewName: previewNaming.previewName,
                    resolvedUrl: previewNaming.resolvedUrl,
                } satisfies PreviewDispatchResult
            })
        }

        private handlePrClosed(input: {
            prNumber: number
            branchName: string
            merged: boolean
            serviceId: string
            previewTemplateId?: string | null
            deliveryId: string
        }): Effect.Effect<
            PreviewDispatchResult,
            unknown,
            | LifecycleRequirements
            | ProvisioningRequirements
            | PreviewCleanupPolicy
        > {
            return Effect.gen(function* () {
                const trigger = input.merged ? 'merge' : 'close'
                const cleanupPolicy = yield* PreviewCleanupPolicy
                const decision = cleanupPolicy.shouldCleanup(trigger, {
                    autoDeleteOnMerge: true,
                    autoDeleteOnClose: true,
                    ttlHours: 168,
                })

                if (!decision.cleanup) {
                    return {
                        action: 'skipped',
                        reason: decision.reason,
                    } satisfies PreviewDispatchResult
                }

                // Resolve the preview name that was originally created for this PR
                const previewName = `pr-${String(input.prNumber)}`

                const lifecycle = yield* PreviewLifecycleEventService
                yield* lifecycle.emitEffect(
                    'previewCleaned',
                    { serviceId: input.serviceId },
                    {
                        serviceId: input.serviceId,
                        previewName,
                        trigger,
                        reason: decision.reason,
                        deliveryId: input.deliveryId,
                        timestamp: new Date().toISOString(),
                    }
                )

                yield* Effect.logInfo(
                    `Preview cleaned: ${previewName} trigger=${trigger} reason=${decision.reason} (service=${input.serviceId})`
                )

                // Deactivate route + remove DNS record + mark preview rows inactive.
                const provisioning = yield* PreviewProvisioningService
                yield* Effect.forkDetach(
                    recover(
                        provisioning.cleanupPreview({
                            serviceId: input.serviceId,
                            previewName,
                            branchName: input.branchName,
                            prNumber: input.prNumber,
                            trigger,
                            reason: decision.reason,
                            deliveryId: input.deliveryId,
                        }),
                        (error) =>
                            Effect.logWarning(
                                `Preview cleanup failed for ${previewName}: ${describeFailure(error)}`
                            )
                    )
                )

                return {
                    action: 'cleaned',
                    reason: decision.reason,
                    previewName,
                } satisfies PreviewDispatchResult
            })
        }

        dispatchPrEvent(
            event: GithubPrEvent
        ): ReturnType<GithubWebhookDispatchServiceShape['dispatchPrEvent']> {
            return Effect.gen({ self: this }, function* () {
                const {
                    action,
                    prNumber,
                    branchName,
                    commitSha,
                    merged,
                    serviceId,
                    projectId,
                    previewTemplateId,
                    previewUrlPattern,
                    deliveryId,
                } = event

                // T0xx: Wire the per-project github_deployment_rules into the decision
                // before the default behavior, so an event can be gated (skip) or
                // explicitly routed (deploy/preview) by configured rules. Only runs
                // when a real projectId is available (repo→project resolution not yet
                // wired in the webhook controller).
                if (projectId) {
                    const rules = yield* GithubDeploymentRuleService
                    const rule = yield* rules.resolveAction({
                        projectId,
                        event: 'pull_request',
                        branch: branchName,
                        changedFiles: [],
                    })
                    if (rule.action === 'skip') {
                        yield* Effect.logInfo(
                            `PR #${prNumber} skipped by rule (${rule.reason})`
                        )
                        return {
                            action: 'skipped',
                            reason: rule.reason,
                        } satisfies PreviewDispatchResult
                    }
                }

                if (action === 'closed') {
                    return yield* this.handlePrClosed({
                        prNumber,
                        branchName,
                        merged,
                        serviceId,
                        previewTemplateId,
                        deliveryId,
                    })
                }

                return yield* this.handlePrOpenedOrUpdated({
                    prNumber,
                    branchName,
                    commitSha,
                    serviceId,
                    previewTemplateId,
                    previewUrlPattern,
                    deliveryId,
                    action,
                })
            })
        }
    }
}
