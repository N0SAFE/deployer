import { Effect } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { provideTo } from '@deployer/effect-core'

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
    GithubWebhookDispatchService,
    type GithubPrEvent,
} from './github-webhook-dispatch.service'
import {
    PreviewProvisioningService,
    type PreviewProvisioningServiceShape,
} from './preview-provisioning.service'

const event: GithubPrEvent = {
    action: 'opened',
    prNumber: 7,
    branchName: 'feat/x',
    commitSha: 'abc',
    merged: false,
    serviceId: 'svc-1',
    deliveryId: 'd-1',
}

/** Let the detached provisioning fiber run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function setup() {
    const naming = {
        buildPreviewName: vi.fn(() =>
            Effect.succeed({
                previewName: 'pr-7',
                resolvedUrl: 'pr-7.example.com',
            })
        ),
    }
    const cleanupPolicy = {
        shouldCleanup: vi.fn(() => ({ cleanup: true, reason: 'pr_closed' })),
    }
    const lifecycle = { emitEffect: vi.fn(() => Effect.void) }
    const provisioning = {
        provisionPreview: vi.fn(() => Effect.succeed({})),
        cleanupPreview: vi.fn(() => Effect.succeed({})),
    }
    const routing = {
        resolveServiceUrls: vi.fn(() =>
            Effect.succeed([{ domain: 'example.com', isPrimary: true }])
        ),
    }
    const rules = {
        resolveAction: vi.fn(() =>
            Effect.succeed({ action: 'deploy', reason: 'no_rule_matched' })
        ),
    }
    // The fakes need nothing from the context beyond what is provided here.
    const service = provideTo(
        new GithubWebhookDispatchService.live(),
        (effect) =>
            effect.pipe(
                Effect.provideService(
                    PreviewNaming,
                    naming as unknown as PreviewNamingShape
                ),
                Effect.provideService(
                    PreviewCleanupPolicy,
                    cleanupPolicy as unknown as PreviewCleanupPolicyShape
                ),
                Effect.provideService(
                    PreviewLifecycleEventService,
                    lifecycle as unknown as PreviewLifecycleEventServiceShape
                ),
                Effect.provideService(
                    PreviewProvisioningService,
                    provisioning as unknown as PreviewProvisioningServiceShape
                ),
                Effect.provideService(
                    DomainRouting,
                    routing as unknown as DomainRoutingShape
                ),
                Effect.provideService(
                    GithubDeploymentRuleService,
                    rules as unknown as GithubDeploymentRuleServiceShape
                )
            ) as Effect.Effect<unknown>
    )
    return {
        service,
        naming,
        cleanupPolicy,
        lifecycle,
        provisioning,
        routing,
        rules,
    }
}

describe('GithubWebhookDispatchService', () => {
    let t: ReturnType<typeof setup>
    beforeEach(() => {
        t = setup()
    })

    it('creates a preview when a pull request is opened: emits the event and provisions in the background', async () => {
        const result = await Effect.runPromise(t.service.dispatchPrEvent(event))

        expect(result).toEqual({
            action: 'created',
            reason: 'pr_opened',
            previewName: 'pr-7',
            resolvedUrl: 'pr-7.example.com',
        })
        expect(t.naming.buildPreviewName).toHaveBeenCalledWith(
            expect.objectContaining({
                urlPattern: 'preview-pr-{{pr_number}}.example.com',
                namingStrategy: 'pr',
            })
        )
        expect(t.lifecycle.emitEffect).toHaveBeenCalledWith(
            'previewCreated',
            { serviceId: 'svc-1' },
            expect.objectContaining({ previewName: 'pr-7' })
        )
        await settle()
        expect(t.provisioning.provisionPreview).toHaveBeenCalledWith(
            expect.objectContaining({
                serviceId: 'svc-1',
                previewName: 'pr-7',
                prNumber: 7,
            })
        )
    })

    it('updates the preview on a new commit', async () => {
        const result = await Effect.runPromise(
            t.service.dispatchPrEvent({ ...event, action: 'synchronize' })
        )

        expect(result).toMatchObject({
            action: 'updated',
            reason: 'pr_synchronize',
        })
        expect(t.lifecycle.emitEffect).toHaveBeenCalledWith(
            'previewUpdated',
            { serviceId: 'svc-1' },
            expect.anything()
        )
    })

    it('answers before the provisioning finishes, and survives it failing', async () => {
        t.provisioning.provisionPreview.mockReturnValue(
            Effect.fail(new Error('dns down')) as never
        )

        const result = await Effect.runPromise(t.service.dispatchPrEvent(event))
        await settle()

        expect(result.action).toBe('created')
    })

    it('cleans the preview when a pull request is closed', async () => {
        const result = await Effect.runPromise(
            t.service.dispatchPrEvent({
                ...event,
                action: 'closed',
                merged: true,
            })
        )

        expect(t.cleanupPolicy.shouldCleanup).toHaveBeenCalledWith(
            'merge',
            expect.objectContaining({ ttlHours: 168 })
        )
        expect(result).toEqual({
            action: 'cleaned',
            reason: 'pr_closed',
            previewName: 'pr-7',
        })
        expect(t.lifecycle.emitEffect).toHaveBeenCalledWith(
            'previewCleaned',
            { serviceId: 'svc-1' },
            expect.objectContaining({ trigger: 'merge' })
        )
        await settle()
        expect(t.provisioning.cleanupPreview).toHaveBeenCalledWith(
            expect.objectContaining({ trigger: 'merge', previewName: 'pr-7' })
        )
    })

    it('skips the cleanup when the policy keeps the preview', async () => {
        t.cleanupPolicy.shouldCleanup.mockReturnValue({
            cleanup: false,
            reason: 'policy_keeps_preview',
        })

        const result = await Effect.runPromise(
            t.service.dispatchPrEvent({ ...event, action: 'closed' })
        )

        expect(result).toEqual({
            action: 'skipped',
            reason: 'policy_keeps_preview',
        })
        expect(t.provisioning.cleanupPreview).not.toHaveBeenCalled()
    })

    it("lets a project's deployment rule skip the event before anything happens", async () => {
        t.rules.resolveAction.mockReturnValue(
            Effect.succeed({ action: 'skip', reason: 'rule:no previews' })
        )

        const result = await Effect.runPromise(
            t.service.dispatchPrEvent({ ...event, projectId: 'p1' })
        )

        expect(result).toEqual({
            action: 'skipped',
            reason: 'rule:no previews',
        })
        expect(t.lifecycle.emitEffect).not.toHaveBeenCalled()
    })

    it('does not consult the rules without a project', async () => {
        await Effect.runPromise(t.service.dispatchPrEvent(event))

        expect(t.rules.resolveAction).not.toHaveBeenCalled()
    })
})
