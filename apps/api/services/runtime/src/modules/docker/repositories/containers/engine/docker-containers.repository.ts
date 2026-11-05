import { Context, Data, Effect } from 'effect'

import {
    dockerodeContainerListSchema,
    type DockerContainerInspectDetail,
    type DockerodeContainerList,
} from '@deployer/contracts-entities'
import { DockerEngine, type DockerError } from '@deployer/docker'

import {
    buildContainerInspectDetail,
    layerFallbackCandidates,
} from './container-inspect-detail'
import { extractRootFsLayers } from './container-inspect-reading'

/** The engine could not describe this container (it is gone, or the engine refused). */
export class ContainerNotFound extends Data.TaggedError('ContainerNotFound')<{
    readonly containerId: string
}> {}

/**
 * The engine's container list as the runtime reads it: items that do not fit the schema are dropped one by one
 * instead of failing the whole list. Pure, so it is tested with plain objects.
 */
export function parseDockerodeContainers(
    raw: readonly unknown[]
): DockerodeContainerList[] {
    const whole = dockerodeContainerListSchema.array().safeParse(raw)
    if (whole.success) {
        return whole.data
    }
    return raw
        .filter((item) => dockerodeContainerListSchema.safeParse(item).success)
        .map((item) => dockerodeContainerListSchema.parse(item))
}

export type DockerContainersRepositoryShape = {
    /** Every container the engine reports (running or not), in the shape the runtime reads. */
    readonly listRaw: Effect.Effect<
        DockerodeContainerList[],
        DockerError,
        DockerEngine
    >
    /** The inspect detail of one container; its image layers come from the image when the container does not carry them. */
    readonly inspect: (
        containerId: string
    ) => Effect.Effect<
        DockerContainerInspectDetail,
        ContainerNotFound,
        DockerEngine
    >
}

/** The containers of the local engine; a constant that yields the engine when `listRaw` runs. */
export class DockerContainersRepository extends Context.Service<
    DockerContainersRepository,
    DockerContainersRepositoryShape
>()('runtime/DockerContainersRepository') {
    static readonly live = class DockerContainersRepositoryImpl implements DockerContainersRepositoryShape {
        listRaw = Effect.gen(function* () {
            const engine = yield* DockerEngine
            const raw = yield* engine.containers.list({ all: true })
            return parseDockerodeContainers(raw)
        })

        inspect = (containerId) =>
            Effect.gen(function* () {
                const engine = yield* DockerEngine
                const inspect = yield* engine.containers
                    .inspect(containerId)
                    .pipe(
                        Effect.mapError(
                            () => new ContainerNotFound({ containerId })
                        )
                    )
                const generatedAt = new Date().toISOString()

                let layerIds = extractRootFsLayers(inspect)
                if (layerIds.length === 0) {
                    for (const candidate of layerFallbackCandidates(inspect)) {
                        // A candidate the engine cannot inspect is skipped: layers stay empty.
                        const image = yield* engine.images
                            .inspect(candidate)
                            .pipe(Effect.orElseSucceed(() => null))
                        if (image === null) continue
                        layerIds = extractRootFsLayers(image)
                        if (layerIds.length > 0) break
                    }
                }

                return buildContainerInspectDetail(
                    containerId,
                    inspect,
                    layerIds,
                    generatedAt
                )
            })
    }
}
