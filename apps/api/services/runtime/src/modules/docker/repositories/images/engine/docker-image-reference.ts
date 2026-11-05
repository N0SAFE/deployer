import type { DockerodeImageSummary } from '@deployer/contracts-entities'

import {
    normalizeImageRegistrySegment,
    normalizeImageRepositoryPath,
} from './docker-image-identity'

/**
 * How an image is referred to: ids, digests and the candidate references used to find it in the engine. Pure.
 */

export function toStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.filter(
            (entry): entry is string =>
                typeof entry === 'string' && entry.length > 0
        )
    }

    if (typeof value === 'string' && value.length > 0) {
        return [value]
    }

    return []
}

export function buildImageInspectCandidates(imageId: string): string[] {
    const normalized = imageId.trim()
    if (normalized.length === 0) {
        return []
    }

    const candidates = new Set<string>([normalized])
    const shaPrefix = 'sha256:'

    if (normalized.startsWith(shaPrefix)) {
        const withoutPrefix = normalized.slice(shaPrefix.length)
        if (withoutPrefix.length > 0) {
            candidates.add(withoutPrefix)
        }
    } else {
        candidates.add(`${shaPrefix}${normalized}`)
    }

    return [...candidates]
}

export function normalizeImageIdentifier(
    value: string | null | undefined
): string {
    if (typeof value !== 'string') {
        return ''
    }

    return value
        .trim()
        .toLowerCase()
        .replace(/^sha256:/u, '')
}

export function normalizeDigestHash(
    value: string | null | undefined
): string | null {
    if (typeof value !== 'string') {
        return null
    }

    const trimmed = value.trim().toLowerCase()
    if (trimmed.length === 0) {
        return null
    }

    const digestPart = trimmed.includes(':')
        ? trimmed.slice(trimmed.indexOf(':') + 1)
        : trimmed
    return digestPart.length > 0 ? digestPart : null
}

export function buildCanonicalImageIdentifier(input: {
    registry: string
    repository: string
    digest: string | null
    fallbackId: string
}): string {
    const digestHash = normalizeDigestHash(input.digest)
    if (!digestHash) {
        return normalizeImageIdentifier(input.fallbackId)
    }

    const registry = normalizeImageRegistrySegment(input.registry).toLowerCase()
    const repository = normalizeImageRepositoryPath(
        input.repository
    ).toLowerCase()
    return `${registry}/${repository}@${digestHash}`
}

export function identifiersMatch(
    left: string | null | undefined,
    right: string | null | undefined
): boolean {
    const normalizedLeft = normalizeImageIdentifier(left)
    const normalizedRight = normalizeImageIdentifier(right)

    if (normalizedLeft.length === 0 || normalizedRight.length === 0) {
        return false
    }

    return (
        normalizedLeft === normalizedRight ||
        normalizedLeft.startsWith(normalizedRight) ||
        normalizedRight.startsWith(normalizedLeft)
    )
}

export function buildImageInspectCandidatesFromImageList(
    imageId: string,
    images: DockerodeImageSummary[]
): string[] {
    const requested = imageId.trim()
    const candidates = new Set<string>()

    for (const image of images) {
        const rawImageId = typeof image.Id === 'string' ? image.Id.trim() : ''
        const repoTags = toStringArray(
            image.RepoTags as string | string[] | undefined
        )
            .map((tag) => tag.trim())
            .filter((tag) => tag.length > 0 && tag !== '<none>:<none>')

        const repoDigests = toStringArray(
            image.RepoDigests as string | string[] | undefined
        )
            .map((digest) => digest.trim())
            .filter((digest) => digest.length > 0 && digest !== '<none>@<none>')

        const digestHashes = repoDigests
            .map((digest) => {
                const digestSeparatorIndex = digest.indexOf('@')
                return digestSeparatorIndex === -1
                    ? digest
                    : digest.slice(digestSeparatorIndex + 1)
            })
            .filter((digest) => digest.length > 0)

        const hasMatch = [
            rawImageId,
            ...repoTags,
            ...repoDigests,
            ...digestHashes,
        ].some((candidate) => identifiersMatch(candidate, requested))

        if (!hasMatch) {
            continue
        }

        if (rawImageId.length > 0) {
            candidates.add(rawImageId)
        }

        for (const repoTag of repoTags) {
            candidates.add(repoTag)
        }

        for (const repoDigest of repoDigests) {
            candidates.add(repoDigest)
        }
    }

    return [...candidates]
}
