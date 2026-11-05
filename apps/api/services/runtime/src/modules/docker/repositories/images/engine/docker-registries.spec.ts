import { describe, expect, it } from 'vitest'

import type { DockerImage } from '@deployer/contracts-entities'

import { deriveRegistries } from './docker-registries'

const image = (
    registry: string,
    repository: string,
    lastSeenAt: string
): DockerImage => ({
    id: `${registry}/${repository}`,
    registry,
    repository,
    tag: '1',
    digest: null,
    sizeBytes: 1,
    createdAt: lastSeenAt,
    lastSeenAt,
    labels: {},
})

describe('deriveRegistries', () => {
    it('groups images by registry with their sorted repositories and latest sighting', () => {
        const registries = deriveRegistries([
            image('ghcr.io', 'acme/web', '2026-10-01T00:00:00.000Z'),
            image('ghcr.io', 'acme/api', '2026-10-03T00:00:00.000Z'),
            image('docker.io', 'nginx', '2026-10-02T00:00:00.000Z'),
        ])

        expect(registries).toHaveLength(2)
        expect(
            registries.find((item) => item.name === 'ghcr.io')
        ).toMatchObject({
            repositories: ['acme/api', 'acme/web'],
            lastSyncedAt: '2026-10-03T00:00:00.000Z',
            isPrimary: false,
            authMode: 'anonymous',
            status: 'unknown',
        })
        expect(
            registries.find((item) => item.name === 'docker.io')?.isPrimary
        ).toBe(true)
    })

    it('is empty when there are no images', () => {
        expect(deriveRegistries([])).toEqual([])
    })
})
