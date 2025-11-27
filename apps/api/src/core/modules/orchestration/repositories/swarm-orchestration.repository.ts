import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@/core/modules/database/services/database.service';
import { orchestrationStacks } from '@/config/drizzle/schema/orchestration';
import { eq, and } from 'drizzle-orm';

@Injectable()
export class SwarmOrchestrationRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async findActiveStacks() {
    return this.databaseService.db
      .select()
      .from(orchestrationStacks)
      .where(eq(orchestrationStacks.status, 'running' as any));
  }

  async updateStackStatus(stackId: string, status: string) {
    return this.databaseService.db
      .update(orchestrationStacks)
      .set({ status: status as any, updatedAt: new Date() })
      .where(eq(orchestrationStacks.id, stackId));
  }

  async createStack(data: any) {
    const [stack] = await this.databaseService.db
      .insert(orchestrationStacks)
      .values(data as any)
      .returning();
    return stack;
  }

  async updateStackDeployment(stackId: string, status: string, deployStartedAt: Date) {
    return this.databaseService.db
      .update(orchestrationStacks)
      .set({ status: status as any, lastDeployedAt: deployStartedAt, updatedAt: new Date() })
      .where(eq(orchestrationStacks.id, stackId));
  }

  async updateStackDeploymentComplete(stackId: string, status: string, deployCompletedAt: Date) {
    return this.databaseService.db
      .update(orchestrationStacks)
      .set({ status: status as any, lastDeployedAt: deployCompletedAt, updatedAt: new Date() })
      .where(eq(orchestrationStacks.id, stackId));
  }

  async updateStackDeploymentFailed(stackId: string, status: string, error: string) {
    return this.databaseService.db
      .update(orchestrationStacks)
      .set({ 
        status: status as any, 
        lastDeployedAt: new Date(),
        errorMessage: error,
        updatedAt: new Date() 
      })
      .where(eq(orchestrationStacks.id, stackId));
  }

  async findById(stackId: string) {
    const [result] = await this.databaseService.db
      .select()
      .from(orchestrationStacks)
      .where(eq(orchestrationStacks.id, stackId));
    return result || null;
  }

  async updateNetworkConfig(stackId: string, networkConfig: any) {
    const stack = await this.findById(stackId);
    if (!stack) return null;
    
    return this.databaseService.db
      .update(orchestrationStacks)
      .set({ 
        composeConfig: {
          ...stack.composeConfig,
          networks: networkConfig
        } as any, 
        updatedAt: new Date() 
      })
      .where(eq(orchestrationStacks.id, stackId));
  }

  async updateScalingConfig(stackId: string, scalingConfig: any) {
    const stack = await this.findById(stackId);
    if (!stack) return null;
    
    return this.databaseService.db
      .update(orchestrationStacks)
      .set({ 
        resourceQuotas: {
          ...stack.resourceQuotas,
          ...scalingConfig
        } as any, 
        updatedAt: new Date() 
      })
      .where(eq(orchestrationStacks.id, stackId));
  }

  async findByProjectId(projectId: string) {
    const [result] = await this.databaseService.db
      .select()
      .from(orchestrationStacks)
      .where(eq(orchestrationStacks.projectId, projectId));
    return result || null;
  }

  async removeStack(stackId: string) {
    return this.databaseService.db
      .update(orchestrationStacks)
      .set({ 
        status: 'removing' as any,
        lastDeployedAt: new Date(),
        updatedAt: new Date() 
      })
      .where(eq(orchestrationStacks.id, stackId));
  }

  async markStackRemoved(stackId: string) {
    return this.databaseService.db
      .update(orchestrationStacks)
      .set({ 
        status: 'paused' as any,
        lastDeployedAt: new Date(),
        updatedAt: new Date() 
      })
      .where(eq(orchestrationStacks.id, stackId));
  }

  async markStackRemovalFailed(stackId: string, error: string) {
    return this.databaseService.db
      .update(orchestrationStacks)
      .set({ 
        status: 'failed' as any,
        lastDeployedAt: new Date(),
        errorMessage: error,
        updatedAt: new Date() 
      })
      .where(eq(orchestrationStacks.id, stackId));
  }

  async findStackByName(name: string) {
    const [result] = await this.databaseService.db
      .select()
      .from(orchestrationStacks)
      .where(eq(orchestrationStacks.name, name));
    return result || null;
  }

  async findStacksByProjectAndEnvironment(projectId: string, environmentId: string) {
    return this.databaseService.db
      .select()
      .from(orchestrationStacks)
      .where(
        and(
          eq(orchestrationStacks.projectId, projectId),
          eq(orchestrationStacks.environment, environmentId)
        )
      );
  }

  async deleteStack(stackId: string) {
    return this.databaseService.db
      .delete(orchestrationStacks)
      .where(eq(orchestrationStacks.id, stackId));
  }

  async updateStackConfig(stackId: string, composeConfig: any) {
    return this.databaseService.db
      .update(orchestrationStacks)
      .set({ 
        composeConfig, 
        status: 'running' as any,
        updatedAt: new Date() 
      })
      .where(eq(orchestrationStacks.id, stackId));
  }
}
