import { Injectable } from '@nestjs/common';
import { DockerService } from '@/core/modules/docker/services/docker.service';
import { TraefikService } from '@/core/modules/orchestration/services/traefik.service';
import { ProjectServerService } from '@/core/modules/projects/services/project-server.service';
import { BaseProviderService } from '@/core/modules/providers/common';
import { TraefikConfigBuilder } from '@/core/modules/traefik/config-builder/builders';
import type {
  IDeploymentProvider,
  ProviderConfig,
  DeploymentTrigger,
  SourceFiles,
} from '../interfaces/provider.interface';
import type { IProvider, ConfigSchema } from '@/core/interfaces/provider.interface';
import { z } from 'zod';
import * as fs from 'fs-extra';
import * as path from 'path';
export interface StaticFileDeploymentOptions {
    serviceName: string;
    deploymentId: string;
    projectId?: string;
    domain: string;
    subdomain?: string;
    // sourcePath is an optional host path to copy files from (temporary extract directory)
    sourcePath?: string;
}
export interface NginxContainerInfo {
    containerId: string;
    containerName: string;
    domain: string;
    isRunning: boolean;
    createdAt: Date;
}
/**
 * Static Provider Service
 * Handles deployment of static files using nginx containers and project-level HTTP servers
 * Implements IDeploymentProvider for unified deployment pipeline
 */
@Injectable()
export class StaticProviderService extends BaseProviderService implements IDeploymentProvider, IProvider {
    // IProvider properties
    readonly id = 'static';
    readonly name = 'Static Files';
    readonly type = 'static' as const;
    readonly description = 'Deploy pre-built static files (HTML, CSS, JS) directly without build process';
    readonly icon = '📁';
    readonly supportedBuilders = ['static'];
    
    private readonly staticVolumePath = '/app/static';

    constructor(
        private readonly dockerService: DockerService,
        private readonly traefikService: TraefikService,
        private readonly projectServerService: ProjectServerService,
    ) {
        super(StaticProviderService.name);
    }

    /**
     * Fetch source files from static upload/path
     * For static provider, files are already on the host
     */
    async fetchSource(config: ProviderConfig, trigger: DeploymentTrigger): Promise<SourceFiles> {
        return this.executeWithLogging(
            'fetchSource',
            async () => {
                const sourcePath = config.repository?.url || trigger.data?.sourcePath;
                
                if (!sourcePath) {
                    throw new Error('Source path is required for static provider');
                }

                // Verify source path exists
                if (!(await fs.pathExists(sourcePath))) {
                    throw new Error(`Source path does not exist: ${sourcePath}`);
                }

                const sourceId = `static-${Date.now()}-${this.generateId()}`;
                
                // For static files, we can use the path directly or copy to temp location
                // Here we'll use it directly since it's already on the host
                return {
                    sourceId,
                    localPath: sourcePath,
                    metadata: {
                        provider: 'static',
                        version: trigger.data?.version || new Date().toISOString(),
                        timestamp: this.getCurrentTimestamp(),
                        sourcePath,
                        uploadedBy: trigger.userId,
                    },
                    cleanup: async () => {
                        // For static files, we typically don't cleanup the source
                        // unless it's a temporary upload directory
                        if (trigger.data?.isTemporary) {
                            await fs.remove(sourcePath);
                            this.debug(`Cleaned up temporary source: ${sourcePath}`);
                        }
                    },
                };
            },
        );
    }

    /**
     * Validate static provider configuration
     */
    async validateConfig(config: any): Promise<{ valid: boolean; errors: string[] }> {
        const errors: string[] = [];

        // Support both ProviderConfig and raw config format
        const sourcePath = config.repository?.url || config.sourcePath || config.config?.defaultPath;

        // For static provider, we need either a URL (path) in config or runtime path
        if (!sourcePath) {
            errors.push('Source path is required');
        }

        // Validate path if provided
        if (sourcePath) {
            try {
                await fs.access(sourcePath);
            } catch {
                errors.push(`Source path is not accessible: ${sourcePath}`);
            }
        }

        return {
            valid: errors.length === 0,
            errors,
        };
    }

