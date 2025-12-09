import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@/core/modules/database/services/database.service';
import { orchestrationStacks, stackStatusEnum } from '@/config/drizzle/schema/orchestration';
import { eq, and, type InferSelectModel } from 'drizzle-orm';

@Injectable()
export class SwarmOrchestrationRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async findActiveStacks() {
    return this.databaseService.db
      .select()
      .from(orchestrationStacks)
      .where(eq(orchestrationStacks.status, 'running'));
  }

  async updateStackStatus(stackId: string, status: (typeof stackStatusEnum.enumValues)[number]) {
    return this.databaseService.db
      .update(orchestrationStacks)
      .set({ status: status, updatedAt: new Date() })
      .where(eq(orchestrationStacks.id, stackId));
  }

  async createStack(data: InferSelectModel<typeof orchestrationStacks>) {
    const [stack] = await this.databaseService.db
      .insert(orchestrationStacks)
      .values(data)
      .returning();
    return stack;
  }

  async updateStackDeployment(stackId: string, status: (typeof stackStatusEnum.enumValues)[number], deployStartedAt: Date) {
    return this.databaseService.db
      .update(orchestrationStacks)
      .set({ status: status, lastDeployedAt: deployStartedAt, updatedAt: new Date() })
      .where(eq(orchestrationStacks.id, stackId));
  }

  async updateStackDeploymentComplete(stackId: string, status: (typeof stackStatusEnum.enumValues)[number], deployCompletedAt: Date) {
    return this.databaseService.db
      .update(orchestrationStacks)
      .set({ status: status, lastDeployedAt: deployCompletedAt, updatedAt: new Date() })
      .where(eq(orchestrationStacks.id, stackId));
  }

  async updateStackDeploymentFailed(stackId: string, status: (typeof stackStatusEnum.enumValues)[number], error: string) {
    return this.databaseService.db
      .update(orchestrationStacks)
      .set({ 
        status: status, 
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
    return result ?? null;
  }

  async updateNetworkConfig(stackId: string, networkConfig: InferSelectModel<typeof orchestrationStacks>['composeConfig']['networks']) {
    const stack = await this.findById(stackId);
    if (!stack) return null;
    
    return this.databaseService.db
      .update(orchestrationStacks)
      .set({ 
        composeConfig: {
          ...stack.composeConfig,
          networks: networkConfig
        } , 
        updatedAt: new Date() 
      })
      .where(eq(orchestrationStacks.id, stackId));
  }

  async updateScalingConfig(stackId: string, scalingConfig: InferSelectModel<typeof orchestrationStacks>['resourceQuotas']) {
    const stack = await this.findById(stackId);
    if (!stack) return null;
    
    return this.databaseService.db
      .update(orchestrationStacks)
      .set({ 
        resourceQuotas: {
          ...stack.resourceQuotas,
          ...scalingConfig
        }, 
        updatedAt: new Date() 
      })
      .where(eq(orchestrationStacks.id, stackId));
  }

  async findByProjectId(projectId: string) {
    const [result] = await this.databaseService.db
      .select()
      .from(orchestrationStacks)
      .where(eq(orchestrationStacks.projectId, projectId));
    return result ?? null;
  }

  async removeStack(stackId: string) {
    return this.databaseService.db
      .update(orchestrationStacks)
      .set({ 
        status: 'removing' ,
        lastDeployedAt: new Date(),
        updatedAt: new Date() 
      })
      .where(eq(orchestrationStacks.id, stackId));
  }

  async markStackRemoved(stackId: string) {
    return this.databaseService.db
      .update(orchestrationStacks)
      .set({ 
        status: 'paused' ,
        lastDeployedAt: new Date(),
        updatedAt: new Date() 
      })
      .where(eq(orchestrationStacks.id, stackId));
  }

  async markStackRemovalFailed(stackId: string, error: string) {
    return this.databaseService.db
      .update(orchestrationStacks)
      .set({ 
        status: 'failed' ,
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
    return result ?? null;
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

  async updateStackConfig(stackId: string, composeConfig: InferSelectModel<typeof orchestrationStacks>['composeConfig']) {
    return this.databaseService.db
      .update(orchestrationStacks)
      .set({ 
        composeConfig, 
        status: 'running' ,
        updatedAt: new Date() 
      })
      .where(eq(orchestrationStacks.id, stackId));
  }
}
