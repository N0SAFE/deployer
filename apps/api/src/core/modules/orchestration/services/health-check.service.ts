import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bull";
import type { Queue } from "bull";
import { Cron, CronExpression } from "@nestjs/schedule";
import {
  orchestrationStacks,
  serviceInstances,
} from "@/config/drizzle/schema/orchestration";
import {
  stackMetrics,
  resourceAlerts,
} from "@/config/drizzle/schema/resource-monitoring";
import { eq, and, desc, gte } from "drizzle-orm";
import { DockerService } from "@/core/modules/docker/services/docker.service";
import axios, { type AxiosResponse } from "axios";
import { DatabaseService } from "@/core/modules/database/services/database.service";
export interface HealthCheckResult {
  stackId: string;
  serviceId?: string;
  serviceName: string;
  endpoint: string;
  status: "healthy" | "unhealthy" | "unknown" | "timeout" | "error";
  responseTime: number; // milliseconds
  statusCode?: number;
  errorMessage?: string;
  timestamp: Date;
  metadata?: {
    headers?: Record<string, string>;
    contentLength?: number;
    sslInfo?: any;
    redirectCount?: number;
  };
}
export interface ServiceHealthSummary {
  stackId: string;
  serviceId: string;
  serviceName: string;
  overallHealth: "healthy" | "degraded" | "unhealthy" | "unknown";
  uptime: number; // percentage over last 24h
  avgResponseTime: number; // ms over last hour
  errorRate: number; // percentage over last hour
  lastCheck: Date;
  checksToday: number;
  errorsToday: number;
}
export interface HealthCheckConfig {
  enabled: boolean;
  interval: number; // seconds
  timeout: number; // seconds
  retries: number;
  healthCheckPath: string; // e.g., '/health', '/api/health'
  expectedStatusCodes: number[]; // e.g., [200, 204]
  expectedContent?: string; // Optional content to check for
  headers?: Record<string, string>; // Custom headers to send
}

