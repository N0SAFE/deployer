import { Cause, Effect, Exit } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { RuntimeInvalid } from '../../../core/runtime.errors'

import { ApiTriggerSource } from './api-trigger.source'
import { makeDeploymentTriggerRegistry } from './deployment-trigger-registry.service'
import { TriggerServiceLinkPort } from './deployment-trigger.ports'
import { GithubPushTriggerSource } from './github-push-trigger.source'

import type { DeploymentTriggerSource } from './base/deployment-trigger-source.interface'

/**
 * These tests exist to prove the SEAM works, not the individual sources.
 *
 * The bug class being prevented: a registry that is tested only with mocks can look
 * pluggable while the real dispatch order, the enabled/disabled rule, or the null-vs-throw
 * contract is wrong. Every assertion below fails if the seam regresses.
 */
const makeRegistry = (
    sources: DeploymentTriggerSource<TriggerServiceLinkPort>[]
) => makeDeploymentTriggerRegistry(sources)

type Links = {
    findServiceBySourceUrl: (
        url: string
    ) => Promise<{ id: string; providerConfig: unknown } | null>
}
const noLinks: Links = { findServiceBySourceUrl: () => Promise.resolve(null) }

/** Runs a source/registry program with the repo link port faked, resolving to the success value. */
const run = <A, E>(
    effect: Effect.Effect<A, E, TriggerServiceLinkPort>,
    links: Links = noLinks
): Promise<A> =>
    Effect.runPromise(
        Effect.provideService(effect, TriggerServiceLinkPort, links as never)
    )

/** A source whose only job is to claim one provider/event pair. */
const stubSource = (
    sourceId: string,
    provider: string,
    eventName: string,
    enabled = true
): DeploymentTriggerSource<TriggerServiceLinkPort> => ({
    sourceId,
    isEnabled: () => enabled,
    disabledReason: () => (enabled ? '' : `${sourceId} is off`),
    matches: (event) =>
        event.provider === provider && event.eventName === eventName,
    toTriggerInput: () =>
        Effect.succeed({
            serviceId: `svc-from-${sourceId}`,
            environment: 'production',
            source: {
                sourceType: 'github',
                repositoryUrl: 'https://example.test/r.git',
                branch: 'main',
                commitSha: 'a'.repeat(40),
            },
        }),
})

describe('DeploymentTriggerRegistry', () => {
    it('dispatches by provider+event and reports which source claimed it', async () => {
        const registry = makeRegistry([
            stubSource('one', 'github', 'push'),
            stubSource('two', 'github', 'pull_request'),
        ])

        const result = await run(
            registry.toTriggerInput({
                provider: 'github',
                eventName: 'pull_request',
                payload: {},
            })
        )

        expect(result?.sourceId).toBe('two')
        expect(result?.input?.serviceId).toBe('svc-from-two')
    })

    it('returns null for an event no source wants, rather than throwing', async () => {
        // A webhook endpoint receives issues, stars, releases… None of those are
        // deployable, and that is not an error.
        const registry = makeRegistry([stubSource('one', 'github', 'push')])

        await expect(
            run(
                registry.toTriggerInput({
                    provider: 'github',
                    eventName: 'issues',
                    payload: {},
                })
            )
        ).resolves.toBeNull()
    })

    it('fails requireInput with RuntimeInvalid when nothing matched, listing the enabled sources', async () => {
        const registry = makeRegistry([stubSource('one', 'github', 'push')])

        const exit = await Effect.runPromiseExit(
            Effect.provideService(
                registry.requireInput({
                    provider: 'github',
                    eventName: 'issues',
                    payload: {},
                }),
                TriggerServiceLinkPort,
                noLinks as never
            )
        )
        const failure = Exit.isFailure(exit) ? Cause.squash(exit.cause) : null
        expect(failure).toBeInstanceOf(RuntimeInvalid)
        expect((failure as RuntimeInvalid).reason).toMatch(
            /No deployment trigger source matched.*one/
        )
    })

    it('does NOT let a DISABLED source claim an event', async () => {
        // This is the rule that keeps "registered but inert" honest: without it a
        // disabled source would match and then fail deeper, which is a worse error than
        // "no source".
        const registry = makeRegistry([
            stubSource('off', 'github', 'push', false),
            stubSource('on', 'github', 'push', true),
        ])

        const result = await run(
            registry.toTriggerInput({
                provider: 'github',
                eventName: 'push',
                payload: {},
            })
        )

        expect(result?.sourceId).toBe('on')
    })

    it('reports disabled sources with their reason, so diagnostics can explain the gap', () => {
        const registry = makeRegistry([
            stubSource('off', 'github', 'push', false),
        ])

        expect(registry.supportedSources()).toEqual([
            { sourceId: 'off', enabled: false, reason: 'off is off' },
        ])
    })

    it('resolves in registration order, so ties are deterministic', () => {
        const registry = makeRegistry([
            stubSource('first', 'github', 'push'),
            stubSource('second', 'github', 'push'),
        ])

        expect(
            registry.resolve({
                provider: 'github',
                eventName: 'push',
                payload: {},
            })?.sourceId
        ).toBe('first')
    })
})

