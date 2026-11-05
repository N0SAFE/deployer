import { Effect } from 'effect'
import { describe, it, expect, vi } from 'vitest'

import { makeCustomSourceProvider } from '../custom/services/custom-source-provider.service'
import { makeGithubSourceProvider } from '../github/services/github-source-provider.service'
import { makeUploadSourceProvider } from '../upload/services/upload-source-provider.service'

describe('Source provider conformance', () => {
    it('upload provider emits dockerfile runtime context with image when provided', async () => {
        const bundles = {
            register: vi.fn(),
            findByUploadId: vi.fn().mockReturnValue(
                Effect.succeed({
                    uploadId: 'upload-1',
                    uploadPath: '/tmp/uploads/upload-1-bundle.zip',
                    fileName: 'bundle.zip',
                    fileSize: 123,
                    mimeType: 'application/zip',
                    uploadedAt: '2024-01-01T00:00:00.000Z',
                })
            ),
        }
        const upload = makeUploadSourceProvider({ bundles: bundles })

        const result = await Effect.runPromise(
            upload.resolveSourceCheckout({
                source: {
                    sourceType: 'upload',
                    uploadId: 'upload-1',
                    fileName: 'bundle.zip',
                    fileSize: 123,
                    customData: {
                        uploadId: 'upload-1',
                        runtimeRunner: 'dockerfile',
                        containerImage: 'registry.local/upload:latest',
                        containerName: 'upload-ctr-1',
                    },
                },
            } as never)
        )

        expect(result).toMatchObject({
            provider: 'upload',
            uploadPath: '/tmp/uploads/upload-1-bundle.zip',
            runtimeRunner: 'dockerfile',
            containerImage: 'registry.local/upload:latest',
            containerName: 'upload-ctr-1',
        })
    })

    it('custom provider emits dockerfile runtime context with required image', async () => {
        const custom = makeCustomSourceProvider()

        const result = await Effect.runPromise(
            custom.resolveSourceCheckout({
                source: {
                    sourceType: 'custom',
                    customData: {
                        runtimeRunner: 'dockerfile',
                        containerImage: 'registry.local/custom:latest',
                        containerName: 'custom-ctr-1',
                    },
                },
            } as never)
        )

        expect(result).toMatchObject({
            provider: 'custom',
            runtimeRunner: 'dockerfile',
            containerImage: 'registry.local/custom:latest',
            containerName: 'custom-ctr-1',
        })
    })

    it('github provider supports PR context fallback branch', async () => {
        const gitService = {
            validateRepository: vi.fn(() => Effect.succeed(true)),
        }
        const github = makeGithubSourceProvider({ git: gitService as never })

        const result = await Effect.runPromise(
            github.resolveSourceCheckout({
                source: {
                    sourceType: 'github',
                    repositoryUrl: 'https://github.com/acme/repo',
                    pullRequestNumber: 7,
                },
            } as never)
        )

        expect(result).toMatchObject({
            provider: 'github',
            repositoryUrl: 'https://github.com/acme/repo',
            branch: 'refs/pull/7/head',
            pullRequestNumber: 7,
        })
    })
})
