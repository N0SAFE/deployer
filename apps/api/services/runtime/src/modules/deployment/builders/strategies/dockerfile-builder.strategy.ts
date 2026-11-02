import { Injectable, Inject } from "@nestjs/common";

import { DockerEngine, type DockerEngineShape } from "@deployer/docker";
import { runPromiseUnwrapped } from "@deployer/effect-core";

import type {
    BuilderStrategy,
    BuilderStrategyContext,
    BuilderStrategyResult,
} from "../base/builder-strategy.interface";

/**
 * `dockerfile` — build one image from the context's Dockerfile.
 *
 * This is the only builder that was genuinely working before the registry existed;
 * the behaviour is moved here verbatim so the refactor changes no defaults.
 */
@Injectable()
export class DockerfileBuilderStrategy implements BuilderStrategy {
    readonly builderType = "dockerfile";

    constructor(@Inject(DockerEngine) private readonly dockerEngine: DockerEngineShape) {}

    /** Always available: it needs only the Docker engine, which the API requires. */
    isAvailable(): boolean {
        return true;
    }

    unavailableReason(): string {
        return "";
    }

    async build(context: BuilderStrategyContext): Promise<BuilderStrategyResult> {
        await runPromiseUnwrapped(
            this.dockerEngine.build.image(context.buildContextPath, context.imageTag, {
                ...(context.dockerfileName !== null ? { dockerfileName: context.dockerfileName } : {}),
            }),
            { signal: context.signal },
        );
        return { image: context.imageTag };
    }
}