describe('ApiTriggerSource', () => {
    it('claims an api event carrying a complete trigger input', async () => {
        const source = new ApiTriggerSource()
        const payload = {
            serviceId: 'svc-1',
            environment: 'production',
            source: {
                sourceType: 'upload',
                uploadId: 'u1',
                uploadPath: '/tmp/u1',
            },
        }

        expect(
            source.matches({ provider: 'api', eventName: 'trigger', payload })
        ).toBe(true)
        await expect(
            run(
                source.toTriggerInput({
                    provider: 'api',
                    eventName: 'trigger',
                    payload,
                })
            )
        ).resolves.toMatchObject({
            serviceId: 'svc-1',
        })
    })

    it('rejects a payload without serviceId or source — it must not claim a malformed body', () => {
        const source = new ApiTriggerSource()

        expect(
            source.matches({
                provider: 'api',
                eventName: 'trigger',
                payload: { environment: 'production' },
            })
        ).toBe(false)
        expect(
            source.matches({
                provider: 'api',
                eventName: 'trigger',
                payload: { serviceId: 'svc-1' },
            })
        ).toBe(false)
    })

    it('never claims a non-api provider', () => {
        const source = new ApiTriggerSource()
        const payload = { serviceId: 'svc-1', source: { sourceType: 'github' } }

        expect(
            source.matches({ provider: 'github', eventName: 'push', payload })
        ).toBe(false)
    })
})

describe('GithubPushTriggerSource', () => {
    /**
     * The repo→service bridge DOES exist: `DeploymentRepository.findServiceBySourceUrl`
     * queries `services` and matches the normalized `providerConfig.sourceUrl`. An
     * earlier version of the source reported itself disabled on the false premise that
     * the bridge was missing — which made a working feature inert. Asserting `enabled`
     * here is what keeps that regression from coming back.
     */
    it('is enabled, because the repo→service bridge exists', () => {
        const source = new GithubPushTriggerSource()

        expect(source.isEnabled()).toBe(true)
    })

    it('explains that a push deploys only when a service has a matching sourceUrl', () => {
        const source = new GithubPushTriggerSource()

        expect(source.disabledReason()).toMatch(/sourceUrl/)
    })

    it('deploys a push whose repository matches a linked service', async () => {
        const source = new GithubPushTriggerSource()
        const links = {
            findServiceBySourceUrl: vi.fn(() =>
                Promise.resolve({ id: 'svc-1', providerConfig: null })
            ),
        }

        const input = await run(
            source.toTriggerInput({
                provider: 'github',
                eventName: 'push',
                payload: {
                    ref: 'refs/heads/main',
                    after: 'abc1234def',
                    repository: { html_url: 'https://github.com/acme/app' },
                },
            }),
            links
        )

        expect(input).toMatchObject({
            serviceId: 'svc-1',
            environment: 'production',
            source: {
                sourceType: 'github',
                repositoryUrl: 'https://github.com/acme/app',
                branch: 'main',
                commitSha: 'abc1234def',
            },
        })
    })

    it('declines a push whose repository matches no service', async () => {
        const source = new GithubPushTriggerSource()
        const links = {
            findServiceBySourceUrl: vi.fn(() => Promise.resolve(null)),
        }

        const input = await run(
            source.toTriggerInput({
                provider: 'github',
                eventName: 'push',
                payload: {
                    ref: 'refs/heads/main',
                    after: 'abc1234def',
                    repository: {
                        html_url: 'https://github.com/acme/unlinked',
                    },
                },
            }),
            links
        )

        expect(input).toBeNull()
    })

    it('claims only github push', () => {
        const source = new GithubPushTriggerSource()

        expect(
            source.matches({
                provider: 'github',
                eventName: 'push',
                payload: {},
            })
        ).toBe(true)
        expect(
            source.matches({
                provider: 'github',
                eventName: 'pull_request',
                payload: {},
            })
        ).toBe(false)
        expect(
            source.matches({
                provider: 'gitlab',
                eventName: 'push',
                payload: {},
            })
        ).toBe(false)
    })

    it('declines a branch-deletion push, which is not deployable', async () => {
        const source = new GithubPushTriggerSource()

        const input = await run(
            source.toTriggerInput({
                provider: 'github',
                eventName: 'push',
                payload: {
                    deleted: true,
                    ref: 'refs/heads/main',
                    after: '0'.repeat(40),
                    repository: { html_url: 'https://x' },
                },
            })
        )

        expect(input).toBeNull()
    })

    it('declines a push with no commit sha', async () => {
        const source = new GithubPushTriggerSource()

        const input = await run(
            source.toTriggerInput({
                provider: 'github',
                eventName: 'push',
                payload: {
                    ref: 'refs/heads/main',
                    repository: { html_url: 'https://x' },
                },
            })
        )

        expect(input).toBeNull()
    })
})
