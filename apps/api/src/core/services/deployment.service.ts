import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { eq, desc, and, count } from 'drizzle-orm';
import { db } from '../modules/db/drizzle/index';
import { deployments, deploymentLogs, deploymentStatusEnum, logLevelEnum, } from '../modules/db/drizzle/schema/deployment';
// Type aliases based on the actual schema
type DeploymentStatus = typeof deploymentStatusEnum.enumValues[number];
type LogLevel = typeof logLevelEnum.enumValues[number];
type SelectDeployment = typeof deployments.$inferSelect;
type InsertDeployment = typeof deployments.$inferInsert;
type SelectDeploymentLog = typeof deploymentLogs.$inferSelect;
type InsertDeploymentLog = typeof deploymentLogs.$inferInsert;
export interface CreateDeploymentData {
    serviceId: string;
    sourceType: 'github' | 'gitlab' | 'git' | 'upload' | 'custom';
    sourceConfig: {
        repositoryUrl?: string;
        branch?: string;
        commitSha?: string;
        pullRequestNumber?: number;
        fileName?: string;
        fileSize?: number;
        customData?: Record<string, any>;
    };
    triggeredBy?: string;
    environment?: 'production' | 'staging' | 'preview' | 'development';
    metadata?: Record<string, any>;
}
export interface DeploymentLogData {
    level: LogLevel;
    message: string;
    phase?: string;
    step?: string;
    service?: string;
    stage?: string;
    timestamp: Date;
    metadata?: Record<string, any>;
}
@Injectable()
export class DeploymentService {
    private readonly logger = new Logger(DeploymentService.name);
    async createDeployment(data: CreateDeploymentData): Promise<string> {
        this.logger.log(`Creating deployment for service ${data.serviceId}`);
        const insertData: InsertDeployment = {
            serviceId: data.serviceId,
            triggeredBy: data.triggeredBy || null,
            status: 'pending',
            environment: data.environment || 'production',
            sourceType: data.sourceType,
            sourceConfig: data.sourceConfig,
            metadata: data.metadata || {},
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        const result = await db.insert(deployments).values(insertData).returning({ id: deployments.id });
        const deploymentId = result[0].id;
        // Add initial log
        await this.addDeploymentLog(deploymentId, {
            level: 'info',
            message: 'Deployment created and queued',
            phase: 'initialization',
            timestamp: new Date(),
            metadata: { sourceConfig: data.sourceConfig },
        });
        this.logger.log(`Deployment ${deploymentId} created successfully`);
        return deploymentId;
    }
    async getDeployment(deploymentId: string): Promise<SelectDeployment> {
        const result = await db
            .select()
            .from(deployments)
            .where(eq(deployments.id, deploymentId))
            .limit(1);
        if (!result.length) {
            throw new NotFoundException(`Deployment ${deploymentId} not found`);
        }
        return result[0];
    }
    async updateDeploymentStatus(deploymentId: string, status: DeploymentStatus): Promise<void> {
        this.logger.log(`Updating deployment ${deploymentId} status to ${status}`);
        const updateData: Partial<InsertDeployment> = {
            status,
            updatedAt: new Date(),
        };
        // Set timestamp based on status
        if (status === 'building') {
            updateData.buildStartedAt = new Date();
        }
        else if (status === 'deploying') {
            updateData.deployStartedAt = new Date();
        }
        else if (status === 'success') {
            updateData.deployCompletedAt = new Date();
        }
        await db
            .update(deployments)
            .set(updateData)
            .where(eq(deployments.id, deploymentId));
    }
    async updateDeploymentMetadata(deploymentId: string, metadata: Record<string, any>): Promise<void> {
        const deployment = await this.getDeployment(deploymentId);
        const updatedMetadata = { ...deployment.metadata, ...metadata };
        await db
            .update(deployments)
            .set({
            metadata: updatedMetadata,
            updatedAt: new Date(),
        })
            .where(eq(deployments.id, deploymentId));
    }
    async addDeploymentLog(deploymentId: string, logData: DeploymentLogData): Promise<void> {
        const insertData: InsertDeploymentLog = {
            deploymentId,
            level: logData.level,
            message: logData.message,
            phase: logData.phase || null,
            step: logData.step || null,
            service: logData.service || null,
            stage: logData.stage || null,
            timestamp: logData.timestamp,
            metadata: logData.metadata || {},
        };
        await db.insert(deploymentLogs).values(insertData);
    }
    async getDeploymentLogs(deploymentId: string, options?: {
        limit?: number;
        offset?: number;
        level?: LogLevel;
        phase?: string;
        service?: string;
    }): Promise<SelectDeploymentLog[]> {
        const query = db
            .select()
            .from(deploymentLogs)
            .where(eq(deploymentLogs.deploymentId, deploymentId))
            .orderBy(desc(deploymentLogs.timestamp));
        if (options?.limit) {
            return await query.limit(options.limit);
        }
        return await query;
    }
    async getServiceDeployments(serviceId: string, options?: {
        limit?: number;
        offset?: number;
        status?: DeploymentStatus;
        environment?: string;
    }): Promise<SelectDeployment[]> {
        const query = db
            .select()
            .from(deployments)
            .where(eq(deployments.serviceId, serviceId))
            .orderBy(desc(deployments.createdAt));
        if (options?.limit) {
            return await query.limit(options.limit);
        }
        return await query;
    }
    async getActiveDeployments(serviceId?: string): Promise<SelectDeployment[]> {
        const activeStatuses: DeploymentStatus[] = ['pending', 'queued', 'building', 'deploying'];
        const baseQuery = db
            .select()
            .from(deployments);
        const query = serviceId
            ? baseQuery.where(eq(deployments.serviceId, serviceId))
            : baseQuery;
        const results = await query.orderBy(desc(deployments.createdAt));
        return results.filter(deployment => activeStatuses.includes(deployment.status));
    }
    async getLastSuccessfulDeployment(serviceId: string): Promise<SelectDeployment | null> {
        const result = await db
            .select()
            .from(deployments)
            .where(and(eq(deployments.serviceId, serviceId), eq(deployments.status, 'success')))
            .orderBy(desc(deployments.deployCompletedAt))
            .limit(1);
        return result.length ? result[0] : null;
    }
    async getDeploymentStats(serviceId: string): Promise<{
        total: number;
        success: number;
        failed: number;
        active: number;
    }> {
        const [totalResult, successResult, failedResult, activeResult] = await Promise.all([
            db.select({ count: count() }).from(deployments).where(eq(deployments.serviceId, serviceId)),
            db.select({ count: count() }).from(deployments).where(and(eq(deployments.serviceId, serviceId), eq(deployments.status, 'success'))),
            db.select({ count: count() }).from(deployments).where(and(eq(deployments.serviceId, serviceId), eq(deployments.status, 'failed'))),
            db.select({ count: count() }).from(deployments).where(and(eq(deployments.serviceId, serviceId), eq(deployments.status, 'building'))),
        ]);
        return {
            total: totalResult[0].count,
            success: successResult[0].count,
            failed: failedResult[0].count,
            active: activeResult[0].count,
        };
    }
    async cancelDeployment(deploymentId: string): Promise<void> {
        const deployment = await this.getDeployment(deploymentId);
        if (!['pending', 'queued', 'building', 'deploying'].includes(deployment.status)) {
            throw new Error(`Cannot cancel deployment in status: ${deployment.status}`);
        }
        await this.updateDeploymentStatus(deploymentId, 'cancelled');
        await this.addDeploymentLog(deploymentId, {
            level: 'info',
            message: 'Deployment cancelled by user',
            phase: 'cancellation',
            timestamp: new Date(),
        });
        this.logger.log(`Deployment ${deploymentId} cancelled`);
    }
    async cleanupOldDeployments(olderThanDays: number = 30): Promise<number> {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
        // First, get deployments to cleanup (completed statuses only)
        const results = await db
            .select()
            .from(deployments);
        const deploymentsToCleanup = results.filter(deployment => ['success', 'failed', 'cancelled'].includes(deployment.status) &&
            deployment.createdAt < cutoffDate);
        if (deploymentsToCleanup.length === 0) {
            return 0;
        }
        // Delete deployment logs first (foreign key constraint)
        for (const deployment of deploymentsToCleanup) {
            await db.delete(deploymentLogs).where(eq(deploymentLogs.deploymentId, deployment.id));
        }
        // Delete deployments
        for (const deployment of deploymentsToCleanup) {
            await db.delete(deployments).where(eq(deployments.id, deployment.id));
        }
        const deletedCount = deploymentsToCleanup.length;
        this.logger.log(`Cleaned up ${deletedCount} old deployments`);
        return deletedCount;
    }
}
