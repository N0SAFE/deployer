import { BadRequestException, Injectable } from "@nestjs/common";
import { DockerService } from "@deployer/nest-docker/services/docker.service";
import type { BuilderStrategy, BuilderStrategyContext, BuilderStrategyResult } from "../base/builder-strategy.interface";

export type BuildpackFamilyKind = "nixpacks" | "buildpack" | "railpack";

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
 */
@Injectable()
export class BuildpackFamilyBuilderStrategy implements BuilderStrategy {
    readonly builderType: BuildpackFamilyKind;

    constructor(
        builderType: BuildpackFamilyKind,
        private readonly dockerService: DockerService,
    ) {
        this.builderType = builderType;
    }

    /**
     * Always available: the artifact is an ordinary Docker build, which this platform
     * always supports. The per-deployment precondition is checked in `build()`.
     */
    isAvailable(): boolean {
        return true;
    }

    unavailableReason(): string {
        return "";
    }

    async build(context: BuilderStrategyContext): Promise<BuilderStrategyResult> {
        // Present only when the operator supplied custom commands — the caller writes it
        // in `prepareCustomBuilderDockerfileIfNeeded`.
        if (context.dockerfileName === null) {
            throw new BadRequestException(
                `Builder '${this.builderType}' requires custom build and run commands: this platform ` +
                    `runs no ${this.builderType} toolchain, so the artifact is produced from a generated ` +
                    "Dockerfile. Set a build command (and run command), or use 'dockerfile' with a " +
                    "committed Dockerfile instead.",
            );
        }

        await this.dockerService.buildImage(context.buildContextPath, context.imageTag, {
            dockerfileName: context.dockerfileName,
            autoCreateDockerfile: false,
        });

        return { image: context.imageTag };
    }
}
