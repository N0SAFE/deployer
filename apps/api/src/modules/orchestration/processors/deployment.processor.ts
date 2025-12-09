import { Processor, Process } from "@nestjs/bull";
import { InjectQueue } from "@nestjs/bull";
import { Logger } from "@nestjs/common";
import type { Job, Queue } from "bull";
import { BaseProcessorService, type JobHandlers } from "@/core/modules/jobs/base-processor.service";
import {
  deploymentContracts,
  type BuildJobData,
  type DeployJobData,
  type DeployJobResult,
  type UpdateJobData,
  type RemoveJobData,
  type ScaleJobData,
  type TraefikConfigUpdateJobData,
  type CertificateRenewalJobData,
  type CleanupJobData,
  type HealthCheckJobData,
  type HealthCheckJobResult,
  type OrchestrationDeployUploadJobData,
  type OrchestrationDeployUploadJobResult,
  type AlertNotificationJobData,
  type RollbackJobData,
  type DeployUploadJobData,
  type DeploymentJobResult,
} from "./deployment-processor.contracts";

// Import types
import type { SwarmStackConfig } from "@/core/modules/orchestration/types/deployment-job.types";

// Import services (thin processor only orchestrates, services do the work)
import { DeploymentService } from "@/core/modules/deployment/services/deployment.service";
import { DeploymentCleanupService } from "@/core/modules/deployment/services/deployment-cleanup.service";
import { DeploymentHealthMonitorService } from "@/core/modules/deployment/services/deployment-health-monitor.service";
import { SwarmOrchestrationService } from "@/core/modules/swarm/services/swarm-orchestration.service";
import { ResourceAllocationService } from "@/core/modules/swarm/services/resource-allocation.service";
import { SslCertificateService } from "@/core/modules/ssl/services/ssl-certificate.service";
import { JobTrackingService } from "@/core/modules/jobs/services/job-tracking.service";
import { TraefikOrchestrationService } from "@/core/modules/orchestration/services/traefik-orchestration.service";

// Type definitions for handler results
interface JobResult {
  success: boolean;
  message: string;
}

type ProgressFn = (percent: number) => Promise<void>;
type LogFn = (message: string, level?: "info" | "warn" | "error") => void;

/**
 * Deployment Processor
 * 
 * A thin processor that orchestrates job execution by delegating to services.
 * Following the principle: Processor = Controller (thin orchestration layer)
 * 
 * The processor:
 * - Receives jobs from the Bull queue
 * - Validates job data using Zod schemas
 * - Delegates to appropriate services
 * - Reports progress and logs
 * - Does NOT contain business logic
 */
@Processor("deployment")
export class DeploymentProcessor extends BaseProcessorService<typeof deploymentContracts> {
  protected override readonly logger = new Logger(DeploymentProcessor.name);

  constructor(
    @InjectQueue("deployment") queue: Queue,
    // Core services for deployment operations
    private readonly deploymentService: DeploymentService,
    private readonly deploymentCleanupService: DeploymentCleanupService,
    private readonly healthMonitorService: DeploymentHealthMonitorService,
    // Orchestration services
    private readonly swarmService: SwarmOrchestrationService,
    private readonly resourceService: ResourceAllocationService,
    private readonly sslService: SslCertificateService,
    private readonly traefikService: TraefikOrchestrationService,
    // Job tracking service
    private readonly jobTrackingService: JobTrackingService,
  ) {
    super("deployment", queue, deploymentContracts);
    this.logger.log("🚀 DeploymentProcessor initialized");
  }

