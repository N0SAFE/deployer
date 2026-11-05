import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { DockerEngine } from '@deployer/docker'

import {
    DockerContainersRepository,
    parseDockerodeContainers,
} from './docker-containers.repository'

const valid = {
    Id: 'c1',
    Names: ['/api'],
    Image: 'img',
    Labels: {},
    State: 'running',
    Status: 'Up',
    Created: 1,
    Ports: [],
    Mounts: [],
}

describe('DockerContainersRepository', () => {
    it('drops the items that do not fit instead of failing the list', () => {
        const parsed = parseDockerodeContainers([valid, { nonsense: true }])
        expect(parsed.map((container) => container.Id)).toEqual(['c1'])
    })

    it('lists from the engine it yields', async () => {
        const engine = {
            containers: { list: () => Effect.succeed([valid]) },
        } as never
        const listed = await Effect.runPromise(
            new DockerContainersRepository.live().listRaw.pipe(
                Effect.provideService(DockerEngine, engine)
            )
        )
        expect(listed).toHaveLength(1)
    })
})
