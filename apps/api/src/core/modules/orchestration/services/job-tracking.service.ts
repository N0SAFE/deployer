import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue, Job, JobStatus } from 'bull';
import { Cron } from '@nestjs/schedule';
import { DATABASE_CONNECTION } from '../../db/database-connection';
import type { Database } from '../../db/drizzle/index';
import { jobTracking } from '../../db/drizzle/schema/orchestration';
import { eq, desc, and, gte, lte, inArray } from 'drizzle-orm';
export interface JobTrackingInfo {
    id: string;
    type: string;
    status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'paused';
    data: any;
    progress: number;
    createdAt: Date;
    startedAt?: Date;
    completedAt?: Date;
    failedAt?: Date;
    duration?: number;
    stackId?: string;
    serviceId?: string;
    logs: string[];
    error?: string;
    metadata: Record<string, any>;
}
export interface JobStatusSummary {
    total: number;
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: number;
}
export interface JobHistoryQuery {
    status?: string[];
    type?: string[];
    stackId?: string;
    serviceId?: string;
    fromDate?: Date;
    toDate?: Date;
    limit?: number;
    offset?: number;
}
@Injectable()
export class JobTrackingService {
    private readonly logger = new Logger(JobTrackingService.name);
    private readonly JOB_RETENTION_DAYS = 30;
    private readonly MAX_LOGS_PER_JOB = 1000;
    constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: Database, 
    @InjectQueue('deployment-queue')
    private readonly deploymentQueue: Queue) { }
    /**
     * Get real-time job statistics from Bull queue
     */
    async getJobStatusSummary(): Promise<JobStatusSummary> {
        try {
            const counts = await this.deploymentQueue.getJobCounts();
            return {
                total: counts.waiting + counts.active + counts.completed + counts.failed + counts.delayed,
                waiting: counts.waiting,
                active: counts.active,
                completed: counts.completed,
                failed: counts.failed,
                delayed: counts.delayed,
                paused: 0 // Bull doesn't track paused jobs in getJobCounts()
            };
        }
        catch (error) {
            this.logger.error('Failed to get job status summary:', error);
            throw error;
        }
    }
    /**
     * Get detailed information about a specific job
     */
    async getJobDetails(jobId: string): Promise<JobTrackingInfo | null> {
        try {
            // First try to get from Bull queue (for active jobs)
            const bullJob = await this.deploymentQueue.getJob(jobId);
            if (bullJob) {
                return this.mapBullJobToTrackingInfo(bullJob);
            }
            // If not in queue, check database for completed/failed jobs
            const [dbJob] = await this.db
                .select()
                .from(jobTracking)
                .where(eq(jobTracking.id, jobId))
                .limit(1);
            if (dbJob) {
                return this.mapDbJobToTrackingInfo(dbJob);
            }
            return null;
        }
        catch (error) {
            this.logger.error(`Failed to get job details for ${jobId}:`, error);
            throw error;
        }
    }
    /**
     * Get job history with filtering and pagination
     */
    async getJobHistory(query: JobHistoryQuery = {}): Promise<{
        jobs: JobTrackingInfo[];
        total: number;
        hasMore: boolean;
    }> {
        try {
            const { status, type, stackId, serviceId, fromDate, toDate, limit = 50, offset = 0 } = query;
            let whereConditions: any[] = [];
            if (status && status.length > 0) {
                whereConditions.push(inArray(jobTracking.status, status as any[]));
            }
            if (type && type.length > 0) {
                whereConditions.push(inArray(jobTracking.type, type as any[]));
            }
            if (stackId) {
                whereConditions.push(eq(jobTracking.stackId, stackId));
            }
            if (serviceId) {
                whereConditions.push(eq(jobTracking.serviceId, serviceId));
            }
            if (fromDate) {
                whereConditions.push(gte(jobTracking.createdAt, fromDate));
            }
            if (toDate) {
                whereConditions.push(lte(jobTracking.createdAt, toDate));
            }
            const whereClause = whereConditions.length > 0
                ? and(...whereConditions)
                : undefined;
            // Get total count
            const totalResult = await this.db
                .select({ count: jobTracking.id })
                .from(jobTracking)
                .where(whereClause);
            const total = totalResult.length;
            // Get paginated results
            const dbJobs = await this.db
                .select()
                .from(jobTracking)
                .where(whereClause)
                .orderBy(desc(jobTracking.createdAt))
                .limit(limit)
                .offset(offset);
            const jobs = dbJobs.map(job => this.mapDbJobToTrackingInfo(job));
            return {
                jobs,
                total,
                hasMore: (offset + limit) < total
            };
        }
        catch (error) {
            this.logger.error('Failed to get job history:', error);
            throw error;
        }
    }
    /**
     * Get active jobs from Bull queue
     */
    async getActiveJobs(): Promise<JobTrackingInfo[]> {
        try {
            const activeJobs = await this.deploymentQueue.getActive();
            return activeJobs.map(job => this.mapBullJobToTrackingInfo(job));
        }
        catch (error) {
            this.logger.error('Failed to get active jobs:', error);
            throw error;
        }
    }
    /**
     * Get waiting jobs from Bull queue
     */
    async getWaitingJobs(): Promise<JobTrackingInfo[]> {
        try {
            const waitingJobs = await this.deploymentQueue.getWaiting();
            return waitingJobs.map(job => this.mapBullJobToTrackingInfo(job));
        }
        catch (error) {
            this.logger.error('Failed to get waiting jobs:', error);
            throw error;
        }
    }
    /**
     * Get failed jobs from Bull queue
     */
    async getFailedJobs(): Promise<JobTrackingInfo[]> {
        try {
            const failedJobs = await this.deploymentQueue.getFailed();
            return failedJobs.map(job => this.mapBullJobToTrackingInfo(job));
        }
        catch (error) {
            this.logger.error('Failed to get failed jobs:', error);
            throw error;
        }
    }
    /**
     * Get completed jobs from Bull queue (recent ones)
     */
    async getCompletedJobs(): Promise<JobTrackingInfo[]> {
        try {
            const completedJobs = await this.deploymentQueue.getCompleted();
            return completedJobs.map(job => this.mapBullJobToTrackingInfo(job));
        }
        catch (error) {
            this.logger.error('Failed to get completed jobs:', error);
            throw error;
        }
    }
    /**
     * Retry a failed job
     */
    async retryJob(jobId: string): Promise<void> {
        try {
            const job = await this.deploymentQueue.getJob(jobId);
            if (!job) {
                throw new Error(`Job ${jobId} not found`);
            }
            await job.retry();
            this.logger.log(`Job ${jobId} queued for retry`);
        }
        catch (error) {
            this.logger.error(`Failed to retry job ${jobId}:`, error);
            throw error;
        }
    }
    /**
     * Cancel/remove a job
     */
    async cancelJob(jobId: string): Promise<void> {
        try {
            const job = await this.deploymentQueue.getJob(jobId);
            if (!job) {
                throw new Error(`Job ${jobId} not found`);
            }
            await job.remove();
            this.logger.log(`Job ${jobId} cancelled and removed`);
        }
        catch (error) {
            this.logger.error(`Failed to cancel job ${jobId}:`, error);
            throw error;
        }
    }
    /**
     * Store job tracking information to database when jobs complete/fail
     */
    async storeJobTracking(job: Job, status: JobStatus): Promise<void> {
        try {
            const jobData = {
                id: job.id.toString(),
                type: job.name as 'deploy' | 'update' | 'remove' | 'scale' | 'build' | 'cleanup' | 'health-check' | 'ssl-renew' | 'backup' | 'restore',
                status: status as 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'paused',
                data: job.data,
                progress: job.progress(),
                createdAt: new Date(job.timestamp),
                startedAt: job.processedOn ? new Date(job.processedOn) : null,
                completedAt: job.finishedOn ? new Date(job.finishedOn) : null,
                failedAt: job.failedReason ? new Date(job.finishedOn || Date.now()) : null,
                duration: job.processedOn && job.finishedOn
                    ? job.finishedOn - job.processedOn
                    : null,
                stackId: job.data.stackId || null,
                serviceId: job.data.serviceId || null,
                logs: this.extractJobLogs(job),
                error: job.failedReason || null,
                metadata: {
                    opts: job.opts,
                    returnValue: job.returnvalue,
                    attempts: job.attemptsMade
                }
            };
            await this.db
                .insert(jobTracking)
                .values(jobData)
                .onConflictDoUpdate({
                target: jobTracking.id,
                set: {
                    status: jobData.status,
                    progress: jobData.progress,
                    completedAt: jobData.completedAt,
                    failedAt: jobData.failedAt,
                    duration: jobData.duration,
                    logs: jobData.logs,
                    error: jobData.error,
                    metadata: jobData.metadata,
                    updatedAt: new Date()
                }
            });
            this.logger.log(`Stored job tracking for ${job.id} with status ${status}`);
        }
        catch (error) {
            this.logger.error(`Failed to store job tracking for ${job.id}:`, error);
            // Don't throw - this shouldn't break the job processing
        }
    }
    /**
     * Clean up old job tracking records
     */
    @Cron('0 2 * * *') // Daily at 2 AM
    async cleanupOldJobTracking(): Promise<void> {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - this.JOB_RETENTION_DAYS);
            await this.db
                .delete(jobTracking)
                .where(lte(jobTracking.createdAt, cutoffDate));
            this.logger.log(`Cleaned up job tracking records older than ${this.JOB_RETENTION_DAYS} days`);
        }
        catch (error) {
            this.logger.error('Failed to cleanup old job tracking records:', error);
        }
    }
    /**
     * Get job statistics for a specific stack
     */
    async getStackJobStatistics(stackId: string): Promise<{
        total: number;
        byStatus: Record<string, number>;
        byType: Record<string, number>;
        averageDuration: number;
        recentJobs: JobTrackingInfo[];
    }> {
        try {
            const jobs = await this.db
                .select()
                .from(jobTracking)
                .where(eq(jobTracking.stackId, stackId))
                .orderBy(desc(jobTracking.createdAt))
                .limit(100);
            const total = jobs.length;
            const byStatus: Record<string, number> = {};
            const byType: Record<string, number> = {};
            let totalDuration = 0;
            let durationsCount = 0;
            jobs.forEach(job => {
                // Count by status
                byStatus[job.status] = (byStatus[job.status] || 0) + 1;
                // Count by type
                byType[job.type] = (byType[job.type] || 0) + 1;
                // Calculate average duration
                if (job.duration && job.duration > 0) {
                    totalDuration += job.duration;
                    durationsCount++;
                }
            });
            const averageDuration = durationsCount > 0 ? totalDuration / durationsCount : 0;
            const recentJobs = jobs
                .slice(0, 10)
                .map(job => this.mapDbJobToTrackingInfo(job));
            return {
                total,
                byStatus,
                byType,
                averageDuration,
                recentJobs
            };
        }
        catch (error) {
            this.logger.error(`Failed to get job statistics for stack ${stackId}:`, error);
            throw error;
        }
    }
    /**
     * Map Bull job to tracking info
     */
    private mapBullJobToTrackingInfo(job: Job): JobTrackingInfo {
        return {
            id: job.id.toString(),
            type: job.name,
            status: this.mapBullJobStatus(job),
            data: job.data,
            progress: job.progress(),
            createdAt: new Date(job.timestamp),
            startedAt: job.processedOn ? new Date(job.processedOn) : undefined,
            completedAt: job.finishedOn ? new Date(job.finishedOn) : undefined,
            failedAt: job.failedReason ? new Date(job.finishedOn || Date.now()) : undefined,
            duration: job.processedOn && job.finishedOn
                ? job.finishedOn - job.processedOn
                : undefined,
            stackId: job.data.stackId,
            serviceId: job.data.serviceId,
            logs: this.extractJobLogs(job),
            error: job.failedReason,
            metadata: {
                opts: job.opts,
                returnValue: job.returnvalue,
                attempts: job.attemptsMade
            }
        };
    }
    /**
     * Map database job to tracking info
     */
    private mapDbJobToTrackingInfo(job: any): JobTrackingInfo {
        return {
            id: job.id,
            type: job.type,
            status: job.status,
            data: job.data,
            progress: job.progress || 0,
            createdAt: job.createdAt,
            startedAt: job.startedAt,
            completedAt: job.completedAt,
            failedAt: job.failedAt,
            duration: job.duration,
            stackId: job.stackId,
            serviceId: job.serviceId,
            logs: job.logs || [],
            error: job.error,
            metadata: job.metadata || {}
        };
    }
    /**
     * Map Bull job status to our status enum
     */
    private mapBullJobStatus(job: Job): 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'paused' {
        if (job.finishedOn) {
            return job.failedReason ? 'failed' : 'completed';
        }
        if (job.processedOn) {
            return 'active';
        }
        if (job.opts.delay && Date.now() < job.timestamp + job.opts.delay) {
            return 'delayed';
        }
        return 'waiting';
    }
    /**
     * Extract logs from Bull job
     */
    private extractJobLogs(job: Job): string[] {
        const logs: string[] = [];
        if (job.returnvalue && typeof job.returnvalue === 'object' && job.returnvalue.logs) {
            logs.push(...job.returnvalue.logs);
        }
        if (job.failedReason) {
            logs.push(`ERROR: ${job.failedReason}`);
        }
        // Limit logs to prevent memory issues
        return logs.slice(-this.MAX_LOGS_PER_JOB);
    }
}