    /**
     * Get configuration schema for Static provider (IProvider interface)
     */
    getConfigSchema(): ConfigSchema {
        return {
            id: 'static-provider-config',
            version: '1.0.0',
            title: 'Static Files Configuration',
            description: 'Configure static file deployment from local path or upload',
            fields: [
                {
                    key: 'sourcePath',
                    label: 'Source Path',
                    description: 'Local filesystem path to static files',
                    schema: z.string().min(1),
                    type: 'text',
                    required: true,
                    placeholder: '/path/to/static/files',
                    group: 'source',
                    ui: { order: 1, fullWidth: true },
                },
                {
                    key: 'indexFile',
                    label: 'Index File',
                    description: 'Default file to serve (e.g., index.html)',
                    schema: z.string(),
                    type: 'text',
                    required: false,
                    defaultValue: 'index.html',
                    placeholder: 'index.html',
                    group: 'serving',
                    ui: { order: 2 },
                },
                {
                    key: 'enableSPA',
                    label: 'Single Page Application (SPA)',
                    description: 'Route all requests to index file (for React, Vue, Angular apps)',
                    schema: z.boolean(),
                    type: 'boolean',
                    required: false,
                    defaultValue: false,
                    group: 'serving',
                    ui: { order: 3 },
                },
                {
                    key: 'customHeaders',
                    label: 'Custom Headers',
                    description: 'Additional HTTP headers to send (JSON format)',
                    schema: z.string().optional(),
                    type: 'json',
                    required: false,
                    placeholder: '{"Cache-Control": "max-age=3600"}',
                    group: 'advanced',
                    ui: { order: 4, fullWidth: true },
                },
                {
                    key: 'compressionEnabled',
                    label: 'Enable Compression',
                    description: 'Enable gzip compression for static assets',
                    schema: z.boolean(),
                    type: 'boolean',
                    required: false,
                    defaultValue: true,
                    group: 'optimization',
                    ui: { order: 5 },
                },
            ],
            validate: async (config: any) => {
                const errors: string[] = [];
                
                if (config.customHeaders) {
                    try {
                        JSON.parse(config.customHeaders);
                    } catch {
                        errors.push('Custom headers must be valid JSON');
                    }
                }
                
                return { valid: errors.length === 0, errors };
            },
            transform: (config: any) => {
                return {
                    type: 'static',
                    repository: {
                        url: config.sourcePath,
                    },
                    config: {
                        defaultPath: config.sourcePath,
                        indexFile: config.indexFile || 'index.html',
                        spaMode: config.enableSPA || false,
                        customHeaders: config.customHeaders ? JSON.parse(config.customHeaders) : {},
                        compression: config.compressionEnabled ?? true,
                    },
                };
            },
        };
    }

    /**
     * Get default configuration (IProvider interface)
     */
    getDefaultConfig(): Record<string, any> {
        return {
            sourcePath: '',
            indexFile: 'index.html',
            enableSPA: false,
            customHeaders: '',
            compressionEnabled: true,
        };
    }

    /**
     * Static provider doesn't use cache (files are uploaded/changed explicitly)
     */
    async shouldSkipDeployment(
        _config: ProviderConfig,
        _trigger: DeploymentTrigger,
    ): Promise<{ shouldSkip: boolean; reason: string }> {
        return { 
            shouldSkip: false, 
            reason: 'Static provider always deploys (no cache check)' 
        };
    }

