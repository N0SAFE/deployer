import { BadRequestException, Injectable } from "@nestjs/common";
import { existsSync } from "node:fs";
import path from "node:path";
import { DockerService } from "@deployer/nest-docker/services/docker.service";
import type {
    BuilderStrategy,
    BuilderStrategyContext,
    BuilderStrategyResult,
} from "../base/builder-strategy.interface";

/** Compose files Docker itself accepts, in Docker's own precedence order. */
const COMPOSE_CANDIDATES = ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"] as const;

/**
 * `docker_compose` — build every image declared in the compose file.
 *
 * Returns `image: null` on purpose: a compose project is addressed by PROJECT NAME at
 * runtime, not by a single tag. The old inline code did the same (`return null`), and
 * the caller interprets null as "defer to the compose runtime".
 *
 * ── KNOWN GAP, STATED HERE SO IT IS NOT MISTAKEN FOR WORKING ──────────────
 * Building is real (`docker compose build`). RUNNING is not: the compose runtime
 * runner delegates to the single-container runner, which falls back to `nginx:alpine`
 * when it has no image. `SwarmComposeRealizerService` — the real compose→swarm
 * pipeline — is implemented and called by nothing. So a compose service currently
 * builds correctly and then runs the wrong artifact.
 */
@Injectable()
export class DockerComposeBuilderStrategy implements BuilderStrategy {
    readonly builderType = "docker_compose";

    constructor(private readonly dockerService: DockerService) {}

    isAvailable(): boolean {
        return true;
    }

    unavailableReason(): string {
        return "";
    }

    async build(context: BuilderStrategyContext): Promise<BuilderStrategyResult> {
        if (context.dockerfileName !== null) {
            throw new BadRequestException(
                "Custom build/run commands cannot be combined with builder 'docker_compose' — the compose file already declares how each service is built",
            );
        }

        const composeFile = COMPOSE_CANDIDATES.find((candidate) =>
            existsSync(path.join(context.buildContextPath, candidate)),
        );
        if (composeFile === undefined) {
            throw new BadRequestException(
                "Builder 'docker_compose' requires a compose file in the source context",
            );
        }

        await this.dockerService.buildCompose(context.buildContextPath, {
            composeFileName: composeFile,
            projectName: `deployer-${context.deploymentId.slice(0, 12)}`,
        });

        return { image: null };
    }
}
