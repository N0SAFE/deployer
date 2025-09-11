import { Injectable, Logger } from '@nestjs/common';
import { DockerService } from '../services/docker.service';
import { TraefikService } from '../modules/orchestration/services/traefik.service';
export interface StaticFileDeploymentOptions {
    serviceName: string;
    deploymentId: string;
    domain: string;
    subdomain?: string;
    filesPath: string; // Path within the static_files volume
    customNginxConfig?: string;
    sslEnabled?: boolean;
}
export interface NginxContainerInfo {
    containerId: string;
    containerName: string;
    domain: string;
    isRunning: boolean;
    createdAt: Date;
}
@Injectable()
export class StaticFileService {
    private readonly logger = new Logger(StaticFileService.name);
    constructor(private readonly dockerService: DockerService, private readonly traefikService: TraefikService) { }
    /**
     * Deploy static files by creating an nginx container and configuring Traefik routing
     */
    async deployStaticFiles(options: StaticFileDeploymentOptions): Promise<NginxContainerInfo> {
        const { serviceName, deploymentId, domain, subdomain, filesPath, customNginxConfig, sslEnabled = false } = options;
        this.logger.log(`Deploying static files for service ${serviceName} at ${domain}`);
        // Generate container name
        const containerName = `${serviceName}-nginx-${deploymentId.substring(0, 8)}`;
        // Generate nginx configuration
        const nginxConfig = customNginxConfig || this.generateDefaultNginxConfig(filesPath);
        try {
            // Create nginx container
            const containerId = await this.createNginxContainer(containerName, filesPath, nginxConfig, deploymentId);
            // Configure Traefik routing
            await this.configureTraefikRouting(serviceName, containerName, domain, subdomain, sslEnabled);
            this.logger.log(`Static file deployment successful: ${containerName} serving ${domain}`);
            return {
                containerId,
                containerName,
                domain: subdomain ? `${subdomain}.${domain}` : domain,
                isRunning: true,
                createdAt: new Date(),
            };
        }
        catch (error) {
            this.logger.error(`Failed to deploy static files for ${serviceName}:`, error);
            throw new Error(`Static file deployment failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    /**
     * Update static files in an existing nginx container
     */
    async updateStaticFiles(containerName: string, filesPath: string, customNginxConfig?: string): Promise<void> {
        this.logger.log(`Updating static files in container ${containerName}`);
        try {
            // Check if container exists and is running
            const containerInfo = await this.dockerService.getContainerInfo(containerName);
            if (containerInfo.State.Status !== 'running') {
                throw new Error(`Container ${containerName} is not running`);
            }
            // Update nginx config if provided
            if (customNginxConfig) {
                await this.updateNginxConfig(containerName, customNginxConfig);
            }
            // Reload nginx to pick up any file changes
            await this.reloadNginx(containerName);
            this.logger.log(`Successfully updated static files in ${containerName}`);
        }
        catch (error) {
            this.logger.error(`Failed to update static files in ${containerName}:`, error);
            throw error;
        }
    }
    /**
     * Remove static file deployment (stop container and remove Traefik config)
     */
    async removeStaticFileDeployment(serviceName: string, containerName: string): Promise<void> {
        this.logger.log(`Removing static file deployment for ${serviceName}`);
        try {
            // Stop and remove container
            await this.dockerService.stopContainer(containerName);
            await this.dockerService.removeContainer(containerName);
            // Remove Traefik configuration by deleting config file
            await this.removeTraefikConfig(serviceName);
            this.logger.log(`Successfully removed static file deployment: ${containerName}`);
        }
        catch (error) {
            this.logger.error(`Failed to remove static file deployment ${containerName}:`, error);
            throw error;
        }
    }
    /**
     * List all nginx containers managed by this service
     */
    async listStaticFileDeployments(): Promise<NginxContainerInfo[]> {
        try {
            const containers = await this.dockerService.listContainers({
                all: true,
                filters: {
                    label: ['deployer.nginx.static=true']
                }
            });
            return containers.map(container => ({
                containerId: container.Id,
                containerName: container.Names[0]?.replace('/', '') || 'unknown',
                domain: container.Labels['deployer.nginx.domain'] || 'unknown',
                isRunning: container.State === 'running',
                createdAt: new Date(container.Created * 1000),
            }));
        }
        catch (error) {
            this.logger.error('Failed to list static file deployments:', error);
            return [];
        }
    }
    /**
     * Create nginx container with proper configuration
     */
    private async createNginxContainer(containerName: string, filesPath: string, nginxConfig: string, deploymentId: string): Promise<string> {
        // Get the current Docker network from environment
        const networkName = process.env.COMPOSE_PROJECT_NAME
            ? `${process.env.COMPOSE_PROJECT_NAME}_app_network_dev`
            : 'deployer_app_network_dev';
        const container = await this.dockerService.createContainer({
            Image: 'nginx:alpine',
            name: containerName,
            Labels: {
                'deployer.deployment_id': deploymentId,
                'deployer.managed': 'true',
                'deployer.nginx.static': 'true',
                'deployer.nginx.files_path': filesPath,
            },
            ExposedPorts: {
                '80/tcp': {},
            },
            HostConfig: {
                RestartPolicy: {
                    Name: 'unless-stopped'
                },
                Binds: [
                    // Mount the static files volume
                    `${process.env.COMPOSE_PROJECT_NAME || 'deployer'}_static_files_dev:/usr/share/nginx/html:ro`,
                ],
                NetworkMode: networkName,
            },
            Healthcheck: {
                Test: ['CMD-SHELL', 'wget --no-verbose --tries=1 --spider http://127.0.0.1 || exit 1'],
                Interval: 30000000000, // 30s in nanoseconds
                Timeout: 5000000000, // 5s in nanoseconds
                Retries: 3,
                StartPeriod: 10000000000, // 10s in nanoseconds
            }
        });
        // Start the container
        await container.start();
        // Apply nginx configuration
        await this.updateNginxConfig(containerName, nginxConfig);
        return container.id;
    }
    /**
     * Generate default nginx configuration for serving static files
     */
    private generateDefaultNginxConfig(filesPath: string): string {
        return `
server {
    listen 80;
    server_name _;
    
    root /usr/share/nginx/html/${filesPath};
    index index.html index.htm;
    
    # Enable gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    
    # Main location block
    location / {
        try_files \\$uri \\$uri/ =404;
        
        # Cache static assets
        location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
        
        # Cache HTML files for shorter time
        location ~* \\.(html|htm)$ {
            expires 1h;
            add_header Cache-Control "public";
        }
    }
    
    # Health check endpoint
    location /health {
        access_log off;
        return 200 "healthy\\n";
        add_header Content-Type text/plain;
    }
    
    # Disable access to hidden files
    location ~ /\\. {
        deny all;
    }
    
    # Disable access to sensitive files
    location ~* \\.(conf|env|htaccess|htpasswd)$ {
        deny all;
    }
}
    `.trim();
    }
    /**
     * Update nginx configuration in container
     */
    private async updateNginxConfig(containerName: string, config: string): Promise<void> {
        // Create config file in container using docker exec
        const configScript = `cat > /etc/nginx/conf.d/default.conf << 'EOF'\n${config}\nEOF`;
        try {
            // Use a simple approach to write the config file
            await this.execInContainer(containerName, ['sh', '-c', configScript]);
            // Reload nginx
            await this.reloadNginx(containerName);
        }
        catch (error) {
            this.logger.error(`Failed to update nginx config in ${containerName}:`, error);
            throw error;
        }
    }
    /**
     * Reload nginx configuration
     */
    private async reloadNginx(containerName: string): Promise<void> {
        try {
            await this.execInContainer(containerName, ['nginx', '-s', 'reload']);
        }
        catch (error) {
            this.logger.error(`Failed to reload nginx in ${containerName}:`, error);
            throw error;
        }
    }
    /**
     * Configure Traefik routing for the nginx container
     */
    private async configureTraefikRouting(serviceName: string, containerName: string, domain: string, subdomain?: string, sslEnabled = false): Promise<void> {
        const fullDomain = subdomain ? `${subdomain}.${domain}` : domain;
        const traefikConfig = {
            http: {
                routers: {
                    [`${serviceName}-router`]: {
                        rule: `Host(\`${fullDomain}\`)`,
                        service: `${serviceName}-service`,
                        middlewares: [`${serviceName}-headers`],
                        ...(sslEnabled && { tls: {} }),
                    }
                },
                services: {
                    [`${serviceName}-service`]: {
                        loadBalancer: {
                            servers: [
                                { url: `http://${containerName}:80` }
                            ]
                        }
                    }
                },
                middlewares: {
                    [`${serviceName}-headers`]: {
                        headers: {
                            customRequestHeaders: {
                                'X-Forwarded-Proto': sslEnabled ? 'https' : 'http'
                            },
                            customResponseHeaders: {
                                'Cache-Control': 'public, max-age=3600'
                            }
                        }
                    }
                }
            }
        };
        // Write Traefik configuration
        await this.writeTraefikConfig(serviceName, traefikConfig);
    }
    /**
     * Execute command in container using Docker API
     */
    private async execInContainer(containerName: string, cmd: string[]): Promise<void> {
        // For now, we'll use a simple approach - the DockerService should expose this method
        // This is a temporary implementation
        const { spawn } = require('child_process');
        return new Promise((resolve, reject) => {
            const dockerExec = spawn('docker', ['exec', containerName, ...cmd]);
            dockerExec.on('close', (code) => {
                if (code === 0) {
                    resolve();
                }
                else {
                    reject(new Error(`Docker exec exited with code ${code}`));
                }
            });
            dockerExec.on('error', (error) => {
                reject(error);
            });
        });
    }
    /**
     * Write Traefik configuration file
     */
    private async writeTraefikConfig(serviceName: string, config: any): Promise<void> {
        const fs = require('fs').promises;
        const yaml = require('yaml');
        const configPath = `/app/traefik-configs/${serviceName}.yml`;
        const configContent = yaml.stringify(config);
        try {
            await fs.writeFile(configPath, configContent, 'utf8');
            this.logger.log(`Wrote Traefik config for ${serviceName} to ${configPath}`);
        }
        catch (error) {
            this.logger.error(`Failed to write Traefik config for ${serviceName}:`, error);
            throw error;
        }
    }
    /**
     * Remove Traefik configuration file
     */
    private async removeTraefikConfig(serviceName: string): Promise<void> {
        const fs = require('fs').promises;
        const configPath = `/app/traefik-configs/${serviceName}.yml`;
        try {
            await fs.unlink(configPath);
            this.logger.log(`Removed Traefik config for ${serviceName}`);
        }
        catch (error) {
            // Ignore if file doesn't exist
            if ((error as any).code !== 'ENOENT') {
                this.logger.error(`Failed to remove Traefik config for ${serviceName}:`, error);
                throw error;
            }
        }
    }
}
