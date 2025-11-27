import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@/core/modules/database/services/database.service';
import { resourceAlerts, stackMetrics } from '@/config/drizzle/schema/resource-monitoring';
import { orchestrationStacks } from '@/config/drizzle/schema/orchestration';
import { services } from '@/config/drizzle/schema/deployment';
import { eq, and, gte, desc, lt } from 'drizzle-orm';

@Injectable()
export class ResourceMonitoringRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async findActiveStacks() {
    return this.databaseService.db
      .select({
        stackId: orchestrationStacks.id,
        projectId: orchestrationStacks.projectId,
        stackName: orchestrationStacks.name,
      })
      .from(orchestrationStacks)
      .where(eq(orchestrationStacks.status, 'running'));
  }

  async findStackServices(stackId: string) {
    // Note: services table doesn't have stackId - returns empty array for now
    // TODO: Implement proper service-to-stack relationship
    return [];
  }

  async insertMetrics(metrics: any[]) {
    return this.databaseService.db.insert(stackMetrics).values(metrics);
  }

  async insertSingleMetric(metric: any) {
    return this.databaseService.db.insert(stackMetrics).values(metric);
  }

  async insertAlerts(alerts: any[]) {
    return this.databaseService.db.insert(resourceAlerts).values(alerts);
  }

  async deleteOldMetrics(days: number) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    return this.databaseService.db
      .delete(stackMetrics)
      .where(lt(stackMetrics.timestamp, cutoffDate));
  }

  async deleteOldAlerts(days: number) {
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return this.databaseService.db
      .delete(resourceAlerts)
      .where(lt(resourceAlerts.createdAt, cutoffDate));
  }

  async deleteResolvedAlerts(daysOld: number) {
    const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
    return this.databaseService.db
      .delete(resourceAlerts)
      .where(and(
        eq(resourceAlerts.isResolved, true),
        lt(resourceAlerts.createdAt, cutoffDate)
      ));
  }

  async findMetricsByStack(stackId: string, hours: number) {
    const since = new Date();
    since.setHours(since.getHours() - hours);

    return this.databaseService.db
      .select()
      .from(stackMetrics)
      .where(and(eq(stackMetrics.stackId, stackId), gte(stackMetrics.timestamp, since)))
      .orderBy(desc(stackMetrics.timestamp));
  }

  async findMetricsByService(serviceId: string, hours: number) {
    const since = new Date();
    since.setHours(since.getHours() - hours);

    return this.databaseService.db
      .select()
      .from(stackMetrics)
      .where(and(eq(stackMetrics.serviceId, serviceId), gte(stackMetrics.timestamp, since)))
      .orderBy(desc(stackMetrics.timestamp));
  }

  async findActiveAlertsByStack(stackId: string) {
    return this.databaseService.db
      .select()
      .from(resourceAlerts)
      .where(and(eq(resourceAlerts.stackId, stackId), eq(resourceAlerts.isResolved, false)))
      .orderBy(desc(resourceAlerts.createdAt));
  }

  async findActiveAlertsByService(serviceId: string) {
    return this.databaseService.db
      .select()
      .from(resourceAlerts)
      .where(and(eq(resourceAlerts.serviceId, serviceId), eq(resourceAlerts.isResolved, false)))
      .orderBy(desc(resourceAlerts.createdAt));
  }

  async findAllActiveAlerts() {
    return this.databaseService.db
      .select()
      .from(resourceAlerts)
      .where(eq(resourceAlerts.isResolved, false))
      .orderBy(desc(resourceAlerts.createdAt));
  }

  async resolveAlert(alertId: string) {
    return this.databaseService.db
      .update(resourceAlerts)
      .set({ isResolved: true, resolvedAt: new Date(), updatedAt: new Date() })
      .where(eq(resourceAlerts.id, alertId));
  }

  async findLatestMetricByService(serviceId: string) {
    const [result] = await this.databaseService.db
      .select()
      .from(stackMetrics)
      .where(eq(stackMetrics.serviceId, serviceId))
      .orderBy(desc(stackMetrics.timestamp))
      .limit(1);
    return result || null;
  }
}
