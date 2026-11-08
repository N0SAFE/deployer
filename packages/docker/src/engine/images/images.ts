import { Context, Effect } from 'effect'
import z from 'zod/v4'

import {
    dockerodeImageSummarySchema,
    type DockerodeImageSummary,
} from '@deployer/contracts-entities'

import { engineMessage } from '../../errors/classify'
import {
    DockerInvalid,
    DockerUnavailable,
    type DockerError,
} from '../../errors/errors'
import { engineCall } from '../call'

import { followProgress } from './progress'

import type Docker from 'dockerode'

export type ImagePullPolicy = 'IfNotPresent' | 'Always' | 'Never'

export type PullOptions = {
    readonly registryAuth?: Docker.AuthConfig
    /** Attempts before giving up. Default 3. */
    readonly retries?: number
    /** Wait before the second attempt; doubles each time. Default 2000. */
    readonly backoffMs?: number
    /** Receives each human-readable progress line the engine reports. */
    readonly onProgressLine?: (line: string) => void
}

export type ImagesShape = {
    /** True when the image is present locally. */
    readonly exists: (image: string) => Effect.Effect<boolean>
    /** Removes an image, forced. One that is already gone counts as removed. */
    readonly remove: (imageTag: string) => Effect.Effect<void, DockerError>
    /** The image as the engine describes it, or `DockerNotFound`. */
    readonly inspect: (
        image: string
    ) => Effect.Effect<Docker.ImageInspectInfo, DockerError>
    /** Top-level images on this engine (`GET /images/json`). */
    readonly list: () => Effect.Effect<DockerodeImageSummary[], DockerError>
    /** Pulls `image`, retrying with exponential backoff. */
    readonly pull: (
        image: string,
        options?: PullOptions
    ) => Effect.Effect<void, DockerError>
    /** Makes `image` present locally as `policy` allows: nothing when it is there, a pull when it is not. */
    readonly ensurePresent: (
        image: string,
        policy: ImagePullPolicy,
        registryAuth?: Docker.AuthConfig
    ) => Effect.Effect<void, DockerError>
}

/**
 * The one implementation of `ImagesShape`.
 *
 * Declared at module scope rather than as a class expression on the service: declaration emit
 * cannot describe the private members of an anonymous exported class (TS4094).
 */
class ImagesImpl implements ImagesShape {
    constructor(private readonly client: Docker) {}

    private pullOnce(image: string, options: PullOptions) {
        const client = this.client
        return engineCall(`pull image ${image}`, async (signal) => {
            const stream = await client.pull(image, {
                ...(options.registryAuth
                    ? { authconfig: options.registryAuth }
                    : {}),
                abortSignal: signal,
            })
            await followProgress(client, stream, options.onProgressLine)
        })
    }

    pull(
        image: string,
        options: PullOptions = {}
    ): Effect.Effect<void, DockerError> {
        const pullOnce = (i: string, o: PullOptions) => this.pullOnce(i, o)
        return Effect.fn('DockerImages.pull')(function* () {
        const retries = options.retries ?? 3
        let backoffMs = options.backoffMs ?? 2000
        let lastFailure: DockerError | null = null
        for (let attempt = 1; attempt <= retries; attempt++) {
            const outcome = yield* pullOnce(image, options).pipe(
                Effect.map(() => null),
                Effect.catch((failure) => Effect.succeed(failure))
            )
            if (outcome === null) {
                yield* Effect.logInfo(
                    `Pulled ${image} on attempt ${String(attempt)}`
                )
                return
            }
            lastFailure = outcome
            yield* Effect.logWarning(
                `Pull attempt ${String(attempt)} failed for ${image}: ${engineMessage(outcome)}`
            )
            if (attempt < retries) {
                yield* Effect.sleep(backoffMs)
                backoffMs *= 2
            }
        }
        return yield* Effect.fail(
            new DockerUnavailable({
                reason: `Failed to pull image ${image}: ${lastFailure ? engineMessage(lastFailure) : 'unknown error'}`,
                cause: lastFailure,
            })
        )
        })()
    }

    ensurePresent(
        image: string,
        policy: ImagePullPolicy,
        registryAuth?: Docker.AuthConfig
    ): Effect.Effect<void, DockerError> {
        const client = this.client
        const pull = (i: string, o: PullOptions) => this.pull(i, o)
        return Effect.fn('DockerImages.ensurePresent')(function* () {
        if (policy !== 'Always') {
            const present = yield* engineCall(`inspect image ${image}`, () =>
                client.getImage(image).inspect()
            ).pipe(
                Effect.as(true),
                Effect.catch(() => Effect.succeed(false))
            )
            if (present) return
            if (policy === 'Never') {
                return yield* Effect.fail(
                    new DockerInvalid({
                        reason: `Image ${image} not present locally and imagePullPolicy is 'Never'`,
                    })
                )
            }
        }
        yield* pull(image, { registryAuth })
        })()
    }

    remove(imageTag: string): Effect.Effect<void, DockerError> {
        const client = this.client
        return Effect.fn('DockerImages.remove')(function* () {
            yield* engineCall(
                `remove image ${imageTag}`,
                () => client.getImage(imageTag).remove({ force: true }),
                `image '${imageTag}'`
            ).pipe(Effect.catchTag('DockerNotFound', () => Effect.void))
            yield* Effect.logInfo(`Removed image ${imageTag}`)
        })()
    }

    list(): Effect.Effect<z.infer<typeof dockerodeImageSummarySchema>[], DockerError> {
        const client = this.client
        return Effect.fn('DockerImages.list')(function* () {
            return yield* engineCall('list engine images', async () =>
                z
                    .array(dockerodeImageSummarySchema)
                    .parse(await client.listImages({ all: false }))
            )
        })()
    }

    exists(image: string): Effect.Effect<boolean, never> {
        const client = this.client
        return engineCall(`inspect image ${image}`, () =>
            client.getImage(image).inspect()
        ).pipe(
            Effect.as(true),
            Effect.catch(() => Effect.succeed(false))
        )
    }

    inspect(image: string): Effect.Effect<Docker.ImageInspectInfo, DockerError> {
        const client = this.client
        return engineCall(
            `inspect image ${image}`,
            () => client.getImage(image).inspect(),
            `image '${image}'`
        )
    }
}

/** Engine images, as an Effect service. */
export class Images extends Context.Service<Images, ImagesShape>()(
    'docker/Images'
) {
    /** The implementation: it owns every member body and takes the engine client. */
    static readonly live = ImagesImpl
}
