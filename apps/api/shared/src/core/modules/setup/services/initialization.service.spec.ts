import { Effect } from 'effect'
import { describe, beforeEach, it, expect, vi } from 'vitest'

import type { NodeConfigRepositoryShape } from '@deployer/node-state'

import {
    makeInitializationService,
    type InitializationServiceShape,
} from './initialization.service'

describe('InitializationService', () => {
    let service: InitializationServiceShape
    let find: ReturnType<typeof vi.fn>

    beforeEach(() => {
        find = vi.fn(() => Effect.succeed(null))
        service = makeInitializationService({
            nodeConfigRepository: {
                find,
                save: vi.fn(),
                update: vi.fn(),
            } as unknown as NodeConfigRepositoryShape,
            localInitializationService: { initialize: vi.fn() },
            remoteInitializationService: { initialize: vi.fn() },
            // The flows are mocked with no requirements, so the bare runtime is enough here.
            host: {
                runUnwrapped: (effect: Effect.Effect<unknown, unknown>) =>
                    Effect.runPromise(effect),
            } as never,
            setupEventService: {
                emit: vi.fn(),
                observeProgress$: vi.fn(),
            } as never,
            // Setup completion advances the lifecycle, which is what readiness READS. Stubbed here so the unit tests stay
            // isolated from it.
            lifecycle: {
                markReadyNow: vi.fn(),
                markDatabaseProbeNow: vi.fn(),
                markMeshConnectedNow: vi.fn(),
            },
        })
    })

    describe('checkConfigAndEmit', () => {
        it('emits a completed status for an already-configured node', async () => {
            find.mockReturnValue(
                Effect.succeed({
                    nodeId: 'n1',
                    strategy: 'local' as const,
                    setupState: 'setup_done' as const,
                    databaseUrl: 'postgresql://existing@localhost:5432/db',
                    configuredAt: '2026-01-01T00:00:00.000Z',
                    meshUrlsSnapshot: [],
                    updatedAt: '2026-01-01T00:00:00.000Z',
                })
            )

            await Effect.runPromise(service.checkConfigAndEmit())

            const status = await Effect.runPromise(service.waitForSetup())
            expect(status.strategy).toBe('local')
            expect(status.databaseUrl).toContain('postgresql://existing')
            expect(status.nodeId).toBe('n1')
        })
    })

    /**
     * SEC-012 / SETUP-002 — `/setup/*` is anonymous and must not stay a mutation
     * surface once the node is configured.
     */
    describe('assertSetupMutable', () => {
        const setConfig = (row: unknown) =>
            find.mockReturnValue(Effect.succeed(row))

        const completed = {
            nodeId: 'n1',
            strategy: 'local',
            setupState: 'setup_done',
            databaseUrl:
                'postgresql://deployer:pw@db.example.com:5432/deployer',
            configuredAt: '2026-01-01T00:00:00.000Z',
        }

        it('refuses a mutation once setup is complete', async () => {
            setConfig(completed)

            expect(
                (
                    await Effect.runPromise(
                        Effect.flip(service.assertSetupMutable())
                    )
                )._tag
            ).toBe('SetupAlreadyComplete')
        })

        it('allows a mutation while setup is in progress', async () => {
            setConfig({
                ...completed,
                setupState: 'setup_in_progress',
                configuredAt: null,
                databaseUrl: null,
            })

            await expect(
                Effect.runPromise(service.assertSetupMutable())
            ).resolves.toBeUndefined()
        })

        it('allows a mutation on a fresh node', async () => {
            setConfig(null)

            await expect(
                Effect.runPromise(service.assertSetupMutable())
            ).resolves.toBeUndefined()
        })
    })

    describe('assertDatabaseProbeAllowed', () => {
        const setConfig = (row: unknown) =>
            find.mockReturnValue(Effect.succeed(row))

        it.each([
            ['loopback IPv4', 'postgresql://u:p@127.0.0.1:5432/db'],
            ['private IPv4', 'postgresql://u:p@10.1.2.3:5432/db'],
            ['cloud metadata', 'postgresql://u:p@169.254.169.254/db'],
            ['loopback name', 'postgresql://u:p@localhost:5432/db'],
        ])('refuses a %s target', async (_label, url) => {
            setConfig(null)

            expect(
                (
                    await Effect.runPromise(
                        Effect.flip(service.assertDatabaseProbeAllowed(url))
                    )
                )._tag
            ).toBe('DatabaseProbeRefused')
        })

        it('allows a public address', async () => {
            setConfig(null)

            await expect(
                Effect.runPromise(
                    service.assertDatabaseProbeAllowed(
                        'postgresql://u:p@93.184.216.34:5432/db'
                    )
                )
            ).resolves.toBeUndefined()
        })

        it("allows the platform's own database, even on loopback", async () => {
            const url = 'postgresql://u:p@127.0.0.1:5432/deployer'
            setConfig({
                nodeId: 'n1',
                strategy: 'local',
                setupState: 'setup_done',
                databaseUrl: url,
                configuredAt: '2026-01-01T00:00:00.000Z',
            })

            await expect(
                Effect.runPromise(service.assertDatabaseProbeAllowed(url))
            ).resolves.toBeUndefined()
        })
    })
})
