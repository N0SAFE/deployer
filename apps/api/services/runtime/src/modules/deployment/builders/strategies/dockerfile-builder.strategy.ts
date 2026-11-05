import { Effect } from 'effect'

import type { DockerEngineShape } from '@deployer/docker'

import type { BuilderStrategy } from '../base/builder-strategy.interface'

/**
 * `dockerfile` — build one image from the context's Dockerfile.
 *
 * This is the only builder that was genuinely working before the registry existed;
 * the behaviour is moved here verbatim so the refactor changes no defaults.
 *
 * Always available: it needs only the Docker engine, which the API requires.
 */
export function makeDockerfileBuilderStrategy(
    engine: DockerEngineShape
): BuilderStrategy {
    return {
        builderType: 'dockerfile',
        isAvailable: () => true,
        unavailableReason: () => '',
        build: (context) =>
            engine.build
                .image(context.buildContextPath, context.imageTag, {
                    ...(context.dockerfileName !== null
                        ? { dockerfileName: context.dockerfileName }
                        : {}),
                })
                .pipe(Effect.as({ image: context.imageTag })),
    }
}
