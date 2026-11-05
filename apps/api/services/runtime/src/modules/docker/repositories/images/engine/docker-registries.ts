import {
    dockerRegistrySchema,
    type DockerImage,
    type DockerRegistry,
} from '@deployer/contracts-entities'

/**
 * The registries the local images came from. There is no registry API behind this: a registry is whatever an image
 * reference names, with the repositories seen under it and the most recent time one of its images was seen. Auth
 * and status are not known from here, so they are reported as anonymous/unknown.
 */
export function deriveRegistries(
    images: readonly DockerImage[]
): DockerRegistry[] {
    const grouped = new Map<
        string,
        { repositories: Set<string>; lastSeenAt: string }
    >()

    for (const image of images) {
        const current = grouped.get(image.registry) ?? {
            repositories: new Set<string>(),
            lastSeenAt: image.lastSeenAt,
        }
        current.repositories.add(image.repository)
        if (image.lastSeenAt > current.lastSeenAt)
            current.lastSeenAt = image.lastSeenAt
        grouped.set(image.registry, current)
    }

    return [...grouped.entries()].map(([registry, value]) =>
        dockerRegistrySchema.parse({
            id: registry,
            name: registry,
            url: registry,
            authMode: 'anonymous',
            status: 'unknown',
            isPrimary: registry === 'docker.io',
            repositories: [...value.repositories].sort(),
            lastSyncedAt: value.lastSeenAt,
            createdAt: value.lastSeenAt,
            updatedAt: value.lastSeenAt,
        })
    )
}
