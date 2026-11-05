import '@orpc/effect/extensions/effect'

import { createHmac } from 'node:crypto'

import { Cause, Context, Effect, Exit } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { type GithubWebhookInput } from '@deployer/fleet-contracts'
import { effectContext } from '@deployer/nest-effect/testing'
import { callProcedure } from '@deployer/orpc-utils/testing'

import { FleetUnauthorized } from '@/core/fleet.errors'
import {
    guardGithubWebhook,
    type GithubWebhookContext,
} from '@/modules/providers/middleware/github-webhook-auth.middleware'

import {
    GithubAppsStore,
    type GithubAppsStoreShape,
} from '../repositories/github-apps.repository'
import {
    DeploymentTriggerGateway,
    type DeploymentTriggerGatewayShape,
    type TriggerRelayResult,
} from '../services/deployment-trigger.gateway'
import {
    GithubWebhookDispatchService,
    type GithubWebhookDispatchServiceShape,
} from '../services/github-webhook-dispatch.service'
import {
    WebhookIdempotencyService,
    type WebhookIdempotencyServiceShape,
} from '../services/webhook-idempotency.service'

import { GithubWebhooksController } from './github.webhooks.controller'

const SECRET = 'my-secret'

// ─── Fakes: plain objects of `vi.fn()` answering Effects ───────────────────

const makeDispatch = () => ({
    dispatchPrEvent: vi.fn(() =>
        Effect.succeed({
            action: 'created',
            reason: 'pr_opened',
            previewName: 'pr-1',
            resolvedUrl: 'pr-1.preview.local',
        })
    ),
})

const makeIdempotency = () => ({
    isDuplicate: vi.fn((_deliveryId: string) => Effect.succeed(false)),
    markSeen: vi.fn((_deliveryId: string) => Effect.void),
})

const makeStore = () => ({
    setInstallation: vi.fn((_appId: string, _installationId: string | null) =>
        Effect.succeed(true)
    ),
    getWebhookSecret: vi.fn((): Effect.Effect<string | null> =>
        Effect.succeed(SECRET)
    ),
    findServiceBySourceUrl: vi.fn(
        (_url: string): Effect.Effect<{ id: string } | null> =>
            Effect.succeed({ id: 'svc-1' })
    ),
})

const makeGateway = () => ({
    relay: vi.fn((): Effect.Effect<TriggerRelayResult> =>
        Effect.succeed({
            dispatched: false,
            sourceId: null,
            deploymentId: null,
            reason: 'no_trigger_source:github/push',
        })
    ),
})

const prPayload = {
    action: 'opened',
    pull_request: {
        number: 1,
        head: { ref: 'feat/preview', sha: 'abc1234' },
        merged: false,
    },
    repository: {
        full_name: 'org/repo',
        html_url: 'https://github.com/org/repo',
    },
}

const sign = (body: unknown, secret = SECRET) =>
    `sha256=${createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex')}`

/** The DETAILED webhook input the contract produces: `{ body, headers }`, signed over the body like GitHub does. */
const delivery = (event: string, deliveryId: string, body: unknown) => ({
    body,
    headers: {
        'x-github-event': event,
        'x-github-delivery': deliveryId,
        'x-hub-signature-256': sign(body),
    },
})

// ─── Controller ────────────────────────────────────────────────────────────