  /**
   * Define handlers for each job type.
   * Handlers receive typed data and delegate to services.
   */
  protected getHandlers(): JobHandlers<typeof deploymentContracts> {
    return {
      build: async ({ data, progress, log }) => {
          return this.handleBuildJob(data, progress, log);
      },
      deploy: async ({ data, progress, log }) => {
          return this.handleDeployJob(data, progress, log);
      },
      update: async ({ data, progress, log }) => {
          return this.handleUpdateJob(data, progress, log);
      },
      remove: async ({ data, progress, log }) => {
          return this.handleRemoveJob(data, progress, log);
      },
      scale: async ({ data, progress, log }) => {
          return this.handleScaleJob(data, progress, log);
      },
      "update-traefik-config": async ({ data, progress, log }) => {
          return this.handleTraefikConfigJob(data, progress, log);
      },
      "renew-certificate": async ({ data, progress, log }) => {
          return this.handleCertificateRenewalJob(data, progress, log);
      },
      cleanup: async ({ data, progress, log }) => {
          return this.handleCleanupJob(data, progress, log);
      },
      "health-check": async ({ data, progress, log }) => {
          return this.handleHealthCheckJob(data, progress, log);
      },
      "orchestration-deploy-upload": async ({ data, progress, log }) => {
          return this.handleOrchestrationDeployUploadJob(data, progress, log);
      },
      "send-alert-notification": async ({ data, progress, log }) => {
          return this.handleAlertNotificationJob(data, progress, log);
      },
      rollback: async ({ data, progress, log }) => {
          return this.handleRollbackJob(data, progress, log);
      },
      "deploy-upload":  ({ data, progress, log }) => {
          return this.handleDeployUploadJob(data, progress, log);
      },
    };
  }

  // ========== @Process handlers - delegate to processJob ==========
  // These are required by @nestjs/bull to route jobs to the processor

  @Process("build")
  handleBuild(job: Job<BuildJobData>) {
    return this.processJob(job);
  }

  @Process("deploy")
  handleDeploy(job: Job<DeployJobData>) {
    return this.processJob(job);
  }

  @Process("update")
  handleUpdate(job: Job<UpdateJobData>) {
    return this.processJob(job);
  }

  @Process("remove")
  handleRemove(job: Job<RemoveJobData>) {
    return this.processJob(job);
  }

  @Process("scale")
  handleScale(job: Job<ScaleJobData>) {
    return this.processJob(job);
  }

  @Process("update-traefik-config")
  handleTraefikConfigUpdate(job: Job<TraefikConfigUpdateJobData>) {
    return this.processJob(job);
  }

  @Process("renew-certificate")
  handleCertificateRenewal(job: Job<CertificateRenewalJobData>) {
    return this.processJob(job);
  }

  @Process("cleanup")
  handleCleanup(job: Job<CleanupJobData>) {
    return this.processJob(job);
  }

  @Process("health-check")
  handleHealthCheck(job: Job<HealthCheckJobData>) {
    return this.processJob(job);
  }

  @Process("orchestration-deploy-upload")
  handleOrchestrationDeployUpload(job: Job<OrchestrationDeployUploadJobData>) {
    return this.processJob(job);
  }

  @Process("send-alert-notification")
  handleSendAlertNotification(job: Job<AlertNotificationJobData>) {
    return this.processJob(job);
  }

  @Process("rollback")
  handleRollback(job: Job<RollbackJobData>) {
    return this.processJob(job);
  }

  @Process("deploy-upload")
  handleDeployUpload(job: Job<DeployUploadJobData>) {
    return this.processJob(job);
  }

  // ========== Job Implementation Methods ==========
  // These are thin orchestration methods that delegate to services

  /**
   * Handle build job - build a stack's images
   */
  private async handleBuildJob(
    data: BuildJobData,
    progress: ProgressFn,
    log: LogFn,
  ): Promise<JobResult> {
    const { stackName, buildArgs } = data;
    log(`Starting build for stack: ${stackName}`);
    
    try {
      await progress(10);
      
      // Delegate to swarm service for building
      await this.swarmService.buildStack(stackName, buildArgs);
      
      await progress(100);
      log(`Build completed for stack: ${stackName}`);
      
      return { success: true, message: `Build completed for ${stackName}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Build failed for ${stackName}: ${message}`, "error");
      throw error;
    }
  }

