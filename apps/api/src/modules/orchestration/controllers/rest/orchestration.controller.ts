import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  HttpException,
  HttpStatus,
  Logger,
  Query,
} from "@nestjs/common";
import { SwarmOrchestrationService } from "@/core/modules/orchestration/services/swarm-orchestration.service";
import type {
  SwarmStackConfig,
  ResourceUsage,
} from "@repo/api-contracts/modules/orchestration";
import {
  TraefikService,
  type TraefikConfig,
  type DomainMapping,
} from "@/core/modules/orchestration/services/traefik.service";
import {
  ResourceAllocationService,
  type ResourceQuota,
} from "@/core/modules/orchestration/services/resource-allocation.service";
import { SslCertificateService } from "@/core/modules/orchestration/services/ssl-certificate.service";
import { ResourceMonitoringService } from "@/core/modules/orchestration/services/resource-monitoring.service";
import { HealthCheckService } from "@/core/modules/orchestration/services/health-check.service";
import {
  JobTrackingService,
  type JobHistoryQuery,
} from "@/core/modules/orchestration/services/job-tracking.service";
import { orchestrationStacks } from "@/config/drizzle/schema/orchestration";
import { DatabaseService } from "@/core/modules/database/services/database.service";
export interface CreateStackRequest {
  projectId: string;
  environment: string;
  stackName: string;
  composeConfig: any;
  resourceQuotas?: ResourceQuota;
  domainMappings?: {
    [service: string]: string[];
  };
  sslConfig?: {
    email: string;
    provider: "letsencrypt" | "cloudflare" | "custom";
    staging?: boolean;
  };
}
export interface UpdateStackRequest {
  composeConfig?: any;
  resourceQuotas?: ResourceQuota;
  domainMappings?: {
    [service: string]: string[];
  };
}
export interface ScaleServicesRequest {
  [serviceName: string]: number;
}
export interface SetQuotasRequest {
  quotas: ResourceQuota;
}
@Controller("api/orchestration")
export class OrchestrationRestController {
  private readonly logger = new Logger(OrchestrationRestController.name);
  constructor(
    private readonly swarmService: SwarmOrchestrationService,
    private readonly traefikService: TraefikService,
    private readonly resourceService: ResourceAllocationService,
    private readonly sslService: SslCertificateService,
    private readonly resourceMonitoringService: ResourceMonitoringService,
    private readonly healthCheckService: HealthCheckService,
    private readonly jobTrackingService: JobTrackingService,
    private readonly databaseService: DatabaseService
  ) {}
  /**
   * Create a new Docker Swarm stack
   */
  @Post("stacks")
  async createStack(
    @Body()
    request: CreateStackRequest
  ) {
    try {
      this.logger.log(`Creating stack: ${request.stackName}`);
      // Validate request
      if (
        !request.projectId ||
        !request.environment ||
        !request.stackName ||
        !request.composeConfig
      ) {
        throw new HttpException(
          "Missing required fields",
          HttpStatus.BAD_REQUEST
        );
      }
      // Check resource capacity if quotas are set
      if (request.resourceQuotas) {
        const requestedResources = this.extractResourceUsageFromConfig(
          request.composeConfig
        );
        const capacityCheck = await this.resourceService.checkResourceCapacity(
          request.projectId,
          request.environment,
          requestedResources
        );
        if (!capacityCheck.allowed) {
          throw new HttpException(
            `Resource capacity exceeded: ${capacityCheck.violations.join(", ")}`,
            HttpStatus.BAD_REQUEST
          );
        }
      }
      // Create stack configuration
      const stackConfig: SwarmStackConfig = {
        name: request.stackName,
        projectId: request.projectId,
        environment: request.environment,
        composeConfig: request.composeConfig,
        domain: request.domainMappings?.[0]?.[0], // Use first domain if available
      };
      // Create stack
      const stackId = await this.swarmService.createStack(stackConfig);
      return {
        success: true,
        stackId,
        message: `Stack ${request.stackName} queued for deployment`,
      };
    } catch (error) {
      this.logger.error("Failed to create stack:", error);
      throw new HttpException(
        error instanceof Error ? error.message : "Failed to create stack",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
  /**
   * Get stack status and details
   */
  @Get("stacks/:stackId")
  async getStack(
    @Param("stackId")
    stackId: string
  ) {
    try {
      const stack = await this.swarmService.getStackStatus(stackId);
      return { success: true, data: stack };
    } catch (error) {
      this.logger.error(`Failed to get stack ${stackId}:`, error);
      throw new HttpException(
        error instanceof Error ? error.message : "Stack not found",
        HttpStatus.NOT_FOUND
      );
    }
  }
  /**
   * Update an existing stack
   */
  @Put("stacks/:stackId")
  async updateStack(
    @Param("stackId")
    stackId: string,
    @Body()
    request: UpdateStackRequest
  ) {
    try {
      this.logger.log(`Updating stack: ${stackId}`);
      await this.swarmService.updateStack(stackId, request);
      return {
        success: true,
        message: `Stack ${stackId} queued for update`,
      };
    } catch (error) {
      this.logger.error(`Failed to update stack ${stackId}:`, error);
      throw new HttpException(
        error instanceof Error ? error.message : "Failed to update stack",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
  /**
   * Remove a stack
   */
  @Delete("stacks/:stackId")
  async removeStack(
    @Param("stackId")
    stackId: string
  ) {
    try {
      this.logger.log(`Removing stack: ${stackId}`);
      await this.swarmService.removeStack(stackId);
      return {
        success: true,
        message: `Stack ${stackId} queued for removal`,
      };
    } catch (error) {
      this.logger.error(`Failed to remove stack ${stackId}:`, error);
      throw new HttpException(
        error instanceof Error ? error.message : "Failed to remove stack",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
  /**
   * Scale services in a stack
   */
  @Post("stacks/:stackId/scale")
  async scaleServices(
    @Param("stackId")
    stackId: string,
    @Body()
    request: ScaleServicesRequest
  ) {
    try {
      this.logger.log(`Scaling services in stack: ${stackId}`);
      await this.swarmService.scaleServices(stackId, request);
      return {
        success: true,
        message: `Services in stack ${stackId} queued for scaling`,
      };
    } catch (error) {
      this.logger.error(`Failed to scale services in stack ${stackId}:`, error);
      throw new HttpException(
        error instanceof Error ? error.message : "Failed to scale services",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
  /**
   * Update domain mappings for a stack
   */
  @Put("stacks/:stackId/domains")
  async updateDomainMappings(
    @Param("stackId")
    stackId: string,
    @Body()
    mappings: DomainMapping[]
  ) {
    try {
      this.logger.log(`Updating domain mappings for stack: ${stackId}`);
      await this.traefikService.updateDomainMappings(stackId, mappings);
      return {
        success: true,
        message: `Domain mappings for stack ${stackId} queued for update`,
      };
    } catch (error) {
      this.logger.error(
        `Failed to update domain mappings for stack ${stackId}:`,
        error
      );
      throw new HttpException(
        error instanceof Error
          ? error.message
          : "Failed to update domain mappings",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
  /**
   * Get SSL certificate status
   */
  @Get("certificates/:domain")
  async getCertificateStatus(
    @Param("domain")
    domain: string
  ) {
    try {
      const certificate = await this.sslService.getCertificateStatus(domain);
      if (!certificate) {
        throw new HttpException("Certificate not found", HttpStatus.NOT_FOUND);
      }
      return { success: true, data: certificate };
    } catch (error) {
      this.logger.error(
        `Failed to get certificate status for ${domain}:`,
        error
      );
      throw new HttpException(
        error instanceof Error
          ? error.message
          : "Failed to get certificate status",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
  /**
   * Renew SSL certificate
   */
  @Post("certificates/:domain/renew")
  async renewCertificate(
    @Param("domain")
    domain: string
  ) {
    try {
      this.logger.log(`Renewing certificate for domain: ${domain}`);
      await this.sslService.renewCertificate(domain);
      return {
        success: true,
        message: `Certificate renewal for ${domain} queued`,
      };
    } catch (error) {
      this.logger.error(`Failed to renew certificate for ${domain}:`, error);
      throw new HttpException(
        error instanceof Error ? error.message : "Failed to renew certificate",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
  /**
   * Get certificates expiring soon
   */
  @Get("certificates/expiring/:days?")
  async getCertificatesExpiringSoon(
    @Param("days")
    days?: string
  ) {
    try {
      const daysNum = days ? parseInt(days) : 30;
      const certificates =
        await this.sslService.getCertificatesExpiringSoon(daysNum);
      return { success: true, data: certificates };
    } catch (error) {
      this.logger.error(`Failed to get expiring certificates:`, error);
      throw new HttpException(
        error instanceof Error
          ? error.message
          : "Failed to get expiring certificates",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
  /**
   * Set resource quotas for a project environment
   */
  @Put("resources/:projectId/:environment/quotas")
  async setResourceQuotas(
    @Param("projectId")
    projectId: string,
    @Param("environment")
    environment: string,
    @Body()
    request: SetQuotasRequest
  ) {
    try {
      this.logger.log(
        `Setting resource quotas for ${projectId} in ${environment}`
      );
      await this.resourceService.setResourceQuotas(
        projectId,
        environment,
        request.quotas
      );
      return {
        success: true,
        message: `Resource quotas updated for ${projectId} in ${environment}`,
      };
    } catch (error) {
      this.logger.error(
        `Failed to set resource quotas for ${projectId}:`,
        error
      );
      throw new HttpException(
        error instanceof Error
          ? error.message
          : "Failed to set resource quotas",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
  /**
   * Get resource allocation for a project environment
   */
  @Get("resources/:projectId/:environment")
  async getResourceAllocation(
    @Param("projectId")
    projectId: string,
    @Param("environment")
    environment: string
  ) {
    try {
      const allocation = await this.resourceService.getResourceAllocation(
        projectId,
        environment
      );
      if (!allocation) {
        return {
          success: true,
          data: null,
          message: `No resource quotas set for ${projectId} in ${environment}`,
        };
      }
      return { success: true, data: allocation };
    } catch (error) {
      this.logger.error(
        `Failed to get resource allocation for ${projectId}:`,
        error
      );
      throw new HttpException(
        error instanceof Error
          ? error.message
          : "Failed to get resource allocation",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
  /**
   * Get system-wide resource summary
   */
  @Get("resources/system/summary")
  async getSystemResourceSummary() {
    try {
      const summary = await this.resourceService.getSystemResourceSummary();
      return { success: true, data: summary };
    } catch (error) {
      this.logger.error("Failed to get system resource summary:", error);
      throw new HttpException(
        error instanceof Error
          ? error.message
          : "Failed to get system resource summary",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
  /**
   * Get resource usage alerts
   */
  @Get("resources/alerts")
  async getResourceAlerts() {
    try {
      const alerts = await this.resourceService.checkResourceAlerts();
      return { success: true, data: alerts };
    } catch (error) {
      this.logger.error("Failed to get resource alerts:", error);
      throw new HttpException(
        error instanceof Error
          ? error.message
          : "Failed to get resource alerts",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
  /**
   * Generate Traefik configuration preview
   */
  @Post("traefik/preview")
  async generateTraefikPreview(
    @Body()
    config: TraefikConfig
  ) {
    try {
      const traefikConfig =
        await this.traefikService.generateTraefikConfig(config);
      return { success: true, data: traefikConfig };
    } catch (error) {
      this.logger.error("Failed to generate Traefik preview:", error);
      throw new HttpException(
        error instanceof Error
          ? error.message
          : "Failed to generate Traefik preview",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
  /**
   * Extract resource usage from Docker Compose configuration
   */
  private extractResourceUsageFromConfig(
    composeConfig: any
  ): Partial<ResourceUsage> {
    const usage: Partial<ResourceUsage> = {
      cpu: { allocated: 0, used: 0, percentage: 0 },
      memory: { allocated: 0, used: 0, percentage: 0 },
      storage: { allocated: 0, used: 0, percentage: 0 },
      replicas: { total: 0, running: 0 },
      services: 0,
    };
    if (composeConfig?.services) {
      for (const [, serviceConfig] of Object.entries(composeConfig.services)) {
        usage.services = (usage.services || 0) + 1;
        const config = serviceConfig as any;
        const replicas = config?.deploy?.replicas || 1;
        usage.replicas!.total += replicas;
        usage.replicas!.running += replicas; // Assume all are running initially
        if (config?.deploy?.resources?.limits) {
          const limits = config.deploy.resources.limits;
          if (limits.cpus) {
            usage.cpu!.allocated += parseFloat(limits.cpus) * replicas;
          }
          if (limits.memory) {
            usage.memory!.allocated +=
              this.parseMemoryString(limits.memory) * replicas;
          }
        }
      }
    }
    return usage;
  }
  /**
   * Parse memory string to bytes
   */
  private parseMemoryString(memoryStr: string): number {
    const value = parseFloat(memoryStr);
    const unit = memoryStr.replace(/[\d.]/g, "").toLowerCase();
    switch (unit) {
      case "k":
      case "kb":
        return value * 1024;
      case "m":
      case "mb":
        return value * 1024 * 1024;
      case "g":
      case "gb":
        return value * 1024 * 1024 * 1024;
      default:
        return value;
    }
  }
  /**
   * Get resource metrics for a stack
   */
  @Get("stacks/:stackId/metrics")
  async getStackMetrics(
    @Param("stackId")
    stackId: string
  ) {
    try {
      const metrics = await this.resourceMonitoringService.getStackMetrics(
        stackId,
        24
      );
      return metrics;
    } catch (error) {
      this.logger.error(`Failed to get metrics for stack ${stackId}:`, error);
      throw new HttpException(
        "Failed to get stack metrics",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
  /**
   * Get system-wide metrics
   */
  @Get("system/metrics")
  async getSystemMetrics() {
    try {
      const metrics = await this.resourceMonitoringService.getSystemMetrics('system', 24);
      return metrics;
    } catch (error) {
      this.logger.error("Failed to get system metrics:", error);
      throw new HttpException(
        "Failed to get system metrics",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
  /**
   * Get active alerts
   */
  @Get("alerts")
  async getActiveAlerts() {
    try {
      const alerts = await this.resourceMonitoringService.getActiveAlerts();
      return alerts;
    } catch (error) {
      this.logger.error("Failed to get active alerts:", error);
      throw new HttpException(
        "Failed to get active alerts",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
  /**
   * Get active alerts for a specific stack
   */
  @Get("stacks/:stackId/alerts")
  async getStackAlerts(
    @Param("stackId")
    stackId: string
  ) {
    try {
      const alerts =
        await this.resourceMonitoringService.getActiveAlerts(stackId);
      return alerts;
    } catch (error) {
      this.logger.error(`Failed to get alerts for stack ${stackId}:`, error);
      throw new HttpException(
        "Failed to get stack alerts",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
  /**
   * Resolve an alert
   */
  @Put("alerts/:alertId/resolve")
  async resolveAlert(
    @Param("alertId")
    alertId: string
  ) {
    try {
      await this.resourceMonitoringService.resolveAlert(alertId);
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to resolve alert ${alertId}:`, error);
      throw new HttpException(
        "Failed to resolve alert",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
  /**
   * Get resource summary for a stack
   */
  @Get("stacks/:stackId/summary")
  async getStackResourceSummary(
    @Param("stackId")
    stackId: string
  ) {
    try {
      const summary =
        await this.resourceMonitoringService.getStackResourceSummary(stackId);
      return summary;
    } catch (error) {
      this.logger.error(
        `Failed to get resource summary for stack ${stackId}:`,
        error
      );
      throw new HttpException(
        "Failed to get stack resource summary",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
  // Health Check Endpoints
  @Get("health/services/:serviceId")
  async getServiceHealth(
    @Param("serviceId")
    serviceId: string
  ) {
    return await this.healthCheckService.getServiceHealthSummary(serviceId);
  }
  @Get("health/stacks/:stackName")
  async getStackHealth(
    @Param("stackName")
    stackName: string
  ) {
    return await this.healthCheckService.getStackHealthOverview(stackName);
  }
  @Post("health/check/:stackName")
  async triggerHealthCheck(
    @Param("stackName")
    stackName: string
  ) {
    // Trigger health check by adding a job to the queue
    await this.healthCheckService.performHealthChecks();
    return {
      success: true,
      message: `Health check triggered for stack ${stackName}`,
    };
  }
  @Get("health/summary")
  async getHealthSummary() {
    try {
      // Get all stacks from database
      const stacks = await this.databaseService.db.select().from(orchestrationStacks);
      const summaries = await Promise.all(
        stacks.map((stack) =>
          this.healthCheckService.getStackHealthOverview(stack.id)
        )
      );
      return summaries;
    } catch (error) {
      this.logger.error("Failed to get health summary:", error);
      throw new HttpException(
        "Failed to get health summary",
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
  // Job Tracking Endpoints
  @Get("jobs/status")
  async getJobStatusSummary() {
    return await this.jobTrackingService.getJobStatusSummary();
  }
  @Get("jobs/active")
  async getActiveJobs() {
    return await this.jobTrackingService.getActiveJobs();
  }
  @Get("jobs/waiting")
  async getWaitingJobs() {
    return await this.jobTrackingService.getWaitingJobs();
  }
  @Get("jobs/failed")
  async getFailedJobs() {
    return await this.jobTrackingService.getFailedJobs();
  }
  @Get("jobs/completed")
  async getCompletedJobs() {
    return await this.jobTrackingService.getCompletedJobs();
  }
  @Get("jobs/:jobId")
  async getJobDetails(
    @Param("jobId")
    jobId: string
  ) {
    const job = await this.jobTrackingService.getJobDetails(jobId);
    if (!job) {
      throw new HttpException(`Job ${jobId} not found`, HttpStatus.NOT_FOUND);
    }
    return job;
  }
  @Get("jobs")
  async getJobHistory(
    @Query()
    query: JobHistoryQuery
  ) {
    return await this.jobTrackingService.getJobHistory(query);
  }
  @Post("jobs/:jobId/retry")
  async retryJob(
    @Param("jobId")
    jobId: string
  ) {
    try {
      await this.jobTrackingService.retryJob(jobId);
      return { success: true, message: `Job ${jobId} queued for retry` };
    } catch (error) {
      throw new HttpException(
        error instanceof Error ? error.message : "Failed to retry job",
        HttpStatus.BAD_REQUEST
      );
    }
  }
  @Delete("jobs/:jobId")
  async cancelJob(
    @Param("jobId")
    jobId: string
  ) {
    try {
      await this.jobTrackingService.cancelJob(jobId);
      return { success: true, message: `Job ${jobId} cancelled` };
    } catch (error) {
      throw new HttpException(
        error instanceof Error ? error.message : "Failed to cancel job",
        HttpStatus.BAD_REQUEST
      );
    }
  }
  @Get("stacks/:stackId/jobs/statistics")
  async getStackJobStatistics(
    @Param("stackId")
    stackId: string
  ) {
    return await this.jobTrackingService.getStackJobStatistics(stackId);
  }
}
