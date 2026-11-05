import { Effect } from 'effect'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { RuntimeInvalid } from '../../../../../core/runtime.errors'

import { makeGithubSourceProvider } from './github-source-provider.service'

type Provider = ReturnType<typeof makeGithubSourceProvider>
const run = (p: Provider, input: never) =>
    Effect.runPromise(p.resolveSourceCheckout(input))
const runFail = (p: Provider, input: never) =>
    Effect.runPromise(Effect.flip(p.resolveSourceCheckout(input)))

describe('makeGithubSourceProvider', () => {
    const gitService = {
        validateRepository: vi.fn(),
    }

    let service: ReturnType<typeof makeGithubSourceProvider>

    beforeEach(() => {
        vi.clearAllMocks()
        service = makeGithubSourceProvider({ git: gitService as never })
    })

    it('returns null for non-github source type', async () => {
        const result = await run(service, {
            source: {
                sourceType: 'upload',
            },
        } as never)

        expect(result).toBeNull()
        expect(gitService.validateRepository).not.toHaveBeenCalled()
    })

    it('fails with RuntimeInvalid when repositoryUrl is missing', async () => {
        await expect(
            runFail(service, {
                source: {
                    sourceType: 'github',
                    branch: 'main',
                },
            } as never)
        ).resolves.toBeInstanceOf(RuntimeInvalid)
    })

    it('uses branch from pullRequestNumber when branch is omitted', async () => {
        gitService.validateRepository.mockReturnValue(Effect.succeed(true))

        const result = await run(service, {
            source: {
                sourceType: 'github',

                repositoryUrl: 'https://github.com/acme/repo',
                pullRequestNumber: 42,
            },
        } as never)

        expect(result).toEqual({
            provider: 'github',
            repositoryUrl: 'https://github.com/acme/repo',
            branch: 'refs/pull/42/head',
            pullRequestNumber: 42,
        })
    })

    it('prefers explicit branch over pullRequestNumber fallback', async () => {
        gitService.validateRepository.mockReturnValue(Effect.succeed(true))

        const result = await run(service, {
            source: {
                sourceType: 'github',

                repositoryUrl: 'https://github.com/acme/repo',
                branch: 'feature/x',
                pullRequestNumber: 42,
            },
        } as never)

        expect(result).toEqual({
            provider: 'github',
            repositoryUrl: 'https://github.com/acme/repo',
            branch: 'feature/x',
            pullRequestNumber: 42,
        })
    })

    it('fails with RuntimeInvalid when repository is not accessible', async () => {
        gitService.validateRepository.mockReturnValue(Effect.succeed(false))

        await expect(
            runFail(service, {
                source: {
                    sourceType: 'github',

                    repositoryUrl: 'https://github.com/acme/private',
                },
            } as never)
        ).resolves.toBeInstanceOf(RuntimeInvalid)
    })
})
