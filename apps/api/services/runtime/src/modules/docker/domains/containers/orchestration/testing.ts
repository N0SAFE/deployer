import { Effect } from 'effect'

import {
    ContainersLocalPort,
    ContainersMeshPort,
    DockerContainerResolution,
    type DockerContainerResolutionPorts,
    type DockerContainerResolutionShape,
} from './docker-container-resolution'

type PromiseResolution = {
    listContainers?: (...args: never[]) => unknown
    listContainersGrouped?: (...args: never[]) => unknown
    inspectContainer?: (...args: never[]) => unknown
}

/**
 * What a Nest class that runs container resolution on the app's runtime sees, with the resolution replaced by a
 * Promise-returning fake: the runtime runs the effect over a context holding that fake as the service.
 */
export function runtimeOverResolution(fake: PromiseResolution) {
    const wrap =
        (method: keyof PromiseResolution) =>
        (...args: unknown[]) =>
            Effect.tryPromise({
                try: async () =>
                    await (fake[method] as (...a: unknown[]) => unknown)(
                        ...args
                    ),
                catch: (error) => error,
            })
    const service = {
        listContainers: wrap('listContainers'),
        listContainersGrouped: wrap('listContainersGrouped'),
        inspectContainer: wrap('inspectContainer'),
    } as unknown as DockerContainerResolutionShape
    return {
        runPromiseUnwrapped: <A>(effect: Effect.Effect<A, unknown>) =>
            Effect.runPromise(
                Effect.provideService(
                    effect,
                    DockerContainerResolution,
                    service
                )
            ),
    }
}

/** The resolution built over fake collaborators, called as a Promise API the way the old class was. */
export function createResolution(mesh: unknown, local: unknown) {
    const resolution: DockerContainerResolutionShape =
        new DockerContainerResolution.live()
    const provide = <A, E>(
        effect: Effect.Effect<A, E, DockerContainerResolutionPorts>
    ): Promise<A> =>
        Effect.runPromise(
            effect.pipe(
                Effect.provideService(ContainersMeshPort, mesh as never),
                Effect.provideService(ContainersLocalPort, local as never)
            )
        )
    return {
        listContainers: (
            ...args: Parameters<DockerContainerResolutionShape['listContainers']>
        ) => provide(resolution.listContainers(...args)),
        listContainersGrouped: (
            ...args: Parameters<
                DockerContainerResolutionShape['listContainersGrouped']
            >
        ) => provide(resolution.listContainersGrouped(...args)),
        inspectContainer: (
            ...args: Parameters<
                DockerContainerResolutionShape['inspectContainer']
            >
        ) => provide(resolution.inspectContainer(...args)),
    }
}
