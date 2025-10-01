import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { sslCertificates, orchestrationStacks, networkAssignments } from '@/config/drizzle/schema/orchestration';
import { eq, and } from 'drizzle-orm';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as forge from 'node-forge';
import { DockerService } from '../../../services/docker.service';
import * as net from 'net';
import { DatabaseService } from '../../database/services/database.service';
export interface TraefikConfig {
    projectId: string;
    environment: string;
    stackName: string;
    services: {
        [serviceName: string]: {
            image: string;
            domains: string[];
            port: number;
            healthCheck?: string;
            middleware?: string[];
        };
    };
    sslConfig?: {
        email: string;
        provider: 'letsencrypt' | 'cloudflare' | 'custom';
        staging?: boolean;
    };
}
export interface DomainMapping {
    domain: string;
    service: string;
    port: number;
    path?: string;
    middleware?: string[];
}

@Injectable()
export class TraefikService implements OnModuleInit {
    private readonly logger = new Logger(TraefikService.name);
    // Honor environment configuration used by docker-compose (TRAEFIK_CONFIG_BASE_PATH)
    private readonly traefikConfigDir = process.env.TRAEFIK_CONFIG_BASE_PATH || '/app/traefik-configs';
    private readonly certificatesDir = '/app/certificates';
    constructor(
    private readonly databaseService: DatabaseService, 
    @InjectQueue('deployment')
    private deploymentQueue: Queue,
    private readonly dockerService: DockerService) { }
    async onModuleInit() {
        this.logger.log('Docker client initialized for Traefik service');
    }
    /**
     * Generate Traefik configuration for a stack
     */
    async generateTraefikConfig(config: TraefikConfig): Promise<any> {
        const { projectId, environment, stackName, services, sslConfig } = config;
        try {
            this.logger.log(`Generating Traefik config for stack: ${stackName}`);
            // Create network for the stack
            const networkName = this.getDefaultProviderNetwork(stackName);
            await this.createOrUpdateNetwork(projectId, environment, networkName);
            // Generate Traefik service configuration
            const traefikService = {
                image: 'traefik:v3.0',
                command: [
                    '--api.dashboard=true',
                    '--api.insecure=false',
                    '--providers.docker=true',
                    '--providers.docker.swarmMode=true',
                    '--log.level=DEBUG',
                    '--providers.docker.exposedByDefault=false',
                    '--providers.docker.network=' + networkName,
                    '--entrypoints.web.address=:80',
                    '--entrypoints.websecure.address=:443',
                    sslConfig ? '--certificatesresolvers.letsencrypt.acme.tlschallenge=true' : '',
                    sslConfig ? `--certificatesresolvers.letsencrypt.acme.email=${sslConfig.email}` : '',
                    sslConfig ? '--certificatesresolvers.letsencrypt.acme.storage=/certificates/acme.json' : '',
                    sslConfig?.staging ? '--certificatesresolvers.letsencrypt.acme.caServer=https://acme-staging-v02.api.letsencrypt.org/directory' : ''
                ].filter(cmd => cmd !== ''),
                ports: [
                    '80:80',
                    '443:443',
                    '8080:8080' // Traefik dashboard
                ],
                volumes: [
                    '/var/run/docker.sock:/var/run/docker.sock:ro',
                    'traefik_certificates:/certificates'
                ],
                networks: [networkName],
                deploy: {
                    placement: {
                        constraints: ['node.role==manager']
                    },
                    labels: [
                        'traefik.enable=true',
                        'traefik.http.routers.traefik.rule=Host(`traefik.' + stackName + '.local`)',
                        'traefik.http.routers.traefik.entrypoints=websecure',
                        'traefik.http.routers.traefik.tls.certresolver=letsencrypt',
                        'traefik.http.services.traefik.loadbalancer.server.port=8080'
                    ]
                }
            };
            // Configure application services with Traefik labels
            const configuredServices = {};
            for (const [serviceName, serviceConfig] of Object.entries(services)) {
                const { image, domains, port, healthCheck, middleware } = serviceConfig;
                // Generate Traefik labels
                const labels = [
                    'traefik.enable=true',
                    `traefik.http.services.${serviceName}.loadbalancer.server.port=${port}`,
                    ...domains.map((domain, index) => [
                        `traefik.http.routers.${serviceName}-${index}.rule=Host(\`${domain}\`)`,
                        `traefik.http.routers.${serviceName}-${index}.entrypoints=websecure`,
                        sslConfig ? `traefik.http.routers.${serviceName}-${index}.tls.certresolver=letsencrypt` : '',
                        `traefik.http.routers.${serviceName}-${index}.service=${serviceName}`
                    ]).flat().filter(label => label !== ''),
                    // HTTP to HTTPS redirect
                    ...domains.map((domain, index) => [
                        `traefik.http.routers.${serviceName}-${index}-http.rule=Host(\`${domain}\`)`,
                        `traefik.http.routers.${serviceName}-${index}-http.entrypoints=web`,
                        `traefik.http.routers.${serviceName}-${index}-http.middlewares=https-redirect`
                    ]).flat()
                ];
                // Add middleware labels
                if (middleware && middleware.length > 0) {
                    labels.push(`traefik.http.routers.${serviceName}.middlewares=${middleware.join(',')}`);
                }
                // Add health check
                if (healthCheck) {
                    labels.push(`traefik.http.services.${serviceName}.loadbalancer.healthcheck.path=${healthCheck}`);
                }
                configuredServices[serviceName] = {
                    image,
                    networks: [networkName],
                    deploy: {
                        labels,
                        replicas: 1,
                        update_config: {
                            parallelism: 1,
                            order: 'start-first'
                        },
                        restart_policy: {
                            condition: 'on-failure',
                            delay: '5s',
                            max_attempts: 3
                        }
                    }
                };
                // Store SSL certificate records
                for (const domain of domains) {
                    await this.storeSslCertificate({
                        domain,
                        projectId,
                        issuer: sslConfig?.provider || 'letsencrypt',
                        autoRenew: true
                    });
                }
            }
            // Create middleware for HTTPS redirect
            configuredServices['traefik-middlewares'] = {
                image: 'traefik:v3.0',
                command: ['--version'],
                deploy: {
                    labels: [
                        'traefik.http.middlewares.https-redirect.redirectscheme.scheme=https',
                        'traefik.http.middlewares.https-redirect.redirectscheme.permanent=true'
                    ],
                    replicas: 0
                }
            };
            // Complete Docker Compose configuration
            const composeConfig = {
                version: '3.8',
                services: {
                    traefik: traefikService,
                    ...configuredServices
                },
                networks: {
                    [networkName]: {
                        driver: 'overlay',
                        attachable: true
                    }
                },
                volumes: {
                    traefik_certificates: {}
                }
            };
            this.logger.log(`Traefik config generated for stack: ${stackName}`);
            return composeConfig;
        }
        catch (error) {
            this.logger.error(`Failed to generate Traefik config for ${stackName}:`, error);
            throw error;
        }
    }
    /**
     * Create or update network assignment
     */
    private async createOrUpdateNetwork(projectId: string, environment: string, networkName: string): Promise<void> {
        try {
            // Check if network assignment exists
            const existing = await this.databaseService.db.select()
                .from(networkAssignments)
                .where(and(eq(networkAssignments.projectId, projectId), eq(networkAssignments.environment, environment), eq(networkAssignments.networkName, networkName)))
                .limit(1);
            // Create Docker network if it doesn't exist
            let dockerNetworkId: string;
            try {
                const networks = await this.dockerService.getDockerClient().listNetworks({
                    filters: { name: [networkName] }
                });
                if (networks.length === 0) {
                    this.logger.log(`Creating Docker overlay network: ${networkName}`);
                    const network = await this.dockerService.getDockerClient().createNetwork({
                        Name: networkName,
                        Driver: 'overlay',
                        Options: {
                            'encrypted': 'false'
                        },
                        Labels: {
                            'project.id': projectId,
                            'project.environment': environment,
                            'traefik.enable': 'true'
                        },
                        Attachable: true,
                        IPAM: {
                            Driver: 'default'
                        }
                    });
                    dockerNetworkId = network.id;
                }
                else {
                    dockerNetworkId = networks[0].Id;
                    this.logger.log(`Using existing Docker network: ${networkName} (${dockerNetworkId})`);
                }
            }
            catch (dockerError) {
                this.logger.error(`Failed to create/get Docker network ${networkName}:`, dockerError);
                // Use fallback network ID for database record
                dockerNetworkId = `${networkName}_fallback_${Date.now()}`;
            }
            if (existing.length === 0) {
                // Create new network assignment
                await this.databaseService.db.insert(networkAssignments).values({
                    projectId,
                    networkName,
                    networkId: dockerNetworkId,
                    networkType: 'overlay',
                    environment,
                    networkConfig: {
                        driver: 'overlay',
                        attachable: true,
                        encrypted: false,
                        labels: {
                            'project.id': projectId,
                            'project.environment': environment
                        }
                    },
                    isActive: true
                });
                this.logger.log(`Network assignment created: ${networkName} -> ${dockerNetworkId}`);
            }
            else {
                // Update existing assignment with Docker network ID
                await this.databaseService.db.update(networkAssignments)
                    .set({
                    networkId: dockerNetworkId,
                    updatedAt: new Date()
                })
                    .where(eq(networkAssignments.id, existing[0].id));
                this.logger.log(`Network assignment updated: ${networkName} -> ${dockerNetworkId}`);
            }
        }
        catch (error) {
            this.logger.error(`Failed to create network assignment for ${networkName}:`, error);
            throw error;
        }
    }
    /**
     * Store SSL certificate record
     */
    private async storeSslCertificate(config: {
        domain: string;
        projectId: string;
        issuer: string;
        autoRenew: boolean;
    }): Promise<void> {
        try {
            // Check if certificate record exists
            const existing = await this.databaseService.db.select()
                .from(sslCertificates)
                .where(eq(sslCertificates.domain, config.domain))
                .limit(1);
            if (existing.length === 0) {
                // Create new certificate record
                await this.databaseService.db.insert(sslCertificates).values({
                    domain: config.domain,
                    projectId: config.projectId,
                    issuer: config.issuer,
                    autoRenew: config.autoRenew,
                    isValid: false, // Will be updated when certificate is issued
                    certificatePath: `/certificates/${config.domain}.crt`,
                    privateKeyPath: `/certificates/${config.domain}.key`,
                    metadata: {
                        subjectAlternativeNames: [config.domain],
                        keyType: 'RSA',
                        keySize: 2048,
                        fingerprint: '',
                        serialNumber: ''
                    }
                });
                this.logger.log(`SSL certificate record created: ${config.domain}`);
            }
        }
        catch (error) {
            this.logger.error(`Failed to store SSL certificate record for ${config.domain}:`, error);
            throw error;
        }
    }
    /**
     * Update domain mappings for a stack
     */
    async updateDomainMappings(stackId: string, mappings: DomainMapping[]): Promise<void> {
        try {
            const [stack] = await this.databaseService.db.select()
                .from(orchestrationStacks)
                .where(eq(orchestrationStacks.id, stackId))
                .limit(1);
            if (!stack) {
                throw new Error(`Stack ${stackId} not found`);
            }
            this.logger.log(`Updating domain mappings for stack: ${stack.name}`);
            // Update stack domain mappings
            const domainConfig = mappings.reduce((acc, mapping) => {
                if (!acc[mapping.service]) {
                    acc[mapping.service] = [];
                }
                acc[mapping.service].push({
                    domain: mapping.domain,
                    port: mapping.port,
                    path: mapping.path,
                    middleware: mapping.middleware
                });
                return acc;
            }, {} as any);
            await this.databaseService.db.update(orchestrationStacks)
                .set({
                domainMappings: domainConfig,
                updatedAt: new Date()
            })
                .where(eq(orchestrationStacks.id, stackId));
            // Queue config update job
            await this.deploymentQueue.add('update-traefik-config', {
                stackId,
                stackName: stack.name,
                domainMappings: domainConfig
            }, {
                priority: 3,
                attempts: 2
            });
        }
        catch (error) {
            this.logger.error(`Failed to update domain mappings for stack ${stackId}:`, error);
            throw error;
        }
    }
    /**
     * Get SSL certificate status
     */
    async getCertificateStatus(domain: string): Promise<any> {
        try {
            const [certificate] = await this.databaseService.db.select()
                .from(sslCertificates)
                .where(eq(sslCertificates.domain, domain))
                .limit(1);
            if (!certificate) {
                return null;
            }
            // Check certificate validity if file exists
            let certificateInfo: {
                notAfter: Date;
                issuer: string;
                fileExists: boolean;
                isValid: boolean;
            } | null = null;
            try {
                const certPath = certificate.certificatePath;
                if (certPath && await fs.pathExists(certPath)) {
                    const certPem = await fs.readFile(certPath, 'utf8');
                    const cert = forge.pki.certificateFromPem(certPem);
                    certificateInfo = {
                        notAfter: cert.validity.notAfter,
                        issuer: cert.issuer.getField('CN')?.value || 'Unknown',
                        fileExists: true,
                        isValid: new Date() < cert.validity.notAfter
                    };
                }
            }
            catch (error) {
                this.logger.warn(`Failed to read certificate file for ${domain}:`, error);
            }
            return {
                ...certificate,
                certificateInfo
            };
        }
        catch (error) {
            this.logger.error(`Failed to get certificate status for ${domain}:`, error);
            throw error;
        }
    }
    /**
     * Renew SSL certificate
     */
    async renewCertificate(domain: string): Promise<void> {
        try {
            this.logger.log(`Initiating certificate renewal for: ${domain}`);
            // Update certificate record
            await this.databaseService.db.update(sslCertificates)
                .set({
                lastRenewalAttempt: new Date(),
                renewalStatus: 'in-progress',
                updatedAt: new Date()
            })
                .where(eq(sslCertificates.domain, domain));
            // Queue renewal job
            await this.deploymentQueue.add('renew-certificate', {
                domain
            }, {
                priority: 2,
                attempts: 3,
                delay: 5000
            });
        }
        catch (error) {
            this.logger.error(`Failed to initiate certificate renewal for ${domain}:`, error);
            throw error;
        }
    }
    /**
     * Get Traefik dashboard URL for a stack
     */
    getDashboardUrl(stackName: string): string {
        return `http://traefik.${stackName}.local:8080`;
    }
    /**
     * Generate middleware configuration
     */
    generateMiddleware(name: string, config: Record<string, unknown>): string[] {
        const labels: string[] = [];
        switch (config.type) {
            case 'auth':
                labels.push(`traefik.http.middlewares.${name}.basicauth.users=${config.users}`);
                break;
            case 'cors':
                labels.push(`traefik.http.middlewares.${name}.headers.accesscontrolalloworigin=${config.allowOrigin}`);
                labels.push(`traefik.http.middlewares.${name}.headers.accesscontrolallowmethods=${config.allowMethods}`);
                break;
            case 'ratelimit':
                labels.push(`traefik.http.middlewares.${name}.ratelimit.average=${config.average}`);
                labels.push(`traefik.http.middlewares.${name}.ratelimit.burst=${config.burst}`);
                break;
            case 'compress':
                labels.push(`traefik.http.middlewares.${name}.compress=true`);
                break;
            default:
                this.logger.warn(`Unknown middleware type: ${config.type}`);
        }
        return labels;
    }
    /**
     * Ensure Traefik container is running for a stack
     */
    async ensureTraefikRunning(stackName: string, networkName: string): Promise<void> {
        try {
            const containerName = `traefik_${stackName}`;
            // Check if Traefik container exists and is running
            const containers = await this.dockerService.getDockerClient().listContainers({
                all: true,
                filters: { name: [containerName] }
            });
            if (containers.length === 0) {
                this.logger.log(`Creating Traefik container for stack: ${stackName}`);
                await this.createTraefikContainer(containerName, networkName);
            }
            else {
                const container = containers[0];
                if (container.State !== 'running') {
                    this.logger.log(`Starting Traefik container for stack: ${stackName}`);
                    const dockerContainer = this.dockerService.getDockerClient().getContainer(container.Id);
                    await dockerContainer.start();
                }
                else {
                    this.logger.log(`Traefik container already running for stack: ${stackName}`);
                }
            }
        }
        catch (error) {
            this.logger.error(`Failed to ensure Traefik is running for stack ${stackName}:`, error);
            throw error;
        }
    }
    /**
     * Create Traefik container
     */
    private async createTraefikContainer(containerName: string, networkName: string): Promise<void> {
        try {
            const container = await this.dockerService.getDockerClient().createContainer({
                Image: 'traefik:v3.0',
                name: containerName,
                Cmd: [
                    '--api.dashboard=true',
                    '--api.insecure=false',
                    '--providers.docker=true',
                    '--providers.docker.swarmMode=true',
                    '--log.level=DEBUG',
                    '--providers.docker.exposedByDefault=false',
                    `--providers.docker.network=${networkName}`,
                    '--entrypoints.web.address=:80',
                    '--entrypoints.websecure.address=:443',
                    '--certificatesresolvers.letsencrypt.acme.tlschallenge=true',
                    '--certificatesresolvers.letsencrypt.acme.email=admin@example.com',
                    '--certificatesresolvers.letsencrypt.acme.storage=/certificates/acme.json'
                ],
                ExposedPorts: {
                    '80/tcp': {},
                    '443/tcp': {},
                    '8080/tcp': {}
                },
                HostConfig: {
                    PortBindings: {
                        '80/tcp': [{ HostPort: '80' }],
                        '443/tcp': [{ HostPort: '443' }],
                        '8080/tcp': [{ HostPort: '8080' }]
                    },
                    Binds: [
                        '/var/run/docker.sock:/var/run/docker.sock:ro',
                        'traefik_certificates:/certificates'
                    ],
                    RestartPolicy: {
                        Name: 'unless-stopped'
                    }
                },
                NetworkingConfig: {
                    EndpointsConfig: {
                        [networkName]: {
                            Aliases: ['traefik']
                        }
                    }
                },
                Labels: {
                    'traefik.enable': 'true',
                    'traefik.http.routers.traefik.rule': 'Host(`traefik.local`)',
                    'traefik.http.routers.traefik.entrypoints': 'websecure',
                    'traefik.http.routers.traefik.tls.certresolver': 'letsencrypt',
                    'traefik.http.services.traefik.loadbalancer.server.port': '8080'
                }
            });
            await container.start();
            this.logger.log(`Traefik container created and started: ${containerName}`);
        }
        catch (error) {
            this.logger.error(`Failed to create Traefik container ${containerName}:`, error);
            throw error;
        }
    }
    /**
     * Generate Traefik configuration for static file serving
     */
    async generateStaticFileConfig(config: {
        projectId: string;
        serviceId: string;
        domain: string;
        staticPath: string;
        cachingEnabled?: boolean;
        compressionEnabled?: boolean;
    }): Promise<any> {
        try {
            const { projectId, serviceId, domain, staticPath, cachingEnabled = true, compressionEnabled = true } = config;
            this.logger.log(`Generating static file config for service: ${serviceId}`);
            const serviceName = `${projectId}-${serviceId}-static`;
            const middlewares: string[] = [];
            // Add compression middleware
            if (compressionEnabled) {
                middlewares.push(`${serviceName}-compress`);
            }
            // Add caching middleware
            if (cachingEnabled) {
                middlewares.push(`${serviceName}-cache`);
            }
            // Add security middleware
            middlewares.push(`${serviceName}-security`);
            const staticService = {
                image: 'nginx:alpine',
                volumes: [
                    `${staticPath}:/usr/share/nginx/html:ro`,
                    `./nginx-static.conf:/etc/nginx/nginx.conf:ro`
                ],
                deploy: {
                    labels: [
                        'traefik.enable=true',
                        `traefik.http.routers.${serviceName}.rule=Host(\`${domain}\`)`,
                        `traefik.http.routers.${serviceName}.entrypoints=websecure`,
                        `traefik.http.routers.${serviceName}.tls.certresolver=letsencrypt`,
                        `traefik.http.routers.${serviceName}.service=${serviceName}`,
                        `traefik.http.services.${serviceName}.loadbalancer.server.port=80`,
                        // Middlewares
                        `traefik.http.routers.${serviceName}.middlewares=${middlewares.join(',')}`,
                        // Compression middleware
                        `traefik.http.middlewares.${serviceName}-compress.compress=true`,
                        // Security headers middleware
                        `traefik.http.middlewares.${serviceName}-security.headers.frameDeny=true`,
                        `traefik.http.middlewares.${serviceName}-security.headers.contentTypeNosniff=true`,
                        `traefik.http.middlewares.${serviceName}-security.headers.browserXSSFilter=true`,
                        `traefik.http.middlewares.${serviceName}-security.headers.forceSTSHeader=true`,
                        `traefik.http.middlewares.${serviceName}-security.headers.stsSeconds=31536000`,
                        // Caching middleware
                        `traefik.http.middlewares.${serviceName}-cache.headers.customResponseHeaders.Cache-Control=public, max-age=86400`,
                        `traefik.http.middlewares.${serviceName}-cache.headers.customResponseHeaders.X-Static-Cache=enabled`,
                    ]
                }
            };
            // Create nginx config for static serving
            const nginxConfig = this.generateNginxConfig(serviceName);
            return {
                service: staticService,
                nginxConfig,
                middlewares: this.generateStaticFileMiddlewares(serviceName)
            };
        }
        catch (error) {
            this.logger.error(`Failed to generate static file config for service ${config.serviceId}:`, error);
            throw error;
        }
    }
    /**
     * Generate nginx configuration for static file serving
     */
    private generateNginxConfig(_serviceName: string): string {
        return `
events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    server_tokens off;
    
    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied expired no-cache no-store private must-revalidate auth;
    gzip_types
        text/css
        text/javascript
        text/xml
        text/plain
        application/javascript
        application/xml+rss
        application/json
        image/svg+xml;
    
    server {
        listen 80;
        server_name _;
        root /usr/share/nginx/html;
        index index.html index.htm;
        
        # Security headers
        add_header X-Frame-Options "DENY" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        
        # Static assets with long cache
        location ~* \\.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
            add_header X-Static-Asset "true";
        }
        
        # HTML files with no cache for SPA routing
        location ~* \\.html$ {
            expires -1;
            add_header Cache-Control "no-cache, no-store, must-revalidate";
            add_header Pragma "no-cache";
        }
        
        # SPA routing - try files, fallback to index.html
        location / {
            try_files $uri $uri/ /index.html;
        }
        
        # Health check endpoint
        location /health {
            access_log off;
            return 200 "healthy\\n";
            add_header Content-Type text/plain;
        }
        
        # Deny access to sensitive files
        location ~ /\\. {
            deny all;
            access_log off;
            log_not_found off;
        }
        
        location ~ ~$ {
            deny all;
            access_log off;
            log_not_found off;
        }
    }
}
    `.trim();
    }
    /**
     * Generate static file middlewares
     */
    private generateStaticFileMiddlewares(serviceName: string): Record<string, any> {
        return {
            [`${serviceName}-compress`]: {
                type: 'compress',
                config: {
                    excludedContentTypes: ['image/*', 'video/*']
                }
            },
            [`${serviceName}-cache`]: {
                type: 'headers',
                config: {
                    customResponseHeaders: {
                        'Cache-Control': 'public, max-age=86400',
                        'X-Static-Cache': 'enabled'
                    }
                }
            },
            [`${serviceName}-security`]: {
                type: 'headers',
                config: {
                    frameDeny: true,
                    contentTypeNosniff: true,
                    browserXSSFilter: true,
                    forceSTSHeader: true,
                    stsSeconds: 31536000,
                    customResponseHeaders: {
                        'X-Deployment-Type': 'static'
                    }
                }
            }
        };
    }
    /**
     * Update service for static file serving
     */
    async configureStaticFileServing(config: {
        serviceId: string;
        projectId: string;
        domain: string;
        staticPath: string;
        environment?: string;
        backendTarget?: string; // container name or ip:port
    }): Promise<void> {
        try {
            const { serviceId, projectId, domain, staticPath, backendTarget } = config;
            this.logger.log(`Configuring static file serving for service: ${serviceId}`);
            // Generate static file configuration
            const staticConfig = await this.generateStaticFileConfig({
                projectId,
                serviceId,
                domain,
                staticPath,
                cachingEnabled: true,
                compressionEnabled: true
            });
            // Create nginx config file
            const configPath = `/app/nginx-configs/${serviceId}.conf`;
            await fs.ensureDir(path.dirname(configPath));
            await fs.writeFile(configPath, staticConfig.nginxConfig);

            // If a backendTarget (container name) is provided we prefer Traefik's Docker provider using labels
            // and therefore skip writing a file-provider dynamic YAML to avoid stale upstream entries.
            const dynamicDir = path.join(this.traefikConfigDir, 'dynamic', projectId ? String(projectId) : 'projects');
            await fs.ensureDir(dynamicDir);
            const serviceName = `${projectId || 'project'}-${serviceId}`;
            const backend = backendTarget || serviceName;
            const dynamicPath = path.join(dynamicDir, `${serviceId}-static.yml`);
            if (backendTarget) {
                // When backendTarget is explicitly provided, assume the container will include Traefik labels
                // and remove any previously generated dynamic YAML that references this service to avoid routing to stale IPs.
                try {
                    const files = await fs.readdir(dynamicDir);
                    for (const f of files) {
                        const p = path.join(dynamicDir, f);
                        try {
                            const stat = await fs.stat(p);
                            if (!stat.isFile()) continue;
                            const content = await fs.readFile(p, 'utf8');
                            if (content.includes(serviceId) || content.includes(`${serviceId}-service`) || content.includes(`${projectId || 'project'}-${serviceId}`) || content.includes(domain)) {
                                await fs.unlink(p);
                                this.logger.log(`Removed stale dynamic Traefik config at ${p} because backendTarget is provided`);
                            }
                        }
                        catch (innerErr) {
                            this.logger.warn(`Failed to inspect/remove candidate dynamic file ${p}: ${(innerErr as any)?.message || String(innerErr)}`);
                        }
                    }
                }
                catch (rmErr) {
                    this.logger.warn(`Failed to clean dynamic Traefik configs in ${dynamicDir}: ${(rmErr as any)?.message || String(rmErr)}`);
                }

                // Verify the backendTarget container exists and has proper labels for the requested domain.
                try {
                    const containerInfo = await this.dockerService.getContainerInfo(backendTarget);
                    const labels = (containerInfo.Config && containerInfo.Config.Labels) || {};
                    const labelValues = Object.values(labels).map(v => String(v));
                    const hasDomainLabel = labelValues.some(v => v.includes(domain));
                    if (hasDomainLabel) {
                        this.logger.log(`Backend container ${backendTarget} has Traefik labels for ${domain}; relying on Docker provider.`);
                        return; // done - docker provider will handle routing
                    }

                    // No matching label found; create a fallback dynamic entry that points to the container's IP
                    const networks = containerInfo.NetworkSettings?.Networks || {};
                    const nets = Object.keys(networks);
                    let ipAddress: string | undefined = undefined;
                    if (nets.length > 0) {
                        // pick first network's IP for fallback
                        ipAddress = networks[nets[0]]?.IPAddress || networks[nets[0]]?.GlobalIPv6Address;
                    }
                    if (!ipAddress) {
                        this.logger.warn(`Could not determine IP address for backend ${backendTarget}; not writing fallback dynamic config.`);
                        return;
                    }

                    const fallbackDynamic: Record<string, unknown> = {
                        http: {
                            routers: {
                                [
                                    `${serviceName}-router`
                                ]: {
                                    rule: `Host(` + "`" + `${domain}` + "`" + `)`,
                                    service: serviceName,
                                    entrypoints: ['web']
                                }
                            },
                            services: {
                                [serviceName]: {
                                    loadBalancer: {
                                        servers: [
                                            { url: `http://${ipAddress}:80` }
                                        ]
                                    }
                                }
                            }
                        }
                    };
                    const fallbackPath = path.join(dynamicDir, `${serviceId}-static-fallback.yml`);
                    await fs.writeFile(fallbackPath, require('yaml').stringify(fallbackDynamic), 'utf8');
                    this.logger.log(`Wrote fallback dynamic Traefik config at ${fallbackPath} pointing ${domain} -> ${ipAddress}`);
                    return;
                }
                catch (inspectErr) {
                    // Backend container doesn't exist - allow calling code to handle further (we don't write a bad config)
                    this.logger.warn(`Backend target ${backendTarget} could not be inspected: ${(inspectErr as any)?.message || String(inspectErr)}. Skipping dynamic file creation.`);
                    return;
                }
            }
            else {
                // Write dynamic Traefik configuration that points to the actual backend target
                const dynamicObj: Record<string, unknown> = {
                     http: {
                         routers: {
                            [`${serviceName}-router`]: {
                                rule: `Host(` + "`" + `${domain}` + "`" + `)`,
                                service: serviceName,
                                entrypoints: ['web']
                            }
                        },
                        services: {
                            [serviceName]: {
                                loadBalancer: {
                                    servers: [
                                        { url: `http://${backend}:80` }
                                    ]
                                }
                            }
                        }
                    }
                };

                // Validate backend reachability before writing the dynamic file. If backend is a container/service name
                // try to resolve it via Docker; otherwise attempt a TCP probe to port 80 on the host.
                const backendIsReachable = await (async () => {
                    // Try Docker-based resolution
                    try {
                        const ci = await this.dockerService.getContainerInfo(backend);
                        // If container exists and has at least one network IP, consider it reachable for routing
                        const nets = ci.NetworkSettings?.Networks || {};
                        const hasIp = Object.keys(nets).some(k => !!nets[k]?.IPAddress || !!nets[k]?.GlobalIPv6Address);
                        if (hasIp) return true;
                    }
                    catch { /* not a container name */ }
                    // Fallback to TCP connect
                    const host = backend.split(':')[0];
                    const port = Number((backend.split(':')[1]) || 80);
                    try {
                        return await new Promise<boolean>((resolve) => {
                            const sock = net.createConnection({ host, port, timeout: 1500 }, () => {
                                sock.destroy();
                                resolve(true);
                            });
                            sock.on('error', () => { try { sock.destroy(); } catch {} ; resolve(false); });
                            sock.on('timeout', () => { try { sock.destroy(); } catch {} ; resolve(false); });
                        });
                    }
                    catch {
                        return false;
                    }
                })();

                if (!backendIsReachable) {
                    this.logger.warn(`Not writing dynamic Traefik config at ${dynamicPath} because backend ${backend} does not appear reachable`);
                }
                else {
                    await fs.writeFile(dynamicPath, require('yaml').stringify(dynamicObj), 'utf8');
                    this.logger.log(`Wrote dynamic Traefik config at ${dynamicPath}`);
                }
            }
        }
        catch (error) {
            this.logger.error(`Failed to configure static file serving for service ${config.serviceId}:`, error);
            throw error;
        }
    }
    /**
     * Update stack configuration in database
     */
    private async updateStackConfiguration(serviceId: string, config: { staticServingEnabled?: boolean; staticPath?: string; domain?: string; middlewares?: string[] }): Promise<void> {
        try {
            type StackRow = typeof orchestrationStacks.$inferSelect;

            let stack: StackRow | undefined = undefined;

            // Try find by stack name first
            try {
                const [foundByName] = await this.databaseService.db.select().from(orchestrationStacks).where(eq(orchestrationStacks.name, serviceId)).limit(1);
                if (foundByName) stack = foundByName as StackRow;
            }
            catch (lookupErr) {
                this.logger.debug(`Name-based stack lookup failed for ${serviceId}:`, (lookupErr as any)?.message || String(lookupErr));
            }

            // If not found by name and the provided identifier looks like a UUID, try matching projectId
            if (!stack) {
                const uuidLike = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(serviceId);
                if (uuidLike) {
                    try {
                        const [foundByProject] = await this.databaseService.db.select().from(orchestrationStacks).where(eq(orchestrationStacks.projectId, serviceId)).limit(1);
                        if (foundByProject) stack = foundByProject as StackRow;
                    }
                    catch (lookupErr) {
                        this.logger.debug(`ProjectId-based stack lookup failed for ${serviceId}:`, (lookupErr as any)?.message || String(lookupErr));
                    }
                }
            }

            if (!stack) {
                this.logger.warn(`No orchestration stack found matching service/stack identifier: ${serviceId} - skipping update`);
                return;
            }

            // Update existing stack compose config with static config
            const updatedConfig = { ...stack.composeConfig, staticConfig: config } as any;
            await this.databaseService.db.update(orchestrationStacks).set({ composeConfig: updatedConfig, updatedAt: new Date() }).where(eq(orchestrationStacks.id, stack.id));
            this.logger.log(`Updated stack configuration for service: ${serviceId}`);
        }
        catch (error) {
             this.logger.error(`Failed to update stack configuration for service ${serviceId}:`, error);
             throw error;
         }
     }
    /**
     * Compute the default network name Traefik should use for the given stack.
     * In development we prefer the compose project network when COMPOSE_PROJECT_NAME is set to keep Traefik reachable to containers created by the API.
     */
    private getDefaultProviderNetwork(stackName: string): string {
        if (process.env.COMPOSE_PROJECT_NAME) {
            return `${process.env.COMPOSE_PROJECT_NAME}_app_network_dev`;
        }
        return `${stackName}_network`;
    }
}
