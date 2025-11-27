import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DockerService } from './docker.service';
import { DeploymentService } from '@/core/modules/deployment/services/deployment.service';
import { ProjectService } from '@/modules/project/services/project.service';
import { ServiceService } from '@/core/modules/service/services/service.service';
import { DeploymentPhase } from '@/core/common/types/deployment-phase';
import { deployments, projects } from '@/config/drizzle/schema';
import * as fs from 'fs/promises';
import * as path from 'path';

// Type aliases for type safety
type Deployment = typeof deployments.$inferSelect;
type Project = typeof projects.$inferSelect;

interface ZombieContainer {
  id: string;
  name: string;
  projectId: string;
  createdAt: Date;
  state: string;
  image: string;
  labels: Record<string, string>;
}

interface ReconciliationResult {
  projectId: string;
  containerName: string;
  action: 'restarted' | 'relabeled' | 'removed' | 'skipped';
  reason: string;
}

@Injectable()
export class ZombieCleanupService {
  private readonly logger = new Logger(ZombieCleanupService.name);

  constructor(
    private readonly dockerService: DockerService,
    private readonly deploymentService: DeploymentService,
    private readonly projectService: ProjectService,
    private readonly serviceService: ServiceService,
  ) {}

  /**
   * Resume incomplete deployments after API restart/crash
   * This is called FIRST during startup to recover in-progress deployments
   */
  async resumeIncompleteDeployments(): Promise<{
    resumed: number;
    failed: number;
    skipped: number;
  }> {
    this.logger.log('🔄 Scanning for incomplete deployments to resume...');

    // Find deployments that are stuck for more than 5 minutes
    const incompleteDeployments = await this.deploymentService.findStuckDeployments(5);

    this.logger.log(
      `Found ${incompleteDeployments.length} stuck deployments (no update for 5+ minutes)`
    );

    let resumed = 0;
    let failed = 0;
    let skipped = 0;

    for (const deployment of incompleteDeployments) {
      try {
        const result = await this.handleIncompleteDeployment(deployment);
        
        if (result === 'resumed') {
          resumed++;
        } else if (result === 'failed') {
          failed++;
        } else {
          skipped++;
        }
      } catch (error) {
        this.logger.error(
          `Failed to handle incomplete deployment ${deployment.id}:`,
          error
        );
        failed++;
      }
    }

    this.logger.log(
      `📊 Resume summary: ${resumed} resumed, ${failed} failed, ${skipped} skipped`
    );

    return { resumed, failed, skipped };
  }

  /**
   * Handle a single incomplete deployment
   * Returns 'resumed', 'failed', or 'skipped'
   */
  private async handleIncompleteDeployment(
    deployment: Deployment
  ): Promise<'resumed' | 'failed' | 'skipped'> {
    this.logger.log(
      `🔍 Examining deployment ${deployment.id} (phase: ${deployment.phase})`
    );

    // Check if deployment can be resumed
    const canResume = await this.canResumeDeployment(deployment);

    if (!canResume) {
      this.logger.warn(
        `❌ Cannot resume deployment ${deployment.id} - marking as failed`
      );
      await this.markDeploymentFailed(
        deployment.id,
        'Deployment stuck and cannot be resumed after API restart'
      );
      return 'failed';
    }

    // Attempt to resume the deployment
    try {
      this.logger.log(
        `✅ Resuming deployment ${deployment.id} from phase ${deployment.phase}`
      );
      
      await this.resumeDeployment(deployment);
      return 'resumed';
    } catch (error) {
      this.logger.error(
        `❌ Failed to resume deployment ${deployment.id}:`,
        error
      );
      
      await this.markDeploymentFailed(
        deployment.id,
        `Resume failed: ${(error as Error).message}`
      );
      return 'failed';
    }
  }

