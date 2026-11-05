import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { DockerContainerLinks } from './docker-container-links'
import { DockerContainerLinksLookup } from './docker-container-links-lookup.repository'

const at = '2026-10-01T00:00:00.000Z'
const container = {
    id: 'c1',
    hash: 'h1',
    name: 'api',
    projectId: 'p1',
    serviceId: 's1',
    stackId: null,
    imageId: null,
    status: 'running',
    health: 'none',
    environment: null,
    cpuPercent: null,
    memoryPercent: null,
    restartCount: 0,
    ports: [],
    networkIds: [],
    volumeIds: [],
    managedBy: 'orphan',
    managedReason: null,
    managedDeploymentId: null,
    managedServiceId: null,
    managedProjectId: null,
    managedImageRef: null,
    managedNetworkMode: null,
    logsStreamId: null,
    startedAt: null,
    createdAt: at,
    updatedAt: at,
} as never

const run = (
    effect: Effect.Effect<unknown, unknown, unknown>,
    lookup: unknown
) =>
    Effect.runPromise(
        effect.pipe(
            Effect.provideService(DockerContainerLinksLookup, lookup as never)
        ) as Effect.Effect<unknown>
    )

describe('DockerContainerLinks', () => {
    it('returns nothing for no containers without touching the database', async () => {
        const lookup = { lookup: vi.fn() }
        await expect(
            run(DockerContainerLinks.live.attach([], ['project'], null), lookup)
        ).resolves.toEqual([])
        expect(lookup.lookup).not.toHaveBeenCalled()
    })

    it('gives empty links, with no query, when no link is asked for', async () => {
        const lookup = { lookup: vi.fn() }
        const [linked] = (await run(
            DockerContainerLinks.live.attach([container], [], 'admin'),
            lookup
        )) as { links: unknown }[]
        expect(linked?.links).toEqual({
            deployment: null,
            service: null,
            project: null,
        })
        expect(lookup.lookup).not.toHaveBeenCalled()
    })

    it("looks the rows up once and assembles the links for the caller's role", async () => {
        const lookup = {
            lookup: vi.fn(() =>
                Effect.succeed({
                    deployments: [],
                    services: [],
                    projects: [
                        {
                            id: 'p1',
                            name: 'proj',
                            baseDomain: 'example.com',
                            updatedAt: new Date(at),
                        },
                    ],
                })
            ),
        }
        const [viewer] = (await run(
            DockerContainerLinks.live.attach(
                [container],
                ['project'],
                'viewer'
            ),
            lookup
        )) as {
            links: { project: { baseDomain: string | null } | null }
        }[]
        expect(lookup.lookup).toHaveBeenCalledTimes(1)
        expect(viewer?.links.project?.baseDomain).toBeNull()
    })
})
