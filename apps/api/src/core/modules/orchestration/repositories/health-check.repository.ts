import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@/core/modules/database/services/database.service';
import { 
  orchestrationStacks, 
  serviceInstances 
} from '@/config/drizzle/schema/orchestration';
import { stackMetrics, resourceAlerts } from '@/config/drizzle/schema/resource-monitoring';
import { eq, and, gte, desc, inArray } from 'drizzle-orm';

@Injectable()
export class HealthCheckRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async findActiveStacks() {
    return this.databaseService.db
      .select()
      .from(orchestrationStacks)
      .where(eq(orchestrationStacks.status, 'running'));
  }

  async findServicesByStackId(stackId: string) {
    return this.databaseService.db
      .select()
      .from(serviceInstances)
      .where(eq(serviceInstances.stackId, stackId));
  }

  async insertStackMetric(metric: any) {
    return this.databaseService.db.insert(stackMetrics).values(metric);
  }

  async updateStackHealth(stackId: string, healthStatus: string, metadata?: any) {
    const updateData: any = { healthStatus, updatedAt: new Date() };
    if (metadata) {
      updateData.metadata = metadata;
    }
    return this.databaseService.db
      .update(orchestrationStacks)
      .set(updateData)
      .where(eq(orchestrationStacks.id, stackId));
  }

  async findRecentAlerts(stackId: string, minutes: number) {
    const since = new Date();
    since.setMinutes(since.getMinutes() - minutes);

    return this.databaseService.db
      .select()
      .from(resourceAlerts)
      .where(
        and(
          eq(resourceAlerts.stackId, stackId),
          gte(resourceAlerts.createdAt, since)
        )
      );
  }

  async insertAlert(alert: any) {
    return this.databaseService.db.insert(resourceAlerts).values(alert);
  }

  async findRecentHealthChecks(serviceId: string, minutes: number) {
    const since = new Date();
    since.setMinutes(since.getMinutes() - minutes);

    return this.databaseService.db
      .select()
      .from(stackMetrics)
      .where(
        and(
          eq(stackMetrics.serviceId, serviceId),
          gte(stackMetrics.timestamp, since)
        )
      )
      .orderBy(desc(stackMetrics.timestamp));
  }

  async findRecentHealthChecksByStack(stackId: string, minutes: number) {
    const since = new Date();
    since.setMinutes(since.getMinutes() - minutes);

    return this.databaseService.db
      .select()
      .from(stackMetrics)
      .where(
        and(
          eq(stackMetrics.stackId, stackId),
          gte(stackMetrics.timestamp, since)
        )
      )
      .orderBy(desc(stackMetrics.timestamp));
  }

  async updateServiceHealth(serviceId: string, healthStatus: string, healthCheckResult?: any) {
    return this.databaseService.db
      .update(serviceInstances)
      .set({
        healthStatus: healthStatus as any,
        lastHealthCheck: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(serviceInstances.id, serviceId));
  }

  async findServiceById(serviceId: string) {
    const [result] = await this.databaseService.db
      .select()
      .from(serviceInstances)
      .where(eq(serviceInstances.id, serviceId));
    return result || null;
  }

  async findServiceHealthChecks(serviceId: string, limit: number) {
    return this.databaseService.db
      .select()
      .from(stackMetrics)
      .where(eq(stackMetrics.serviceId, serviceId))
      .orderBy(desc(stackMetrics.timestamp))
      .limit(limit);
  }

  async findServicesByIds(serviceIds: string[]) {
    return this.databaseService.db
      .select()
      .from(serviceInstances)
      .where(inArray(serviceInstances.id, serviceIds));
  }

  async findStackByServiceId(serviceId: string) {
    const [service] = await this.databaseService.db
      .select()
      .from(serviceInstances)
      .where(eq(serviceInstances.id, serviceId));

    if (!service) return null;

    const [stack] = await this.databaseService.db
      .select()
      .from(orchestrationStacks)
      .where(eq(orchestrationStacks.id, service.stackId));

    return stack || null;
  }

  async findActiveHealthAlerts(serviceId: string) {
    return this.databaseService.db
      .select()
      .from(resourceAlerts)
      .where(
        and(
          eq(resourceAlerts.serviceId, serviceId),
          eq(resourceAlerts.isResolved, false)
        )
      )
      .orderBy(desc(resourceAlerts.createdAt));
  }

  async findAllActiveHealthAlerts() {
    return this.databaseService.db
      .select()
      .from(resourceAlerts)
      .where(
        and(
          eq(resourceAlerts.alertType, 'health' as any),
          eq(resourceAlerts.isResolved, false)
        )
      )
      .orderBy(desc(resourceAlerts.createdAt));
  }

  async findRecentHealthChecksByService(serviceId: string, minutes: number) {
    const since = new Date();
    since.setMinutes(since.getMinutes() - minutes);

    return this.databaseService.db
      .select()
      .from(stackMetrics)
      .where(
        and(
          eq(stackMetrics.serviceId, serviceId),
          gte(stackMetrics.timestamp, since)
        )
      )
      .orderBy(desc(stackMetrics.timestamp));
  }

  async resolveHealthAlerts(serviceId: string) {
    return this.databaseService.db
      .update(resourceAlerts)
      .set({ isResolved: true, resolvedAt: new Date() })
      .where(
        and(
          eq(resourceAlerts.serviceId, serviceId),
          eq(resourceAlerts.isResolved, false)
        )
      );
  }

  async findRecentServiceHealthAlert(stackId: string, serviceId: string, alertType: string, minutes: number) {
    const since = new Date();
    since.setMinutes(since.getMinutes() - minutes);

    const [result] = await this.databaseService.db
      .select()
      .from(resourceAlerts)
      .where(
        and(
          eq(resourceAlerts.stackId, stackId),
          eq(resourceAlerts.serviceId, serviceId),
          eq(resourceAlerts.alertType, alertType as any),
          eq(resourceAlerts.isResolved, false),
          gte(resourceAlerts.createdAt, since)
        )
      )
      .limit(1);
    
    return result || null;
  }
}