@Injectable()
export class HealthCheckService {
  private readonly logger = new Logger(HealthCheckService.name);
  // Default health check configuration
  private readonly defaultConfig: HealthCheckConfig = {
    enabled: true,
    interval: 30, // 30 seconds
    timeout: 10, // 10 seconds
    retries: 3,
    healthCheckPath: "/health",
    expectedStatusCodes: [200, 204],
    headers: {
      "User-Agent": "OrchestrationHealthCheck/1.0",
    },
  };
  constructor(
    private readonly databaseService: DatabaseService,
    @InjectQueue("deployment")
    private deploymentQueue: Queue,
    private readonly dockerService: DockerService
  ) {}
  /**
   * Perform health checks every 30 seconds
   */
  @Cron("*/30 * * * * *") // Every 30 seconds
  async performHealthChecks() {
    try {
      this.logger.log("Starting health checks");
      // Get all active stacks
      const activeStacks = await this.databaseService.db
        .select()
        .from(orchestrationStacks)
        .where(eq(orchestrationStacks.status, "running"));
      let totalChecks = 0;
      let healthyServices = 0;
      let unhealthyServices = 0;
      for (const stack of activeStacks) {
        try {
          // Get services for this stack
          const services = await this.databaseService.db
            .select()
            .from(serviceInstances)
            .where(eq(serviceInstances.stackId, stack.id));
          // Perform health checks for each service
          for (const service of services) {
            const healthCheckConfig = this.extractHealthCheckConfig(service);
            if (healthCheckConfig.enabled) {
              const result = await this.checkServiceHealth(
                stack,
                service,
                healthCheckConfig
              );
              await this.storeHealthCheckResult(result);
              totalChecks++;
              if (result.status === "healthy") {
                healthyServices++;
              } else {
                unhealthyServices++;
                // Generate alert for unhealthy service
                await this.generateHealthAlert(result);
              }
            }
          }
          // Update stack health status
          await this.updateStackHealthStatus(stack.id);
        } catch (error) {
          this.logger.error(
            `Failed to perform health checks for stack ${stack.name}:`,
            error
          );
        }
      }
      this.logger.log(
        `Health checks completed. Total: ${totalChecks}, Healthy: ${healthyServices}, Unhealthy: ${unhealthyServices}`
      );
    } catch (error) {
      this.logger.error("Failed to perform health checks:", error);
    }
  }
  /**
   * Check health of a specific service
   */
  private async checkServiceHealth(
    stack: any,
    service: any,
    config: HealthCheckConfig
  ): Promise<HealthCheckResult> {
    const result: HealthCheckResult = {
      stackId: stack.id,
      serviceId: service.id,
      serviceName: service.serviceName,
      endpoint: "",
      status: "unknown",
      responseTime: 0,
      timestamp: new Date(),
    };
    try {
      // Get service endpoint from domain assignments or internal network
      const endpoint = this.buildServiceEndpoint(
        service,
        config.healthCheckPath
      );
      result.endpoint = endpoint;
      if (!endpoint) {
        result.status = "error";
        result.errorMessage = "No accessible endpoint found";
        return result;
      }
      // Perform HTTP health check
      const startTime = Date.now();
      try {
        const response: AxiosResponse = await axios.get(endpoint, {
          timeout: config.timeout * 1000,
          headers: config.headers,
          validateStatus: (status) =>
            config.expectedStatusCodes.includes(status),
          maxRedirects: 3,
        });
        result.responseTime = Date.now() - startTime;
        result.statusCode = response.status;
        result.status = "healthy";
        // Store response metadata
        result.metadata = {
          headers: response.headers as Record<string, string>,
          contentLength: response.headers["content-length"]
            ? parseInt(response.headers["content-length"])
            : undefined,
          redirectCount: response.request._redirectCount || 0,
        };
        // Check expected content if specified
        if (
          config.expectedContent &&
          !response.data.includes(config.expectedContent)
        ) {
          result.status = "unhealthy";
          result.errorMessage = "Expected content not found in response";
        }
      } catch (error: any) {
        result.responseTime = Date.now() - startTime;
        if (error.code === "ECONNABORTED") {
          result.status = "timeout";
          result.errorMessage = `Request timeout after ${config.timeout}s`;
        } else if (error.response) {
          result.status = "unhealthy";
          result.statusCode = error.response.status;
          result.errorMessage = `HTTP ${error.response.status}: ${error.response.statusText}`;
        } else {
          result.status = "error";
          result.errorMessage = error.message || "Connection failed";
        }
      }
    } catch (error: any) {
      result.status = "error";
      result.errorMessage = error.message || "Health check failed";
      this.logger.error(
        `Health check failed for service ${service.serviceName}:`,
        error
      );
    }
    return result;
  }
  /**
   * Build service endpoint URL for health checks
   */
  private buildServiceEndpoint(service: any, healthCheckPath: string): string {
    try {
      // Try external domain first
      if (service.domainAssignments?.external) {
        const external = service.domainAssignments.external;
        const protocol = external.sslEnabled ? "https" : "http";
        return `${protocol}://${external.domain}:${external.port}${healthCheckPath}`;
      }
      // Try internal hostname
      if (service.domainAssignments?.internal) {
        const internal = service.domainAssignments.internal;
        return `http://${internal.hostname}:${internal.port}${healthCheckPath}`;
      }
      // Try service name with default port
      if (service.serviceName && service.metadata?.ports?.length > 0) {
        const port = service.metadata.ports[0];
        return `http://${service.serviceName}:${port}${healthCheckPath}`;
      }
      return "";
    } catch (error) {
      this.logger.error(
        `Failed to build endpoint for service ${service.serviceName}:`,
        error
      );
      return "";
    }
  }
  /**
   * Extract health check configuration from service
   */
  private extractHealthCheckConfig(service: any): HealthCheckConfig {
    const config = { ...this.defaultConfig };
    try {
      // Check if service has custom health check configuration
      if (service.healthCheckConfig) {
        Object.assign(config, service.healthCheckConfig);
      }
      // Check environment variables for health check path
      if (service.metadata?.environment) {
        const env = service.metadata.environment;
        if (env.HEALTH_CHECK_PATH) {
          config.healthCheckPath = env.HEALTH_CHECK_PATH;
        }
        if (env.HEALTH_CHECK_INTERVAL) {
          config.interval = parseInt(env.HEALTH_CHECK_INTERVAL);
        }
        if (env.HEALTH_CHECK_TIMEOUT) {
          config.timeout = parseInt(env.HEALTH_CHECK_TIMEOUT);
        }
        if (env.HEALTH_CHECK_ENABLED === "false") {
          config.enabled = false;
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to extract health check config for ${service.serviceName}:`,
        error
      );
    }
    return config;
  }
  /**
   * Store health check result
   */
  private async storeHealthCheckResult(
    result: HealthCheckResult
  ): Promise<void> {
    try {
      // Store as a metric entry
      await this.databaseService.db.insert(stackMetrics).values({
        stackId: result.stackId,
        serviceId: result.serviceId,
        timestamp: result.timestamp,
        cpuUsage: "0", // Not applicable for health checks
        memoryUsage: "0",
        memoryLimit: "0",
        storageUsage: "0",
        networkRx: "0",
        networkTx: "0",
        diskRead: "0",
        diskWrite: "0",
        metadata: {
          type: "health-check",
          serviceName: result.serviceName,
          endpoint: result.endpoint,
          status: result.status,
          responseTime: result.responseTime,
          statusCode: result.statusCode,
          errorMessage: result.errorMessage,
          ...result.metadata,
        },
      });
      // Update service health status in service_instances table
      await this.databaseService.db
        .update(serviceInstances)
        .set({
          healthStatus:
            result.status === "healthy"
              ? "healthy"
              : result.status === "timeout"
                ? "starting"
                : "unhealthy",
          lastHealthCheck: result.timestamp,
          updatedAt: new Date(),
        })
        .where(eq(serviceInstances.id, result.serviceId!));
    } catch (error) {
      this.logger.error(
        `Failed to store health check result for ${result.serviceName}:`,
        error
      );
    }
  }
  /**
   * Generate health alert for unhealthy services
   */
  private async generateHealthAlert(result: HealthCheckResult): Promise<void> {
    try {
      // Don't generate alerts for unknown status or first-time failures
      if (result.status === "unknown") {
        return;
      }
      // Check if we already have a recent alert for this service
      const recentAlerts = await this.databaseService.db
        .select()
        .from(resourceAlerts)
        .where(
          and(
            eq(resourceAlerts.stackId, result.stackId),
            eq(resourceAlerts.serviceId, result.serviceId!),
            eq(resourceAlerts.alertType, "health"),
            eq(resourceAlerts.isResolved, false),
            gte(resourceAlerts.createdAt, new Date(Date.now() - 5 * 60 * 1000)) // Last 5 minutes
          )
        )
        .limit(1);
      if (recentAlerts.length > 0) {
        return; // Don't spam alerts
      }
      // Determine severity based on status
      const severity = result.status === "error" ? "critical" : "warning";
      // Create alert
      await this.databaseService.db.insert(resourceAlerts).values({
        stackId: result.stackId,
        serviceId: result.serviceId,
        alertType: "health",
        severity,
        message: `Service ${result.serviceName} health check failed: ${result.errorMessage || result.status}`,
        threshold: result.responseTime.toString(),
        currentValue: result.responseTime.toString(),
        isResolved: false,
        metadata: {
          generatedBy: "health-check-service",
          endpoint: result.endpoint,
          status: result.status,
          statusCode: result.statusCode,
          responseTime: result.responseTime,
        },
      });
      // Queue alert notification
      await this.deploymentQueue.add(
        "send-alert-notification",
        {
          alert: {
            stackId: result.stackId,
            serviceId: result.serviceId,
            serviceName: result.serviceName,
            alertType: "health",
            severity,
            message: `Service ${result.serviceName} is ${result.status}`,
            endpoint: result.endpoint,
            responseTime: result.responseTime,
            timestamp: result.timestamp,
          },
        },
        {
          priority: severity === "critical" ? 1 : 2,
          attempts: 3,
        }
      );
    } catch (error) {
      this.logger.error(
        `Failed to generate health alert for ${result.serviceName}:`,
        error
      );
    }
  }
  /**
   * Update overall stack health status
   */
  private async updateStackHealthStatus(stackId: string): Promise<void> {
    try {
      // Get recent health checks for all services in the stack
      const recentHealthChecks = await this.databaseService.db
        .select()
        .from(stackMetrics)
        .where(
          and(
            eq(stackMetrics.stackId, stackId),
            gte(stackMetrics.timestamp, new Date(Date.now() - 5 * 60 * 1000)) // Last 5 minutes
          )
        )
        .orderBy(desc(stackMetrics.timestamp));
      if (recentHealthChecks.length === 0) {
        return;
      }
      // Group by service and get latest check for each
      const serviceHealthMap = new Map<string, any>();
      recentHealthChecks.forEach((check) => {
        if (check.metadata?.type === "health-check") {
          const serviceId = check.serviceId!;
          if (
            !serviceHealthMap.has(serviceId) ||
            check.timestamp > serviceHealthMap.get(serviceId).timestamp
          ) {
            serviceHealthMap.set(serviceId, check);
          }
        }
      });
      // Calculate overall stack health
      let healthyCount = 0;
      let totalCount = 0;
      serviceHealthMap.forEach((check) => {
        totalCount++;
        if (check.metadata?.status === "healthy") {
          healthyCount++;
        }
      });
      // Determine stack health status
      let stackHealthStatus = "unknown";
      if (totalCount > 0) {
        const healthPercentage = (healthyCount / totalCount) * 100;
        if (healthPercentage >= 90) {
          stackHealthStatus = "healthy";
        } else if (healthPercentage >= 50) {
          stackHealthStatus = "degraded";
        } else {
          stackHealthStatus = "unhealthy";
        }
      }
      // Update stack record with health status
      await this.databaseService.db
        .update(orchestrationStacks)
        .set({
          lastHealthCheck: new Date(),
          updatedAt: new Date(),
          currentResources: {
            healthStatus: stackHealthStatus,
            healthyServices: healthyCount,
            totalServices: totalCount,
            healthPercentage:
              totalCount > 0 ? (healthyCount / totalCount) * 100 : 0,
          } as any,
        })
        .where(eq(orchestrationStacks.id, stackId));
    } catch (error) {
      this.logger.error(
        `Failed to update stack health status for ${stackId}:`,
        error
      );
    }
  }
  /**
   * Get health summary for a service
   */
  async getServiceHealthSummary(
    serviceId: string
  ): Promise<ServiceHealthSummary | null> {
    try {
      // Get service details
      const [service] = await this.databaseService.db
        .select()
        .from(serviceInstances)
        .where(eq(serviceInstances.id, serviceId))
        .limit(1);
      if (!service) {
        return null;
      }
      // Get health checks from last 24 hours
      const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const healthChecks = await this.databaseService.db
        .select()
        .from(stackMetrics)
        .where(
          and(
            eq(stackMetrics.serviceId, serviceId),
            gte(stackMetrics.timestamp, last24h)
          )
        )
        .orderBy(desc(stackMetrics.timestamp));
      const healthCheckResults = healthChecks.filter(
        (check) => check.metadata?.type === "health-check"
      );
      if (healthCheckResults.length === 0) {
        return {
          stackId: service.stackId,
          serviceId: service.id,
          serviceName: service.serviceName,
          overallHealth: "unknown",
          uptime: 0,
          avgResponseTime: 0,
          errorRate: 0,
          lastCheck: new Date(),
          checksToday: 0,
          errorsToday: 0,
        };
      }
      // Calculate metrics
      const totalChecks = healthCheckResults.length;
      const healthyChecks = healthCheckResults.filter(
        (check) => check.metadata?.status === "healthy"
      ).length;
      const uptime = (healthyChecks / totalChecks) * 100;
      // Get last hour for response time and error rate
      const lastHour = new Date(Date.now() - 60 * 60 * 1000);
      const lastHourChecks = healthCheckResults.filter(
        (check) => check.timestamp >= lastHour
      );
      let avgResponseTime = 0;
      let errorRate = 0;
      if (lastHourChecks.length > 0) {
        const totalResponseTime = lastHourChecks.reduce(
          (sum, check) => sum + (check.metadata?.responseTime || 0),
          0
        );
        avgResponseTime = totalResponseTime / lastHourChecks.length;
        const errorCount = lastHourChecks.filter(
          (check) => check.metadata?.status !== "healthy"
        ).length;
        errorRate = (errorCount / lastHourChecks.length) * 100;
      }
      // Determine overall health
      let overallHealth: "healthy" | "degraded" | "unhealthy" | "unknown" =
        "unknown";
      if (uptime >= 95) {
        overallHealth = "healthy";
      } else if (uptime >= 80) {
        overallHealth = "degraded";
      } else {
        overallHealth = "unhealthy";
      }
      const errorsToday = totalChecks - healthyChecks;
      return {
        stackId: service.stackId,
        serviceId: service.id,
        serviceName: service.serviceName,
        overallHealth,
        uptime,
        avgResponseTime: Math.round(avgResponseTime),
        errorRate: Math.round(errorRate * 100) / 100,
        lastCheck: healthCheckResults[0].timestamp,
        checksToday: totalChecks,
        errorsToday,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get service health summary for ${serviceId}:`,
        error
      );
      throw error;
    }
  }
  /**
   * Get stack health overview
   */
  async getStackHealthOverview(stackId: string): Promise<any> {
    try {
      // Get all services in the stack
      const services = await this.databaseService.db
        .select()
        .from(serviceInstances)
        .where(eq(serviceInstances.stackId, stackId));
      const healthSummaries = await Promise.all(
        services.map((service) => this.getServiceHealthSummary(service.id))
      );
      const validSummaries = healthSummaries.filter(
        (summary) => summary !== null
      ) as ServiceHealthSummary[];
      // Calculate stack-wide metrics
      let healthyServices = 0;
      let degradedServices = 0;
      let unhealthyServices = 0;
      let totalUptime = 0;
      let totalResponseTime = 0;
      let totalErrorRate = 0;
      validSummaries.forEach((summary) => {
        switch (summary.overallHealth) {
          case "healthy":
            healthyServices++;
            break;
          case "degraded":
            degradedServices++;
            break;
          case "unhealthy":
            unhealthyServices++;
            break;
        }
        totalUptime += summary.uptime;
        totalResponseTime += summary.avgResponseTime;
        totalErrorRate += summary.errorRate;
      });
      const totalServices = validSummaries.length;
      const avgUptime = totalServices > 0 ? totalUptime / totalServices : 0;
      const avgResponseTime =
        totalServices > 0 ? totalResponseTime / totalServices : 0;
      const avgErrorRate =
        totalServices > 0 ? totalErrorRate / totalServices : 0;
      // Determine overall stack health
      let overallHealth = "unknown";
      if (totalServices > 0) {
        const healthyPercentage = (healthyServices / totalServices) * 100;
        if (healthyPercentage >= 90) {
          overallHealth = "healthy";
        } else if (healthyPercentage >= 70) {
          overallHealth = "degraded";
        } else {
          overallHealth = "unhealthy";
        }
      }
      return {
        stackId,
        overallHealth,
        services: validSummaries,
        summary: {
          totalServices,
          healthyServices,
          degradedServices,
          unhealthyServices,
          avgUptime: Math.round(avgUptime * 100) / 100,
          avgResponseTime: Math.round(avgResponseTime),
          avgErrorRate: Math.round(avgErrorRate * 100) / 100,
          lastUpdated: new Date(),
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to get stack health overview for ${stackId}:`,
        error
      );
      throw error;
    }
  }
  /**
   * Manually trigger health check for a service
   */
  async triggerHealthCheck(serviceId: string): Promise<HealthCheckResult> {
    try {
      // Get service and stack details
      const [service] = await this.databaseService.db
        .select()
        .from(serviceInstances)
        .where(eq(serviceInstances.id, serviceId))
        .limit(1);
      if (!service) {
        throw new Error(`Service ${serviceId} not found`);
      }
      const [stack] = await this.databaseService.db
        .select()
        .from(orchestrationStacks)
        .where(eq(orchestrationStacks.id, service.stackId))
        .limit(1);
      if (!stack) {
        throw new Error(`Stack ${service.stackId} not found`);
      }
      // Get health check configuration
      const config = this.extractHealthCheckConfig(service);
      // Perform health check
      const result = await this.checkServiceHealth(stack, service, config);
      // Store result
      await this.storeHealthCheckResult(result);
      // Generate alert if unhealthy
      if (result.status !== "healthy") {
        await this.generateHealthAlert(result);
      }
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to trigger health check for service ${serviceId}:`,
        error
      );
      throw error;
    }
  }
  /**
   * Auto-resolve health alerts when services recover
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async resolveRecoveredHealthAlerts() {
    try {
      this.logger.log(
        "Checking for recovered services to resolve health alerts"
      );
      // Get active health alerts
      const activeHealthAlerts = await this.databaseService.db
        .select()
        .from(resourceAlerts)
        .where(
          and(
            eq(resourceAlerts.alertType, "health"),
            eq(resourceAlerts.isResolved, false)
          )
        );
      let resolvedCount = 0;
      for (const alert of activeHealthAlerts) {
        try {
          // Check recent health status for this service
          const recentHealthChecks = await this.databaseService.db
            .select()
            .from(stackMetrics)
            .where(
              and(
                eq(stackMetrics.stackId, alert.stackId),
                eq(stackMetrics.serviceId, alert.serviceId!),
                gte(
                  stackMetrics.timestamp,
                  new Date(Date.now() - 5 * 60 * 1000)
                ) // Last 5 minutes
              )
            )
            .orderBy(desc(stackMetrics.timestamp))
            .limit(3);
          const healthyChecks = recentHealthChecks.filter(
            (check) =>
              check.metadata?.type === "health-check" &&
              check.metadata?.status === "healthy"
          );
          // If we have 2 or more consecutive healthy checks, resolve the alert
          if (healthyChecks.length >= 2) {
            await this.databaseService.db
              .update(resourceAlerts)
              .set({
                isResolved: true,
                resolvedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(resourceAlerts.id, alert.id));
            resolvedCount++;
            this.logger.log(
              `Resolved health alert for service in stack ${alert.stackId}`
            );
          }
        } catch (error) {
          this.logger.error(
            `Failed to check health alert resolution for alert ${alert.id}:`,
            error
          );
        }
      }
      if (resolvedCount > 0) {
        this.logger.log(
          `Resolved ${resolvedCount} health alerts for recovered services`
        );
      }
    } catch (error) {
      this.logger.error("Failed to resolve recovered health alerts:", error);
    }
  }
}
