import { Context, Effect } from 'effect'

import { serviceOver, type Over } from '@deployer/effect-core'

import { attempt, describeFailure, recover } from '@/core/effects'
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
    type PreviewLifecycleEventServiceShape,
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

type Ports = {
    readonly naming: PreviewNamingShape
    readonly cleanupPolicy: PreviewCleanupPolicyShape
    readonly lifecycle: PreviewLifecycleEventServiceShape
    readonly provisioning: PreviewProvisioningServiceShape
    readonly routing: DomainRoutingShape
    readonly rules: GithubDeploymentRuleServiceShape
}

// T032: Webhook-driven preview create/update orchestration.
// Dispatches GitHub PR events to the appropriate preview lifecycle action.
// T037: Emits typed lifecycle audit events via PreviewLifecycleEventService.
function makeGithubWebhookDispatchService({
    naming,
    cleanupPolicy,
    lifecycle,
    provisioning,
    routing,
    rules,
}: Ports) {
    const handlePrOpenedOrUpdated = (input: {
        prNumber: number
        branchName: string
        commitSha: string
        serviceId: string
        previewTemplateId?: string | null
        previewUrlPattern?: string | null
        deliveryId: string
        action: string
    }) =>
        Effect.gen(function* () {
            // B2: derive the preview base domain from the service's primary domain
            // mapping (data-driven — never env vars, never a `.local` fallback).
            const urls = yield* routing.resolveServiceUrls(input.serviceId)
            const primary = urls.find((u) => u.isPrimary) ?? urls[0]
            const baseDomain = primary?.domain
            const urlPattern =
                input.previewUrlPattern ??
                (baseDomain
                    ? `preview-pr-{{pr_number}}.${baseDomain}`
                    : 'preview-pr-{{pr_number}}')

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

    const handlePrClosed = (input: {
        prNumber: number
        branchName: string
        merged: boolean
        serviceId: string
        previewTemplateId?: string | null
        deliveryId: string
    }) =>
        Effect.gen(function* () {
            const trigger = input.merged ? 'merge' : 'close'
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

    return {
        dispatchPrEvent: Effect.fn(
            'GithubWebhookDispatchService.dispatchPrEvent'
        )(function* (event: GithubPrEvent) {
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
                return yield* handlePrClosed({
                    prNumber,
                    branchName,
                    merged,
                    serviceId,
                    previewTemplateId,
                    deliveryId,
                })
            }

            return yield* handlePrOpenedOrUpdated({
                prNumber,
                branchName,
                commitSha,
                serviceId,
                previewTemplateId,
                previewUrlPattern,
                deliveryId,
                action,
            })
        }),
    }
}

export type GithubWebhookDispatchServiceShape = Over<
    ReturnType<typeof makeGithubWebhookDispatchService>,
    | PreviewNaming
    | PreviewCleanupPolicy
    | PreviewLifecycleEventService
    | PreviewProvisioningService
    | DomainRouting
    | GithubDeploymentRuleService
>

/** Tag and implementation together: the tag is the contract, `live` the one implementation. */
export class GithubWebhookDispatchService extends Context.Service<
    GithubWebhookDispatchService,
    GithubWebhookDispatchServiceShape
>()('fleet/GithubWebhookDispatchService') {
    /** The collaborators are yielded when a method runs, so this is a constant the module provides with `useValue`. */
    static readonly live: GithubWebhookDispatchServiceShape = serviceOver(
        Effect.all({
            naming: PreviewNaming,
            cleanupPolicy: PreviewCleanupPolicy,
            lifecycle: PreviewLifecycleEventService,
            provisioning: PreviewProvisioningService,
            routing: DomainRouting,
            rules: GithubDeploymentRuleService,
        }),
        makeGithubWebhookDispatchService
    )
}
