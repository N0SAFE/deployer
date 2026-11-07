import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { DatabasePort, StorageFailure } from '../../database/storage'
import { ConfigNotFoundError, ConfigSyncFailure } from '../errors'
import { TraefikRepository } from '../repositories/traefik.repository'

import { TraefikFileSystemService } from './traefik-file-system.service'
import { TraefikSyncService } from './traefik-sync.service'
import { TraefikService } from './traefik.service'

import type { TraefikRepositoryShape } from '../repositories/traefik.repository'

const config = {
    id: 'cfg-12345678',
    serviceId: 'svc-12345678',
    domain: 'example.com',
    fullDomain: 'api.example.com',
    port: 3000,
    sslEnabled: true,
    sslProvider: 'letsencrypt',
    serviceHost: 'web',
    servicePort: 3000,
    domainRoutes: [
        {
            id: 'route-12345678',
            hostRule: 'Host(`api.example.com`)',
            entryPoint: 'web',
        },
    ],
    middlewares: [],
}

function repoWith(overrides: Record<string, unknown> = {}) {
    return {
        getCompleteServiceConfig: vi.fn(() => Effect.succeed(config)),
        getServiceById: vi.fn(() => Effect.succeed({ projectId: 'p1' })),
        getProjectById: vi.fn(() => Effect.succeed({ name: 'shop' })),
        updateConfigSyncStatus: vi.fn(() => Effect.succeed(undefined)),
        createConfigFile: vi.fn(() => Effect.succeed(undefined)),
        ...overrides,
    } as unknown as TraefikRepositoryShape
}

/**
 * The real filesystem over a base path: its virtual tree is read from whatever `TraefikRepository` the
 * run provides, so a spec supplies that one tag and nothing else.
 */
const fileSystemOver = (env: { basePath: string; backupPath: string }) =>
    new TraefikFileSystemService.live(env)

const sync = new TraefikSyncService.live()
const facade = new TraefikService.live()

/** The fake repository answers every read, so the port behind it is never reached. */
const databasePort = {} as never

/** One sync/filesystem operation, over the repository fake. */
const runSync = <A, E>(
    effect: Effect.Effect<
        A,
        E,
        TraefikRepository | TraefikFileSystemService | DatabasePort
    >,
    repository: TraefikRepositoryShape,
    fileSystem: ReturnType<typeof fileSystemOver>
): Promise<A> =>
    Effect.runPromise(
        effect.pipe(
            Effect.provideService(TraefikRepository, repository),
            Effect.provideService(TraefikFileSystemService, fileSystem),
            Effect.provideService(DatabasePort, databasePort)
        )
    )

/** One facade operation: it also reaches the sync service. */
const runFacade = <A, E>(
    effect: Effect.Effect<
        A,
        E,
        | TraefikRepository
        | TraefikFileSystemService
        | TraefikSyncService
        | DatabasePort
    >,
    repository: TraefikRepositoryShape,
    fileSystem: ReturnType<typeof fileSystemOver>
): Promise<A> =>
    Effect.runPromise(
        effect.pipe(
            Effect.provideService(TraefikRepository, repository),
            Effect.provideService(TraefikFileSystemService, fileSystem),
            Effect.provideService(TraefikSyncService, sync),
            Effect.provideService(DatabasePort, databasePort)
        )
    )

describe('TraefikSync', () => {
    it('writes the generated YAML under the project folder and records the sync', async () => {
        const basePath = await mkdtemp(join(tmpdir(), 'traefik-'))
        const repository = repoWith()
        const fileSystem = fileSystemOver({
            basePath,
            backupPath: join(basePath, 'backup'),
        })

        const result = await runSync(
            sync.syncServiceConfiguration('cfg-12345678'),
            repository,
            fileSystem
        )

        expect(result).toMatchObject({
            success: true,
            action: 'created',
            configName: 'api.example.com',
        })
        const written = await readFile(
            join(
                basePath,
                'dynamic',
                'projects',
                'shop',
                'service-svc-1234-cfg-1234.yml'
            ),
            'utf8'
        )
        expect(written).toContain('Host(`api.example.com`)')
        expect(repository.updateConfigSyncStatus).toHaveBeenCalledOnce()
    })

    it('answers an unknown configuration as a failed result, not an error', async () => {
        const repository = repoWith({
            getCompleteServiceConfig: () => Effect.succeed(null),
        })
        expect(
            await runSync(
                sync.syncServiceConfiguration('x'),
                repository,
                fileSystemOver({
                    basePath: '/nowhere',
                    backupPath: '/nowhere',
                })
            )
        ).toMatchObject({
            success: false,
            message: 'Configuration not found in database',
        })
    })

    it('reports a write failure as a failed result and skips the status update', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'traefik-'))
        const blocker = join(dir, 'file')
        await writeFile(blocker, '')
        const repository = repoWith()

        const result = await runSync(
            sync.syncServiceConfiguration('cfg-12345678'),
            repository,
            fileSystemOver({ basePath: blocker, backupPath: blocker })
        )

        expect(result).toMatchObject({ success: false, action: 'error' })
        expect(repository.updateConfigSyncStatus).not.toHaveBeenCalled()
    })

    it('fails with the typed storage failure when the database cannot be read', async () => {
        const repository = repoWith({
            getCompleteServiceConfig: () => Effect.fail(new StorageFailure({})),
        })
        await expect(
            runSync(
                Effect.flip(sync.syncServiceConfiguration('x')),
                repository,
                fileSystemOver({
                    basePath: '/nowhere',
                    backupPath: '/nowhere',
                })
            )
        ).resolves.toBeInstanceOf(StorageFailure)
    })
})