  /**
   * Check if a deployment can be resumed
   * - Verify deployment files exist
   * - Check if containers are still running
   * - Validate phase metadata
   */
  private async canResumeDeployment(deployment: Deployment): Promise<boolean> {
    const phase = deployment.phase as DeploymentPhase;

    // Early phases (before files exist) cannot be resumed
    if (
      phase === DeploymentPhase.QUEUED ||
      phase === DeploymentPhase.PULLING_SOURCE
    ) {
      this.logger.log(
        `Deployment ${deployment.id} in early phase ${phase} - cannot resume`
      );
      return false;
    }

    // Check if deployment files exist for file-based deployments
    if (deployment.sourceType === 'upload') {
      const filesExist = await this.checkDeploymentFiles(deployment);
      if (!filesExist) {
        this.logger.warn(
          `Deployment ${deployment.id} files missing - cannot resume`
        );
        return false;
      }
    }

    // For git deployments, check if source is still accessible
    if (deployment.sourceType === 'git') {
      // TODO: Add source accessibility check
      // For now, assume we can retry from scratch
    }

    return true;
  }

  /**
   * Resume a deployment from its current phase
   * This orchestrates the resume process based on deployment type and phase
   */
  private async resumeDeployment(deployment: Deployment): Promise<void> {
    const phase = deployment.phase as DeploymentPhase;

    this.logger.log(
      `Resuming deployment ${deployment.id} from phase ${phase}`
    );

    // Log the resume attempt
    await this.deploymentService.addDeploymentLog(deployment.id, {
      level: 'info',
      message: `Attempting to resume deployment from phase ${phase}`,
      phase: phase,
      timestamp: new Date(),
      metadata: {
        resumeAttempted: true,
        originalPhase: phase,
        stuckAt: deployment.phaseUpdatedAt,
      },
    });

    // Delegate to DeploymentService's resume logic
    try {
      await this.deploymentService.resumeFromPhase(deployment.id, phase);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to resume deployment ${deployment.id}:`, errorMessage);
      
      await this.deploymentService.addDeploymentLog(deployment.id, {
        level: 'error',
        message: `Failed to resume deployment: ${errorMessage}`,
        phase: phase,
        timestamp: new Date(),
        metadata: {
          error: errorMessage,
          phase: phase,
        },
      });
    }
  }

  /**
   * Mark a deployment as failed with error details
   */
  private async markDeploymentFailed(
    deploymentId: string,
    errorMessage: string
  ): Promise<void> {
    await this.deploymentService.updateDeploymentPhase(
      deploymentId,
      DeploymentPhase.FAILED,
      0,
      {
        error: errorMessage,
        failedAt: new Date().toISOString(),
        resumeAttempted: true,
      }
    );

    await this.deploymentService.updateDeploymentStatus(
      deploymentId,
      'failed'
    );

    await this.deploymentService.addDeploymentLog(deploymentId, {
      level: 'error',
      message: `Deployment marked as failed: ${errorMessage}`,
      timestamp: new Date(),
      metadata: {
        error: errorMessage,
        failedDuringResume: true,
      },
    });
  }

  /**
   * Check if deployment files exist on disk
   */
  private async checkDeploymentFiles(deployment: Deployment): Promise<boolean> {
    try {
      const uploadPath =
        (deployment.sourceConfig as any)?.filePath ||
        (deployment.phaseMetadata as any)?.uploadPath;

      if (!uploadPath) {
        this.logger.warn(
          `No upload path found in deployment ${deployment.id} metadata`
        );
        return false;
      }

      // Check if the upload file exists
      try {
        await fs.access(uploadPath);
        return true;
      } catch {
        this.logger.warn(
          `Upload file not found: ${uploadPath}`
        );
        return false;
      }
    } catch (error) {
      this.logger.error(
        `Error checking deployment files for ${deployment.id}:`,
        error
      );
      return false;
    }
  }

  /**
   * Automatic cleanup runs every hour
   * First attempts reconciliation, then removes unreconcilable containers
   */
  @Cron(CronExpression.EVERY_HOUR)
  async autoCleanup() {
    this.logger.log('Running automatic zombie container cleanup with reconciliation');
    try {
      // Step 1: Reconcile symlinks (self-healing)
      const symlinkResult = await this.reconcileSymlinks();
      this.logger.log(
        `Symlink reconciliation: ${symlinkResult.fixed} fixed, ${symlinkResult.verified} verified, ${symlinkResult.errors} errors`,
      );

      // Step 2: Try to reconcile containers
      const reconcileResult = await this.reconcileAllContainers({ dryRun: false });
      this.logger.log(
        `Reconciliation: ${reconcileResult.restarted} restarted, ${reconcileResult.relabeled} relabeled, ${reconcileResult.skipped} skipped`,
      );

      // Step 3: Clean up truly orphaned containers
      const cleanupResult = await this.cleanupZombieContainers();
      this.logger.log(
        `Auto cleanup completed: ${cleanupResult.removed} removed, ${cleanupResult.errors} errors`,
      );

      // Step 4: Clean up old helper containers
      const helperResult = await this.cleanupZombieHelpers();
      this.logger.log(
        `Helper cleanup: ${helperResult.removed} removed, ${helperResult.errors} errors`,
      );
    } catch (error) {
      this.logger.error('Auto cleanup failed:', error);
    }
  }

  /**
   * Reconcile project symlinks - ensure they point to correct deployments
   * This is critical for crash recovery and maintaining service availability
   */
  async reconcileSymlinks(): Promise<{
    fixed: number;
    verified: number;
    errors: number;
  }> {
    this.logger.log('🔗 Starting symlink reconciliation...');

    let fixed = 0;
    let verified = 0;
    let errors = 0;

    // Get all active projects
    const { projects: activeProjects } = await this.projectService.findMany({});

    for (const project of activeProjects) {
      try {
        const result = await this.reconcileProjectSymlinks(project);
        
        if (result === 'fixed') {
          fixed++;
        } else if (result === 'verified') {
          verified++;
        }
      } catch (error) {
        this.logger.error(
          `Failed to reconcile symlinks for project ${project.id}:`,
          error
        );
        errors++;
      }
    }

    this.logger.log(
      `✅ Symlink reconciliation complete: ${fixed} fixed, ${verified} verified, ${errors} errors`
    );

    return { fixed, verified, errors };
  }

  /**
   * Reconcile symlinks for a single project
   * - Verify 'current' symlink exists
   * - Verify it points to latest successful deployment
   * - Recreate if broken or missing
   */
  private async reconcileProjectSymlinks(
    project: Project
  ): Promise<'fixed' | 'verified' | 'error'> {
    const projectPath = `/var/www/${project.id}`;
    const currentSymlink = path.join(projectPath, 'current');

    try {
      // Get services for this project
      const projectServices = await this.serviceService.findByProject(project.id);

      if (projectServices.length === 0) {
        // No services for this project yet
        return 'verified';
      }

      // For static file projects, use the first service's latest deployment
      // TODO: Handle multiple services per project
      const primaryService = projectServices[0];

      // Get latest successful deployment for the service
      const latestDeployment = await this.deploymentService.getLastSuccessfulDeployment(
        primaryService.id
      );

      if (!latestDeployment) {
        // No successful deployments yet - nothing to reconcile
        return 'verified';
      }

      const expectedTarget = path.join(
        projectPath,
        'deployments',
        latestDeployment.id
      );

      // Check if current symlink exists
      let needsFix = false;
      let currentTarget: string | null = null;

      try {
        const stats = await fs.lstat(currentSymlink);
        
        if (stats.isSymbolicLink()) {
          currentTarget = await fs.readlink(currentSymlink);
          
          // Normalize paths for comparison
          const normalizedCurrent = path.resolve(path.dirname(currentSymlink), currentTarget);
          const normalizedExpected = path.resolve(expectedTarget);
          
          if (normalizedCurrent !== normalizedExpected) {
            this.logger.warn(
              `🔧 Project ${project.id}: symlink points to wrong target\n` +
              `  Current: ${normalizedCurrent}\n` +
              `  Expected: ${normalizedExpected}`
            );
            needsFix = true;
          }
        } else {
          this.logger.warn(
            `⚠️ Project ${project.id}: 'current' exists but is not a symlink`
          );
          needsFix = true;
        }
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          this.logger.warn(
            `❌ Project ${project.id}: 'current' symlink missing`
          );
          needsFix = true;
        } else {
          throw error;
        }
      }

      if (needsFix) {
        // Verify target deployment directory exists
        try {
          await fs.access(expectedTarget);
        } catch {
          this.logger.error(
            `❌ Project ${project.id}: deployment directory ${expectedTarget} does not exist`
          );
          return 'error';
        }

        // Remove existing symlink if present
        try {
          await fs.unlink(currentSymlink);
        } catch (error: any) {
          if (error.code !== 'ENOENT') {
            this.logger.error(
              `Failed to remove old symlink ${currentSymlink}:`,
              error
            );
          }
        }

        // Create new symlink
        await fs.symlink(expectedTarget, currentSymlink);

        this.logger.log(
          `✅ Fixed symlink for project ${project.id}: ${currentSymlink} -> ${expectedTarget}`
        );

        // Also verify webroot symlink if it exists
        const webrootPath = `/var/www/webroot/${project.id}`;
        try {
          await fs.access(webrootPath);
          
          // Check if webroot is a symlink
          const webrootStats = await fs.lstat(webrootPath);
          if (webrootStats.isSymbolicLink()) {
            const webrootTarget = await fs.readlink(webrootPath);
            const expectedWebrootTarget = path.join(currentSymlink, 'public');
            
            if (webrootTarget !== expectedWebrootTarget) {
              // Fix webroot symlink too
              await fs.unlink(webrootPath);
              await fs.symlink(expectedWebrootTarget, webrootPath);
              
              this.logger.log(
                `✅ Also fixed webroot symlink: ${webrootPath} -> ${expectedWebrootTarget}`
              );
            }
          }
        } catch {
          // Webroot symlink doesn't exist or other error - not critical
        }

        return 'fixed';
      }

      return 'verified';
    } catch (error) {
      this.logger.error(
        `Failed to reconcile symlinks for project ${project.id}:`,
        error
      );
      return 'error';
    }
  }

  /**
   * Automatic cleanup runs every hour
   * First attempts reconciliation, then removes unreconcilable containers
   */

  /**
   * Attempt to reconcile containers with the database
   * - Restart stopped containers that belong to active projects
   * - Relabel containers to match current project state
   * - Skip containers that can't be reconciled
   */
  async reconcileAllContainers(options?: {
    dryRun?: boolean;
    projectId?: string;
  }): Promise<{
    reconciliations: ReconciliationResult[];
    restarted: number;
    relabeled: number;
    skipped: number;
    errors: number;
  }> {
    const { dryRun = false, projectId } = options || {};

    this.logger.log(
      `Starting container reconciliation (dryRun=${dryRun}, projectId=${projectId || 'all'})`,
    );

    const reconciliations: ReconciliationResult[] = [];
    let restarted = 0;
    let relabeled = 0;
    let skipped = 0;
    let errors = 0;

    // Get all active projects from database
    const { projects: activeProjects } = await this.projectService.findMany({});

    const activeProjectMap = new Map(activeProjects.map((p) => [p.id, p]));
    this.logger.log(`Found ${activeProjectMap.size} active projects in database`);

    // Get all containers with deployer labels
    const docker = this.dockerService.getDockerClient();
    const allContainers = await docker.listContainers({
      all: true,
      filters: {
        label: ['deployer.project_server'],
      },
    });

    this.logger.log(`Found ${allContainers.length} containers with deployer labels`);

    // Process each container
    for (const containerInfo of allContainers) {
      const containerProjectId = containerInfo.Labels?.['deployer.project_server'];
      const containerName = containerInfo.Names[0]?.replace(/^\//, '') || 'unknown';

      if (!containerProjectId) {
        continue;
      }

      // Skip if filtering by specific project
      if (projectId && containerProjectId !== projectId) {
        continue;
      }

      const project = activeProjectMap.get(containerProjectId);

      if (project) {
        // Container belongs to active project - try to reconcile
        try {
          if (containerInfo.State !== 'running') {
            // Attempt to restart
            this.logger.log(
              `Container ${containerName} belongs to active project ${(project as any).name} but is ${containerInfo.State} - attempting restart`,
            );

            if (!dryRun) {
              const container = docker.getContainer(containerInfo.Id);
              await container.start();
              this.logger.log(`Successfully restarted ${containerName}`);
            }

            reconciliations.push({
              projectId: containerProjectId,
              containerName,
              action: 'restarted',
              reason: `Container was ${containerInfo.State}, restarted for active project`,
            });
            restarted++;
          } else {
            // Container is running - verify labels are correct
            const expectedHost = (project as any).baseDomain || 'localhost';
            const currentRule = containerInfo.Labels?.[`traefik.http.routers.project-${containerProjectId}.rule`];
            
            if (currentRule && !currentRule.includes(expectedHost)) {
              this.logger.warn(
                `Container ${containerName} has outdated Traefik rule: ${currentRule}`,
              );
              
              reconciliations.push({
                projectId: containerProjectId,
                containerName,
                action: 'skipped',
                reason: 'Label mismatch detected but cannot update running container - manual recreation needed',
              });
              skipped++;
            } else {
              reconciliations.push({
                projectId: containerProjectId,
                containerName,
                action: 'skipped',
                reason: 'Container running correctly',
              });
              skipped++;
            }
          }
        } catch (error) {
          this.logger.error(`Failed to reconcile ${containerName}:`, error);
          reconciliations.push({
            projectId: containerProjectId,
            containerName,
            action: 'skipped',
            reason: `Error: ${(error as Error).message}`,
          });
          errors++;
        }
      }
    }

    this.logger.log(
      `Reconciliation ${dryRun ? '(dry run) ' : ''}completed: ${restarted} restarted, ${relabeled} relabeled, ${skipped} skipped, ${errors} errors`,
    );

    return { reconciliations, restarted, relabeled, skipped, errors };
  }

  /**
   * Find and remove zombie containers from deleted projects
   * NOTE: Should be called AFTER reconcileAllContainers() to ensure we only remove truly orphaned containers
   */
  async cleanupZombieContainers(options?: {
    dryRun?: boolean;
    projectId?: string;
  }): Promise<{
    zombies: ZombieContainer[];
    removed: number;
    errors: number;
  }> {
    const { dryRun = false, projectId } = options || {};

    this.logger.log(
      `Starting zombie container cleanup (dryRun=${dryRun}, projectId=${projectId || 'all'})`,
    );

    const zombies: ZombieContainer[] = [];
    let removed = 0;
    let errors = 0;

    // Get all active project IDs from database
    const { projects: activeProjects } = await this.projectService.findMany({});

    const activeProjectIds = new Set(activeProjects.map((p) => p.id));
    this.logger.log(`Found ${activeProjectIds.size} active projects in database`);

    // Find all containers with deployer labels
    const docker = this.dockerService.getDockerClient();
    const allContainers = await docker.listContainers({
      all: true,
      filters: {
        label: ['deployer.project_server'],
      },
    });

    this.logger.log(
      `Found ${allContainers.length} containers with deployer.project_server label`,
    );

    // Check each container
    for (const containerInfo of allContainers) {
      const containerProjectId =
        containerInfo.Labels?.['deployer.project_server'];

      if (!containerProjectId) {
        continue;
      }

      // Skip if filtering by specific project and this isn't it
      if (projectId && containerProjectId !== projectId) {
        continue;
      }

      // Check if project exists in database
      const isZombie = !activeProjectIds.has(containerProjectId);

      if (isZombie) {
        const zombie: ZombieContainer = {
          id: containerInfo.Id,
          name: containerInfo.Names[0]?.replace(/^\//, '') || 'unknown',
          projectId: containerProjectId,
          createdAt: new Date(containerInfo.Created * 1000),
          state: containerInfo.State,
          image: containerInfo.Image,
          labels: containerInfo.Labels || {},
        };

        zombies.push(zombie);

        this.logger.warn(
          `Found zombie container: ${zombie.name} (project ${zombie.projectId} no longer exists in database)`,
        );

        if (!dryRun) {
          try {
            await this.removeContainer(containerInfo.Id, zombie.name);
            removed++;
          } catch (error) {
            this.logger.error(
              `Failed to remove zombie container ${zombie.name}:`,
              error,
            );
            errors++;
          }
        }
      }
    }

    if (dryRun) {
      this.logger.log(
        `Dry run completed: found ${zombies.length} zombie containers (not removed)`,
      );
    } else {
      this.logger.log(
        `Cleanup completed: ${removed} removed, ${errors} errors, ${zombies.length} total zombies`,
      );
    }

    return { zombies, removed, errors };
  }

  /**
   * Clean up zombie helper containers (deployer-vol-*, deployer-copy-*)
   */
  async cleanupZombieHelpers(options?: {
    dryRun?: boolean;
    olderThanMinutes?: number;
  }): Promise<{
    removed: number;
    errors: number;
  }> {
    const { dryRun = false, olderThanMinutes = 60 } = options || {};

    this.logger.log(
      `Cleaning up zombie helper containers older than ${olderThanMinutes} minutes (dryRun=${dryRun})`,
    );

    let removed = 0;
    let errors = 0;

    const docker = this.dockerService.getDockerClient();
    const allContainers = await docker.listContainers({
      all: true,
    });

    const now = Date.now();
    const maxAge = olderThanMinutes * 60 * 1000;

    for (const containerInfo of allContainers) {
      const name = containerInfo.Names[0]?.replace(/^\//, '') || '';

      // Check for helper container patterns
      if (
        name.startsWith('deployer-vol-') ||
        name.startsWith('deployer-copy-')
      ) {
        const age = now - containerInfo.Created * 1000;

        // Only remove exited containers older than threshold
        if (containerInfo.State === 'exited' && age > maxAge) {
          this.logger.warn(
            `Found zombie helper: ${name} (${Math.round(age / 60000)} minutes old)`,
          );

          if (!dryRun) {
            try {
              await this.removeContainer(containerInfo.Id, name);
              removed++;
            } catch (error) {
              this.logger.error(`Failed to remove helper ${name}:`, error);
              errors++;
            }
          }
        }
      }
    }

    if (dryRun) {
      this.logger.log(`Dry run: would remove ${removed} helper containers`);
    } else {
      this.logger.log(
        `Helper cleanup: ${removed} removed, ${errors} errors`,
      );
    }

    return { removed, errors };
  }

  /**
   * Get comprehensive statistics about all container states
   */
  async getZombieStats(): Promise<{
    projectServers: number;
    stoppedProjectServers: number;
    helpers: number;
    traefikOrphans: number;
    activeProjects: number;
  }> {
    // Count active projects
    const deleted: string[] = [];

    // Get all active projects from database
    const { projects: activeProjects } = await this.projectService.findMany({});
    const activeProjectIds = new Set(activeProjects.map((p) => p.id));    const docker = this.dockerService.getDockerClient();

    // Count project servers
    const projectServerContainers = await docker.listContainers({
      all: true,
      filters: {
        label: ['deployer.project_server'],
      },
    });

    const zombieProjectServers = projectServerContainers.filter(
      (c) =>
        !activeProjectIds.has(c.Labels?.['deployer.project_server'] || ''),
    );

    const stoppedProjectServers = projectServerContainers.filter(
      (c) =>
        activeProjectIds.has(c.Labels?.['deployer.project_server'] || '') &&
        c.State !== 'running',
    );

    // Count helper containers
    const allContainers = await docker.listContainers({ all: true });
    const helperContainers = allContainers.filter((c) => {
      const name = c.Names[0]?.replace(/^\//, '') || '';
      return (
        (name.startsWith('deployer-vol-') ||
          name.startsWith('deployer-copy-')) &&
        c.State === 'exited'
      );
    });

    // Count Traefik orphans
    const traefikContainers = await docker.listContainers({
      all: true,
      filters: {
        label: ['traefik.enable=true'],
      },
    });

    const traefikOrphans = traefikContainers.filter((c) => {
      const projectId = c.Labels?.['deployer.project_server'];
      return projectId && !activeProjectIds.has(projectId);
    });

    return {
      projectServers: zombieProjectServers.length,
      stoppedProjectServers: stoppedProjectServers.length,
      helpers: helperContainers.length,
      traefikOrphans: traefikOrphans.length,
      activeProjects: activeProjects.length,
    };
  }

  /**
   * Helper method to remove a container
   */
  private async removeContainer(
    containerId: string,
    name: string,
  ): Promise<void> {
    const docker = this.dockerService.getDockerClient();
    const container = docker.getContainer(containerId);

    try {
      // Get container info to check state
      const info = await container.inspect();

      // Stop if running
      if (info.State.Status === 'running') {
        this.logger.log(`Stopping container ${name}...`);
        await container.stop({ t: 10 });
      }

      // Remove container
      this.logger.log(`Removing container ${name}...`);
      await container.remove({ force: true });

      this.logger.log(`Successfully removed zombie container: ${name}`);
    } catch (error) {
      throw new Error(
        `Failed to remove container ${name}: ${(error as Error).message}`,
      );
    }
  }
}
