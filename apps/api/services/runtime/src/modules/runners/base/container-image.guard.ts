import { RuntimeInvalid } from '../../../core/runtime.errors'

import type {
    BuildArtifactResult,
    RuntimeDeploymentContext,
} from '../runtime-runner.interface'

/**
 * The image a runner must run, or a loud failure.
 *
 * There used to be a `?? "nginx:alpine"` fallback in every runner. A deploy whose
 * builder produced nothing (no Dockerfile, no builder resolved, compose file the
 * runtime cannot realize) therefore started a stock nginx and reported `success`
 * — the platform's worst failure mode: it looks green and serves the wrong thing.
 *
 * A missing image is a configuration error, not a transient one, so this throws a
 * `BadRequestError` (classified non-retryable by the queue worker, which marks the
 * deployment `failed` with this message).
 */
export function resolveContainerImage(
    artifact: BuildArtifactResult,
    deployment: RuntimeDeploymentContext,
    runnerType: string
): string {
    const image = artifact.containerImage ?? deployment.deploymentContainerImage
    if (typeof image === 'string' && image.trim().length > 0) {
        return image
    }

    throw new RuntimeInvalid({
        reason:
            `No container image was produced, so the '${runnerType}' runner has nothing to start. ` +
            'Add a Dockerfile to the build context, set an explicit builder, or provide a prebuilt image.',
    })
}