describe('TraefikService', () => {
    const fileSystem = fileSystemOver({
        basePath: '/nowhere',
        backupPath: '/nowhere',
    })

    it('fails with ConfigNotFoundError when the service has no Traefik config', async () => {
        const repository = repoWith({
            getServiceConfigByServiceId: () => Effect.succeed(undefined),
        })
        await expect(
            runFacade(
                facade.syncServiceConfiguration('svc'),
                repository,
                fileSystem
            )
        ).rejects.toBeInstanceOf(ConfigNotFoundError)
    })

    it('validates a stored configuration', async () => {
        const repository = repoWith({
            getCompleteServiceConfig: () =>
                Effect.succeed({ ...config, port: 0, serviceTargets: [] }),
        })
        const result = await runFacade(
            facade.validateConfiguration('cfg'),
            repository,
            fileSystem
        )
        expect(result.isValid).toBe(false)
        expect(result.errors.map((e) => e.code)).toEqual(['INVALID_PORT'])
        expect(result.warnings).toHaveLength(1)
    })
})

describe('TraefikSync batches and cleanup', () => {
    const data = (id: string) => ({
        id,
        configName: `cfg-${id}`,
        configType: 'http',
        storageType: 'project',
        projectName: 'shop',
        configContent: 'a: 1',
    })

    it('syncs each changed config, marks a failing one and still runs the rest', async () => {
        const basePath = await mkdtemp(join(tmpdir(), 'traefik-'))
        const markTraefikConfigSyncFailed = vi.fn(() =>
            Effect.succeed(undefined)
        )
        let calls = 0
        const repository = repoWith({
            getTraefikConfigsNeedingSync: () =>
                Effect.succeed([data('one'), data('two')]),
            updateTraefikConfigSyncStatus: () =>
                ++calls === 1
                    ? Effect.fail(new StorageFailure({}))
                    : Effect.succeed(undefined),
            markTraefikConfigSyncFailed,
        })

        const summary = await runSync(
            sync.syncAllConfigurations(),
            repository,
            fileSystemOver({ basePath, backupPath: basePath })
        )

        expect(summary).toMatchObject({ total: 2, successful: 1, failed: 1 })
        expect(markTraefikConfigSyncFailed).toHaveBeenCalledOnce()
        expect(
            await readFile(
                join(basePath, 'dynamic', 'projects', 'shop', 'http-two.yaml'),
                'utf8'
            )
        ).toBe('a: 1')
    })

    it('removes only the real files no active config owns', async () => {
        const basePath = await mkdtemp(join(tmpdir(), 'traefik-'))
        const dir = join(basePath, 'dynamic', 'projects', 'shop')
        await mkdir(dir, { recursive: true })
        const orphan = join(dir, 'service-aaaaaaaa-bbbbbbbb.yml')
        const kept = join(dir, 'service-cccccccc-dddddddd.yml')
        await writeFile(orphan, 'x')
        await writeFile(kept, 'x')
        const repository = repoWith({
            // The virtual listing scans every config; the active set owns only one of them.
            getAllServiceConfigs: (isActive?: boolean) =>
                Effect.succeed(
                    isActive === true
                        ? [{ id: 'dddddddd-1', serviceId: 'cccccccc-1' }]
                        : [
                              { id: 'bbbbbbbb-1', serviceId: 'aaaaaaaa-1' },
                              { id: 'dddddddd-1', serviceId: 'cccccccc-1' },
                          ]
                ),
            getAllNewSslCertificates: () => Effect.succeed([]),
            getAllNewMiddleware: () => Effect.succeed([]),
            getAllStaticFiles: () => Effect.succeed([]),
        })

        const summary = await runSync(
            sync.cleanupOrphanedFiles(),
            repository,
            fileSystemOver({ basePath, backupPath: basePath })
        )

        expect(summary.results.map((r) => r.action)).toEqual(['deleted'])
        await expect(access(orphan)).rejects.toThrow()
        await access(kept)
    })

    it('fails the cleanup with the typed sync failure when the database is down', async () => {
        const repository = repoWith({
            getAllServiceConfigs: () => Effect.fail(new StorageFailure({})),
        })
        await expect(
            runSync(
                sync.cleanupOrphanedFiles(),
                repository,
                fileSystemOver({ basePath: '/x', backupPath: '/x' })
            )
        ).rejects.toBeInstanceOf(ConfigSyncFailure)
    })
})
