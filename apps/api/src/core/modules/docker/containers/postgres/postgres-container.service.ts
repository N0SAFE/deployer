import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Container } from "dockerode";
import { DockerService } from "../../services/docker.service";
import { AbstractDockerContainerService } from "../../services/abstract-docker-container.service";

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
    /** Tracks auto-provisioned Postgres container IDs for cleanup on shutdown. */
    private readonly managedContainerIds = new Set<string>();

    constructor(protected readonly dockerService: DockerService) {
        super(dockerService);
    }

    async onModuleDestroy(): Promise<void> {
        if (this.managedContainerIds.size === 0) return;

        this.logger.log(`Cleaning up ${String(this.managedContainerIds.size)} managed Postgres container(s) …`);

        const docker = this.dockerService.getDockerClient();
        const errors: string[] = [];

        for (const containerId of this.managedContainerIds) {
            try {
                const container = docker.getContainer(containerId);
                // Stop with a short timeout — autoRemove will clean up the container.
                await container.stop({ t: 5 }).catch(() => undefined);
                this.logger.log(`Stopped managed Postgres container ${containerId}`);
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                errors.push(`${containerId}: ${msg}`);
                this.logger.warn(`Failed to stop managed Postgres container ${containerId}: ${msg}`);
            }
        }

        this.managedContainerIds.clear();

        if (errors.length > 0) {
            this.logger.warn(
                `Finished cleanup with ${String(errors.length)} error(s): ${errors.join("; ")}`
            );
        } else {
            this.logger.log("All managed Postgres containers cleaned up successfully");
        }
    }

    async startPostgresContainer(options: PostgresContainerStartOptions = {}): Promise<Container> {
        const databaseName = options.databaseName ?? "deployer";
        const username = options.username ?? "deployer";
        const password = options.password ?? "deployer";
        const apiUrl = options.apiUrl?.trim() ?? "http://127.0.0.1:3000";
        const shutdownTimeoutSeconds = options.shutdownTimeoutSeconds ?? 120;

        // Use the official postgres image directly with a simple CMD wrapper that
        // starts postgres normally. On Linux, the health check from inside the
        // container cannot reach the host's localhost, so we use a minimal CMD
        // that just runs postgres with the original entrypoint.
        //
        // We avoid building a custom Dockerfile with a health check loop because:
        // 1) The health check URL (127.0.0.1:3000) from inside the container
        //    points to the container's own network namespace, not the host.
        // 2) Backgrounding docker-entrypoint.sh can cause postgres to fail
        //    silently due to shell process group issues.
        // 3) The double invocation of docker-entrypoint.sh (ENTRYPOINT + CMD)
        //    creates unnecessary complexity.
        //
        // Instead, we let the image's own ENTRYPOINT handle initialization,
        // and the container stays alive with postgres as PID 1.
        // autoRemove will clean it up when the container exits (via explicit
        // stop or if postgres crashes).

        const container = await this.startContainer({
            image: options.image ?? "postgres:16-alpine",
            name: options.name ?? `deployer-bootstrap-postgres-${randomUUID().slice(0, 8)}`,
            env: [`POSTGRES_DB=${databaseName}`, `POSTGRES_USER=${username}`, `POSTGRES_PASSWORD=${password}`],
            labels: {
                "deployer.managed": "true",
                "deployer.managed_reason": "bootstrap_database",
            },
            exposedPorts: { "5432/tcp": {} },
            autoRemove: true,
            healthCheck: {
                test: ["CMD-SHELL", `pg_isready -U ${username} -d ${databaseName}`],
                interval: 1_000_000_000,   // 1s
                timeout: 5_000_000_000,     // 5s
                retries: 30,
                startPeriod: 5_000_000_000, // 5s grace period
            },
        });

        // Track the container for cleanup on module destroy.
        this.managedContainerIds.add(container.id);

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