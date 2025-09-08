import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DATABASE_CONNECTION } from '../../db/database-connection';
import { Database } from '../../db/drizzle/index';
import { 
  orchestrationStacks,
  serviceInstances
} from '../../db/drizzle/schema/orchestration';
import {
  stackMetrics,
  resourceAlerts
} from '../../db/drizzle/schema/resource-monitoring';
import { eq, and, desc, gte, lt } from 'drizzle-orm';
import * as Docker from 'dockerode';

export interface ResourceMetrics {
  stackId: string;
  serviceId?: string;
  timestamp: Date;
  cpuUsage: number; // CPU usage percentage
  memoryUsage: number; // Memory usage in MB
  memoryLimit: number; // Memory limit in MB
  storageUsage: number; // Storage usage in MB
  networkRx: number; // Network bytes received
  networkTx: number; // Network bytes transmitted
  diskRead: number; // Disk bytes read
  diskWrite: number; // Disk bytes written
}

export interface ResourceAlert {
  stackId: string;
  serviceId?: string;
  alertType: 'cpu' | 'memory' | 'storage' | 'network';
  severity: 'warning' | 'critical';
  message: string;
  threshold: number;
  currentValue: number;
  timestamp: Date;
}

export interface SystemMetrics {
  totalCpuUsage: number;
  totalMemoryUsage: number;
  totalMemoryLimit: number;
  totalStorageUsage: number;
  activeStacks: number;
  activeServices: number;
  timestamp: Date;
}

@Injectable()
export class ResourceMonitoringService {
  private readonly logger = new Logger(ResourceMonitoringService.name);
  private docker: Docker;