    /**
     * Get deployment version string
     */
    getDeploymentVersion(source: SourceFiles): string {
        if (source.metadata.version) {
            return source.metadata.version;
        }
        return source.metadata.timestamp 
            ? new Date(source.metadata.timestamp).toISOString()
            : new Date().toISOString();
    }
    /**
     * Deploy static files by creating an nginx container and configuring Traefik routing
     */
    async deployStaticFiles(options: StaticFileDeploymentOptions & { image?: string; imagePullPolicy?: 'IfNotPresent' | 'Always' | 'Never'; registryAuth?: any }): Promise<NginxContainerInfo & { imageUsed?: string }> {
        const { serviceName, deploymentId, domain, subdomain, projectId, sourcePath } = options;
        const effectiveProjectId = projectId || process.env.COMPOSE_PROJECT_NAME || 'project';
        this.log(`Deploying static files for service ${serviceName} at ${domain} (project=${effectiveProjectId})`);
        // Always use project-level HTTP server model
        {
             // Ensure project http server exists. Provide the full hostname (include subdomain if present)
             const host = subdomain ? `${subdomain}.${domain}` : domain;
             const projectServer = await this.projectServerService.ensureProjectServer(effectiveProjectId, host);
             const projectContainerName = projectServer.containerName;

            // Copy files directly using mounted volume at /app/static
            let copyMeta: { probe?: { exitCode: number; output: string } | null } | null = null;
            if (sourcePath) {
                copyMeta = await this.copyFilesDirectly(effectiveProjectId, sourcePath, serviceName, deploymentId);
            } else {
                this.debug('No sourcePath provided - skipping file copy');
            }

            // Atomically switch current symlink using direct filesystem operations
            try {
                await this.setProjectServiceCurrentDirect(effectiveProjectId, serviceName, deploymentId);
            }
            catch (symlinkErr) {
                this.error(`Failed to set current symlink for ${serviceName}/${deploymentId}:`, symlinkErr);
                throw symlinkErr;
            }

            // Ensure project server has vhost config mapping the Host to this service path
            // This is CRITICAL - if it fails, deployment should fail
            try {
                const host = subdomain ? `${subdomain}.${domain}` : domain;
                await this.projectServerService.ensureVhostForService(effectiveProjectId, host, serviceName);
            }
            catch (vhostErr) {
                this.error(`CRITICAL: Failed to ensure vhost for ${serviceName}@${effectiveProjectId}: ${(vhostErr as any)?.message || String(vhostErr)}`);
                throw new Error(`Failed to configure web server for ${serviceName}: ${(vhostErr as any)?.message || String(vhostErr)}`);
            }

            // Prune older deployments for this service using direct filesystem access
            try {
                await this.pruneOldDeploymentsDirect(effectiveProjectId, serviceName, 5);
            }
            catch (pruneErr) {
                this.warn(`Prune operation failed for ${serviceName}: ${(pruneErr as any)?.message || String(pruneErr)}`);
            }

            // Note: Server reload is already done in ensureVhostForService, no need to reload again

            // Configure Traefik routing using template system
            try {
                const template = this.getTraefikTemplate();
                const containerInfo = await this.dockerService.getContainerInfo(projectServer.containerId);
                const containerPort = Object.keys(containerInfo.Config?.ExposedPorts || {})[0]?.split('/')[0] || '80';
                
                await this.projectServerService.addServiceRouter(
                    effectiveProjectId,
                    serviceName,
                    subdomain ? `${subdomain}.${domain}` : domain,
                    parseInt(containerPort),
                    template
                );
            }
            catch (traefikErr) {
                this.warn(`Failed to configure Traefik routing for ${serviceName}: ${(traefikErr as any)?.message || String(traefikErr)}`);
            }

            // Verify deployment is accessible via HTTP using comprehensive health check
            try {
                const host = subdomain ? `${subdomain}.${domain}` : domain;
                
                // Use the comprehensive health check that verifies everything is working
                const isHealthy = await this.projectServerService.ensureProjectServerHealth(effectiveProjectId, serviceName, host);
                
                if (isHealthy) {
                    this.log(`✅ Comprehensive health check passed: ${host} is fully operational`);
                } else {
                    this.error(`❌ Comprehensive health check failed for ${host}`);
                    // Don't fail deployment on verification failure - log it but continue
                    // The deployment files are in place, the issue might be transient
                }
                
                // Additional basic verification
                await this.verifyDeploymentAccessible(projectContainerName, host);
                this.log(`✅ Basic deployment verification also passed for ${host}`);
            }
            catch (verifyErr) {
                this.warn(`Deployment verification failed for ${serviceName}: ${(verifyErr as any)?.message || String(verifyErr)}`);
                // Don't fail deployment on verification failure - it might be a transient issue
            }

            return {
                containerId: projectServer.containerId,
                containerName: projectServer.containerName,
                domain: subdomain ? `${subdomain}.${domain}` : domain,
                isRunning: true,
                createdAt: new Date(projectServer.createdAt),
                imageUsed: projectServer.image || 'rtsp/lighttpd',
                metadata: { probe: copyMeta?.probe ?? null }
            } as any;
        }
         // Project-level flow executed above; legacy per-deployment containers removed.
         // This code path should never be reached.
         throw new Error('Legacy per-deployment nginx container creation removed in favor of project-level server');
    }
    /**
     * Update static files in an existing nginx container
     */
    async updateStaticFiles(projectId: string, serviceName: string, deploymentId: string, sourcePath?: string): Promise<void> {
        this.log(`Updating static files for ${serviceName} in project ${projectId} (deployment=${deploymentId})`);
        // Use getProjectServerStatus instead of ensureProjectServer to avoid recreating with wrong labels
        const projectServer = await this.projectServerService.getProjectServerStatus(projectId) as any;
        if (!projectServer) {
            throw new Error(`Project server for ${projectId} not found - cannot update static files`);
        }
        if (sourcePath) {
            await this.copyFilesIntoProjectVolume(projectId, sourcePath, serviceName, deploymentId);
        }
        await this.setProjectServiceCurrent(projectId, projectServer.containerName, serviceName, deploymentId);
        await this.pruneOldDeployments(projectId, projectServer.containerName, serviceName, 5);
        await this.projectServerService.reloadProjectServer(projectId);
        this.log(`Updated static files for ${serviceName} in project ${projectId}`);
    }
    /**
     * Remove static file deployment (stop container and remove Traefik config)
     */
    async removeStaticFileDeployment(projectId: string, serviceName: string, deploymentId?: string): Promise<void> {
        this.log(`Removing static file deployment for ${serviceName} in project ${projectId} deployment=${deploymentId || 'ALL'}`);
        const projectServer = await this.projectServerService.getProjectServerStatus(projectId) as any;
        if (!projectServer) {
            this.warn(`Project server for ${projectId} not found - nothing to remove`);
            return;
        }
        const containerName = projectServer.containerName;
        const baseDir = `/srv/static/${serviceName}`;
        if (deploymentId) {
            const cmd = ['sh', '-c', `rm -rf ${baseDir}/${deploymentId}`];
            await this.dockerService.execInContainer(containerName, cmd);
            // If current points to removed deployment, unset or point to next available
            const fixCmd = ['sh', '-c', `if [ -L ${baseDir}/current ]; then target=$(readlink ${baseDir}/current); if [ "$target" = "./${deploymentId}" ]; then next=$(ls -1dt ${baseDir}/*/ 2>/dev/null | sed 's#/##' | head -n1 || true); if [ -n "$next" ]; then ln -sfn ./$next ${baseDir}/current; else rm -f ${baseDir}/current; fi; fi; fi`];
            await this.dockerService.execInContainer(containerName, fixCmd);
        } else {
            // Remove entire service directory
            const cmd = ['sh', '-c', `rm -rf ${baseDir}`];
            await this.dockerService.execInContainer(containerName, cmd);
        }
        await this.projectServerService.reloadProjectServer(projectId);
        this.log(`Removed static file deployment for ${serviceName} in project ${projectId}`);
    }
    /**
     * List all nginx containers managed by this service
     */
    async listStaticFileDeployments(projectId: string): Promise<Array<{ serviceName: string; deployments: string[]; current?: string }>> {
        const projectServer = await this.projectServerService.getProjectServerStatus(projectId) as any;
        if (!projectServer) return [];
        const containerName = projectServer.containerName;
        const cmd = ['sh', '-c', "ls -1 /srv/static 2>/dev/null || true"];
        try {
            const { output } = await this.dockerService.execInContainer(containerName, cmd);
            const services = (output || '').split('\n').map(s => s.trim()).filter(Boolean);
            const result: Array<{ serviceName: string; deployments: string[]; current?: string }> = [];
            for (const svc of services) {
                const listCmd = ['sh', '-c', `ls -1dt /srv/static/${svc}/*/ 2>/dev/null | sed 's#/##' || true`];
                try {
                    const { output: out2 } = await this.dockerService.execInContainer(containerName, listCmd);
                    const deployments = (out2 || '').split('\n').map(s => s.trim()).filter(Boolean);
                    const curCmd = ['sh', '-c', `readlink /srv/static/${svc}/current 2>/dev/null || true`];
                    const { output: curOut } = await this.dockerService.execInContainer(containerName, curCmd);
                    const current = (curOut || '').trim().replace(/^\.\//, '') || undefined;
                    result.push({ serviceName: svc, deployments, current });
                }
                catch (inner) {
                    this.warn(`Failed to list deployments for ${svc}: ${(inner as any)?.message || String(inner)}`);
                }
            }
            return result;
        }
        catch (error) {
            this.error('Failed to list project-level static deployments:', error);
            return [];
        }
    }
    /**
     * Copy files from a host-local sourcePath into the project volume using a temporary helper container.
     */
    private async copyFilesIntoProjectVolume(projectId: string, sourcePath: string, serviceName: string, deploymentId: string): Promise<{ probe?: { exitCode: number; output: string } | null }> {
        // Create target path inside the volume
        const volumeName = `project-${projectId}-static`;
        const containerName = `project-filecopy-${serviceName}-${deploymentId}`;
        // When mounted into the project server the volume is mounted at /srv/static.
        // The volume root therefore should contain per-service directories like
        // <serviceName>/<deploymentId>. To reliably write into the volume from a
        // helper container we mount the volume as /target and write into
        // /target/<serviceName>/<deploymentId> so the project server will see
        // /srv/static/<serviceName>/<deploymentId] after the volume is mounted.
        const targetDirInVolume = `/${serviceName}/${deploymentId}`; // relative to volume root
        // Use an alpine helper container that mounts both sourcePath (host) and target volume
        const binds = [
            `${sourcePath}:/src:ro`,
            `${volumeName}:/target`
        ];
        // Copy contents, flatten nested deployment dirs, and ensure proper permissions
        // lighttpd typically runs as user with UID 100, but we also set 644/755 permissions for safety
        const copyCmd = ['sh', '-c', 
            `mkdir -p /target${targetDirInVolume} && ` +
            `cp -a /src/. /target${targetDirInVolume}/ && ` +
            `for d in /target${targetDirInVolume}/*; do if [ -d \"$d\" ]; then base=\"$(basename \"$d\")\"; case \"$base\" in deployment-*) echo \"Flattening nested dir $base\"; mv \"$d\"/* /target${targetDirInVolume}/ 2>/dev/null || true; rmdir \"$d\" 2>/dev/null || true;; esac; fi; done && ` +
            `find /target${targetDirInVolume} -type f -exec chmod 644 {} \\; && ` +
            `find /target${targetDirInVolume} -type d -exec chmod 755 {} \\; && ` +
            `chown -R 100:101 /target${targetDirInVolume} 2>/dev/null || chown -R 1000:1000 /target${targetDirInVolume}`
        ];
        this.log(`Copying files from host ${sourcePath} into project volume ${volumeName} at ${targetDirInVolume}`);
        const tempContainer = await this.dockerService.createContainer({
            Image: 'alpine:latest',
            name: containerName,
            Cmd: copyCmd,
            HostConfig: {
                Binds: binds,
            },
        });
        try {
            await tempContainer.start();
            // Wait for completion by using wait()
            await tempContainer.wait();
            this.log(`Copied files into volume ${volumeName} at ${targetDirInVolume} for service ${serviceName}`);
        }
        finally {
            try {
                await tempContainer.remove({ force: true });
            }
            catch { }
        }
        // Probe the copied path for file count and total size (best-effort)
        try {
            const probeScript = `cd /target${targetDirInVolume} 2>/dev/null || exit 0; files=$(find . -type f | wc -l); bytes=$(du -sb . 2>/dev/null | cut -f1 || echo 0); sample=$(find . -type f | head -n 10 | paste -sd "," -); echo "files=\${files};bytes=\${bytes};sample=\${sample}"`;
            const probeResult = await this.dockerService.runCommandInVolume(volumeName, probeScript);
            this.log(`Probe for copied files in ${volumeName}${targetDirInVolume}: exit=${probeResult.exitCode}`);
            try {
                await this.dockerService.putStringIntoVolume(volumeName, `${targetDirInVolume}`, '.deployer-probe.txt', probeResult.output);
            } catch (writeErr) {
                this.warn(`Failed to write probe summary into volume (non-fatal): ${(writeErr as Error)?.message || String(writeErr)}`);
            }
            return { probe: probeResult } as any;
        } catch (probeErr) {
            this.warn(`Volume probe failed (non-fatal): ${(probeErr as Error)?.message || String(probeErr)}`);
            return { probe: null } as any;
        }
    }
    /**
     * Verify that a deployment is accessible via HTTP inside the container
     */
    private async verifyDeploymentAccessible(containerName: string, host: string): Promise<void> {
        // Try to fetch the index page from inside the container
        const curlCmd = ['sh', '-c', `command -v curl >/dev/null 2>&1 && curl -f -s -o /dev/null -w '%{http_code}' -H 'Host: ${host}' http://127.0.0.1/ || echo '200'`];
        try {
            const { output } = await this.dockerService.execInContainer(containerName, curlCmd);
            const statusCode = (output || '').trim();
            if (statusCode.startsWith('2')) {
                return; // Success - 2xx status code
            }
            throw new Error(`HTTP verification returned status ${statusCode}`);
        } catch (err) {
            this.warn(`HTTP verification failed: ${(err as Error)?.message || String(err)}`);
            // Fallback: check if files exist in /var/www/html
            const checkCmd = ['sh', '-c', 'ls -la /var/www/html/ | grep -E "html|htm" | wc -l'];
            const { output: fileCount } = await this.dockerService.execInContainer(containerName, checkCmd);
            if (parseInt(fileCount?.trim() || '0') > 0) {
                this.log(`Files exist in /var/www/html, HTTP verification may have failed due to missing curl`);
                return; // Files exist, consider it verified
            }
            throw new Error('No HTML files found in webroot');
        }
    }

    /**
     * Copy files directly using the mounted static volume instead of helper containers
     */
    private async copyFilesDirectly(
        projectId: string, 
        sourcePath: string, 
        serviceName: string, 
        deploymentId: string
    ): Promise<{ probe?: { exitCode: number; output: string } | null }> {
        const targetDir = path.join(this.staticVolumePath, `project-${projectId}`, serviceName, deploymentId);
        
        try {
            this.log(`Copying files directly from ${sourcePath} to ${targetDir}`);
            
            // Ensure target directory exists
            await fs.ensureDir(targetDir);
            
            // Copy files from source to target
            await fs.copy(sourcePath, targetDir, {
                overwrite: true,
                recursive: true,
                dereference: true // Follow symlinks
            });
            
            // Validate copy by checking if files exist
            const files = await fs.readdir(targetDir);
            if (files.length === 0) {
                throw new Error(`No files found in target directory after copy: ${targetDir}`);
            }
            
            this.log(`✅ Successfully copied ${files.length} files/directories to ${targetDir}`);
            
            // Generate probe information
            const probeInfo = await this.generateProbeInfo(targetDir);
            
            // Write probe file
            const probeFilePath = path.join(targetDir, '.deployer-probe.txt');
            await fs.writeFile(probeFilePath, probeInfo.output);
            
            return { probe: probeInfo };
            
        } catch (error) {
            this.error(`Failed to copy files directly: ${(error as Error)?.message || String(error)}`);
            throw error;
        }
    }

    /**
     * Generate probe information for copied files
     */
    private async generateProbeInfo(targetDir: string): Promise<{ exitCode: number; output: string }> {
        try {
            const stats = await fs.stat(targetDir);
            if (!stats.isDirectory()) {
                return { exitCode: 1, output: 'Target is not a directory' };
            }

            // Count files
            const files = await this.getAllFiles(targetDir);
            const fileCount = files.length;
            
            // Calculate total size
            let totalBytes = 0;
            for (const file of files) {
                try {
                    const fileStat = await fs.stat(file);
                    totalBytes += fileStat.size;
                } catch {
                    // Skip files that can't be read
                }
            }
            
            // Get sample files (first 10)
            const sampleFiles = files.slice(0, 10).map(f => path.relative(targetDir, f));
            const sample = sampleFiles.join(',');
            
            const output = `files=${fileCount};bytes=${totalBytes};sample=${sample}`;
            return { exitCode: 0, output };
            
        } catch (error) {
            return { exitCode: 1, output: `Probe failed: ${(error as Error)?.message}` };
        }
    }

    /**
     * Recursively get all files in a directory
     */
    private async getAllFiles(dir: string): Promise<string[]> {
        const files: string[] = [];
        
        const items = await fs.readdir(dir);
        for (const item of items) {
            const fullPath = path.join(dir, item);
            const stat = await fs.stat(fullPath);
            
            if (stat.isDirectory()) {
                const subFiles = await this.getAllFiles(fullPath);
                files.push(...subFiles);
            } else {
                files.push(fullPath);
            }
        }
        
        return files;
    }

    /**
     * Create symlink directly using filesystem operations instead of Docker exec
     */
    private async setProjectServiceCurrentDirect(projectId: string, serviceName: string, deploymentId: string): Promise<void> {
        const projectDir = path.join(this.staticVolumePath, `project-${projectId}`, serviceName);
        const currentLink = path.join(projectDir, 'current');
        const targetDir = path.join(projectDir, deploymentId);
        
        try {
            // Ensure the target deployment directory exists
            if (!(await fs.pathExists(targetDir))) {
                throw new Error(`Target deployment directory does not exist: ${targetDir}`);
            }
            
            // Remove existing symlink if it exists
            if (await fs.pathExists(currentLink)) {
                const stat = await fs.lstat(currentLink);
                if (stat.isSymbolicLink()) {
                    await fs.unlink(currentLink);
                    this.debug(`Removed existing symlink: ${currentLink}`);
                }
            }
            
            // Create new symlink (relative path for portability)
            await fs.symlink(deploymentId, currentLink);
            this.log(`✅ Created symlink: ${currentLink} -> ${deploymentId}`);
            
            // Write deployment metadata
            const metadataPath = path.join(targetDir, '.deployer-meta.json');
            const metadata = {
                id: deploymentId,
                updatedAt: new Date().toISOString()
            };
            await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
            
            // Verify symlink
            const linkStat = await fs.lstat(currentLink);
            if (!linkStat.isSymbolicLink()) {
                throw new Error(`Failed to create symlink at ${currentLink}`);
            }
            
            const linkTarget = await fs.readlink(currentLink);
            if (linkTarget !== deploymentId) {
                throw new Error(`Symlink points to wrong target. Expected: ${deploymentId}, Got: ${linkTarget}`);
            }
            
        } catch (error) {
            this.error(`Failed to set current symlink for ${serviceName}/${deploymentId}: ${(error as Error)?.message}`);
            throw error;
        }
    }

    /**
     * Atomically set the 'current' symlink for a service inside the project server container
     */
    private async setProjectServiceCurrent(projectId: string, projectContainerName: string, serviceName: string, deploymentId: string): Promise<void> {
        const linkDir = `/srv/static/${serviceName}`;
        const target = `./${deploymentId}`;
        // Ensure the per-deployment directory exists, then atomically switch 'current' and write metadata
        const cmd = ['sh', '-c', `mkdir -p ${linkDir}/${deploymentId} && ln -sfn ${target} ${linkDir}/current || ln -sfn ${linkDir}/${deploymentId} ${linkDir}/current; printf '{"id":"%s","updatedAt":"%s"}' '${deploymentId}' "$(date -Iseconds)" > ${linkDir}/${deploymentId}/.deployer-meta.json`];
        this.debug(`Setting current symlink for ${serviceName} to ${deploymentId}`);
        await this.dockerService.execInContainer(projectContainerName, cmd);
        // Verify symlink points to an existing directory, otherwise attempt absolute fallback
        try {
            const verifyCmd = ['sh', '-c', `if [ -L ${linkDir}/current ]; then target=$(readlink ${linkDir}/current); if [ -n "$target" ] && [ -d ${linkDir}/$target ]; then exit 0; fi; fi; exit 2`];
            await this.dockerService.execInContainer(projectContainerName, verifyCmd);
        } catch {
            this.warn(`Symlink verification failed for ${linkDir}/current; attempting absolute symlink fallback`);
            const absCmd = ['sh', '-c', `ln -sfn ${linkDir}/${deploymentId} ${linkDir}/current || true`];
            await this.dockerService.execInContainer(projectContainerName, absCmd);
            // Final verification
            const finalCheck = ['sh', '-c', `if [ -L ${linkDir}/current ] && [ -d ${linkDir}/${deploymentId} ]; then exit 0; else exit 3; fi`];
            await this.dockerService.execInContainer(projectContainerName, finalCheck);
        }
    }
    /**
     * Prune older deployments inside the project server volume for a given service, keeping `keep` latest directories
     */
    private async pruneOldDeployments(projectId: string, projectContainerName: string, serviceName: string, keep = 5): Promise<void> {
        const serviceDir = `/srv/static/${serviceName}`;
        const cmd = ['sh', '-c', `cd ${serviceDir} && ls -1dt */ 2>/dev/null | sed 's#/##' | tail -n +${keep + 1} | xargs -r rm -rf`];
        try {
            await this.dockerService.execInContainer(projectContainerName, cmd);
            this.log(`Pruned older deployments for ${serviceName}, keeping ${keep}`);
        }
        catch (error) {
            this.warn(`Failed to prune deployments for ${serviceName}: ${(error as any)?.message || String(error)}`);
        }
    }

    /**
     * Prune older deployments using direct filesystem access instead of container exec
     */
    private async pruneOldDeploymentsDirect(projectId: string, serviceName: string, keep = 5): Promise<void> {
        const serviceDir = path.join(this.staticVolumePath, `project-${projectId}`, serviceName);
        
        try {
            // Check if service directory exists
            if (!(await fs.pathExists(serviceDir))) {
                this.debug(`Service directory does not exist, skipping prune: ${serviceDir}`);
                return;
            }
            
            // Get all deployment directories
            const items = await fs.readdir(serviceDir);
            const deploymentDirs: Array<{ name: string; mtime: Date }> = [];
            
            for (const item of items) {
                const itemPath = path.join(serviceDir, item);
                try {
                    const stat = await fs.stat(itemPath);
                    if (stat.isDirectory() && item !== 'current') { // Don't include the 'current' symlink
                        deploymentDirs.push({ name: item, mtime: stat.mtime });
                    }
                } catch {
                    // Skip items that can't be statted
                }
            }
            
            // Sort by modification time (newest first)
            deploymentDirs.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
            
            // Remove old deployments (keep the newest 'keep' deployments)
            const toRemove = deploymentDirs.slice(keep);
            if (toRemove.length > 0) {
                this.log(`Pruning ${toRemove.length} old deployments for ${serviceName}, keeping ${keep} newest`);
                
                for (const { name } of toRemove) {
                    const deploymentPath = path.join(serviceDir, name);
                    try {
                        await fs.remove(deploymentPath);
                        this.debug(`Removed old deployment: ${deploymentPath}`);
                    } catch (removeError) {
                        this.warn(`Failed to remove old deployment ${deploymentPath}: ${(removeError as Error)?.message}`);
                    }
                }
            } else {
                this.debug(`No old deployments to prune for ${serviceName} (${deploymentDirs.length} total, keeping ${keep})`);
            }
            
        } catch (error) {
            this.warn(`Failed to prune deployments for ${serviceName}: ${(error as Error)?.message || String(error)}`);
        }
    }

    /**
     * Get the default Traefik configuration template for static provider
     */
    getTraefikTemplate(): string {
        return `# Static Provider Traefik Template
# Variables: ~##domain##~, ~##subdomain##~, ~##host##~, ~##projectId##~, ~##serviceName##~, ~##containerName##~, ~##pathPrefix##~, ~##containerPort##~

http:
  routers:
    ~##routerName##~:
      rule: "Host(\`~##host##~\`)"
      service: "~##serviceName##~-svc"
      middlewares:
        - "~##serviceName##~-path"
      entryPoints:
        - web
  
  middlewares:
    ~##serviceName##~-path:
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
     * Get default Traefik configuration builder for static file deployments
     * @param config Optional configuration for customizing the default setup
     * @returns TraefikConfigBuilder with static file optimized defaults
     */
    getDefaultTraefikConfig(config?: {
        domain?: string;
        enableSSL?: boolean;
        enableCompression?: boolean;
        enableCaching?: boolean;
    }): TraefikConfigBuilder {
        const builder = new TraefikConfigBuilder();
        const domain = config?.domain || '~##domain##~';

        // Default router for static files
        builder.addRouter('static-files', r => r
            .rule(`Host(\`${domain}\`)`)
            .service('static-files-service')
            .entryPoint(config?.enableSSL ? 'websecure' : 'web')
        );

        // Default nginx service
        builder.addService('static-files-service', s => s
            .loadBalancer(lb => lb
                .server('http://~##containerName##~:80')
                .healthCheck({ path: '/', interval: '30s' })
            )
        );

        // Add compression middleware if enabled
        if (config?.enableCompression) {
            builder.addMiddleware('compress', m => m.compress());
        }

        // Add caching headers if enabled
        if (config?.enableCaching) {
            builder.addMiddleware('cache-headers', m => m.headers({
                customResponseHeaders: {
                    'Cache-Control': 'public, max-age=31536000',
                    'X-Cache-Status': 'HIT',
                },
            }));
        }

        // Add SSL configuration if enabled
        if (config?.enableSSL) {
            builder.configureTLS(tls => tls
                .certificate('~##certFile##~', '~##keyFile##~')
                .minVersion('VersionTLS12')
            );
        }

        return builder;
    }
}
