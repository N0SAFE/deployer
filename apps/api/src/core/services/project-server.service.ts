import { Injectable, Logger } from '@nestjs/common';
import { DockerService } from './docker.service';
import type { CreateContainerOptions } from './docker.service';

export interface ProjectServerInfo {
  containerId: string;
  containerName: string;
  image: string;
  createdAt: string;
}

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
   * Alias for ensureProjectServerForProject with better naming for external use
   */
  async ensureProjectServer(projectId: string, host: string): Promise<ProjectServerInfo> {
    const result = await this.ensureProjectServerForProject(projectId, host);
    if (!result) {
      throw new Error(`Failed to ensure project server for project ${projectId}`);
    }
    return result;
  }

  /**
   * Ensure a project-level HTTP server exists for the given projectId and domain.
   * Returns minimal metadata about the server (containerId, containerName, image, createdAt)
   */
  async ensureProjectServerForProject(projectId: string, host?: string): Promise<ProjectServerInfo | undefined> {
    const containerName = `project-http-${projectId}`;
    const volumeName = process.env.STATIC_FILES_VOLUME_NAME || `${process.env.COMPOSE_PROJECT_NAME || 'deployer'}_static_files_dev`;
    
    // Use environment-specific domain configuration
    const domain = process.env.DEFAULT_DOMAIN || 'localhost';
    
    // For Traefik labels, use the specific host if provided, otherwise fall back to default domain
    const traefikHost = host || domain;
    
    // Get network name for current compose project
    const networkName = process.env.COMPOSE_PROJECT_NAME 
      ? `${process.env.COMPOSE_PROJECT_NAME}_app_network_dev`
      : 'app_network_dev';
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
      [`traefik.http.routers.project-${projectId}.rule`]: `Host(\`${traefikHost}\`)`,
      [`traefik.http.services.project-${projectId}.loadbalancer.server.port`]: '80',
    };

    const options: CreateContainerOptions = {
      image: image,
      name: containerName,
      Labels: labels,
      // Create a startup script that initializes the webroot and configures dual-stack IPv4/IPv6
      Entrypoint: ['sh'],
      Cmd: [
        '-c',
        `
          # Create initial placeholder content
          mkdir -p /var/www/html
          echo '<h1>Service Starting...</h1><p>Deployment in progress...</p>' > /var/www/html/index.html
          
          # Configure lighttpd for dual-stack listening (both IPv4 and IPv6)
          cat > /etc/lighttpd/conf.d/00-network.conf << 'EOF'
# Enable IPv6 support
server.use-ipv6 = "enable"
# Bind to 0.0.0.0 which with use-ipv6 enabled will listen on both IPv4 and IPv6
server.bind = "0.0.0.0"
EOF
          
          # Start lighttpd in foreground
          exec /usr/sbin/lighttpd -D -f /etc/lighttpd/lighttpd.conf
        `.trim()
      ],
      Healthcheck: {
        Test: ['CMD-SHELL', 'wget --quiet --tries=1 --spider http://127.0.0.1:80/ || exit 1'],
        Interval: 30000000000, // 30 seconds in nanoseconds
        Timeout: 10000000000,  // 10 seconds
        Retries: 3,
        StartPeriod: 40000000000, // 40 seconds - give time for lighttpd to start
      },
      HostConfig: {
        // Mount the unified static volume with project-specific paths
        // The static files are organized as /srv/static/project-{id}/service/deployment
        // and conf.d files are stored in the same volume for configuration
        Binds: [`${volumeName}:/srv/static:rw`, `${volumeName}:/etc/lighttpd/conf.d:rw`],
        NetworkMode: networkName,
        RestartPolicy: { 
          Name: 'on-failure',
          MaximumRetryCount: 3,
        },
      },
    };

    // Create container with retries
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        this.logger.log(`Creating project server ${containerName} (attempt ${attempt}/3)`);
        const container = await this.dockerService.createContainer(options);
        await container.start();
        
        // Wait for container to initialize
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Verify container is healthy
        const healthCheck = await this.verifyContainerHealth(containerName, 30000); // 30 second timeout
        if (!healthCheck.healthy) {
          this.logger.warn(`Container created but health check failed: ${healthCheck.reason}`);
          await this.dockerService.removeContainer(containerName);
          if (attempt === 3) {
            throw new Error(`Failed to create healthy container after 3 attempts: ${healthCheck.reason}`);
          }
          continue;
        }
        
        const ci = await container.inspect();
        this.logger.log(`✅ Successfully created and verified project server ${containerName} (${ci.Id})`);
        return {
          containerId: ci.Id,
          containerName,
          image: image,
          createdAt: ci.Created,
        };
      } catch (error) {
        this.logger.error(`Attempt ${attempt} failed to create project server ${containerName}:`, error);
        try {
          await this.dockerService.removeContainer(containerName);
        } catch (cleanupError) {
          this.logger.warn(`Failed to cleanup failed container: ${(cleanupError as any)?.message}`);
        }
        
        if (attempt === 3) {
          throw error;
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
        // This should never be reached, but added for type safety
    throw new Error(`Failed to create project server ${containerName} after all attempts`);
  }

  /**
   * Verify that a container is healthy and responding
   */
  private async verifyContainerHealth(containerName: string, timeoutMs: number = 30000): Promise<{healthy: boolean, reason: string}> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        // Check if container is running
        const info = await this.dockerService.getContainerInfo(containerName);
        if (info.State?.Status !== 'running') {
          return { healthy: false, reason: `Container is ${info.State?.Status || 'unknown state'}` };
        }
        
        // Try to execute a health check command
        try {
          await this.dockerService.execInContainer(containerName, ['wget', '--quiet', '--tries=1', '--spider', 'http://127.0.0.1:80/']);
          return { healthy: true, reason: 'Health check passed' };
        } catch {
          // If health check fails, wait and retry
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
      } catch (error) {
        return { healthy: false, reason: `Container check failed: ${(error as any)?.message}` };
      }
    }
    
    return { healthy: false, reason: 'Health check timeout' };
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

  /**
   * Ensure a lighttpd vhost exists inside the project server container that maps the
   * given host to the service's `current` directory under /srv/static.
   * 
   * Note: The rtsp/lighttpd image sets server.document-root in 05-webroot.conf which
   * cannot be overridden in conditional blocks. Instead, we symlink files from our
   * volume path into the default webroot /var/www/html.
   * 
   * For multi-service support: If multiple services exist, each service gets a subdirectory
   * in /var/www/html (e.g., /var/www/html/service1/) and we use URL rewriting.
   */
  async ensureVhostForService(projectId: string, host: string, serviceName: string) {
    const containerName = `project-http-${projectId}`;
    
    // First ensure the container exists and is healthy
    await this.ensureProjectServerForProject(projectId, host);
    
    // Retry vhost setup with exponential backoff
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Wait for container to be fully ready
        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
        
        // Verify container is healthy before attempting vhost setup
        const healthCheck = await this.verifyContainerHealth(containerName, 10000);
        if (!healthCheck.healthy) {
          if (attempt === maxRetries) {
            throw new Error(`Container is not healthy after ${maxRetries} attempts: ${healthCheck.reason}`);
          }
          this.logger.warn(`Container not healthy on attempt ${attempt}, retrying...`);
          continue;
        }
        
        await this.setupVhostConfiguration(projectId, host, serviceName, containerName);
        
        // Verify the setup worked
        const verificationSuccess = await this.verifyVhostSetup(containerName, serviceName);
        if (verificationSuccess) {
          this.logger.log(`✅ Successfully configured vhost for ${host} -> ${serviceName}`);
          return;
        } else if (attempt === maxRetries) {
          throw new Error('Vhost setup verification failed after all attempts');
        }
        
      } catch (error) {
        this.logger.warn(`Vhost setup attempt ${attempt}/${maxRetries} failed: ${(error as any)?.message}`);
        if (attempt === maxRetries) {
          throw new Error(`Failed to configure web server for ${serviceName} after ${maxRetries} attempts: ${(error as any)?.message}`);
        }
      }
    }
  }

  private async setupVhostConfiguration(projectId: string, host: string, serviceName: string, containerName: string) {
      // Update Traefik labels for this specific host
      try {
        const currentConfig = await this.dockerService.getContainerInfo(containerName);
        
        // Log the current and desired Traefik router rule
        const currentRule = currentConfig.Config?.Labels?.[`traefik.http.routers.project-${projectId}.rule`];
        const desiredRule = `Host(\`${host}\`)`;
        
        this.logger.log(`Traefik routing for ${containerName}:`);
        this.logger.log(`  Current rule: ${currentRule}`);
        this.logger.log(`  Desired rule: ${desiredRule}`);
        
        if (currentRule !== desiredRule) {
          this.logger.warn(`Traefik rule mismatch! Container has wrong host configuration.`);
          this.logger.warn(`This deployment may not be accessible via ${host}`);
          this.logger.warn(`Container needs to be recreated with correct Traefik labels.`);
        }
        
      } catch (labelErr) {
        this.logger.warn(`Could not check Traefik labels: ${(labelErr as any)?.message}`);
      }
      
      // Check if other services already exist in /srv/static
      const checkServicesCmd = ['sh', '-c', 'ls -1 /srv/static 2>/dev/null | wc -l'];
      const { output: serviceCountStr } = await this.dockerService.execInContainer(containerName, checkServicesCmd);
      const serviceCount = parseInt(serviceCountStr?.trim() || '0');
      
      // Check if /var/www/html has content from another service
      const checkWebrootCmd = ['sh', '-c', 'ls -A /var/www/html 2>/dev/null | wc -l'];
      const { output: webrootCountStr } = await this.dockerService.execInContainer(containerName, checkWebrootCmd);
      const webrootHasContent = parseInt(webrootCountStr?.trim() || '0') > 0;
      
      if (serviceCount > 1 && webrootHasContent) {
        this.logger.warn(`Multiple services detected in project ${projectId}. Current limitation: Only one static service per project server is supported when using direct webroot symlinks.`);
        this.logger.warn(`Existing content in /var/www/html will be replaced with ${serviceName}. This will break other services!`);
        // TODO: Implement proper multi-service support using path-based routing or mod_evhost
        // For now, we'll proceed but log a warning
      }
      
      this.logger.log(`Setting up symlinks for host ${host} to service ${serviceName}`);
      
      // Strategy: Symlink from /var/www/html (default webroot) to our service's current directory
      // This works because 05-webroot.conf sets server.document-root = "/var/www/html" and
      // server.follow-symlink = "enable"
      
      // Create symlinks from default webroot to our service's current directory in unified volume structure
      const symlinkCmd = [
        'sh',
        '-c',
        `rm -rf /var/www/html && ln -sf /srv/static/project-${projectId}/${serviceName}/current /var/www/html`
      ];
      
      await this.dockerService.execInContainer(containerName, symlinkCmd);
      this.logger.log(`Created symlink from /var/www/html to /srv/static/project-${projectId}/${serviceName}/current in ${containerName}`);
      
      // Reload lighttpd to ensure changes take effect
      await this.reloadProjectServer(projectId);
      this.logger.log(`Reloaded project server ${containerName} after setting up symlinks for ${host}`);
  }

  private async verifyVhostSetup(containerName: string, _serviceName: string): Promise<boolean> {
    try {
      // Verify the symlinks were created successfully
      const verifyCmd = ['sh', '-c', 'ls -la /var/www/html/ 2>/dev/null | head -n 10'];
      const result = await this.dockerService.execInContainer(containerName, verifyCmd);
      this.logger.log(`Symlink verification: ${result.output?.substring(0, 200)}...`);
      
      // Also verify we can read the files as lighttpd user
      const permCheckCmd = ['sh', '-c', 'su lighttpd -s /bin/sh -c "ls /var/www/html/ 2>&1" 2>/dev/null || ls -la /var/www/html/ 2>/dev/null'];
      const permResult = await this.dockerService.execInContainer(containerName, permCheckCmd);
      if (permResult.output?.includes('Permission denied')) {
        this.logger.warn(`Permission check failed: lighttpd user cannot read files in /var/www/html`);
        return false;
      } else {
        this.logger.log(`Permission check passed: lighttpd user can access files`);
      }
      
      // Final HTTP test
      const httpTest = await this.dockerService.execInContainer(containerName, ['sh', '-c', 'wget --quiet --tries=1 --spider http://localhost:80/ && echo "ok" || echo "fail"']);
      return httpTest.output?.trim() === 'ok';
      
    } catch (verifyErr) {
      this.logger.warn(`Failed to verify vhost setup: ${(verifyErr as any)?.message || String(verifyErr)}`);
      return false;
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

  /**
   * Comprehensive health check and recovery for project servers
   * This method can be called after deployments to ensure everything is working
   */
  async ensureProjectServerHealth(projectId: string, serviceName: string, host: string = 'localhost'): Promise<boolean> {
    const containerName = `project-http-${projectId}`;
    
    try {
      this.logger.log(`🔍 Performing comprehensive health check for project ${projectId}...`);
      
      // Step 1: Ensure project server exists and is healthy
      await this.ensureProjectServerForProject(projectId, host);
      
      // Step 2: Verify it's actually healthy after creation/startup
      const healthCheck = await this.verifyContainerHealth(containerName, 15000);
      if (!healthCheck.healthy) {
        this.logger.error(`❌ Project server failed health check: ${healthCheck.reason}`);
        return false;
      }
      
      this.logger.log(`✅ Project server is healthy: ${healthCheck.reason}`);
      
      // Step 3: Ensure vhost is properly configured
      await this.ensureVhostForService(projectId, host, serviceName);
      
      // Step 4: Final verification - can we actually reach the service?
      const finalHealthCheck = await this.verifyContainerHealth(containerName, 10000);
      if (!finalHealthCheck.healthy) {
        this.logger.error(`❌ Final health check failed: ${finalHealthCheck.reason}`);
        return false;
      }
      
      this.logger.log(`🎉 Project ${projectId} service ${serviceName} is fully operational!`);
      return true;
      
    } catch (error) {
      this.logger.error(`💥 Failed to ensure project server health for ${projectId}:`, error);
      return false;
    }
  }
}