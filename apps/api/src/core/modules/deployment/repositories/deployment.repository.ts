import { Injectable } from '@nestjs/common';
import { eq, desc, and, count, lt, ne, inArray, SQL } from 'drizzle-orm';
import { DatabaseService } from '@/core/modules/database/services/database.service';
import { deployments, deploymentLogs, deploymentRollbacks, services, projects, type deploymentStatusEnum, type logLevelEnum, type rollbackStatusEnum } from '@/config/drizzle/schema';

/**
 * DeploymentRepository
 * 
 * PURPOSE: Handle ALL database operations for deployments
 * LOCATION: Core module repository
 * 
 * PATTERN: Service-Repository Pattern
 * - ONLY layer that injects DatabaseService
 * - Contains ONLY database queries (no business logic)
 * - Returns raw database entities
 * - Uses Drizzle ORM type inference
 * 
 * USED BY: 
 * - DeploymentService (core)
 * - DeploymentHealthMonitorService (core)
 * - DeploymentCleanupService (core)
 * - ZombieCleanupService (core)
 * - DeploymentOrchestratorService (core)
 */

// Type aliases for type safety
type Deployment = typeof deployments.$inferSelect;
type DeploymentInsert = typeof deployments.$inferInsert;
type DeploymentLog = typeof deploymentLogs.$inferSelect;
type DeploymentLogInsert = typeof deploymentLogs.$inferInsert;
type DeploymentRollback = typeof deploymentRollbacks.$inferSelect;
type DeploymentStatus = typeof deploymentStatusEnum.enumValues[number];
type LogLevel = typeof logLevelEnum.enumValues[number];
type RollbackStatus = typeof rollbackStatusEnum.enumValues[number];

export interface DeploymentWithRelations extends Deployment {
  service?: typeof services.$inferSelect;
  project?: typeof projects.$inferSelect;
}

export interface DeploymentListFilters {
  serviceId?: string;
  projectId?: string;
  status?: DeploymentStatus | DeploymentStatus[];
  environment?: string;
  limit?: number;
  offset?: number;
}

export interface DeploymentStats {
  total: number;
  successful: number;
  failed: number;
  building: number;
  queued: number;
}

