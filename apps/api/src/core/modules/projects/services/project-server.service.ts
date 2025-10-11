import { Injectable, Logger } from '@nestjs/common';
import { DockerService } from '@/core/modules/docker/services/docker.service';
import { TraefikTemplateService } from '@/core/modules/traefik/services/traefik-template.service';
import type { CreateContainerOptions } from '@/core/modules/docker/services/docker.service';

export interface ProjectServerInfo {
  containerId: string;
  containerName: string;
  image: string;
  createdAt: string;
}

@Injectable()
export class ProjectServerService {
  private readonly logger = new Logger(ProjectServerService.name);
  constructor(
    private readonly dockerService: DockerService,
    private readonly traefikTemplateService: TraefikTemplateService,
  ) {}

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
    // If container exists, check if labels match current requirements
    try {
      const info = await this.dockerService.getContainerInfo(containerName);
      this.logger.log(`Project server ${containerName} already exists`);
      

      // Check if Traefik labels match the current host requirement
      const expectedRule = `Host(\`${traefikHost}\`)`;
      const currentRule = info.Config?.Labels?.[`traefik.http.routers.project-${projectId}.rule`];
      
      if (currentRule !== expectedRule) {
        this.logger.warn(`Traefik rule mismatch for ${containerName}:`);
        this.logger.warn(`  Current: ${currentRule}`);
        this.logger.warn(`  Expected: ${expectedRule}`);
        this.logger.log(`Recreating container with correct Traefik labels...`);
        
        // Stop and remove the container
        try {
          await this.dockerService.stopContainer(containerName);
          await this.dockerService.removeContainer(containerName);
          this.logger.log(`Removed outdated container ${containerName}`);
        } catch (removeErr) {
          this.logger.error(`Failed to remove outdated container: ${(removeErr as Error)?.message}`);
          throw removeErr;
        }
        
        // Fall through to create new container with correct labels
      } else {
        // Labels match, just ensure it's running
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
        
        // Check and warn about mismatched image (but don't recreate)
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
      }
    } catch (error) {
      // Container doesn't exist or error occurred
      if ((error as any)?.statusCode === 404) {
        this.logger.debug(`Project server ${containerName} does not exist, creating...`);
      } else {
        this.logger.error(`Error checking container ${containerName}:`, error);
        throw error;
      }
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
      // Traefik routing is now handled via file provider (dynamic YAML configs)
      // Not using Docker provider labels to avoid conflicts
    };

