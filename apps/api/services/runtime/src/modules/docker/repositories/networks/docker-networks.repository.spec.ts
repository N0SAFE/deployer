import { Effect, Exit } from 'effect'
import { describe, expect, it } from 'vitest'

import { DockerEngine, DockerUnavailable } from '@deployer/docker'

import {
    DockerNetworksRepository,
    normalizeNetworkDriver,
    normalizeNetworkScope,
} from './docker-networks.repository'

const engineWith = (networks: unknown[]) =>
    ({ networks: { list: () => Effect.succeed(networks) } }) as never

const withEngine = (engine: never) => ({
    list: new DockerNetworksRepository.live().list.pipe(
        Effect.provideService(DockerEngine, engine)
    ),
})

describe('DockerNetworksRepository', () => {
    it('maps an engine network onto the network entity', async () => {
        const repository = withEngine(
            engineWith([
                {
                    Id: 'n1',
                    Name: 'deployer-overlay',
                    Driver: 'overlay',
                    Scope: 'swarm',
                    Internal: false,
                    Attachable: true,
                    IPAM: {
                        Config: [
                            { Subnet: '10.0.1.0/24', Gateway: '10.0.1.1' },
                        ],
                    },
                    Containers: { c1: {}, c2: {} },
                    Labels: { team: 'core' },
                    Created: '2026-10-01T10:00:00.000Z',
                },
            ])
        )

        const [network] = await Effect.runPromise(repository.list)

        expect(network).toMatchObject({
            id: 'n1',
            name: 'deployer-overlay',
            driver: 'overlay',
            scope: 'swarm',
            subnet: '10.0.1.0/24',
            gateway: '10.0.1.1',
            containerIds: ['c1', 'c2'],
            labels: { team: 'core' },
            createdAt: '2026-10-01T10:00:00.000Z',
        })
    })

    it('defaults what the engine leaves out', async () => {
        const [network] = await Effect.runPromise(
            withEngine(engineWith([{ Id: 'n2' }])).list
        )
        expect(network).toMatchObject({
            name: 'unknown-network',
            driver: 'custom',
            scope: 'global',
            attachable: true,
            subnet: null,
            gateway: null,
            containerIds: [],
        })
    })

    it('treats an unknown driver as custom and an unknown scope as global', () => {
        expect(normalizeNetworkDriver('weave')).toBe('custom')
        expect(normalizeNetworkDriver('BRIDGE')).toBe('bridge')
        expect(normalizeNetworkScope('galaxy')).toBe('global')
        expect(normalizeNetworkScope('Local')).toBe('local')
    })

    it("fails with the engine's own typed error", async () => {
        const failing = {
            networks: {
                list: () =>
                    Effect.fail(
                        new DockerUnavailable({ reason: 'socket gone' })
                    ),
            },
        } as never
        const exit = await Effect.runPromiseExit(withEngine(failing).list)
        expect(Exit.isFailure(exit)).toBe(true)
    })
})