@Injectable()
export class DeploymentRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Find deployment by ID
   */
  async findById(id: string): Promise<Deployment | null> {
    const [deployment] = await this.databaseService.db
      .select()
      .from(deployments)
      .where(eq(deployments.id, id))
      .limit(1);
    
    return deployment || null;
  }

  /**
   * Find deployment with service and project relations
   */
  async findByIdWithRelations(id: string): Promise<DeploymentWithRelations | null> {
    const [result] = await this.databaseService.db
      .select({
        deployment: deployments,
        service: services,
        project: projects,
      })
      .from(deployments)
      .leftJoin(services, eq(deployments.serviceId, services.id))
      .leftJoin(projects, eq(services.projectId, projects.id))
      .where(eq(deployments.id, id))
      .limit(1);

    if (!result) return null;

    return {
      ...result.deployment,
      service: result.service || undefined,
      project: result.project || undefined,
    };
  }

  /**
   * Find all active deployments (not completed/failed/cancelled)
   */
  async findActiveDeployments(): Promise<Deployment[]> {
    return this.databaseService.db
      .select()
      .from(deployments)
      .where(
        inArray(deployments.status, ['queued', 'building', 'deploying'])
      )
      .orderBy(desc(deployments.createdAt));
  }

  /**
   * Find incomplete deployments (for crash recovery)
   */
  async findIncompleteDeployments(): Promise<Deployment[]> {
    return this.databaseService.db
      .select()
      .from(deployments)
      .where(
        and(
          inArray(deployments.status, ['queued', 'building', 'deploying']),
          ne(deployments.phase, 'active')
        )
      )
      .orderBy(desc(deployments.createdAt));
  }

  /**
   * Find stuck deployments (older than threshold, still in progress)
   */
  async findStuckDeployments(thresholdMinutes: number = 30): Promise<Deployment[]> {
    const thresholdDate = new Date(Date.now() - thresholdMinutes * 60 * 1000);
    
    return this.databaseService.db
      .select()
      .from(deployments)
      .where(
        and(
          inArray(deployments.status, ['queued', 'building', 'deploying']),
          lt(deployments.createdAt, thresholdDate)
        )
      )
      .orderBy(deployments.createdAt);
  }

  /**
   * Find recent deployments for a service
   */
  async findRecentByServiceId(serviceId: string, limit: number = 10): Promise<Deployment[]> {
    return this.databaseService.db
      .select()
      .from(deployments)
      .where(eq(deployments.serviceId, serviceId))
      .orderBy(desc(deployments.createdAt))
      .limit(limit);
  }

  /**
   * Find last successful deployment for a service
   */
  async findLastSuccessful(serviceId: string): Promise<Deployment | null> {
    const [deployment] = await this.databaseService.db
      .select()
      .from(deployments)
      .where(
        and(
          eq(deployments.serviceId, serviceId),
          eq(deployments.status, 'success')
        )
      )
      .orderBy(desc(deployments.deployCompletedAt))
      .limit(1);
    
    return deployment || null;
  }

  /**
   * Find deployments with filters and pagination
   */
  async findMany(filters: DeploymentListFilters): Promise<{ deployments: Deployment[]; total: number }> {
    const conditions: SQL[] = [];
    
    if (filters.serviceId) {
      conditions.push(eq(deployments.serviceId, filters.serviceId));
    }
    
    if (filters.projectId) {
      // Need to join with services to filter by project
      // For now, we'll handle this in the service layer
      // TODO: Add project filter support
    }
    
    if (filters.status) {
      if (Array.isArray(filters.status)) {
        conditions.push(inArray(deployments.status, filters.status));
      } else {
        conditions.push(eq(deployments.status, filters.status));
      }
    }
    
    if (filters.environment) {
      conditions.push(eq(deployments.environment, filters.environment as any));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    
    // Get total count
    const [{ value: total }] = await this.databaseService.db
      .select({ value: count() })
      .from(deployments)
      .where(whereClause);

    // Get deployments
    const results = await this.databaseService.db
      .select()
      .from(deployments)
      .where(whereClause)
      .orderBy(desc(deployments.createdAt))
      .limit(filters.limit || 50)
      .offset(filters.offset || 0);

    return {
      deployments: results,
      total: total || 0,
    };
  }

  /**
   * Get deployment statistics for a service
   */
  async getServiceStats(serviceId: string): Promise<DeploymentStats> {
    const [totalCount, successCount, failedCount, buildingCount, queuedCount] = await Promise.all([
      this.databaseService.db
        .select({ count: count() })
        .from(deployments)
        .where(eq(deployments.serviceId, serviceId)),
      this.databaseService.db
        .select({ count: count() })
        .from(deployments)
        .where(and(eq(deployments.serviceId, serviceId), eq(deployments.status, 'success'))),
      this.databaseService.db
        .select({ count: count() })
        .from(deployments)
        .where(and(eq(deployments.serviceId, serviceId), eq(deployments.status, 'failed'))),
      this.databaseService.db
        .select({ count: count() })
        .from(deployments)
        .where(and(eq(deployments.serviceId, serviceId), eq(deployments.status, 'building'))),
      this.databaseService.db
        .select({ count: count() })
        .from(deployments)
        .where(and(eq(deployments.serviceId, serviceId), eq(deployments.status, 'queued'))),
    ]);

    return {
      total: totalCount[0]?.count || 0,
      successful: successCount[0]?.count || 0,
      failed: failedCount[0]?.count || 0,
      building: buildingCount[0]?.count || 0,
      queued: queuedCount[0]?.count || 0,
    };
  }

  /**
   * Create new deployment
   */
  async create(data: DeploymentInsert): Promise<Deployment> {
    const [deployment] = await this.databaseService.db
      .insert(deployments)
      .values(data)
      .returning();
    
    return deployment;
  }

  /**
   * Update deployment status and metadata
   */
  async updateStatus(
    id: string,
    status: DeploymentStatus,
    metadata?: Partial<Deployment>
  ): Promise<Deployment | null> {
    const updateData: Partial<Deployment> = {
      status,
      updatedAt: new Date(),
      ...metadata,
    };

    const [updated] = await this.databaseService.db
      .update(deployments)
      .set(updateData)
      .where(eq(deployments.id, id))
      .returning();
    
    return updated || null;
  }

  /**
   * Mark deployment as failed with error message
   */
  async markFailed(id: string, errorMessage: string): Promise<Deployment | null> {
    const [updated] = await this.databaseService.db
      .update(deployments)
      .set({
        status: 'failed',
        errorMessage,
        deployCompletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(deployments.id, id))
      .returning();
    
    return updated || null;
  }

  /**
   * Update deployment container information
   */
  async updateContainer(
    id: string,
    containerName: string,
    containerImage: string
  ): Promise<void> {
    await this.databaseService.db
      .update(deployments)
      .set({
        containerName,
        containerImage,
        updatedAt: new Date(),
      })
      .where(eq(deployments.id, id));
  }

  /**
   * Update deployment phase (for crash recovery)
   */
  async updatePhase(
    id: string,
    phase: string,
    phaseProgress?: number,
    phaseMetadata?: Record<string, any>
  ): Promise<Deployment | null> {
    const updateData: any = {
      phase,
      phaseUpdatedAt: new Date(),
      updatedAt: new Date(),
    };

    if (phaseProgress !== undefined) {
      updateData.phaseProgress = phaseProgress;
    }

    if (phaseMetadata) {
      updateData.phaseMetadata = phaseMetadata;
    }

    const [updated] = await this.databaseService.db
      .update(deployments)
      .set(updateData)
      .where(eq(deployments.id, id))
      .returning();
    
    return updated || null;
  }

  /**
   * Delete deployment
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.databaseService.db
      .delete(deployments)
      .where(eq(deployments.id, id));
    
    return result.rowCount > 0;
  }

  /**
   * Delete multiple deployments by IDs
   */
  async deleteMany(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    
    const result = await this.databaseService.db
      .delete(deployments)
      .where(inArray(deployments.id, ids));
    
    return result.rowCount || 0;
  }

  // ==========================================
  // DEPLOYMENT LOGS
  // ==========================================

  /**
   * Add deployment log
   */
  async addLog(deploymentId: string, log: Omit<DeploymentLogInsert, 'deploymentId'>): Promise<DeploymentLog> {
    const [logEntry] = await this.databaseService.db
      .insert(deploymentLogs)
      .values({
        ...log,
        deploymentId,
      })
      .returning();
    
    return logEntry;
  }

  /**
   * Get deployment logs with pagination
   */
  async getLogs(
    deploymentId: string,
    options?: { limit?: number; offset?: number; level?: LogLevel }
  ): Promise<{ logs: DeploymentLog[]; total: number }> {
    const conditions = [eq(deploymentLogs.deploymentId, deploymentId)];
    
    if (options?.level) {
      conditions.push(eq(deploymentLogs.level, options.level));
    }

    const whereClause = and(...conditions);

    // Get total count
    const [{ value: total }] = await this.databaseService.db
      .select({ value: count() })
      .from(deploymentLogs)
      .where(whereClause);

    // Get logs
    const logs = await this.databaseService.db
      .select()
      .from(deploymentLogs)
      .where(whereClause)
      .orderBy(desc(deploymentLogs.timestamp))
      .limit(options?.limit || 100)
      .offset(options?.offset || 0);

    return {
      logs,
      total: total || 0,
    };
  }

  /**
   * Get recent logs for deployment
   */
  async getRecentLogs(deploymentId: string, limit: number = 10): Promise<DeploymentLog[]> {
    return this.databaseService.db
      .select()
      .from(deploymentLogs)
      .where(eq(deploymentLogs.deploymentId, deploymentId))
      .orderBy(desc(deploymentLogs.timestamp))
      .limit(limit);
  }

  /**
   * Delete logs for deployment
   */
  async deleteLogs(deploymentId: string): Promise<number> {
    const result = await this.databaseService.db
      .delete(deploymentLogs)
      .where(eq(deploymentLogs.deploymentId, deploymentId));
    
    return result.rowCount || 0;
  }

  /**
   * Find active rollback for deployment
   * 
   * @param deploymentId - Deployment ID to check for active rollback
   * @param status - Rollback status to filter by (defaults to 'in_progress')
   * @returns Active rollback if exists, null otherwise
   */
  async findActiveRollback(deploymentId: string, status: RollbackStatus = 'in_progress'): Promise<DeploymentRollback | null> {
    const [rollback] = await this.databaseService.db
      .select()
      .from(deploymentRollbacks)
      .where(
        and(
          eq(deploymentRollbacks.fromDeploymentId, deploymentId),
          eq(deploymentRollbacks.status, status)
        )
      )
      .limit(1);

    return rollback || null;
  }
}
