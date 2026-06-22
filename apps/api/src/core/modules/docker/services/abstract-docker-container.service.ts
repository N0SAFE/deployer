import { Injectable, Logger } from "@nestjs/common";
import type { Container } from "dockerode";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "node:crypto";
import { DockerService } from "./docker.service";

export interface DockerContainerStartOptions {
    image: string;
    name: string;
    env?: string[];
    labels?: Record<string, string>;
    command?: string[];
    hostConfig?: Record<string, unknown>;
    exposedPorts?: Record<string, object>;
    workingDirectory?: string;
    baseDockerfilePath?: string;
    baseDockerfileContents?: string;
    autoRemove?: boolean;
    healthCheck?: {
        test: string[];
        interval?: number;
        timeout?: number;
        retries?: number;
        startPeriod?: number;
    };
}

@Injectable()
export abstract class AbstractDockerContainerService {
    protected readonly logger = new Logger(AbstractDockerContainerService.name);

    constructor(protected readonly dockerService: DockerService) {}

    async startContainer(options: DockerContainerStartOptions): Promise<Container> {
        const { sourcePath, dockerfileName } = this.ensureBaseDockerfile(options);
        const image = await this.buildBaseImage(options, sourcePath, dockerfileName);
        const docker = this.dockerService.getDockerClient();

        // Build host config, auto-adding port publishing for any exposed ports.
        // Dockerode requires either PortBindings or PublishAllPorts in HostConfig
        // alongside ExposedPorts to actually publish the port to the host.
        // Without it, getMappedPort() fails because the port is never bound.
        //
        // We use explicit PortBindings with HostPort "0" (random port) rather than
        // PublishAllPorts because some Docker versions/configurations treat
        // PublishAllPorts inconsistently. Explicit PortBindings are always honored.
        let hostConfig = options.hostConfig ?? {};
        if (options.exposedPorts && Object.keys(options.exposedPorts).length > 0) {
            const portBindings: Record<string, { HostPort: string }[]> = {};
            for (const port of Object.keys(options.exposedPorts)) {
                portBindings[port] = [{ HostPort: "0" }];
            }
            hostConfig = { ...hostConfig, PortBindings: portBindings };
        }
        if (options.autoRemove) {
            hostConfig = { ...hostConfig, AutoRemove: true };
        }

        this.logger.debug(`Creating container "${options.name}" with hostConfig=${JSON.stringify(hostConfig)}, exposedPorts=${JSON.stringify(options.exposedPorts)}`);

        const createOptions: Record<string, unknown> = {
            Image: image,
            name: options.name,
            Env: options.env,
            Labels: options.labels,
            Cmd: options.command,
            HostConfig: hostConfig,
            ExposedPorts: options.exposedPorts,
        };

        if (options.healthCheck) {
            createOptions.Healthcheck = {
                Test: options.healthCheck.test,
                Interval: options.healthCheck.interval ?? 1_000_000_000,
                Timeout: options.healthCheck.timeout ?? 5_000_000_000,
                Retries: options.healthCheck.retries ?? 30,
                StartPeriod: options.healthCheck.startPeriod ?? 5_000_000_000,
            };
        }

        const container = await docker.createContainer(createOptions);

        await container.start();

        const afterStart = await container.inspect();
        this.logger.debug(`Container "${options.name}" started. Ports: ${JSON.stringify(afterStart.NetworkSettings.Ports)}`);

        return container;
    }

    protected ensureBaseDockerfile(options: DockerContainerStartOptions): { sourcePath: string; dockerfileName: string } {
        if (options.baseDockerfilePath) {
            return {
                sourcePath: path.dirname(options.baseDockerfilePath),
                dockerfileName: path.basename(options.baseDockerfilePath),
            };
        }

        const directory = options.workingDirectory ?? path.join(process.cwd(), ".docker", `bootstrap-${randomUUID()}`);
        fs.mkdirSync(directory, { recursive: true });

        const dockerfileName = "Dockerfile";
        const dockerfilePath = path.join(directory, dockerfileName);
        const contents = options.baseDockerfileContents ?? this.buildDefaultDockerfile(options.image, options.command);

        if (!fs.existsSync(dockerfilePath)) {
            fs.writeFileSync(dockerfilePath, contents, "utf8");
        }

        return { sourcePath: directory, dockerfileName };
    }

    protected buildDefaultDockerfile(image: string, command?: string[]): string {
        const cmd = command?.length ? `CMD [${command.map((entry) => JSON.stringify(entry)).join(", ")}]` : "";

        return [
            `FROM ${image}`,
            "WORKDIR /app",
            "COPY . /app",
            cmd,
        ].filter(Boolean).join("\n");
    }

    protected async buildBaseImage(options: DockerContainerStartOptions, sourcePath: string, dockerfileName: string): Promise<string> {
        const imageTag = `deployer/bootstrap:${randomUUID()}`;

        await this.dockerService.buildImage(sourcePath, imageTag, {
            dockerfileName,
            autoCreateDockerfile: false,
        });

        this.logger.log(`Built base Dockerfile image for ${options.name}: ${imageTag}`);
        return imageTag;
    }

    abstract getMappedPort(containerId: string, containerPort: number): Promise<number>;
    abstract stopContainer(containerId: string, timeoutSeconds?: number): Promise<void>;
    abstract removeContainer(containerId: string, force?: boolean): Promise<void>;
}