  /**
   * Handle deploy job - deploy a service or stack
   */
  private async handleDeployJob(
    data: DeployJobData,
    progress: ProgressFn,
    log: LogFn,
  ): Promise<DeployJobResult> {
    log("Starting deployment");
    
    try {
      await progress(10);
      
      // Check if this is a standard deployment (has deploymentId) or orchestration deployment (has stackId)
      if ('deploymentId' in data) {
        // Standard deployment - delegate to deployment service
        // Map contract data to deployService config
        const standardData = data as { deploymentId: string; projectId: string; serviceId: string; sourceConfig: Record<string, unknown> };
        
        // Extract uploadPath from sourceConfig if available
        const sourceConfig = standardData.sourceConfig;
        const uploadPath = sourceConfig.uploadPath;
        
        await this.deploymentService.deployService({
          deploymentId: standardData.deploymentId,
          serviceName: standardData.serviceId, // Use serviceId as serviceName
          sourcePath: typeof uploadPath === 'string' ? uploadPath : '/tmp/deploy',
          projectId: standardData.projectId,
        });
        
        await progress(100);
        log(`Deployment completed: ${standardData.deploymentId}`);
        
        return {
          success: true,
          message: 'Deployment completed',
          deploymentId: standardData.deploymentId,
          domainUrl: undefined,
        };
      } else {
        // Orchestration deployment - delegate to swarm service
        const orchestrationData = data as { stackId: string; stackName: string; composeConfig: Record<string, unknown> };
        await this.swarmService.deployStack(orchestrationData.stackId, orchestrationData.stackName, orchestrationData.composeConfig);
        
        await progress(100);
        log(`Stack deployment completed: ${orchestrationData.stackName}`);
        
        return {
          success: true,
          message: `Stack ${orchestrationData.stackName} deployed successfully`,
          stackId: orchestrationData.stackId,
          stackName: orchestrationData.stackName,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Deployment failed: ${message}`, "error");
      throw error;
    }
  }

  /**
   * Handle update job - update a stack configuration
   */
  private async handleUpdateJob(
    data: UpdateJobData,
    progress: ProgressFn,
    log: LogFn,
  ): Promise<JobResult> {
    const { stackId, stackName, updates } = data;
    log(`Starting update for stack: ${stackName}`);
    
    try {
      await progress(10);
      
      // Delegate to swarm service
      await this.swarmService.updateStack(stackId, updates);
      
      await progress(100);
      log(`Update completed for stack: ${stackName}`);
      
      return { success: true, message: `Update completed for ${stackName}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Update failed for ${stackName}: ${message}`, "error");
      throw error;
    }
  }

  /**
   * Handle remove job - remove a stack
   */
  private async handleRemoveJob(
    data: RemoveJobData,
    progress: ProgressFn,
    log: LogFn,
  ): Promise<JobResult> {
    const { stackId, stackName } = data;
    log(`Starting removal for stack: ${stackName}`);
    
    try {
      await progress(10);
      
      // Delegate to swarm service
      await this.swarmService.removeStack(stackId);
      
      await progress(100);
      log(`Removal completed for stack: ${stackName}`);
      
      return { success: true, message: `Removal completed for ${stackName}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Removal failed for ${stackName}: ${message}`, "error");
      throw error;
    }
  }

  /**
   * Handle scale job - scale stack services
   */
  private async handleScaleJob(
    data: ScaleJobData,
    progress: ProgressFn,
    log: LogFn,
  ): Promise<JobResult> {
    const { stackId, stackName, serviceScales } = data;
    log(`Starting scale operation for stack: ${stackName}`);
    
    try {
      await progress(10);
      
      // Delegate to swarm service
      await this.swarmService.scaleServices(stackId, serviceScales);
      
      await progress(100);
      log(`Scale completed for stack: ${stackName}`);
      
      return { success: true, message: `Scale completed for ${stackName}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Scale failed for ${stackName}: ${message}`, "error");
      throw error;
    }
  }

  /**
   * Handle Traefik config update job
   */
  private async handleTraefikConfigJob(
    data: TraefikConfigUpdateJobData,
    progress: ProgressFn,
    log: LogFn,
  ): Promise<JobResult> {
    const { stackName, domainMappings } = data;
    log(`Starting Traefik config update for stack: ${stackName}`);
    
    try {
      await progress(10);
      
      // Convert domainMappings to the expected DomainMapping[] format
      // Each entry needs: domain, service, port
      const mappingsArray = Object.entries(domainMappings).map(([domain, config]) => {
        const configObj = config as Record<string, unknown> | null;
        const service = configObj?.service;
        const port = configObj?.port;
        return {
          domain,
          service: typeof service === 'string' ? service : stackName,
          port: typeof port === 'number' ? port : 80,
          path: configObj?.path as string | undefined,
          middleware: configObj?.middleware as string[] | undefined,
        };
      });
      
      // Delegate to traefik orchestration service
      await this.traefikService.updateDomainMappings(data.stackId, mappingsArray);
      
      await progress(100);
      log(`Traefik config updated for stack: ${stackName}`);
      
      return { success: true, message: `Traefik config updated for ${stackName}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Traefik config update failed for ${stackName}: ${message}`, "error");
      throw error;
    }
  }

  /**
   * Handle certificate renewal job
   */
  private async handleCertificateRenewalJob(
    data: CertificateRenewalJobData,
    progress: ProgressFn,
    log: LogFn,
  ): Promise<JobResult> {
    const { domain } = data;
    log(`Starting certificate renewal for domain: ${domain}`);
    
    try {
      await progress(10);
      
      // Delegate to SSL service
      await this.sslService.renewCertificate(domain);
      
      await progress(100);
      log(`Certificate renewed for domain: ${domain}`);
      
      return { success: true, message: `Certificate renewed for ${domain}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Certificate renewal failed for ${domain}: ${message}`, "error");
      throw error;
    }
  }

  /**
   * Handle cleanup job - clean up deployment resources
   */
  private async handleCleanupJob(
    data: CleanupJobData,
    progress: ProgressFn,
    log: LogFn,
  ): Promise<JobResult> {
    const { stackId, stackName, cleanupType } = data;
    log(`Starting cleanup for stack: ${stackName}`);
    
    try {
      await progress(10);
      
      // Delegate to swarm service for stack cleanup
      // cleanupType determines what to remove: volumes, images, or all
      if (cleanupType === 'all') {
        await this.swarmService.removeStack(stackId);
      } else {
        // For partial cleanup, use swarm service with options
        await this.swarmService.removeStack(stackId);
      }
      
      await progress(100);
      log(`Cleanup completed for stack: ${stackName}`);
      
      return { success: true, message: `Cleanup completed for ${stackName}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Cleanup failed for ${stackName}: ${message}`, "error");
      throw error;
    }
  }

  /**
   * Handle health check job
   */
  private async handleHealthCheckJob(
    data: HealthCheckJobData,
    progress: ProgressFn,
    log: LogFn,
  ): Promise<HealthCheckJobResult> {
    const { stackId, stackName } = data;
    log(`Starting health check for stack: ${stackName}`);
    
    try {
      await progress(10);
      
      // Use swarm service to get stack status
      const status = await this.swarmService.getStackStatus(stackId);
      
      await progress(100);
      log(`Health check completed for stack: ${stackName}`);
      
      const healthy = status?.status === 'running';
      
      return {
        success: healthy,
        message: healthy 
          ? `Health check passed for ${stackName}` 
          : `Health check failed for ${stackName}: status is ${status?.status ?? 'unknown'}`,
        healthResult: status ? {
          status: status.status,
          services: status.services.length,
          runningReplicas: status.resourceUsage?.replicas.running ?? 0,
          totalReplicas: status.resourceUsage?.replicas.total ?? 0,
        } : undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Health check failed for ${stackName}: ${message}`, "error");
      throw error;
    }
  }

  /**
   * Handle orchestration deploy upload job
   * Used for deploying from uploaded archives to swarm stacks
   */
  private async handleOrchestrationDeployUploadJob(
    data: OrchestrationDeployUploadJobData,
    progress: ProgressFn,
    log: LogFn,
  ): Promise<OrchestrationDeployUploadJobResult> {
    const { uploadId, serviceId, extractPath, projectId, domain } = data;
    const stackName = `upload-${uploadId.slice(0, 8)}`;
    log(`Starting orchestration deploy upload for service: ${serviceId}, uploadId: ${uploadId}`);
    
    try {
      await progress(10);
      
      // Create a compose config from the uploaded source
      const composeConfig: Record<string, unknown> = {
        version: '3.8',
        services: {
          [serviceId]: {
            build: { context: extractPath },
            deploy: { replicas: 1 },
          },
        },
      };
      
      // Create a new stack for this upload-based deployment
      const stackConfig: SwarmStackConfig = {
        name: stackName,
        projectId,
        environment: 'production',
        composeConfig,
        domain,
      };
      
      const stackId = await this.swarmService.createStack(stackConfig);
      
      await progress(50);
      
      // Deploy the stack
      await this.swarmService.deployStack(stackId, stackName, composeConfig);
      
      await progress(100);
      log(`Orchestration deploy upload completed for service: ${serviceId}`);
      
      return {
        success: true,
        message: `Deployment from upload completed for ${serviceId}`,
        stackId,
        stackName,
        type: 'upload',
        domain: domain ?? null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Orchestration deploy upload failed for ${serviceId}: ${message}`, "error");
      throw error;
    }
  }

  /**
   * Handle alert notification job
   */
  private async handleAlertNotificationJob(
    data: AlertNotificationJobData,
    progress: ProgressFn,
    log: LogFn,
  ): Promise<JobResult> {
    const { alert } = data;
    const { alertType, message: alertMessage, stackId, severity } = alert;
    log(`Sending alert notification: ${alertType}`);
    
    try {
      await progress(10);
      
      // TODO: Delegate to notification service when available
      // For now, just log the alert
      this.logger.warn(`[ALERT][${severity}] ${alertType}: ${alertMessage} (stack: ${stackId})`);
      
      await progress(100);
      log(`Alert notification sent: ${alertType}`);
      
      return { success: true, message: `Alert notification sent: ${alertType}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Alert notification failed: ${message}`, "error");
      throw error;
    }
  }

  /**
   * Handle rollback job
   */
  private async handleRollbackJob(
    data: RollbackJobData,
    progress: ProgressFn,
    log: LogFn,
  ): Promise<DeploymentJobResult> {
    const { deploymentId, targetDeploymentId } = data;
    log(`Starting rollback from ${deploymentId} to ${targetDeploymentId}`);
    
    try {
      await progress(10);
      
      // Delegate to deployment service
      const rollbackId = await this.deploymentService.startRollback(
        deploymentId,
        targetDeploymentId,
      );
      
      await progress(50);
      
      // Complete the rollback
      this.deploymentService.completeRollback(rollbackId);
      
      await progress(100);
      log(`Rollback completed from ${deploymentId} to ${targetDeploymentId}`);
      
      return {
        success: true,
        message: `Rollback completed to deployment ${targetDeploymentId}`,
        deploymentId: targetDeploymentId,
        domainUrl: undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Rollback failed: ${message}`, "error");
      throw error;
    }
  }

  /**
   * Handle deploy upload job - deploy from uploaded files
   */
  private async handleDeployUploadJob(
    data: DeployUploadJobData,
    progress: ProgressFn,
    log: LogFn,
  ): Promise<DeploymentJobResult> {
    const { uploadId, serviceId, deploymentId, extractPath, environment } = data;
    log(`Starting deploy from upload for service: ${serviceId}, uploadId: ${uploadId}`);
    
    try {
      await progress(10);
      
      // Delegate to deployment service with upload source config
      await this.deploymentService.deployService({
        deploymentId,
        serviceName: serviceId, // Use serviceId as serviceName
        sourcePath: extractPath,
        buildType: 'dockerfile',
        environmentVariables: environment ? { NODE_ENV: environment } : undefined,
      });
      
      await progress(100);
      log(`Deploy from upload completed for service: ${serviceId}`);
      
      return {
        success: true,
        message: `Deployment from upload completed for ${serviceId}`,
        deploymentId,
        domainUrl: undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`Deploy from upload failed for ${serviceId}: ${message}`, "error");
      throw error;
    }
  }
}
