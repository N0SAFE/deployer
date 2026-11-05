import { mkdtemp, mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { StorageFailure } from '../../database/storage'
import { ConfigNotFoundError, ConfigSyncFailure } from '../errors'

import { makeTraefikFileSystem as makeFs } from './traefik-file-system.service'
import { makeTraefikSync } from './traefik-sync.service'
import { makeTraefikService } from './traefik.service'

import type { TraefikRepositoryShape } from '../repositories/traefik.repository'

/** The file system over a fake repository (the pure conventions never read it). */
const makeTraefikFileSystem = (
    env: { basePath: string; backupPath: string },
    repository?: TraefikRepositoryShape
) => makeFs(env, repository ?? repoWith())

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

describe('TraefikSync', () => {
    it('writes the generated YAML under the project folder and records the sync', async () => {
        const basePath = await mkdtemp(join(tmpdir(), 'traefik-'))
        const fileSystem = makeTraefikFileSystem({
            basePath,
            backupPath: join(basePath, 'backup'),
        })
        const repository = repoWith()
        const sync = makeTraefikSync({ repository, fileSystem })

        const result = await Effect.runPromise(
            sync.syncServiceConfiguration('cfg-12345678')
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
        const sync = makeTraefikSync({
            repository: repoWith({
                getCompleteServiceConfig: () => Effect.succeed(null),
            }),
            fileSystem: makeTraefikFileSystem({
                basePath: '/nowhere',
                backupPath: '/nowhere',
            }),
        })
        expect(
            await Effect.runPromise(sync.syncServiceConfiguration('x'))
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
        const sync = makeTraefikSync({
            repository,
            fileSystem: makeTraefikFileSystem({
                basePath: blocker,
                backupPath: blocker,
            }),
        })

        const result = await Effect.runPromise(
            sync.syncServiceConfiguration('cfg-12345678')
        )

        expect(result).toMatchObject({ success: false, action: 'error' })
        expect(repository.updateConfigSyncStatus).not.toHaveBeenCalled()
    })

    it('fails with the typed storage failure when the database cannot be read', async () => {
        const sync = makeTraefikSync({
            repository: repoWith({
                getCompleteServiceConfig: () =>
                    Effect.fail(new StorageFailure({})),
            }),
            fileSystem: makeTraefikFileSystem({
                basePath: '/nowhere',
                backupPath: '/nowhere',
            }),
        })
        expect(
            await Effect.runPromise(
                Effect.flip(sync.syncServiceConfiguration('x'))
            )
        ).toBeInstanceOf(StorageFailure)
    })
})

describe('TraefikService', () => {
    const fileSystem = makeTraefikFileSystem({
        basePath: '/nowhere',
        backupPath: '/nowhere',
    })
    const sync = makeTraefikSync({ repository: repoWith(), fileSystem })

    it('fails with ConfigNotFoundError when the service has no Traefik config', async () => {
        const service = makeTraefikService({
            repository: repoWith({
                getServiceConfigByServiceId: () => Effect.succeed(undefined),
            }),
            fileSystem,
            sync,
        })
        expect(
            await Effect.runPromise(
                Effect.flip(service.syncServiceConfiguration('svc'))
            )
        ).toBeInstanceOf(ConfigNotFoundError)
    })

    it('validates a stored configuration', async () => {
        const service = makeTraefikService({
            repository: repoWith({
                getCompleteServiceConfig: () =>
                    Effect.succeed({ ...config, port: 0, serviceTargets: [] }),
            }),
            fileSystem,
            sync,
        })
        const result = await Effect.runPromise(
            service.validateConfiguration('cfg')
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
        const sync = makeTraefikSync({
            repository,
            fileSystem: makeTraefikFileSystem(
                { basePath, backupPath: basePath },
                repository
            ),
        })

        const summary = await Effect.runPromise(sync.syncAllConfigurations())

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
            getAllServiceConfigs: () => Effect.succeed([{ id: 'dddddddd-1' }]),
        })
        const fileSystem = makeTraefikFileSystem(
            { basePath, backupPath: basePath },
            repository
        )
        // The virtual listing the cleanup scans: both files, as the config browser would show them.
        const listing = [orphan, kept].map((f) => f.replace(basePath, ''))
        const sync = makeTraefikSync({
            repository,
            fileSystem: {
                ...fileSystem,
                getAllConfigFiles: () =>
                    Effect.succeed(listing.map((f) => join(basePath, f))),
            },
        })

        const summary = await Effect.runPromise(sync.cleanupOrphanedFiles())

        expect(summary.results.map((r) => r.action)).toEqual(['deleted'])
        await expect(access(orphan)).rejects.toThrow()
        await access(kept)
    })

    it('fails the cleanup with the typed sync failure when the database is down', async () => {
        const repository = repoWith({
            getAllServiceConfigs: () => Effect.fail(new StorageFailure({})),
        })
        const sync = makeTraefikSync({
            repository,
            fileSystem: {
                ...makeTraefikFileSystem(
                    { basePath: '/x', backupPath: '/x' },
                    repository
                ),
                getAllConfigFiles: () => Effect.succeed([]),
            },
        })
        expect(
            await Effect.runPromise(Effect.flip(sync.cleanupOrphanedFiles()))
        ).toBeInstanceOf(ConfigSyncFailure)
    })
})
