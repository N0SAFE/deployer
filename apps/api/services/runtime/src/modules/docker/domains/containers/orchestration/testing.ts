import { Effect } from "effect";

import {
    ContainersLocalPort,
    ContainersMeshPort,
    DockerContainerResolution,
} from "./docker-container-resolution";

type PromiseResolution = {
    listContainers?: (...args: never[]) => unknown;
    listContainersGrouped?: (...args: never[]) => unknown;
    inspectContainer?: (...args: never[]) => unknown;
};

/**
 * What a Nest class that runs container resolution on the app's runtime sees, with the resolution replaced by a
 * Promise-returning fake: the runtime runs the effect over a context holding that fake as the service.
 */
export function runtimeOverResolution(fake: PromiseResolution) {
    const wrap =
        (method: keyof PromiseResolution) =>
        (...args: unknown[]) =>
            Effect.tryPromise({
                try: async () => await (fake[method] as (...a: unknown[]) => unknown)(...args),
                catch: (error) => error,
            });
    const service = {
        listContainers: wrap("listContainers"),
        listContainersGrouped: wrap("listContainersGrouped"),
        inspectContainer: wrap("inspectContainer"),
    };
    return {
        runPromiseUnwrapped: <A>(effect: Effect.Effect<A, unknown, never>) =>
            Effect.runPromise(Effect.provideService(effect as never, DockerContainerResolution, service as never)) as Promise<A>,
    };
}

/** The resolution built over fake collaborators, called as a Promise API the way the old class was. */
export function createResolution(mesh: unknown, local: unknown) {
    const provide = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);
    const withPorts = <A, E>(effect: Effect.Effect<A, E, unknown>) =>
        effect.pipe(
            Effect.provideService(ContainersMeshPort, mesh as never),
            Effect.provideService(ContainersLocalPort, local as never),
        ) as Effect.Effect<A, E, never>;
    return {
        listContainers: (...args: Parameters<typeof DockerContainerResolution.live.listContainers>) =>
            provide(withPorts(DockerContainerResolution.live.listContainers(...args))),
        listContainersGrouped: (...args: Parameters<typeof DockerContainerResolution.live.listContainersGrouped>) =>
            provide(withPorts(DockerContainerResolution.live.listContainersGrouped(...args))),
        inspectContainer: (...args: Parameters<typeof DockerContainerResolution.live.inspectContainer>) =>
            provide(withPorts(DockerContainerResolution.live.inspectContainer(...args))),
    };
}
