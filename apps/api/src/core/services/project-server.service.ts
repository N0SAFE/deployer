import { Injectable, Logger } from '@nestjs/common';
import { DockerService } from './docker.service';
import type { CreateContainerOptions } from './docker.service';

@Injectable()
export class ProjectServerService {
  private readonly logger = new Logger(ProjectServerService.name);
  constructor(private readonly dockerService: DockerService) {}

  private sanitizeHost(maybeUrl: string): string {
    try {
      // If input is a URL, extract hostname; otherwise return input trimmed
      const parsed = new URL(maybeUrl);
      return parsed.hostname || maybeUrl;
    } catch {
      // Not a valid URL, remove scheme if present and trim path
      return maybeUrl.replace(/^https?:\/\//, '').split('/')[0];
    }
  }

  /**
   * Ensure a project-level HTTP server exists for the given projectId and domain.
   * Returns minimal metadata about the server (containerId, containerName, image, createdAt)
   */
  async ensureProjectServer(projectId: string, domain: string) {
    const sanitizedDomain = this.sanitizeHost(domain || 'localhost');
    const containerName = `project-http-${projectId}`;
    const volumeName = `project-${projectId}-static`;
    const networkName = process.env.COMPOSE_PROJECT_NAME
      ? `${process.env.COMPOSE_PROJECT_NAME}_app_network_dev`
      : 'deployer_app_network_dev';
    // If container exists, return info
    try {
      const info = await this.dockerService.getContainerInfo(containerName);
      this.logger.log(`Project server ${containerName} already exists`);
      // If container exists but is not running, attempt to start it
      const state = info.State?.Status || '';
      if (state !== 'running') {
        this.logger.log(`Project server ${containerName} exists but is '${state}' - attempting to start`);
        const container = this.dockerService.getDockerClient().getContainer(info.Id);
        try {
          await container.start();
          this.logger.log(`Started existing project server ${containerName}`);
        } catch (startErr) {
          this.logger.warn(`Failed to start existing project server ${containerName}:`, (startErr as Error)?.message || String(startErr));
        }
      }
      // Check and warn about mismatched image/labels (do not recreate automatically)
      const currentImage = info.Config?.Image;
      if (currentImage && currentImage !== (process.env.PROJECT_SERVER_IMAGE || 'rtsp/lighttpd')) {
        this.logger.warn(`Existing project server ${containerName} uses image ${currentImage} which differs from current configured image ${(process.env.PROJECT_SERVER_IMAGE || 'rtsp/lighttpd')}`);
      }
      return {
        containerId: info.Id,
        containerName,
        image: info.Config?.Image,
        createdAt: info.Created,
      };
    } catch {
      this.logger.debug(`Project server ${containerName} does not exist, creating...`);
    }

    // Create volume if missing
    try {
      const docker = this.dockerService.getDockerClient();
      const volumes = await docker.listVolumes();
      const exists = (volumes.Volumes || []).some((v: any) => v.Name === volumeName);
      if (!exists) {
        await docker.createVolume({ Name: volumeName });
        this.logger.log(`Created volume ${volumeName}`);
      } else {
        this.logger.debug(`Volume ${volumeName} already exists`);
      }
    } catch (error) {
      this.logger.warn(`Failed to ensure volume ${volumeName}: ${(error as any)?.message || String(error)}`);
    }

    // Create and start project HTTP server container
    // Allow override via env var PROJECT_SERVER_IMAGE; default to the public rtsp/lighttpd image
    const image = process.env.PROJECT_SERVER_IMAGE || 'rtsp/lighttpd';
    this.logger.log(`Using project server image: ${image}`);

    const labels: Record<string, string> = {
      'deployer.project_server': projectId,
      'traefik.enable': 'true',
      'traefik.docker.network': networkName,
      // Router rule must use sanitized host only (no scheme/path)
      [`traefik.http.routers.project-${projectId}.rule`]: `Host(\`${sanitizedDomain}\`)`,
      [`traefik.http.services.project-${projectId}.loadbalancer.server.port`]: '80',
    };

    const options: CreateContainerOptions = {
      Image: image,
      name: containerName,
      Labels: labels,
      HostConfig: {
        Binds: [`${volumeName}:/srv/static:rw`],
        NetworkMode: networkName,
        RestartPolicy: { Name: 'unless-stopped' },
      },
    };

    try {
      const container = await this.dockerService.createContainer(options);
      await container.start();
      const ci = await container.inspect();
      this.logger.log(`Started project server ${containerName} (${ci.Id})`);
      return {
        containerId: ci.Id,
        containerName,
        image: image,
        createdAt: ci.Created,
      };
    } catch (error) {
      this.logger.error(`Failed to create project server ${containerName}:`, error);
      throw error;
    }
  }

  async reloadProjectServer(projectId: string) {
    const containerName = `project-http-${projectId}`;
    try {
      // Try a graceful reload (kill -HUP 1) which works if process 1 is lighttpd
      await this.dockerService.execInContainer(containerName, ['sh', '-c', 'kill -HUP 1 || true']);
      this.logger.log(`Sent HUP to project server ${containerName}`);
    } catch (error) {
      this.logger.warn(`Failed to reload project server ${containerName}: ${(error as any)?.message || String(error)}`);
      throw error;
    }
  }

  async getProjectServerStatus(projectId: string) {
    const containerName = `project-http-${projectId}`;
    try {
      const info = await this.dockerService.getContainerInfo(containerName);
      const health = await this.dockerService.getDetailedContainerHealth(info.Id);
      return {
        containerId: info.Id,
        containerName,
        image: info.Config?.Image,
        createdAt: info.Created,
        health,
      };
    } catch (error) {
      this.logger.warn(`Could not get status for project server ${containerName}: ${(error as any)?.message || String(error)}`);
      return null;
    }
  }
}
