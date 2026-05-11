import { Injectable } from "@nestjs/common";
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
export class PostgresContainerService extends AbstractDockerContainerService {
    constructor(protected readonly dockerService: DockerService) {
        super(dockerService);
    }

    async startPostgresContainer(options: PostgresContainerStartOptions = {}): Promise<Container> {
        const databaseName = options.databaseName ?? "deployer";
        const username = options.username ?? "deployer";
        const password = options.password ?? "deployer";
        const apiUrl = options.apiUrl?.trim() ?? "http://127.0.0.1:3000";
        const shutdownTimeoutSeconds = options.shutdownTimeoutSeconds ?? 120;

        return this.startContainer({
            image: options.image ?? "postgres:16-alpine",
            name: options.name ?? `deployer-bootstrap-postgres-${randomUUID().slice(0, 8)}`,
            env: [`POSTGRES_DB=${databaseName}`, `POSTGRES_USER=${username}`, `POSTGRES_PASSWORD=${password}`],
            labels: {
                "deployer.managed": "true",
                "deployer.managed_reason": "bootstrap_database",
            },
            exposedPorts: { "5432/tcp": {} },
            baseDockerfileContents: this.buildPostgresBootstrapDockerfile(apiUrl, shutdownTimeoutSeconds),
        });
    }

    async getMappedPort(containerId: string, containerPort: number): Promise<number> {
        const container = this.dockerService.getDockerClient().getContainer(containerId);
        const inspected = await container.inspect();
        const binding = inspected.NetworkSettings.Ports[`${String(containerPort)}/tcp`]?.[0]?.HostPort;

        if (!binding) {
            throw new Error(`Container ${containerId} does not expose port ${String(containerPort)}`);
        }

        return Number(binding);
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