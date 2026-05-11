import { Injectable } from "@nestjs/common";
import { DockerService } from "./docker.service";
import { AbstractDockerContainerService } from "./abstract-docker-container.service";

@Injectable()
export class DockerContainerService extends AbstractDockerContainerService {
    constructor(protected readonly dockerService: DockerService) {
        super(dockerService);
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
}