describe('GithubWebhooksController', () => {
    let dispatch: ReturnType<typeof makeDispatch>
    let idempotency: ReturnType<typeof makeIdempotency>
    let store: ReturnType<typeof makeStore>
    let gateway: ReturnType<typeof makeGateway>
    let call: <
        T = {
            received: true
            deliveryId: string
            action?: string
            reason?: string
        },
    >(
        input: unknown
    ) => Promise<T>

    beforeEach(() => {
        dispatch = makeDispatch()
        idempotency = makeIdempotency()
        store = makeStore()
        gateway = makeGateway()
        const context = {
            ...effectContext(
                Context.make(
                    GithubAppsStore,
                    store as unknown as GithubAppsStoreShape
                ).pipe(
                    Context.add(
                        WebhookIdempotencyService,
                        idempotency as unknown as WebhookIdempotencyServiceShape
                    ),
                    Context.add(
                        GithubWebhookDispatchService,
                        dispatch as unknown as GithubWebhookDispatchServiceShape
                    ),
                    Context.add(
                        DeploymentTriggerGateway,
                        gateway as unknown as DeploymentTriggerGatewayShape
                    )
                )
            ),
            request: { headers: { 'x-correlation-id': 'c-1' } },
        }
        const controller = new GithubWebhooksController()
        call = <T>(input: unknown) =>
            callProcedure<T>(controller.receive(), input, context)
    })

    it('returns received=true for a valid pull_request event', async () => {
        const result = await call(
            delivery('pull_request', 'delivery-1', prPayload)
        )
        expect(result.received).toBe(true)
        expect(result.deliveryId).toBe('delivery-1')
        expect(result.action).toBe('created')
        expect(idempotency.markSeen).toHaveBeenCalledWith('delivery-1')
    })

    it('skips duplicate deliveries (guard short-circuit) without re-dispatching', async () => {
        idempotency.isDuplicate.mockReturnValue(Effect.succeed(true))
        const result = await call(
            delivery('pull_request', 'delivery-dupe', prPayload)
        )
        expect(result.action).toBe('skipped')
        expect(result.reason).toBe('duplicate_delivery')
        expect(dispatch.dispatchPrEvent).not.toHaveBeenCalled()
    })

    it('dispatches a pull_request with the service the repository is linked to, not its name', async () => {
        await call(delivery('pull_request', 'delivery-pr', prPayload))
        expect(store.findServiceBySourceUrl).toHaveBeenCalledWith(
            'https://github.com/org/repo'
        )
        expect(dispatch.dispatchPrEvent).toHaveBeenCalledWith(
            expect.objectContaining({ serviceId: 'svc-1' })
        )
    })

    it('ignores a pull_request on a repository no service is linked to', async () => {
        store.findServiceBySourceUrl.mockReturnValue(Effect.succeed(null))
        const result = await call(
            delivery('pull_request', 'delivery-pr-2', prPayload)
        )
        expect(result.reason).toBe('pull_request:no_linked_service')
        expect(dispatch.dispatchPrEvent).not.toHaveBeenCalled()
    })

    it('returns skipped when no trigger source claims the event', async () => {
        const result = await call(delivery('issues', 'delivery-3', {}))
        expect(gateway.relay).toHaveBeenCalledWith(
            expect.objectContaining({
                provider: 'github',
                eventName: 'issues',
                deliveryId: 'delivery-3',
            })
        )
        expect(result.action).toBe('skipped')
        expect(result.reason).toBe('no_trigger_source:github/push')
    })

    it('reports a deployment the registry queued for a push', async () => {
        gateway.relay.mockReturnValue(
            Effect.succeed({
                dispatched: true,
                sourceId: 'github-push',
                deploymentId: 'dep-1',
                reason: null,
            })
        )
        const result = await call(
            delivery('push', 'delivery-4', { ref: 'refs/heads/main' })
        )
        expect(result.action).toBe('deployed')
        expect(result.reason).toBe('trigger:github-push:dep-1')
    })

    it('answers BAD_REQUEST for a malformed pull_request payload', async () => {
        await expect(
            call(delivery('pull_request', 'delivery-4', { action: 'opened' }))
        ).rejects.toMatchObject({
            code: 'BAD_REQUEST',
            message: 'Malformed pull_request webhook payload',
        })
    })

    it('answers BAD_REQUEST when the PR is missing head.sha (the type guard rejects it)', async () => {
        const body = {
            action: 'opened',
            pull_request: { number: 2, head: { ref: 'feat/x' }, merged: false },
        }
        await expect(
            call(delivery('pull_request', 'delivery-5', body))
        ).rejects.toMatchObject({
            code: 'BAD_REQUEST',
            message: 'Malformed pull_request webhook payload',
        })
    })

    it('acknowledges non-dispatchable pull_request actions without dispatching', async () => {
        const body = {
            action: 'edited',
            pull_request: {
                number: 2,
                head: { ref: 'feat/x', sha: 'abc' },
                merged: false,
            },
        }
        const result = await call(delivery('pull_request', 'delivery-6', body))
        expect(result.action).toBe('edited')
        expect(result.reason).toBe('pull_request:edited')
        expect(dispatch.dispatchPrEvent).not.toHaveBeenCalled()
    })

    it('answers BAD_REQUEST for a malformed installation payload', async () => {
        await expect(
            call(
                delivery('installation', 'delivery-7', {
                    action: 'created',
                    installation: { id: 1 },
                })
            )
        ).rejects.toMatchObject({
            code: 'BAD_REQUEST',
            message: 'Malformed installation webhook payload',
        })
    })

    it('records the installation id on the matching app', async () => {
        const body = { action: 'created', installation: { id: 42, app_id: 7 } }
        const result = await call(delivery('installation', 'delivery-8', body))
        expect(store.setInstallation).toHaveBeenCalledWith('7', '42')
        expect(result.reason).toBe('installation:created')
    })

    it('clears the installation id when the app is uninstalled', async () => {
        const body = { action: 'deleted', installation: { id: 42, app_id: 7 } }
        const result = await call(delivery('installation', 'delivery-9', body))
        expect(store.setInstallation).toHaveBeenCalledWith('7', null)
        expect(result.reason).toBe('installation:deleted')
    })

    it('says so when the installation belongs to an app the fleet does not know', async () => {
        store.setInstallation.mockReturnValue(Effect.succeed(false))
        const body = { action: 'created', installation: { id: 42, app_id: 7 } }
        const result = await call(delivery('installation', 'delivery-10', body))
        expect(result.reason).toBe('installation:app_not_found')
    })

    it('refuses an unsigned delivery with UNAUTHORIZED, before anything is dispatched', async () => {
        await expect(
            call({
                body: prPayload,
                headers: {
                    'x-github-event': 'pull_request',
                    'x-github-delivery': 'd-unsigned',
                },
            })
        ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
        expect(dispatch.dispatchPrEvent).not.toHaveBeenCalled()
    })
})

// ─── Route guard (guardGithubWebhook) ──────────────────────────────────────

describe('guardGithubWebhook', () => {
    let idempotency: ReturnType<typeof makeIdempotency>
    let store: ReturnType<typeof makeStore>

    beforeEach(() => {
        idempotency = makeIdempotency()
        store = makeStore()
    })

    const guard = (input: unknown) =>
        guardGithubWebhook(input as GithubWebhookInput).pipe(
            Effect.provideService(
                GithubAppsStore,
                store as unknown as GithubAppsStoreShape
            ),
            Effect.provideService(
                WebhookIdempotencyService,
                idempotency as unknown as WebhookIdempotencyServiceShape
            )
            // The fakes need nothing from the context beyond what is provided here.
        ) as Effect.Effect<GithubWebhookContext, unknown>

    /** Run the guard and reject with the ORIGINAL failure, so a test can assert on the tagged error. */
    const run = async (input: unknown) => {
        const exit = await Effect.runPromiseExit(guard(input))
        if (Exit.isSuccess(exit)) return exit.value
        throw Cause.squash(exit.cause)
    }

    it('answers the webhook context with eventType + deliveryId', async () => {
        const input = delivery('pull_request', 'd-1', prPayload)
        expect(await run(input)).toEqual({
            eventType: 'pull_request',
            deliveryId: 'd-1',
        })
        expect(idempotency.markSeen).toHaveBeenCalledWith('d-1')
    })

    it('short-circuits duplicate deliveries with skippedReason', async () => {
        idempotency.isDuplicate.mockReturnValue(Effect.succeed(true))
        const input = {
            body: prPayload,
            headers: {
                'x-github-event': 'pull_request',
                'x-github-delivery': 'd-2',
            },
        }
        expect(await run(input)).toEqual({
            eventType: 'pull_request',
            deliveryId: 'd-2',
            skippedReason: 'duplicate_delivery',
        })
        expect(idempotency.markSeen).not.toHaveBeenCalled()
        expect(store.getWebhookSecret).not.toHaveBeenCalled()
    })

    it('rejects when the signature is missing but a secret is configured', async () => {
        const input = {
            body: prPayload,
            headers: {
                'x-github-event': 'pull_request',
                'x-github-delivery': 'd-3',
            },
        }
        await expect(run(input)).rejects.toBeInstanceOf(FleetUnauthorized)
        expect(idempotency.markSeen).not.toHaveBeenCalled()
    })

    it('rejects when signature verification fails', async () => {
        const input = {
            body: prPayload,
            headers: {
                'x-github-event': 'pull_request',
                'x-github-delivery': 'd-4',
                'x-hub-signature-256': 'sha256=invalid',
            },
        }
        await expect(run(input)).rejects.toBeInstanceOf(FleetUnauthorized)
        expect(idempotency.markSeen).not.toHaveBeenCalled()
    })

    it('rejects a signature made with another secret', async () => {
        const input = {
            body: prPayload,
            headers: {
                'x-github-event': 'pull_request',
                'x-github-delivery': 'd-6',
                'x-hub-signature-256': sign(prPayload, 'other-secret'),
            },
        }
        await expect(run(input)).rejects.toBeInstanceOf(FleetUnauthorized)
    })

    it('fails closed when no webhook secret is configured, even for a signed delivery', async () => {
        store.getWebhookSecret.mockReturnValue(Effect.succeed(null))
        await expect(
            run(delivery('pull_request', 'd-7', prPayload))
        ).rejects.toMatchObject({
            reason: 'Webhook secret is not configured',
        })
        expect(idempotency.markSeen).not.toHaveBeenCalled()
    })

    it('accepts a valid signature', async () => {
        expect(await run(delivery('pull_request', 'd-5', prPayload))).toEqual({
            eventType: 'pull_request',
            deliveryId: 'd-5',
        })
    })
})
