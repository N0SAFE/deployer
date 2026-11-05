import { Effect } from 'effect'

import type { DockerEngineShape } from '@deployer/docker'

import { RuntimeInvalid } from '../../../../core/runtime.errors'

import type { BuilderStrategy } from '../base/builder-strategy.interface'

export type BuildpackFamilyKind = 'nixpacks' | 'buildpack' | 'railpack'

/**
 * The buildpack-family builders: `nixpacks`, `buildpack`, `railpack`.
 *
 * ── WHAT IS ACTUALLY TRUE ABOUT THESE THREE ───────────────────────────────
 * These work — but only through **custom build/run commands**.
 *
 * Before this refactor they had no branch in the inline dispatch, so they fell through
 * to `buildImage()` with no `dockerfileName`. When custom commands were supplied the
 * caller had already written `Dockerfile.deployer.custom`, so it worked by accident;
 * when they were not, there was no Dockerfile and the build failed with
 * "Dockerfile not found" — a message naming the symptom, not the cause.
 *
 * So the fix is NOT to disable the builder (that would remove a working capability, and
 * an existing spec caught exactly that mistake when I tried it). It is: this builder
 * REQUIRES custom commands, and the error must say so. Availability is per-deployment,
 * not global — `isAvailable()` cannot express it — so the precondition is enforced in
 * `build()`, where `dockerfileName !== null` means precisely "custom commands supplied".
 *
 * Always available: the artifact is an ordinary Docker build, which this platform
 * always supports. The per-deployment precondition is checked in `build()`.
 */
export function makeBuildpackFamilyBuilderStrategy(
    builderType: BuildpackFamilyKind,
    engine: DockerEngineShape
): BuilderStrategy {
    return {
        builderType,
        isAvailable: () => true,
        unavailableReason: () => '',
        build: (context) =>
            Effect.gen(function* () {
                // Present only when the operator supplied custom commands — the caller writes it
                // in `prepareCustomBuilderDockerfileIfNeeded`.
                if (context.dockerfileName === null) {
                    return yield* new RuntimeInvalid({
                        reason:
                            `Builder '${builderType}' requires custom build and run commands: this platform ` +
                            `runs no ${builderType} toolchain, so the artifact is produced from a generated ` +
                            "Dockerfile. Set a build command (and run command), or use 'dockerfile' with a " +
                            'committed Dockerfile instead.',
                    })
                }

                yield* engine.build.image(
                    context.buildContextPath,
                    context.imageTag,
                    {
                        dockerfileName: context.dockerfileName,
                    }
                )

                return { image: context.imageTag }
            }),
    }
}
