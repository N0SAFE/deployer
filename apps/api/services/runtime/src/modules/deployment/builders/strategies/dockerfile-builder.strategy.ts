import { Injectable } from "@nestjs/common";
import { DockerService } from "@deployer/nest-docker/services/docker.service";
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

    constructor(private readonly dockerService: DockerService) {}

    /** Always available: it needs only the Docker engine, which the API requires. */
    isAvailable(): boolean {
        return true;
    }

    unavailableReason(): string {
        return "";
    }

    async build(context: BuilderStrategyContext): Promise<BuilderStrategyResult> {
        await this.dockerService.buildImage(context.buildContextPath, context.imageTag, {
            ...(context.dockerfileName !== null
                ? { dockerfileName: context.dockerfileName, autoCreateDockerfile: false }
                : {}),
        });
        return { image: context.imageTag };
    }
}
