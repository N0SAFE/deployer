import { Injectable, Logger } from '@nestjs/common';
import { PipelineConfigSchema, BuildSchema } from '@repo/api-contracts/modules/ci-cd';
import { z } from 'zod';
// id generation uses timestamp-based ids for the in-memory repo

/**
 * Lightweight in-memory repository for CI/CD pipelines and builds.
 *
 * Purpose: Provide consistent, process-lifetime persistence for pipelines and
 * builds so controllers and services can operate in a predictable manner
 * without requiring an immediate database migration. This simulates a
 * persistence layer and can be swapped for a DB-backed repository later.
 */
@Injectable()
export class CiCdRepository {
    private readonly logger = new Logger(CiCdRepository.name);
    private readonly pipelines: Map<string, z.infer<typeof PipelineConfigSchema>> = new Map();
    private readonly builds: Map<string, z.infer<typeof BuildSchema>> = new Map();

    constructor() {
        this.logger.log('Initialized in-memory CiCdRepository (replace with DB-backed repository later)');
    }

    async createPipeline(pipeline: Omit<z.infer<typeof PipelineConfigSchema>, 'id' | 'createdAt' | 'updatedAt'>) {
    const id = `pipeline-${Date.now()}`;
        const item: z.infer<typeof PipelineConfigSchema> = {
            ...pipeline as any,
            id,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        this.pipelines.set(id, item);
        return item;
    }

    async getPipeline(id: string) {
        return this.pipelines.get(id) || null;
    }

    async updatePipeline(id: string, data: Partial<z.infer<typeof PipelineConfigSchema>>) {
        const existing = this.pipelines.get(id);
        if (!existing)
            return null;
        const updated = { ...existing, ...data, updatedAt: new Date() } as z.infer<typeof PipelineConfigSchema>;
        this.pipelines.set(id, updated);
        return updated;
    }

    async deletePipeline(id: string) {
        return this.pipelines.delete(id);
    }

    async listPipelines() {
        return Array.from(this.pipelines.values());
    }

    async createBuild(build: Partial<z.infer<typeof BuildSchema>>) {
        const id = build.id || `build-${Date.now()}`;
        const item: z.infer<typeof BuildSchema> = {
            id,
            pipelineId: build.pipelineId || 'unknown',
            number: build.number || Math.floor(Math.random() * 1000) + 1,
            status: (build.status as any) || 'queued',
            branch: build.branch || 'main',
            commitSha: build.commitSha || `commit-${Date.now()}`,
            commitMessage: build.commitMessage,
            author: build.author || 'unknown',
            triggeredBy: build.triggeredBy || 'manual',
            triggeredAt: build.triggeredAt || new Date(),
            startedAt: build.startedAt,
            completedAt: build.completedAt,
            duration: build.duration,
            logs: build.logs || '',
            artifacts: build.artifacts || [],
            testResults: build.testResults as any,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        this.builds.set(id, item);
        return item;
    }

    async getBuild(id: string) {
        return this.builds.get(id) || null;
    }

    async listBuilds(pipelineId?: string) {
        const all = Array.from(this.builds.values());
        if (!pipelineId)
            return all;
        return all.filter(b => b.pipelineId === pipelineId);
    }

    async getPipelineStats() {
        const totalPipelines = this.pipelines.size;
        const activePipelines = Array.from(this.pipelines.values()).filter(p => p.isActive).length;
        // Basic stats - can be extended later
        return {
            totalPipelines,
            activePipelines,
            successRate: 0,
            averageDuration: 0,
            runsToday: 0,
            runsThisWeek: 0,
            runsThisMonth: 0,
        };
    }
}
