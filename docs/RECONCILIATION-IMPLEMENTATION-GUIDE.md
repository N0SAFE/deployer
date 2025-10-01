# Reconciliation Implementation Guide

> **Step-by-step guide to implement production-grade reconciliation in the deployer app**

This guide shows how to implement the reconciliation patterns described in [RECONCILIATION-ARCHITECTURE.md](./RECONCILIATION-ARCHITECTURE.md).

## Table of Contents
1. [Phase 1: Enhanced Reconciliation](#phase-1-enhanced-reconciliation)
2. [Phase 2: Crash Recovery](#phase-2-crash-recovery)
3. [Phase 3: Multi-Server Coordination](#phase-3-multi-server-coordination)
4. [Phase 4: Testing & Validation](#phase-4-testing--validation)

---

## Phase 1: Enhanced Reconciliation

### Step 1.1: Add Deployment Phase Tracking

**Goal**: Track which phase a deployment is in, so we can resume after crashes.

**Database Migration:**
```sql
-- Add phase tracking to deployments table
ALTER TABLE deployments 
ADD COLUMN phase VARCHAR(50) DEFAULT 'queued',
ADD COLUMN phase_progress INTEGER DEFAULT 0,
ADD COLUMN phase_metadata JSONB DEFAULT '{}',
ADD COLUMN phase_updated_at TIMESTAMP DEFAULT NOW();

-- Create index for finding stuck deployments
CREATE INDEX idx_deployments_stuck ON deployments(status, phase_updated_at)
WHERE status IN ('queued', 'building');
```

**TypeScript Schema Update:**
```typescript
// apps/api/src/config/drizzle/schema/deployment.ts

export enum DeploymentPhase {
  QUEUED = 'queued',
  PULLING_SOURCE = 'pulling_source',
  BUILDING = 'building',
  COPYING_FILES = 'copying_files',
  CREATING_SYMLINKS = 'creating_symlinks',
  UPDATING_ROUTES = 'updating_routes',
  HEALTH_CHECK = 'health_check',
  ACTIVE = 'active',
  FAILED = 'failed',
}

export const deployments = pgTable('deployments', {
  // ... existing columns
  phase: text('phase').default(DeploymentPhase.QUEUED),
  phaseProgress: integer('phase_progress').default(0),
  phaseMetadata: jsonb('phase_metadata').default({}),
  phaseUpdatedAt: timestamp('phase_updated_at').defaultNow(),
});
```

**Service Update:**
```typescript
// apps/api/src/core/services/deployment.service.ts

async updateDeploymentPhase(
  deploymentId: string,
  phase: DeploymentPhase,
  progress: number = 0,
  metadata: Record<string, any> = {}
) {
  await this.db.update(deployments)
    .set({
      phase,
      phaseProgress: progress,
      phaseMetadata: metadata,
      phaseUpdatedAt: new Date(),
    })
    .where(eq(deployments.id, deploymentId));
  
  this.logger.log(`Deployment ${deploymentId}: ${phase} (${progress}%)`);
}

// Usage in deployment flow
async deployStaticFiles(deploymentId: string) {
  try {
    await this.updateDeploymentPhase(deploymentId, DeploymentPhase.PULLING_SOURCE);
    const sourceFiles = await this.pullSource();
    
    await this.updateDeploymentPhase(deploymentId, DeploymentPhase.BUILDING, 25);
    const builtFiles = await this.buildFiles(sourceFiles);
    
    await this.updateDeploymentPhase(deploymentId, DeploymentPhase.COPYING_FILES, 50);
    await this.copyFilesToVolume(builtFiles);
    
    await this.updateDeploymentPhase(deploymentId, DeploymentPhase.CREATING_SYMLINKS, 75);
    await this.createSymlinks();
    
    await this.updateDeploymentPhase(deploymentId, DeploymentPhase.UPDATING_ROUTES, 90);
    await this.updateTraefikRoutes();
    
    await this.updateDeploymentPhase(deploymentId, DeploymentPhase.HEALTH_CHECK, 95);
    await this.verifyDeployment();
    
    await this.updateDeploymentPhase(deploymentId, DeploymentPhase.ACTIVE, 100);
  } catch (error) {
    await this.updateDeploymentPhase(deploymentId, DeploymentPhase.FAILED, 0, {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}
```

### Step 1.2: Add Container Health Checks

**Goal**: Ensure containers are healthy and restart them if not.

**Update Container Creation:**
```typescript
// apps/api/src/core/services/project-server.service.ts

async createProjectContainer(project: Project) {
  const container = await docker.createContainer({
    name: `project-http-${project.id}`,
    Image: this.getImageForServiceType(project.serviceType),
    Labels: {
      'deployer.project_server': project.id,
      'deployer.project_name': project.name,
      'deployer.service_type': project.serviceType,
      'traefik.enable': 'true',
      // ... other Traefik labels
    },
    HostConfig: {
      RestartPolicy: {
        Name: 'unless-stopped',
        MaximumRetryCount: 3,
      },
      Binds: [
        `${volumeName}:/srv/static`,
      ],
    },
    Healthcheck: {
      Test: this.getHealthCheckCommand(project.serviceType),
      Interval: 30 * 1000000000, // 30s in nanoseconds
      Timeout: 10 * 1000000000,  // 10s
      Retries: 3,
      StartPeriod: 60 * 1000000000, // 60s grace period
    },
  });
  
  return container;
}

private getHealthCheckCommand(serviceType: string): string[] {
  switch (serviceType) {
    case 'static-file':
      return ['CMD', 'wget', '--quiet', '--tries=1', '--spider', 'http://localhost:80/'];
    case 'docker':
      // Custom health check based on application
      return ['CMD-SHELL', 'curl -f http://localhost:3000/health || exit 1'];
    default:
      return ['CMD', 'true']; // Always healthy for unknown types
  }
}
```

### Step 1.3: Create Health Monitoring Service

**Goal**: Actively monitor container health and restart unhealthy containers.

**Create Service:**
```typescript
// apps/api/src/core/services/health-monitor.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DockerService } from './docker.service';
import { DatabaseService } from '../modules/database/services/database.service';
import { projects } from '../modules/database/drizzle/schema/deployment';
import { eq } from 'drizzle-orm';

interface ContainerHealthStatus {
  containerId: string;
  projectId: string;
  projectName: string;
  healthy: boolean;
  status: string;
  healthStatus?: string;
  restartCount: number;
}

@Injectable()
export class HealthMonitorService {
  private readonly logger = new Logger(HealthMonitorService.name);
  private readonly restartCounts = new Map<string, number>();

  constructor(
    private readonly dockerService: DockerService,
    private readonly databaseService: DatabaseService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async checkContainerHealth() {
    const docker = this.dockerService.getDockerClient();
    
    try {
      // Get all project containers
      const containers = await docker.listContainers({
        all: true,
        filters: {
          label: ['deployer.project_server'],
        },
      });

      for (const containerInfo of containers) {
        const projectId = containerInfo.Labels['deployer.project_server'];
        const projectName = containerInfo.Labels['deployer.project_name'];

        try {
          const container = docker.getContainer(containerInfo.Id);
          const inspect = await container.inspect();

          const status: ContainerHealthStatus = {
            containerId: containerInfo.Id,
            projectId,
            projectName,
            healthy: true,
            status: inspect.State.Status,
            healthStatus: inspect.State.Health?.Status,
            restartCount: inspect.RestartCount,
          };

          // Check if container is running
          if (inspect.State.Status !== 'running') {
            status.healthy = false;
            this.logger.warn(
              `Container ${projectName} (${containerInfo.Id.substring(0, 12)}) is ${inspect.State.Status}`
            );
            await this.handleUnhealthyContainer(container, status);
            continue;
          }

          // Check health check status
          if (inspect.State.Health?.Status === 'unhealthy') {
            status.healthy = false;
            this.logger.error(
              `Container ${projectName} (${containerInfo.Id.substring(0, 12)}) failed health check`
            );
            await this.handleUnhealthyContainer(container, status);
            continue;
          }

          // Check restart count (if restarting too often, mark project as unhealthy)
          const previousRestartCount = this.restartCounts.get(containerInfo.Id) || 0;
          if (inspect.RestartCount > previousRestartCount) {
            this.logger.warn(
              `Container ${projectName} restarted ${inspect.RestartCount} times (was ${previousRestartCount})`
            );
            this.restartCounts.set(containerInfo.Id, inspect.RestartCount);

            // If restarted more than 5 times in its lifetime, investigate
            if (inspect.RestartCount > 5) {
              await this.handleFrequentRestarts(container, status);
            }
          }

        } catch (error) {
          this.logger.error(
            `Failed to check health for container ${containerInfo.Id}:`,
            error
          );
        }
      }
    } catch (error) {
      this.logger.error('Failed to check container health:', error);
    }
  }

  private async handleUnhealthyContainer(
    container: any,
    status: ContainerHealthStatus
  ) {
    try {
      // First, try to restart the container
      this.logger.log(`Attempting to restart container ${status.projectName}`);
      
      if (status.status === 'exited' || status.status === 'dead') {
        await container.start();
        this.logger.log(`Successfully started container ${status.projectName}`);
      } else if (status.healthStatus === 'unhealthy') {
        await container.restart();
        this.logger.log(`Successfully restarted container ${status.projectName}`);
      }

      // Mark project as degraded in database (for UI indication)
      await this.databaseService.db
        .update(projects)
        .set({
          metadata: {
            lastHealthIssue: new Date().toISOString(),
            healthStatus: 'degraded',
          },
        })
        .where(eq(projects.id, status.projectId));

    } catch (error) {
      this.logger.error(
        `Failed to restart container ${status.projectName}:`,
        error
      );

      // Mark project as unhealthy
      await this.databaseService.db
        .update(projects)
        .set({
          metadata: {
            lastHealthIssue: new Date().toISOString(),
            healthStatus: 'unhealthy',
            healthError: error.message,
          },
        })
        .where(eq(projects.id, status.projectId));
    }
  }

  private async handleFrequentRestarts(
    container: any,
    status: ContainerHealthStatus
  ) {
    this.logger.error(
      `Container ${status.projectName} has restarted ${status.restartCount} times - may indicate a problem`
    );

    // Get container logs to help diagnose
    const logs = await container.logs({
      stdout: true,
      stderr: true,
      tail: 100,
    });

    this.logger.error(`Recent logs for ${status.projectName}:`, logs.toString());

    // Update project metadata with restart warning
    await this.databaseService.db
      .update(projects)
      .set({
        metadata: {
          restartWarning: true,
          restartCount: status.restartCount,
          lastRestartCheck: new Date().toISOString(),
        },
      })
      .where(eq(projects.id, status.projectId));
  }

  /**
   * Get health statistics for monitoring
   */
  async getHealthStats(): Promise<{
    total: number;
    healthy: number;
    unhealthy: number;
    stopped: number;
  }> {
    const docker = this.dockerService.getDockerClient();
    const containers = await docker.listContainers({
      all: true,
      filters: {
        label: ['deployer.project_server'],
      },
    });

    let healthy = 0;
    let unhealthy = 0;
    let stopped = 0;

    for (const containerInfo of containers) {
      const container = docker.getContainer(containerInfo.Id);
      const inspect = await container.inspect();

      if (inspect.State.Status !== 'running') {
        stopped++;
      } else if (inspect.State.Health?.Status === 'unhealthy') {
        unhealthy++;
      } else {
        healthy++;
      }
    }

    return {
      total: containers.length,
      healthy,
      unhealthy,
      stopped,
    };
  }
}
```

**Register Service:**
```typescript
// apps/api/src/core/core.module.ts

import { HealthMonitorService } from './services/health-monitor.service';

@Module({
  imports: [TraefikModule],
  providers: [
    // ... existing providers
    HealthMonitorService,
  ],
  exports: [
    // ... existing exports
    HealthMonitorService,
  ],
})
export class CoreModule {}
```

---

## Phase 2: Crash Recovery

### Step 2.1: Resume Incomplete Deployments

**Goal**: Find and resume deployments that were interrupted by crashes.

**Add to ZombieCleanupService:**
```typescript
// apps/api/src/core/services/zombie-cleanup.service.ts

async onModuleInit() {
  this.logger.log('Running initial reconciliation on startup...');
  
  try {
    // First, resume any incomplete deployments
    await this.resumeIncompleteDeployments();
    
    // Then run normal cleanup
    await this.autoCleanup();
    
    this.logger.log('Initial reconciliation completed');
  } catch (error) {
    this.logger.error('Failed to run initial reconciliation:', error);
  }
}

/**
 * Find and resume deployments that were interrupted by crashes
 */
async resumeIncompleteDeployments() {
  this.logger.log('Checking for incomplete deployments...');
  
  const STUCK_THRESHOLD = 5 * 60 * 1000; // 5 minutes
  const stuckTime = new Date(Date.now() - STUCK_THRESHOLD);

  // Find deployments stuck in progress
  const incompleteDeployments = await this.databaseService.db
    .select()
    .from(deployments)
    .where(
      and(
        inArray(deployments.status, ['queued', 'building']),
        lt(deployments.phaseUpdatedAt, stuckTime)
      )
    );

  if (incompleteDeployments.length === 0) {
    this.logger.log('No incomplete deployments found');
    return;
  }

  this.logger.warn(
    `Found ${incompleteDeployments.length} incomplete deployments`
  );

  for (const deployment of incompleteDeployments) {
    await this.handleIncompleteDeployment(deployment);
  }
}

private async handleIncompleteDeployment(deployment: any) {
  this.logger.warn(
    `Deployment ${deployment.id} stuck in phase ${deployment.phase} ` +
    `for ${Math.floor((Date.now() - deployment.phaseUpdatedAt.getTime()) / 60000)} minutes`
  );

  try {
    const canResume = await this.canResumeDeployment(deployment);

    if (canResume) {
      this.logger.log(`Attempting to resume deployment ${deployment.id}`);
      await this.resumeDeployment(deployment);
    } else {
      this.logger.warn(
        `Cannot resume deployment ${deployment.id}, marking as failed`
      );
      await this.markDeploymentFailed(
        deployment.id,
        'Deployment stuck and cannot be resumed'
      );
    }
  } catch (error) {
    this.logger.error(
      `Failed to handle incomplete deployment ${deployment.id}:`,
      error
    );
  }
}

private async canResumeDeployment(deployment: any): Promise<boolean> {
  // Check if deployment files exist
  const filesExist = await this.checkDeploymentFiles(deployment);
  
  // Can resume from certain phases
  const resumablePhases = [
    DeploymentPhase.COPYING_FILES,
    DeploymentPhase.CREATING_SYMLINKS,
    DeploymentPhase.UPDATING_ROUTES,
  ];

  return resumablePhases.includes(deployment.phase) || filesExist;
}

private async resumeDeployment(deployment: any) {
  // Delegate to deployment service to resume from current phase
  await this.deploymentService.resumeFromPhase(deployment);
}

private async markDeploymentFailed(deploymentId: string, reason: string) {
  await this.databaseService.db
    .update(deployments)
    .set({
      status: 'failed',
      phase: DeploymentPhase.FAILED,
      phaseMetadata: { error: reason },
      updatedAt: new Date(),
    })
    .where(eq(deployments.id, deploymentId));
}

private async checkDeploymentFiles(deployment: any): Promise<boolean> {
  try {
    const volumeName = `project-${deployment.projectId}-static`;
    const deploymentPath = `/srv/static/${deployment.serviceName}/deployment-${deployment.id}`;
    
    const fileCount = await this.dockerService.countFilesInVolume(
      volumeName,
      deploymentPath
    );
    
    return fileCount > 0;
  } catch (error) {
    return false;
  }
}
```

### Step 2.2: Symlink Self-Healing

**Goal**: Detect and fix broken symlinks automatically.

**Add to ZombieCleanupService:**
```typescript
/**
 * Reconcile symlinks for all active projects
 */
async reconcileSymlinks() {
  this.logger.log('Reconciling symlinks...');

  const activeProjects = await this.databaseService.db
    .select()
    .from(projects)
    .where(eq(projects.status, 'active'));

  for (const project of activeProjects) {
    try {
      await this.reconcileProjectSymlinks(project);
    } catch (error) {
      this.logger.error(
        `Failed to reconcile symlinks for project ${project.name}:`,
        error
      );
    }
  }
}

private async reconcileProjectSymlinks(project: any) {
  // Get latest successful deployment
  const latestDeployment = await this.databaseService.db
    .select()
    .from(deployments)
    .where(
      and(
        eq(deployments.projectId, project.id),
        eq(deployments.status, 'active')
      )
    )
    .orderBy(desc(deployments.createdAt))
    .limit(1);

  if (latestDeployment.length === 0) {
    this.logger.warn(`No active deployment for project ${project.name}`);
    return;
  }

  const deployment = latestDeployment[0];
  const volumeName = `project-${project.id}-static`;

  // Verify and fix symlinks
  await this.dockerService.runCommandInVolume(
    volumeName,
    `/srv/static/${project.name}`,
    `
      # Check if current symlink exists
      if [ ! -L current ]; then
        echo "Creating missing 'current' symlink"
        ln -sf deployment-${deployment.id} current
      fi
      
      # Check if current points to correct deployment
      CURRENT_TARGET=$(readlink current)
      if [ "$CURRENT_TARGET" != "deployment-${deployment.id}" ]; then
        echo "Fixing 'current' symlink: $CURRENT_TARGET -> deployment-${deployment.id}"
        ln -sf deployment-${deployment.id} current
      fi
      
      # Verify deployment directory exists
      if [ ! -d "deployment-${deployment.id}" ]; then
        echo "ERROR: Deployment directory missing!"
        exit 1
      fi
      
      echo "Symlinks OK"
    `
  );

  this.logger.log(`Symlinks verified for project ${project.name}`);
}
```

---

## Phase 3: Multi-Server Coordination

### Step 3.1: PostgreSQL Advisory Lock Leader Election

**Goal**: Ensure only one server runs reconciliation at a time.

**Create Leader Election Service:**
```typescript
// apps/api/src/core/services/leader-election.service.ts

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { DatabaseService } from '../modules/database/services/database.service';

@Injectable()
export class LeaderElectionService implements OnModuleDestroy {
  private readonly logger = new Logger(LeaderElectionService.name);
  private isLeader = false;
  private readonly lockKey = 987654321; // Unique number for this app
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Try to become the leader by acquiring advisory lock
   */
  async tryAcquireLeadership(): Promise<boolean> {
    try {
      const result = await this.databaseService.db.execute(
        `SELECT pg_try_advisory_lock(${this.lockKey}) as acquired`
      );

      const acquired = result.rows[0]?.acquired || false;
      
      if (acquired && !this.isLeader) {
        this.isLeader = true;
        this.logger.log('✓ Acquired leadership - this server will handle reconciliation');
        this.startHeartbeat();
      } else if (!acquired && this.isLeader) {
        this.isLeader = false;
        this.logger.warn('✗ Lost leadership - another server is now leader');
        this.stopHeartbeat();
      }

      return this.isLeader;
    } catch (error) {
      this.logger.error('Failed to acquire leadership:', error);
      this.isLeader = false;
      return false;
    }
  }

  /**
   * Release leadership gracefully
   */
  async releaseLeadership(): Promise<void> {
    if (this.isLeader) {
      try {
        await this.databaseService.db.execute(
          `SELECT pg_advisory_unlock(${this.lockKey})`
        );
        this.isLeader = false;
        this.stopHeartbeat();
        this.logger.log('Released leadership');
      } catch (error) {
        this.logger.error('Failed to release leadership:', error);
      }
    }
  }

  /**
   * Check if current server is the leader
   */
  isCurrentLeader(): boolean {
    return this.isLeader;
  }

  /**
   * Start heartbeat to maintain leadership
   */
  private startHeartbeat() {
    if (this.heartbeatInterval) {
      return; // Already started
    }

    // Heartbeat every 30 seconds to verify we still have the lock
    this.heartbeatInterval = setInterval(async () => {
      try {
        // Check if we still have the lock
        const result = await this.databaseService.db.execute(
          `SELECT locktype, objid FROM pg_locks 
           WHERE locktype = 'advisory' 
           AND objid = ${this.lockKey} 
           AND pid = pg_backend_pid()`
        );

        if (result.rows.length === 0) {
          this.logger.warn('Lost advisory lock, no longer leader');
          this.isLeader = false;
          this.stopHeartbeat();
        }
      } catch (error) {
        this.logger.error('Heartbeat check failed:', error);
      }
    }, 30000); // 30 seconds
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Clean up on module destroy
   */
  async onModuleDestroy() {
    await this.releaseLeadership();
  }
}
```

**Update ZombieCleanupService to Use Leader Election:**
```typescript
// apps/api/src/core/services/zombie-cleanup.service.ts

constructor(
  private readonly dockerService: DockerService,
  private readonly databaseService: DatabaseService,
  private readonly leaderElection: LeaderElectionService, // Add this
) {}

@Cron(CronExpression.EVERY_MINUTE)
async autoCleanup() {
  // Only leader runs reconciliation
  const isLeader = await this.leaderElection.tryAcquireLeadership();
  
  if (!isLeader) {
    this.logger.debug('Not leader, skipping reconciliation');
    return;
  }

  this.logger.log('Running automatic reconciliation (as leader)');
  
  try {
    // Step 1: Reconcile containers
    const reconcileResult = await this.reconcileAllContainers({ dryRun: false });
    this.logger.log(
      `Reconciliation: ${reconcileResult.restarted} restarted, ` +
      `${reconcileResult.skipped} skipped`
    );

    // Step 2: Reconcile symlinks
    await this.reconcileSymlinks();

    // Step 3: Clean up zombies
    const cleanupResult = await this.cleanupZombieContainers();
    this.logger.log(
      `Cleanup: ${cleanupResult.removed} removed, ${cleanupResult.errors} errors`
    );

    // Step 4: Clean up helpers
    const helperResult = await this.cleanupZombieHelpers();
    this.logger.log(`Helper cleanup: ${helperResult.removed} removed`);
    
  } catch (error) {
    this.logger.error('Reconciliation failed:', error);
  } finally {
    // Release leadership after reconciliation
    await this.leaderElection.releaseLeadership();
  }
}
```

**Register Leader Election Service:**
```typescript
// apps/api/src/core/core.module.ts

import { LeaderElectionService } from './services/leader-election.service';

@Module({
  imports: [TraefikModule],
  providers: [
    // ... existing providers
    LeaderElectionService,
  ],
  exports: [
    // ... existing exports
    LeaderElectionService,
  ],
})
export class CoreModule {}
```

---

## Phase 4: Testing & Validation

### Test 1: Crash Recovery

```bash
# Start a deployment
curl -X POST http://localhost:3001/api/deployments \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "test-project",
    "source": "git://..."
  }'

# While deployment is running, kill the API server
docker kill deployer-api-dev

# Restart API server
docker start deployer-api-dev

# Check logs - should see:
# "Found 1 incomplete deployments"
# "Attempting to resume deployment..."
```

### Test 2: Container Health Recovery

```bash
# Stop a project container manually
docker stop project-http-{projectId}

# Wait 30 seconds (health check interval)

# Check logs - should see:
# "Container {project} is exited"
# "Attempting to restart container..."
# "Successfully started container..."
```

### Test 3: Multi-Server Coordination

```bash
# Start 2 API servers
docker-compose up --scale api=2

# Check logs from both servers
# Only one should say: "✓ Acquired leadership"
# The other should say: "✗ Not leader, skipping reconciliation"

# Kill the leader server
docker kill deployer-api-1

# Wait 1 minute (next reconciliation cron)

# Check logs from remaining server
# Should say: "✓ Acquired leadership - this server will handle reconciliation"
```

### Test 4: Symlink Self-Healing

```bash
# Break symlinks manually
docker exec project-http-{projectId} rm /srv/static/{service}/current

# Wait 1 minute (reconciliation cron)

# Check logs - should see:
# "Creating missing 'current' symlink"
# "Symlinks verified for project {name}"

# Verify symlink restored
docker exec project-http-{projectId} ls -la /srv/static/{service}/
```

---

## Monitoring Dashboard

Create API endpoints for monitoring:

```typescript
// apps/api/src/core/controllers/monitoring.controller.ts

@Controller('api/monitoring')
export class MonitoringController {
  constructor(
    private readonly healthMonitor: HealthMonitorService,
    private readonly zombieCleanup: ZombieCleanupService,
    private readonly leaderElection: LeaderElectionService,
  ) {}

  @Get('health')
  async getHealthStatus() {
    const stats = await this.healthMonitor.getHealthStats();
    const zombieStats = await this.zombieCleanup.getZombieStats();
    
    return {
      containers: stats,
      zombies: zombieStats,
      isLeader: this.leaderElection.isCurrentLeader(),
      timestamp: new Date().toISOString(),
    };
  }

  @Post('reconcile/trigger')
  async triggerReconciliation() {
    if (!this.leaderElection.isCurrentLeader()) {
      throw new Error('Only leader can trigger reconciliation');
    }
    
    await this.zombieCleanup.autoCleanup();
    
    return { success: true, message: 'Reconciliation triggered' };
  }
}
```

---

## Summary

After implementing all phases, you'll have:

✅ **Phase 1**: Enhanced reconciliation with health checks
✅ **Phase 2**: Automatic crash recovery and symlink healing  
✅ **Phase 3**: Multi-server coordination via leader election
✅ **Phase 4**: Comprehensive testing and monitoring

Your deployment system will be **production-ready** with:
- Automatic recovery from crashes
- Self-healing containers and symlinks
- Multi-server high availability
- Complete observability and monitoring

This matches the reliability of professional platforms like Kubernetes, Heroku, and Vercel! 🚀
