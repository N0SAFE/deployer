import { Injectable, Logger } from '@nestjs/common';
import { DockerService } from '../services/docker.service';
import { TraefikService } from '../modules/orchestration/services/traefik.service';
import { ProjectServerService } from './project-server.service';
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
@Injectable()
export class StaticFileService {
    private readonly logger = new Logger(StaticFileService.name);
    constructor(
        private readonly dockerService: DockerService,
        private readonly traefikService: TraefikService,
        private readonly projectServerService: ProjectServerService,
    ) { }
    /**
     * Deploy static files by creating an nginx container and configuring Traefik routing
     */
    async deployStaticFiles(options: StaticFileDeploymentOptions & { image?: string; imagePullPolicy?: 'IfNotPresent' | 'Always' | 'Never'; registryAuth?: any }): Promise<NginxContainerInfo & { imageUsed?: string }> {
        const { serviceName, deploymentId, domain, subdomain, projectId, sourcePath } = options;
        const effectiveProjectId = projectId || process.env.COMPOSE_PROJECT_NAME || 'project';
        this.logger.log(`Deploying static files for service ${serviceName} at ${domain} (project=${effectiveProjectId})`);
        // Always use project-level HTTP server model
        {
             // Ensure project http server exists. Provide the full hostname (include subdomain if present)
             const host = subdomain ? `${subdomain}.${domain}` : domain;
             const projectServer = await this.projectServerService.ensureProjectServer(effectiveProjectId, host);
             const projectContainerName = projectServer.containerName;

            // Copy files from provided sourcePath into project volume under /srv/static/<service>/<deploymentId>
            if (sourcePath) {
                await this.copyFilesIntoProjectVolume(effectiveProjectId, sourcePath, serviceName, deploymentId);
            } else {
                // Legacy path: if filesPath points at a known shared volume path, attempt to move/copy from there
                this.logger.debug('No sourcePath provided - attempting to copy from legacy filesPath location if available');
                // No-op here: legacy callers should provide filesPath that references a mounted volume already
            }

            // Atomically switch current symlink inside project server
            try {
                await this.setProjectServiceCurrent(effectiveProjectId, projectContainerName, serviceName, deploymentId);
            }
            catch (symlinkErr) {
                this.logger.error(`Failed to set current symlink for ${serviceName}/${deploymentId}:`, symlinkErr);
                throw symlinkErr;
            }

            // Prune older deployments for this service
            try {
                await this.pruneOldDeployments(effectiveProjectId, projectContainerName, serviceName, 5);
            }
            catch (pruneErr) {
                this.logger.warn(`Prune operation failed for ${serviceName}: ${(pruneErr as any)?.message || String(pruneErr)}`);
            }

            // Reload project server if necessary
            try {
                await this.projectServerService.reloadProjectServer(effectiveProjectId);
            }
            catch (reloadErr) {
                this.logger.warn(`Failed to reload project server ${projectContainerName}: ${(reloadErr as any)?.message || String(reloadErr)}`);
            }

            // Configure Traefik routing at project-level if necessary (project server already has labels)
            try {
                await this.traefikService.configureStaticFileServing({
                    serviceId: serviceName,
                    projectId: effectiveProjectId,
                    domain: subdomain ? `${subdomain}.${domain}` : domain,
                    staticPath: `/srv/static/${serviceName}/current`,
                    backendTarget: projectContainerName,
                } as any);
            }
            catch (traefikErr) {
                this.logger.warn(`Failed to call Traefik config for project server backing ${serviceName}: ${(traefikErr as any)?.message || String(traefikErr)}`);
            }

            this.logger.log(`Static file deployment successful: project server ${projectContainerName} serving ${domain} (service=${serviceName})`);
            return {
                containerId: projectServer.containerId,
                containerName: projectServer.containerName,
                domain: subdomain ? `${subdomain}.${domain}` : domain,
                isRunning: true,
                createdAt: new Date(projectServer.createdAt),
                imageUsed: projectServer.image || 'rtsp/lighttpd'
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
        this.logger.log(`Updating static files for ${serviceName} in project ${projectId} (deployment=${deploymentId})`);
        const projectServer = await this.projectServerService.ensureProjectServer(projectId, 'localhost');
        if (sourcePath) {
            await this.copyFilesIntoProjectVolume(projectId, sourcePath, serviceName, deploymentId);
        }
        await this.setProjectServiceCurrent(projectId, projectServer.containerName, serviceName, deploymentId);
        await this.pruneOldDeployments(projectId, projectServer.containerName, serviceName, 5);
        await this.projectServerService.reloadProjectServer(projectId);
        this.logger.log(`Updated static files for ${serviceName} in project ${projectId}`);
    }
    /**
     * Remove static file deployment (stop container and remove Traefik config)
     */
    async removeStaticFileDeployment(projectId: string, serviceName: string, deploymentId?: string): Promise<void> {
        this.logger.log(`Removing static file deployment for ${serviceName} in project ${projectId} deployment=${deploymentId || 'ALL'}`);
        const projectServer = await this.projectServerService.getProjectServerStatus(projectId) as any;
        if (!projectServer) {
            this.logger.warn(`Project server for ${projectId} not found - nothing to remove`);
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
        this.logger.log(`Removed static file deployment for ${serviceName} in project ${projectId}`);
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
                    this.logger.warn(`Failed to list deployments for ${svc}: ${(inner as any)?.message || String(inner)}`);
                }
            }
            return result;
        }
        catch (error) {
            this.logger.error('Failed to list project-level static deployments:', error);
            return [];
        }
    }
    /**
     * Copy files from a host-local sourcePath into the project volume using a temporary helper container.
     */
    private async copyFilesIntoProjectVolume(projectId: string, sourcePath: string, serviceName: string, deploymentId: string): Promise<void> {
        // Create target path inside the volume
        const volumeName = `project-${projectId}-static`;
        const containerName = `project-filecopy-${serviceName}-${deploymentId}`;
        const targetDir = `/srv/static/${serviceName}/${deploymentId}`;
        // Use an alpine helper container that mounts both sourcePath (host) and target volume
        const binds = [
            `${sourcePath}:/src:ro`,
            `${volumeName}:/target`
        ];
        const copyCmd = ['sh', '-c', `mkdir -p ${targetDir} && cp -a /src/. ${targetDir}/ && chown -R 1000:1000 ${targetDir}`];
        this.logger.log(`Copying files from host ${sourcePath} into project volume ${volumeName}:${targetDir}`);
        const tempContainer = await this.dockerService.createContainer({
            Image: 'alpine:latest',
            name: containerName,
            Cmd: copyCmd,
            HostConfig: {
                Binds: binds,
                AutoRemove: true,
            },
        });
        try {
            await tempContainer.start();
            // Wait for completion by using wait()
            await tempContainer.wait();
            this.logger.log(`Copied files into ${targetDir} for service ${serviceName}`);
        }
        finally {
            try {
                await tempContainer.remove({ force: true });
            }
            catch { }
        }
    }
    /**
     * Atomically set the 'current' symlink for a service inside the project server container
     */
    private async setProjectServiceCurrent(projectId: string, projectContainerName: string, serviceName: string, deploymentId: string): Promise<void> {
        const linkDir = `/srv/static/${serviceName}`;
        const target = `./${deploymentId}`;
        // Ensure the per-deployment directory exists, then atomically switch 'current' and write metadata
        const cmd = ['sh', '-c', `mkdir -p ${linkDir}/${deploymentId} && ln -sfn ${target} ${linkDir}/current && printf '{"id":"%s","updatedAt":"%s"}' '${deploymentId}' "$(date -Iseconds)" > ${linkDir}/${deploymentId}/.deployer-meta.json`];
        this.logger.debug(`Setting current symlink for ${serviceName} to ${deploymentId}`);
        await this.dockerService.execInContainer(projectContainerName, cmd);
    }
    /**
     * Prune older deployments inside the project server volume for a given service, keeping `keep` latest directories
     */
    private async pruneOldDeployments(projectId: string, projectContainerName: string, serviceName: string, keep = 5): Promise<void> {
        const serviceDir = `/srv/static/${serviceName}`;
        const cmd = ['sh', '-c', `cd ${serviceDir} && ls -1dt */ 2>/dev/null | sed 's#/##' | tail -n +${keep + 1} | xargs -r rm -rf`];
        try {
            await this.dockerService.execInContainer(projectContainerName, cmd);
            this.logger.log(`Pruned older deployments for ${serviceName}, keeping ${keep}`);
        }
        catch (error) {
            this.logger.warn(`Failed to prune deployments for ${serviceName}: ${(error as any)?.message || String(error)}`);
        }
    }
}
