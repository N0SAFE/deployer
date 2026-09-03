import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { Container } from "dockerode";
import { DockerService } from "../../services/docker.service";
import { AbstractDockerContainerService } from "../../services/abstract-docker-container.service";

const MANAGED_CONTAINER_NAME = "deployer-postgres-dev";
const MANAGED_VOLUME_NAME = "deployer_postgres_data";

/** Stable container name of the API-managed Postgres (shared with the supervisor). */
export const MANAGED_POSTGRES_CONTAINER_NAME = MANAGED_CONTAINER_NAME;
/** Stable named volume persisting the API-managed Postgres data. */
export const MANAGED_POSTGRES_VOLUME_NAME = MANAGED_VOLUME_NAME;
/** Image of the API-managed Postgres container (shared with the supervisor). */
export const MANAGED_POSTGRES_IMAGE = "postgres:16-alpine";
/** Container-side port of the managed Postgres. */
export const MANAGED_POSTGRES_PORT = 5432;

export interface PostgresContainerStartOptions {
    databaseName?: string;
    username?: string;
    password?: string;
    image?: string;
    name?: string;
    apiUrl?: string;
    shutdownTimeoutSeconds?: number;
}

@Injectable()
export class PostgresContainerService extends AbstractDockerContainerService implements OnModuleDestroy {
    constructor(protected readonly dockerService: DockerService) {
        super(dockerService);
    }

    async onModuleDestroy(): Promise<void> {
        // Graceful stop only — container persists for next restart
        try {
            const docker = this.dockerService.getDockerClient();
            const container = docker.getContainer(MANAGED_CONTAINER_NAME);
            await container.stop({ t: 5 }).catch(() => undefined);
            this.logger.log(`🛑 Stopped managed Postgres container: ${MANAGED_CONTAINER_NAME}`);
        } catch (err: unknown) {
            // Container may not exist — that's fine
            this.logger.log(`No managed container to stop (${(err as Error).message})`);
        }
    }

    /**
     * Ensure a Postgres container is running. Uses a FIXED container name so
     * the same container is reused across restarts. Data persists via a named volume.
     *
     * Strategy:
     *   1. Check if container `deployer-postgres-dev` already exists
     *   2. If running → return its connection URL immediately
     *   3. If stopped → restart it
     *   4. If doesn't exist → create new with fixed name + named volume
     */
    async startPostgresContainer(options: PostgresContainerStartOptions = {}): Promise<Container> {
        const databaseName = options.databaseName ?? "deployer";
        const username = options.username ?? "deployer";
        const password = options.password ?? "deployer";

        const docker = this.dockerService.getDockerClient();

        // ── Step 1: Check for existing container ──────────────────────────
        try {
            const existing = docker.getContainer(MANAGED_CONTAINER_NAME);
            const info = await existing.inspect();

            if (info.State.Running) {
                this.logger.log(`♻️ Reusing existing Postgres container: ${MANAGED_CONTAINER_NAME}`);
                return existing;
            }

            // Container exists but stopped — restart it
            this.logger.log(`🔄 Restarting stopped Postgres container: ${MANAGED_CONTAINER_NAME}`);
            await existing.start();
            return existing;

        } catch (err: unknown) {
            if (err instanceof Error && err.message.includes("no such container")) {
                // Container doesn't exist — create it
                this.logger.log(`📦 Creating new Postgres container: ${MANAGED_CONTAINER_NAME}`);
                return this.createPostgresContainer(docker, databaseName, username, password);
            }
            throw err;
        }
    }

