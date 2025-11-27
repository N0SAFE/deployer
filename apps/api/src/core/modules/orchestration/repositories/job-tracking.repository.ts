import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@/core/modules/database/services/database.service';
import { jobTracking } from '@/config/drizzle/schema/orchestration';
import { eq, desc, count, and, gte, lte, sql, SQL } from 'drizzle-orm';

@Injectable()
export class JobTrackingRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async findById(jobId: string) {
    const [result] = await this.databaseService.db
      .select()
      .from(jobTracking)
      .where(eq(jobTracking.id, jobId));
    return result || null;
  }

  async findByDeploymentId(deploymentId: string, pagination: { limit: number; offset: number }) {
    // Note: jobTracking schema doesn't have deploymentId field
    // Return empty result for now
    return {
      jobs: [],
      total: 0,
    };
  }

  async findJobHistory(filters: {
    deploymentId?: string;
    stackId?: string;
    status?: string;
    fromDate?: Date;
    toDate?: Date;
    limit: number;
    offset: number;
  }) {
    const whereConditions: SQL[] = [];
    
    // Note: deploymentId field doesn't exist in jobTracking schema
    if (filters.stackId) {
      whereConditions.push(eq(jobTracking.stackId, filters.stackId));
    }
    if (filters.status) {
      whereConditions.push(eq(jobTracking.status, filters.status as any));
    }
    if (filters.fromDate) {
      whereConditions.push(gte(jobTracking.createdAt, filters.fromDate));
    }
    if (filters.toDate) {
      whereConditions.push(lte(jobTracking.createdAt, filters.toDate));
    }

    const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;

    const totalResult = await this.databaseService.db
      .select({ count: sql<number>`count(*)` })
      .from(jobTracking)
      .where(whereClause);

    const jobs = await this.databaseService.db
      .select()
      .from(jobTracking)
      .where(whereClause)
      .orderBy(desc(jobTracking.createdAt))
      .limit(filters.limit)
      .offset(filters.offset);

    return {
      jobs,
      total: Number(totalResult[0]?.count || 0),
    };
  }

  async upsertJobTracking(jobData: {
    id: string;
    deploymentId?: string; // Not in schema, ignored
    stackId: string;
    jobType: string;
    status: string;
    progress: number;
    startedAt: Date;
    completedAt?: Date | null;
    failedAt?: Date | null;
    duration?: number | null;
    logs?: string | null;
    error?: string | null;
    metadata?: any;
  }) {
    // Map jobData to schema fields
    const { deploymentId, jobType, logs, ...rest } = jobData;
    const schemaData = {
      ...rest,
      status: rest.status as any, // Type assertion for enum
      type: jobType as any, // Rename jobType to type
      logs: logs ? [logs] : [], // Convert string to array
      createdAt: new Date(), // Required field
    };
    
    return this.databaseService.db
      .insert(jobTracking)
      .values(schemaData)
      .onConflictDoUpdate({
        target: jobTracking.id,
        set: {
          status: schemaData.status as any,
          progress: schemaData.progress,
          completedAt: schemaData.completedAt,
          failedAt: schemaData.failedAt,
          duration: schemaData.duration,
          logs: schemaData.logs as any,
          error: schemaData.error,
          metadata: schemaData.metadata,
          updatedAt: new Date(),
        },
      });
  }

  async deleteOldJobs(cutoffDate: Date) {
    return this.databaseService.db
      .delete(jobTracking)
      .where(lte(jobTracking.createdAt, cutoffDate));
  }

  async findJobsByStackId(stackId: string, limit: number) {
    return this.databaseService.db
      .select()
      .from(jobTracking)
      .where(eq(jobTracking.stackId, stackId))
      .orderBy(desc(jobTracking.createdAt))
      .limit(limit);
  }

  async updateJobStatus(jobId: string, status: string, completedAt: Date) {
    return this.databaseService.db
      .update(jobTracking)
      .set({ status: status as any, completedAt, updatedAt: new Date() })
      .where(eq(jobTracking.id, jobId));
  }

  async updateJobProgress(jobId: string, data: {
    currentStep?: string;
    progress?: number;
    logs?: string;
  }) {
    const updateData: any = {
      currentStep: data.currentStep,
      progress: data.progress,
      logs: data.logs ? [data.logs] : undefined,
      updatedAt: new Date(),
    };
    
    return this.databaseService.db
      .update(jobTracking)
      .set(updateData)
      .where(eq(jobTracking.id, jobId));
  }

  async findByStatus(status: string) {
    return this.databaseService.db
      .select()
      .from(jobTracking)
      .where(eq(jobTracking.status, status as any));
  }
}