  // Resource thresholds for alerts
  private readonly thresholds = {
    cpu: {
      warning: 75, // 75% CPU usage
      critical: 90  // 90% CPU usage
    },
    memory: {
      warning: 80, // 80% memory usage
      critical: 95  // 95% memory usage
    },
    storage: {
      warning: 85, // 85% storage usage
      critical: 95  // 95% storage usage
    }
  };

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: Database,
    @InjectQueue('deployment-queue') private deploymentQueue: Queue
  ) {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
  }

  /**
   * Collect resource metrics every 2 minutes
   */
  @Cron('*/2 * * * *') // Every 2 minutes
  async collectResourceMetrics() {
    try {
      this.logger.log('Starting resource metrics collection');

      // Get all active stacks
      const activeStacks = await this.db.select({
        id: orchestrationStacks.id,
        name: orchestrationStacks.name,
        projectId: orchestrationStacks.projectId
      })
      .from(orchestrationStacks)
      .where(eq(orchestrationStacks.status, 'running'));

      const allMetrics: ResourceMetrics[] = [];
      let totalSystemMetrics: SystemMetrics = {
        totalCpuUsage: 0,
        totalMemoryUsage: 0,
        totalMemoryLimit: 0,
        totalStorageUsage: 0,
        activeStacks: activeStacks.length,
        activeServices: 0,
        timestamp: new Date()
      };

      for (const stack of activeStacks) {
        try {
          // Get stack services
          const stackServices = await this.db.select()
            .from(serviceInstances)
            .where(eq(serviceInstances.stackId, stack.id));

          totalSystemMetrics.activeServices += stackServices.length;

          // Collect metrics for each service in the stack
          const stackMetrics = await this.collectStackMetrics(stack.id, stackServices);
          allMetrics.push(...stackMetrics);

          // Aggregate stack metrics for system totals
          for (const metric of stackMetrics) {
            totalSystemMetrics.totalCpuUsage += metric.cpuUsage;
            totalSystemMetrics.totalMemoryUsage += metric.memoryUsage;
            totalSystemMetrics.totalMemoryLimit += metric.memoryLimit;
            totalSystemMetrics.totalStorageUsage += metric.storageUsage;
          }

        } catch (error) {
          this.logger.error(`Failed to collect metrics for stack ${stack.name}:`, error);
        }
      }

      // Store metrics in database
      if (allMetrics.length > 0) {
        await this.storeMetrics(allMetrics);
        await this.storeSystemMetrics(totalSystemMetrics);
        
        // Check for resource violations and generate alerts
        await this.checkResourceAlerts(allMetrics);
      }

      this.logger.log(`Resource metrics collection completed. Collected ${allMetrics.length} metrics`);

    } catch (error) {
      this.logger.error('Failed to collect resource metrics:', error);
    }
  }

  /**
   * Collect metrics for a specific stack
   */
  private async collectStackMetrics(stackId: string, stackServices: any[]): Promise<ResourceMetrics[]> {
    const metrics: ResourceMetrics[] = [];

    try {
      // Get all containers for this stack
      const containers = await this.docker.listContainers({
        filters: {
          label: [`com.docker.compose.project=${stackId}`]
        }
      });

      for (const containerInfo of containers) {
        try {
          const container = this.docker.getContainer(containerInfo.Id);
          const stats = await container.stats({ stream: false });

          // Find matching service
          const serviceName = containerInfo.Labels['com.docker.compose.service'];
          const matchingService = stackServices.find(s => s.name === serviceName);

          // Calculate CPU usage percentage
          const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - 
                          (stats.precpu_stats.cpu_usage?.total_usage || 0);
          const systemDelta = stats.cpu_stats.system_cpu_usage - 
                             (stats.precpu_stats.system_cpu_usage || 0);
          const cpuUsage = systemDelta > 0 ? (cpuDelta / systemDelta) * 100 : 0;

          // Calculate memory usage
          const memoryUsage = Math.round((stats.memory_stats.usage || 0) / 1024 / 1024); // MB
          const memoryLimit = Math.round((stats.memory_stats.limit || 0) / 1024 / 1024); // MB

          // Calculate network stats
          const networks = stats.networks || {};
          let networkRx = 0;
          let networkTx = 0;
          
          Object.values(networks).forEach((network: any) => {
            networkRx += network.rx_bytes || 0;
            networkTx += network.tx_bytes || 0;
          });

          // Calculate disk I/O stats
          const blkioStats = stats.blkio_stats;
          let diskRead = 0;
          let diskWrite = 0;

          if (blkioStats?.io_service_bytes_recursive) {
            blkioStats.io_service_bytes_recursive.forEach((stat: any) => {
              if (stat.op === 'Read') diskRead += stat.value;
              if (stat.op === 'Write') diskWrite += stat.value;
            });
          }

          // Estimate storage usage (simplified)
          const storageUsage = Math.round(diskRead / 1024 / 1024); // MB

          const metric: ResourceMetrics = {
            stackId,
            serviceId: matchingService?.id,
            timestamp: new Date(),
            cpuUsage: Math.round(cpuUsage * 100) / 100, // Round to 2 decimal places
            memoryUsage,
            memoryLimit,
            storageUsage,
            networkRx: Math.round(networkRx / 1024 / 1024), // MB
            networkTx: Math.round(networkTx / 1024 / 1024), // MB
            diskRead: Math.round(diskRead / 1024 / 1024), // MB
            diskWrite: Math.round(diskWrite / 1024 / 1024) // MB
          };

          metrics.push(metric);

        } catch (containerError) {
          this.logger.error(`Failed to collect stats for container ${containerInfo.Id}:`, containerError);
        }
      }

    } catch (error) {
      this.logger.error(`Failed to collect stack metrics for ${stackId}:`, error);
    }

    return metrics;
  }

  /**
   * Store metrics in database
   */
  private async storeMetrics(metrics: ResourceMetrics[]): Promise<void> {
    try {
      // Convert metrics to database format
      const dbMetrics = metrics.map(metric => ({
        stackId: metric.stackId,
        serviceId: metric.serviceId,
        timestamp: metric.timestamp,
        cpuUsage: metric.cpuUsage.toString(),
        memoryUsage: metric.memoryUsage.toString(),
        memoryLimit: metric.memoryLimit.toString(),
        storageUsage: metric.storageUsage.toString(),
        networkRx: metric.networkRx.toString(),
        networkTx: metric.networkTx.toString(),
        diskRead: metric.diskRead.toString(),
        diskWrite: metric.diskWrite.toString(),
        metadata: {
          collectionMethod: 'docker-api',
          containerCount: 1
        }
      }));

      await this.db.insert(stackMetrics).values(dbMetrics);
      this.logger.log(`Stored ${dbMetrics.length} metrics in database`);

    } catch (error) {
      this.logger.error('Failed to store metrics in database:', error);
    }
  }

  /**
   * Store system-wide metrics
   */
  private async storeSystemMetrics(systemMetrics: SystemMetrics): Promise<void> {
    try {
      // Store system metrics as a special stack metric with stackId 'system'
      await this.db.insert(stackMetrics).values({
        stackId: 'system',
        timestamp: systemMetrics.timestamp,
        cpuUsage: systemMetrics.totalCpuUsage.toString(),
        memoryUsage: systemMetrics.totalMemoryUsage.toString(),
        memoryLimit: systemMetrics.totalMemoryLimit.toString(),
        storageUsage: systemMetrics.totalStorageUsage.toString(),
        networkRx: '0',
        networkTx: '0',
        diskRead: '0',
        diskWrite: '0',
        metadata: {
          type: 'system-aggregate',
          activeStacks: systemMetrics.activeStacks,
          activeServices: systemMetrics.activeServices,
          collectionMethod: 'docker-api-aggregate'
        }
      });

    } catch (error) {
      this.logger.error('Failed to store system metrics:', error);
    }
  }

  /**
   * Check for resource alerts and generate notifications
   */
  private async checkResourceAlerts(metrics: ResourceMetrics[]): Promise<void> {
    const alerts: ResourceAlert[] = [];

    for (const metric of metrics) {
      // Check CPU usage
      if (metric.cpuUsage >= this.thresholds.cpu.critical) {
        alerts.push({
          stackId: metric.stackId,
          serviceId: metric.serviceId,
          alertType: 'cpu',
          severity: 'critical',
          message: `Critical CPU usage: ${metric.cpuUsage.toFixed(2)}%`,
          threshold: this.thresholds.cpu.critical,
          currentValue: metric.cpuUsage,
          timestamp: metric.timestamp
        });
      } else if (metric.cpuUsage >= this.thresholds.cpu.warning) {
        alerts.push({
          stackId: metric.stackId,
          serviceId: metric.serviceId,
          alertType: 'cpu',
          severity: 'warning',
          message: `High CPU usage: ${metric.cpuUsage.toFixed(2)}%`,
          threshold: this.thresholds.cpu.warning,
          currentValue: metric.cpuUsage,
          timestamp: metric.timestamp
        });
      }

      // Check memory usage
      if (metric.memoryLimit > 0) {
        const memoryPercentage = (metric.memoryUsage / metric.memoryLimit) * 100;
        
        if (memoryPercentage >= this.thresholds.memory.critical) {
          alerts.push({
            stackId: metric.stackId,
            serviceId: metric.serviceId,
            alertType: 'memory',
            severity: 'critical',
            message: `Critical memory usage: ${memoryPercentage.toFixed(2)}% (${metric.memoryUsage}MB/${metric.memoryLimit}MB)`,
            threshold: this.thresholds.memory.critical,
            currentValue: memoryPercentage,
            timestamp: metric.timestamp
          });
        } else if (memoryPercentage >= this.thresholds.memory.warning) {
          alerts.push({
            stackId: metric.stackId,
            serviceId: metric.serviceId,
            alertType: 'memory',
            severity: 'warning',
            message: `High memory usage: ${memoryPercentage.toFixed(2)}% (${metric.memoryUsage}MB/${metric.memoryLimit}MB)`,
            threshold: this.thresholds.memory.warning,
            currentValue: memoryPercentage,
            timestamp: metric.timestamp
          });
        }
      }

      // Check storage usage (simplified threshold check)
      if (metric.storageUsage >= this.thresholds.storage.critical) {
        alerts.push({
          stackId: metric.stackId,
          serviceId: metric.serviceId,
          alertType: 'storage',
          severity: 'critical',
          message: `Critical storage usage: ${metric.storageUsage}MB`,
          threshold: this.thresholds.storage.critical,
          currentValue: metric.storageUsage,
          timestamp: metric.timestamp
        });
      }
    }

    // Store alerts in database and send notifications
    if (alerts.length > 0) {
      await this.storeAlerts(alerts);
      await this.sendAlertNotifications(alerts);
    }
  }

  /**
   * Store alerts in database
   */
  private async storeAlerts(alerts: ResourceAlert[]): Promise<void> {
    try {
      const dbAlerts = alerts.map(alert => ({
        stackId: alert.stackId,
        serviceId: alert.serviceId,
        alertType: alert.alertType,
        severity: alert.severity,
        message: alert.message,
        threshold: alert.threshold.toString(),
        currentValue: alert.currentValue.toString(),
        isResolved: false,
        metadata: {
          generatedBy: 'resource-monitoring-service',
          timestamp: alert.timestamp.toISOString()
        }
      }));

      await this.db.insert(resourceAlerts).values(dbAlerts);
      this.logger.log(`Stored ${dbAlerts.length} resource alerts`);

    } catch (error) {
      this.logger.error('Failed to store resource alerts:', error);
    }
  }

  /**
   * Send alert notifications
   */
  private async sendAlertNotifications(alerts: ResourceAlert[]): Promise<void> {
    try {
      for (const alert of alerts) {
        // Log alert
        if (alert.severity === 'critical') {
          this.logger.error(`🚨 CRITICAL ALERT: ${alert.message} (Stack: ${alert.stackId})`);
        } else {
          this.logger.warn(`⚠️  WARNING: ${alert.message} (Stack: ${alert.stackId})`);
        }

        // Queue notification job for external integrations (Slack, email, etc.)
        await this.deploymentQueue.add('send-alert-notification', {
          alert
        }, {
          priority: alert.severity === 'critical' ? 1 : 2,
          attempts: 3
        });
      }

    } catch (error) {
      this.logger.error('Failed to send alert notifications:', error);
    }
  }

  /**
   * Cleanup old metrics (runs daily at 3 AM)
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupOldMetrics() {
    try {
      this.logger.log('Starting metrics cleanup');

      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      // Delete metrics older than 30 days
      await this.db.delete(stackMetrics)
        .where(lt(stackMetrics.timestamp, thirtyDaysAgo));

      // Delete resolved alerts older than 7 days
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      await this.db.delete(resourceAlerts)
        .where(and(
          eq(resourceAlerts.isResolved, true),
          lt(resourceAlerts.createdAt, sevenDaysAgo)
        ));

      this.logger.log(`Metrics cleanup completed. Deleted old metrics and resolved alerts`);

    } catch (error) {
      this.logger.error('Failed to cleanup old metrics:', error);
    }
  }

  /**
   * Get resource metrics for a stack
   */
  async getStackMetrics(stackId: string, hours: number = 24): Promise<any[]> {
    try {
      const since = new Date(Date.now() - hours * 60 * 60 * 1000);

      const metrics = await this.db.select()
        .from(stackMetrics)
        .where(and(
          eq(stackMetrics.stackId, stackId),
          gte(stackMetrics.timestamp, since)
        ))
        .orderBy(desc(stackMetrics.timestamp));

      return metrics;

    } catch (error) {
      this.logger.error(`Failed to get metrics for stack ${stackId}:`, error);
      throw error;
    }
  }

  /**
   * Get system metrics
   */
  async getSystemMetrics(hours: number = 24): Promise<any[]> {
    try {
      const since = new Date(Date.now() - hours * 60 * 60 * 1000);

      const metrics = await this.db.select()
        .from(stackMetrics)
        .where(and(
          eq(stackMetrics.stackId, 'system'),
          gte(stackMetrics.timestamp, since)
        ))
        .orderBy(desc(stackMetrics.timestamp));

      return metrics;

    } catch (error) {
      this.logger.error('Failed to get system metrics:', error);
      throw error;
    }
  }

  /**
   * Get active alerts
   */
  async getActiveAlerts(stackId?: string): Promise<any[]> {
    try {
      if (stackId) {
        const alerts = await this.db.select()
          .from(resourceAlerts)
          .where(and(
            eq(resourceAlerts.isResolved, false),
            eq(resourceAlerts.stackId, stackId)
          ))
          .orderBy(desc(resourceAlerts.createdAt));
        return alerts;
      } else {
        const alerts = await this.db.select()
          .from(resourceAlerts)
          .where(eq(resourceAlerts.isResolved, false))
          .orderBy(desc(resourceAlerts.createdAt));
        return alerts;
      }

    } catch (error) {
      this.logger.error('Failed to get active alerts:', error);
      throw error;
    }
  }

  /**
   * Resolve alert
   */
  async resolveAlert(alertId: string): Promise<void> {
    try {
      await this.db.update(resourceAlerts)
        .set({
          isResolved: true,
          resolvedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(resourceAlerts.id, alertId));

      this.logger.log(`Alert ${alertId} resolved`);

    } catch (error) {
      this.logger.error(`Failed to resolve alert ${alertId}:`, error);
      throw error;
    }
  }

  /**
   * Get resource usage summary for a stack
   */
  async getStackResourceSummary(stackId: string): Promise<any> {
    try {
      // Get latest metrics for the stack
      const [latestMetrics] = await this.db.select()
        .from(stackMetrics)
        .where(eq(stackMetrics.stackId, stackId))
        .orderBy(desc(stackMetrics.timestamp))
        .limit(1);

      if (!latestMetrics) {
        return {
          stackId,
          cpuUsage: 0,
          memoryUsage: 0,
          memoryLimit: 0,
          storageUsage: 0,
          lastUpdated: null,
          alerts: []
        };
      }

      // Get active alerts for the stack
      const alerts = await this.getActiveAlerts(stackId);

      return {
        stackId,
        cpuUsage: latestMetrics.cpuUsage,
        memoryUsage: latestMetrics.memoryUsage,
        memoryLimit: latestMetrics.memoryLimit,
        storageUsage: latestMetrics.storageUsage,
        networkRx: latestMetrics.networkRx,
        networkTx: latestMetrics.networkTx,
        lastUpdated: latestMetrics.timestamp,
        alerts: alerts.length
      };

    } catch (error) {
      this.logger.error(`Failed to get resource summary for stack ${stackId}:`, error);
      throw error;
    }
  }
}