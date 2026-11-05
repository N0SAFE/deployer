import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { DockerNotFound, DockerUnavailable } from '@deployer/docker'

import { DockerImageScannerService } from './docker-image-scanner.service'

type ScannerKind = 'trivy' | 'grype' | 'dive'

function createCleanupHarness(params: {
    inspectImpl: () => Promise<unknown>
    removeImpl?: () => Promise<unknown>
}) {
    const inspect = vi.fn(params.inspectImpl)
    const remove = vi.fn(params.removeImpl ?? (async () => undefined))

    const removeContainer = vi.fn(async () => undefined)
    // The engine's containers: the failure of a rejected call travels as the Effect's own error,
    // which the repository reads back (a 404 means the container is gone).
    const engine = {
        containers: {
            // Like the real engine: a 404 is `DockerNotFound`, anything else `DockerUnavailable`.
            inspect: () =>
                Effect.tryPromise({
                    try: () => inspect(),
                    catch: (cause) =>
                        (cause as { statusCode?: number }).statusCode === 404
                            ? new DockerNotFound({ resource: 'container' })
                            : new DockerUnavailable({
                                  reason: 'inspect failed',
                                  cause,
                              }),
                }),
            // The cleanup removes the container through the engine; failures are logged, never thrown.
            remove: () => Effect.promise(() => removeContainer()),
            removeIfExists: () =>
                Effect.tryPromise({
                    try: () => remove(),
                    catch: (cause) =>
                        new DockerUnavailable({
                            reason: 'remove failed',
                            cause,
                        }),
                }),
        },
    }

    const scannerPool = {
        ensureRunning: vi.fn(() => Effect.succeed(true)),
        exec: vi.fn(() =>
            Effect.succeed({ exitCode: 0, output: '', durationMs: 0 })
        ),
        stop: vi.fn(() => Effect.void),
        stopAll: Effect.void,
        cleanStaleImages: Effect.void,
    }

    const repository = new DockerImageScannerService(
        engine as never,
        scannerPool,
        {} as never,
        {} as never
    )

    const delaySpy = vi.fn(async () => undefined)
    ;(repository as unknown as { delay: (ms: number) => Promise<void> }).delay =
        delaySpy

    const cleanupScannerContainer = (
        repository as unknown as {
            cleanupScannerContainer: (
                containerId: string,
                scanner: ScannerKind
            ) => Promise<void>
        }
    ).cleanupScannerContainer.bind(repository)

    return {
        cleanupScannerContainer,
        inspect,
        remove,
        removeContainer,
        delaySpy,
    }
}

describe('DockerImageScannerService scanner container cleanup', () => {
    it('returns when container is already gone after standard remove', async () => {
        const harness = createCleanupHarness({
            inspectImpl: async () => {
                throw {
                    statusCode: 404,
                    message: 'No such container',
                }
            },
        })

        await harness.cleanupScannerContainer('scanner-ctr-1', 'trivy')

        expect(harness.removeContainer).toHaveBeenCalledTimes(1)
        expect(harness.remove).not.toHaveBeenCalled()
        expect(harness.delaySpy).not.toHaveBeenCalled()
    })

    it('force-removes when inspect shows container still exists', async () => {
        const harness = createCleanupHarness({
            inspectImpl: vi
                .fn<() => Promise<unknown>>()
                .mockResolvedValueOnce({ State: { Status: 'exited' } })
                .mockRejectedValueOnce({
                    statusCode: 404,
                    message: 'No such container',
                }),
        })

        await harness.cleanupScannerContainer('scanner-ctr-2', 'grype')

        expect(harness.removeContainer).toHaveBeenCalledTimes(1)
        expect(harness.remove).toHaveBeenCalledTimes(1)
        expect(harness.inspect).toHaveBeenCalledTimes(2)
        expect(harness.delaySpy).not.toHaveBeenCalled()
    })

    it('retries cleanup up to three attempts when container keeps reappearing', async () => {
        const harness = createCleanupHarness({
            inspectImpl: async () => ({ State: { Status: 'running' } }),
        })

        await harness.cleanupScannerContainer('scanner-ctr-3', 'dive')

        expect(harness.removeContainer).toHaveBeenCalledTimes(3)
        expect(harness.remove).toHaveBeenCalledTimes(3)
        expect(harness.delaySpy).toHaveBeenCalledTimes(2)
    })
})
