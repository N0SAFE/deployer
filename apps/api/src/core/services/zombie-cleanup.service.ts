import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DockerService } from './docker.service';
import { DatabaseService } from '../modules/database/services/database.service';
import { projects } from '@/config/drizzle/schema/deployment';

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
export class ZombieCleanupService implements OnModuleInit {
  private readonly logger = new Logger(ZombieCleanupService.name);

  constructor(
    private readonly dockerService: DockerService,
    private readonly databaseService: DatabaseService,
  ) {}

  /**
   * Run cleanup on application startup
   */
  async onModuleInit() {
    this.logger.log('Running initial zombie cleanup on startup...');
    try {
      await this.autoCleanup();
      this.logger.log('Initial zombie cleanup completed');
    } catch (error) {
      this.logger.error('Failed to run initial zombie cleanup:', error);
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
      // Step 1: Try to reconcile containers
      const reconcileResult = await this.reconcileAllContainers({ dryRun: false });
      this.logger.log(
        `Reconciliation: ${reconcileResult.restarted} restarted, ${reconcileResult.relabeled} relabeled, ${reconcileResult.skipped} skipped`,
      );

      // Step 2: Clean up truly orphaned containers
      const cleanupResult = await this.cleanupZombieContainers();
      this.logger.log(
        `Auto cleanup completed: ${cleanupResult.removed} removed, ${cleanupResult.errors} errors`,
      );

      // Step 3: Clean up old helper containers
      const helperResult = await this.cleanupZombieHelpers();
      this.logger.log(
        `Helper cleanup: ${helperResult.removed} removed, ${helperResult.errors} errors`,
      );
    } catch (error) {
      this.logger.error('Auto cleanup failed:', error);
    }
  }

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
    const activeProjects = await this.databaseService.db
      .select({ id: projects.id, name: projects.name, baseDomain: projects.baseDomain })
      .from(projects);

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
              `Container ${containerName} belongs to active project ${project.name} but is ${containerInfo.State} - attempting restart`,
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
            const expectedHost = project.baseDomain || 'localhost';
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
    const activeProjects = await this.databaseService.db
      .select({ id: projects.id })
      .from(projects);

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
    const activeProjects = await this.databaseService.db
      .select({ id: projects.id })
      .from(projects);
    const activeProjectIds = new Set(activeProjects.map((p) => p.id));

    const docker = this.dockerService.getDockerClient();

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
