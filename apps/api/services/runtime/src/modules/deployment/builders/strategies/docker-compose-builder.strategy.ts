import { existsSync } from "node:fs";
import path from "node:path";

import { Effect } from "effect";

import type { DockerEngineShape } from "@deployer/docker";

import { RuntimeInvalid } from "../../../../core/runtime.errors";

import type { BuilderStrategy } from "../base/builder-strategy.interface";

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
 * when it has no image. `SwarmComposeRealizer` — the real compose→swarm
 * pipeline — is implemented and called by nothing. So a compose service currently
 * builds correctly and then runs the wrong artifact.
 */
export function makeDockerComposeBuilderStrategy(engine: DockerEngineShape): BuilderStrategy {
    return {
        builderType: "docker_compose",
        isAvailable: () => true,
        unavailableReason: () => "",
        build: (context) =>
            Effect.gen(function* () {
                if (context.dockerfileName !== null) {
                    return yield* new RuntimeInvalid({ reason: "Custom build/run commands cannot be combined with builder 'docker_compose' — the compose file already declares how each service is built" });
                }

                const composeFile = COMPOSE_CANDIDATES.find((candidate) =>
                    existsSync(path.join(context.buildContextPath, candidate)),
                );
                if (composeFile === undefined) {
                    return yield* new RuntimeInvalid({ reason: "Builder 'docker_compose' requires a compose file in the source context" });
                }

                yield* engine.build.compose(context.buildContextPath, {
                    composeFileName: composeFile,
                    projectName: `deployer-${context.deploymentId.slice(0, 12)}`,
                });

                return { image: null };
            }),
    };
}
