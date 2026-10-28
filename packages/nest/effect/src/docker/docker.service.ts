import { Injectable, Logger } from "@nestjs/common";
import Docker from "dockerode";
import { makeDockerEngine, resolveDockerClient, type DockerEngineShape, type ScannerEngineAccess } from "@deployer/docker";
import { Stream } from "effect";
import * as fs from "fs";
import { Observable } from "rxjs";
// `DockerConnectionConfig` is a TYPE-ONLY export. Importing it as a value makes
// `bun build` fail with "No matching export in src/docker-config.ts", which is
// reported as `AggregateError: Bundle failed` with exit code 0 and NO dist/types
// written, silently breaking every downstream package that needs this one's types.
import type { DockerConnectionConfig } from "@deployer/docker";

@Injectable()
export class DockerService {
    private readonly logger = new Logger(DockerService.name);
    private readonly docker: Docker;

    /**
     * The Docker engine as Effect services. Callers run its Effects themselves (`runPromiseUnwrapped`
     * while they are Promise code, directly once they are Effect); the typed failures reach them as is.
     */
    getEngine(): DockerEngineShape {
        return makeDockerEngine(this.docker);
    }
    private static readonly DEFAULT_DOCKER_SOCKET_PATH = "/var/run/docker.sock";

    /** The resolved Docker socket path in use (null when using TCP). */
    private resolvedSocketPath: string | null = null;

    /**
     * Return the resolved Docker socket path, or `null` if the client is
     * connected via TCP rather than a Unix socket.
     */
    getDockerSocketPath(): string | null {
        return this.resolvedSocketPath;
    }

    /**
     * Return a Docker socket bind-mount string suitable for container
     * `HostConfig.Binds`, or `null` if the client is connected via TCP.
     *
     * @example "/var/run/docker.sock:/var/run/docker.sock"
     */
    getDockerSocketBindMount(): string | null {
        const socketPath = this.resolvedSocketPath;
        if (!socketPath) {
            return null;
        }
        return `${socketPath}:${socketPath}`;
    }

    private static getErrMsg(err: unknown): string {
        if (err instanceof Error) return err.message;
        if (typeof err === "object" && err !== null && "message" in err) {
            const msg = err.message;
            if (typeof msg === "string") return msg;
        }
        return String(err);
    }

    constructor(config: DockerConnectionConfig) {
        const { client, mode, socketPath, warnings } = resolveDockerClient(config);
        for (const warning of warnings) {
            this.logger.warn(warning);
        }
        this.docker = client;
        this.resolvedSocketPath = socketPath;

        if (fs.existsSync(DockerService.DEFAULT_DOCKER_SOCKET_PATH)) {
            try {
                const socketStats = fs.statSync(DockerService.DEFAULT_DOCKER_SOCKET_PATH);
                this.logger.log(
                    `Docker socket found - mode: ${socketStats.mode.toString(8)}, uid: ${String(socketStats.uid)}, gid: ${String(socketStats.gid)}`,
                );
            } catch (error) {
                this.logger.warn(
                    `Docker socket at ${DockerService.DEFAULT_DOCKER_SOCKET_PATH} is present but stats failed: ${DockerService.getErrMsg(error)}`,
                );
            }
        }

        this.logger.log(`Configured Docker client via ${mode}`);
    }

    /**
     * How a container started by the scanner pool reaches this engine: the bind-mounted socket, or
     * the TCP endpoint when the client talks to a remote daemon.
     */
    getScannerEngineAccess(): ScannerEngineAccess {
        const { host, port } = this.docker as unknown as { host?: string; port?: number };
        return {
            socketBind: this.getDockerSocketBindMount(),
            ...(host && port ? { tcp: { host, port } } : {}),
        };
    }

    async *streamContainerLogs(
        containerIdOrName: string,
        options: Docker.ContainerLogsOptions & { stderrPrefix?: string } = {},
    ): AsyncIterable<string> {
        for await (const line of Stream.toAsyncIterable(this.getEngine().logs.stream(containerIdOrName, options))) {
            yield line;
        }
    }

    /**
     * RxJS-friendly wrapper around {@link streamContainerLogs}.
     *
     * Yields each decoded log line on a Subject. Completes when the
     * underlying Docker stream ends, and errors out if the stream errors.
     * Consumers can subscribe and pipe lines into SSE/log emitters without
     * having to deal with the async-iterator protocol.
     *
     * @example
     * ```ts
     * const sub = docker.streamContainerLogs$(containerId, { tail: 0 }).subscribe({
     *     next: (line) => emit(setupEvent),
     *     error: (err) => logger.error(err),
     * });
     * // ... later, on teardown:
     * sub.unsubscribe();
     * ```
     */
    streamContainerLogs$(
        containerIdOrName: string,
        options: Docker.ContainerLogsOptions & { stderrPrefix?: string } = {},
    ): Observable<string> {
        return new Observable<string>((subscriber) => {
            // Kick off consumption; we keep a flag to avoid duplicate teardown
            let cancelled = false;
            void (async () => {
                try {
                    for await (const line of this.streamContainerLogs(containerIdOrName, options)) {
                        if (cancelled) break;
                        subscriber.next(line);
                    }
                    if (!cancelled) subscriber.complete();
                } catch (err: unknown) {
                    if (!cancelled) {
                        subscriber.error(err instanceof Error ? err : new Error(String(err)));
                    }
                }
            })();
            return () => {
                cancelled = true;
            };
        });
    }

    // ==========================================================================
    // SWARM MODE — dockerode SDK (no CLI). All engine responses are Zod-parsed
    // at this boundary (parse, don't validate); business logic never touches
    // dockerode's loose raw shapes.
    // ==========================================================================


}

// Stronger create container options combining dockerode types with our custom fields
export type CreateContainerOptions = {
    // backward compatibility: allow lowercase 'image' property
    image?: string;
    imagePullPolicy?: "IfNotPresent" | "Always" | "Never";
    registryAuth?: Docker.AuthConfig;
} & Docker.ContainerCreateOptions