    const options: CreateContainerOptions = {
      image: image,
      name: containerName,
      Labels: labels,
      // Use default lighttpd entrypoint and cmd - don't override
      // Default: ENTRYPOINT ["/usr/sbin/lighttpd"] CMD ["-D", "-f", "/etc/lighttpd/lighttpd.conf"]
      Healthcheck: {
        Test: ['CMD-SHELL', 'wget --quiet --tries=1 --spider http://127.0.0.1:80/ || exit 1'],
        Interval: 30000000000, // 30 seconds in nanoseconds
        Timeout: 10000000000,  // 10 seconds
        Retries: 3,
        StartPeriod: 40000000000, // 40 seconds - give time for lighttpd to start
      },
      HostConfig: {
        // Mount the unified static volume for project-specific paths
        // The static files are organized as /srv/static/project-{id}/service/deployment
        // We don't mount conf.d to avoid overwriting default lighttpd configs
        Binds: [`${volumeName}:/srv/static:rw`],
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
        this.logger.log('Waiting for lighttpd to start...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Initialize webroot with placeholder content
        try {
          await this.dockerService.execInContainer(containerName, [
            'sh', '-c',
            'mkdir -p /var/www/html && echo "<h1>Service Starting...</h1><p>Deployment in progress...</p>" > /var/www/html/index.html'
          ]);
          this.logger.log('Initialized webroot placeholder content');
        } catch (initErr) {
          this.logger.warn(`Failed to initialize webroot: ${(initErr as any)?.message}`);
          // Continue anyway - not critical
        }
        
        // Verify container is healthy
        const healthCheck = await this.verifyContainerHealth(containerName, 30000); // 30 second timeout
        if (!healthCheck.healthy) {
          this.logger.warn(`Container created but health check failed: ${healthCheck.reason}`);
          
          // Try to get container logs for debugging
          try {
            const containerInfo = await this.dockerService.getContainerInfo(containerName);
            this.logger.error(`Container state: ${JSON.stringify(containerInfo.State)}`);
          } catch (logErr) {
            this.logger.warn(`Could not get container info: ${(logErr as any)?.message}`);
          }
          
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
   * Add Traefik router configuration for a specific service.
   * This allows multiple services to be routed through the same container with different Host rules.
   * Writes to shared Traefik configuration volume that Traefik watches for dynamic config changes.
   */
  async addServiceRouter(
    projectId: string,
    serviceName: string,
    host: string,
    port: number = 80,
    template?: string
  ) {
    const containerName = `project-http-${projectId}`;
    
    this.logger.log(`Adding Traefik router for service ${serviceName} on ${host}`);
    
    // Build router and middleware names
    const routerName = `project-${projectId}-${serviceName}`;
    const middlewareName = `${routerName}-path`;
    const pathPrefix = `/${serviceName}`;
    
    // Use provided template or default static template
    const templateContent = template || this.getDefaultStaticTemplate();
    
    // Parse template with variables
    const traefikConfig = this.traefikTemplateService.parseTemplate(templateContent, {
      domain: host.split('.').slice(1).join('.') || 'localhost',
      subdomain: host.split('.')[0],
      host,
      projectId,
      serviceId: serviceName,
      serviceName,
      containerName,
      containerPort: String(port),
      routerName,
      middlewareName,
      pathPrefix,
    });
    
    // Build Traefik dynamic configuration comment
    const configWithComment = `# Dynamic Traefik configuration for ${serviceName}
# Auto-generated by ProjectServerService
${traefikConfig}`;
    
    // Write config to Traefik's dynamic configuration directory
    // The API container has /app/traefik-configs mounted to the same volume as Traefik's /etc/traefik
    const fs = await import('fs/promises');
    const configPath = `/app/traefik-configs/dynamic/project-${projectId}-${serviceName}.yml`;
    
    try {
      await fs.writeFile(configPath, configWithComment, 'utf8');
      this.logger.log(`✅ Wrote Traefik config to ${configPath}`);
    } catch (error) {
      this.logger.error(`Failed to write Traefik config: ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Get default static provider template
   */
  private getDefaultStaticTemplate(): string {
    return `http:
  routers:
    ~##routerName##~:
      rule: "Host(\`~##host##~\`)"
      service: "~##serviceName##~-svc"
      middlewares:
        - "~##middlewareName##~"
      entryPoints:
        - web
  
  middlewares:
    ~##middlewareName##~:
      addPrefix:
        prefix: "~##pathPrefix##~"
  
  services:
    ~##serviceName##~-svc:
      loadBalancer:
        servers:
          - url: "http://~##containerName##~:~##containerPort##~"
`;
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
    
    // Add Traefik router for this service (uses dynamic config, no container restart needed)
    await this.addServiceRouter(projectId, serviceName, host);
    
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
      this.logger.log(`Setting up directory for ${host} -> ${serviceName}`);
      
      // Strategy: Each service gets its own directory under /var/www/html/{serviceName}/
      // Traefik will handle routing based on Host header and rewrite paths to include service directory
      // Lighttpd just serves files from /var/www/html/ (its default document root)
      
      // Create or update symlink for this service in /var/www/html/{serviceName}
      const setupCmd = [
        'sh',
        '-c',
        `
          mkdir -p /var/www/html && \
          ln -sfn /srv/static/project-${projectId}/${serviceName}/current /var/www/html/${serviceName}
        `.trim()
      ];
      
      await this.dockerService.execInContainer(containerName, setupCmd);
      this.logger.log(`Created symlink /var/www/html/${serviceName} -> /srv/static/project-${projectId}/${serviceName}/current`);
      
      // No need to write lighttpd config - the default config serves from /var/www/html/
      // and follows symlinks by default
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
      
      // Final HTTP test - use 127.0.0.1 instead of localhost to avoid IPv6 resolution issues with BusyBox wget
      const httpTest = await this.dockerService.execInContainer(containerName, ['sh', '-c', 'wget --quiet --tries=1 --spider http://127.0.0.1:80/ && echo "ok" || echo "fail"']);
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