    /**
     * Create a new Postgres container with a FIXED name and named volume.
     * AutoRemove is false so the container (and its data) survives restarts.
     */
    private async createPostgresContainer(
        docker: import("dockerode"),
        databaseName: string,
        username: string,
        password: string,
    ): Promise<Container> {
        // Ensure named volume exists
        const volumes = await docker.listVolumes();
        const hasVolume = volumes.Volumes?.some((v) => v.Name === MANAGED_VOLUME_NAME);
        if (!hasVolume) {
            await docker.createVolume({ Name: MANAGED_VOLUME_NAME });
            this.logger.log(`📀 Created named volume: ${MANAGED_VOLUME_NAME}`);
        }

        const container = await this.startContainer({
            name: MANAGED_CONTAINER_NAME,
            image: MANAGED_POSTGRES_IMAGE,
            env: [
                `POSTGRES_DB=${databaseName}`,
                `POSTGRES_USER=${username}`,
                `POSTGRES_PASSWORD=${password}`,
            ],
            labels: {
                "deployer.managed": "true",
                "deployer.managed_reason": "bootstrap_database",
            },
            exposedPorts: { [`${String(MANAGED_POSTGRES_PORT)}/tcp`]: {} },
            hostConfig: {
                Binds: [`${MANAGED_VOLUME_NAME}:/var/lib/postgresql/data`],
            },
            autoRemove: false,
            healthCheck: {
                test: ["CMD-SHELL", `pg_isready -U ${username} -d ${databaseName}`],
                interval: 1_000_000_000,
                timeout: 5_000_000_000,
                retries: 30,
                startPeriod: 5_000_000_000,
            },
        });

        this.logger.log(`✅ Postgres container created: ${MANAGED_CONTAINER_NAME}`);
        return container;
    }

    async getMappedPort(containerId: string, containerPort: number): Promise<number> {
        const container = this.dockerService.getDockerClient().getContainer(containerId);

        // Docker may need a moment after container.start() to bind the ports.
        // Retry up to 10 times with 1-second delay to handle slow port allocation.
        const maxRetries = 10;
        let lastError: Error | undefined;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const inspected = await container.inspect();
                const binding = inspected.NetworkSettings.Ports[`${String(containerPort)}/tcp`]?.[0]?.HostPort;

                if (binding) {
                    return Number(binding);
                }

                this.logger.debug(
                    `Port ${String(containerPort)} not yet mapped for container ${containerId} (attempt ${attempt}/${maxRetries})`
                );
            } catch (err: unknown) {
                lastError = err instanceof Error ? err : new Error(String(err));
                this.logger.debug(
                    `Inspect failed for container ${containerId} (attempt ${attempt}/${maxRetries}): ${lastError.message}`
                );
                // If container no longer exists, stop retrying
                if (lastError.message.toLowerCase().includes("no such container")) {
                    throw lastError;
                }
            }

            await new Promise((r) => setTimeout(r, 1_000));
        }

        throw lastError ?? new Error(
            `Container ${containerId} does not expose port ${String(containerPort)} after ${String(maxRetries)} retries`
        );
    }

    async stopContainer(containerId: string, timeoutSeconds = 10): Promise<void> {
        const container = this.dockerService.getDockerClient().getContainer(containerId);
        await container.stop({ t: timeoutSeconds }).catch(() => undefined);
    }

    async removeContainer(containerId: string, force = true): Promise<void> {
        const container = this.dockerService.getDockerClient().getContainer(containerId);
        await container.remove({ force }).catch(() => undefined);
    }

    private buildPostgresBootstrapDockerfile(apiUrl: string, shutdownTimeoutSeconds: number): string {
        const apiHealthUrl = `${apiUrl.replace(/\/$/, "")}/health`;
        const command = [
            "set -eu",
            "docker-entrypoint.sh postgres & pid=$!",
            "started_at=$(date +%s)",
            "trap 'kill $pid; wait $pid' INT TERM",
            "while true; do",
            `  if curl -fsS '${apiHealthUrl}' >/dev/null 2>&1; then`,
            "    sleep 5",
            "    continue",
            "  fi",
            "  now=$(date +%s)",
            `  if [ $((now - started_at)) -ge ${String(shutdownTimeoutSeconds)} ]; then`,
            "    kill $pid",
            "    wait $pid || true",
            "    exit 0",
            "  fi",
            "  sleep 5",
            "done",
        ].join("; ");

        return [
            "FROM postgres:16-alpine",
            "RUN apk add --no-cache curl",
            "WORKDIR /bootstrap",
            `CMD ["sh", "-lc", ${JSON.stringify(command)}]`,
        ].join("\n");
    }
}