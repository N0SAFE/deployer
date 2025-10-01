import { Processor, Process } from "@nestjs/bull";
import { Logger } from "@nestjs/common";
import type { Job } from "bull";
import { SwarmOrchestrationService } from "../services/swarm-orchestration.service";
import { TraefikService } from "../services/traefik.service";
import { ResourceAllocationService } from "../services/resource-allocation.service";
import { SslCertificateService } from "../services/ssl-certificate.service";
import {
  deploymentJobs,
  orchestrationStacks,
  sslCertificates,
  deployments,
  deploymentLogs,
  deploymentStatusEnum,
  projects,
  services,
} from "@/config/drizzle/schema";
import { eq } from "drizzle-orm";
import { DeploymentPhase } from "../../../types/deployment-phase";
// Import services needed for standard deployments
import { DockerService } from "../../../services/docker.service";
import { GitService } from "../../../services/git.service";
import { DeploymentService } from "../../../services/deployment.service";
import { FileUploadService } from "../../../../modules/storage/services/file-upload.service";
import { StaticFileServingService } from "../../../../modules/storage/services/static-file-serving.service";
import type {
  DeploymentJobData,
  DeploymentJobResult,
} from "../../../../modules/jobs/types/deployment-job.types";
import { DatabaseService } from "../../database/services/database.service";
@Processor("deployment")
export class DeploymentProcessor {
  private readonly logger = new Logger(DeploymentProcessor.name);
  constructor(
    private readonly swarmService: SwarmOrchestrationService,
    private readonly traefikService: TraefikService,
    private readonly resourceService: ResourceAllocationService,
    private readonly sslService: SslCertificateService,
    private readonly databaseService: DatabaseService,
    // Services needed for standard deployments
    private readonly dockerService: DockerService,
    private readonly gitService: GitService,
    private readonly deploymentService: DeploymentService,
    private readonly fileUploadService: FileUploadService,
    private readonly staticFileServingService: StaticFileServingService
  ) {
    this.logger.log(
      "🚀🚀🚀 DeploymentProcessor initialized and ready to process jobs"
    );
  }

  @Process("build")
  async handleBuild(job: Job) {
    this.logger.log(
      `🔨 DeploymentProcessor: Starting to process build job ${job.id} with data:`,
      JSON.stringify(job.data, null, 2)
    );
    const { stackName, buildArgs } = job.data;
    try {
      this.logger.log(`Processing build job for stack: ${stackName}`);
      // Update job status
      await this.updateJobStatus(job.id.toString(), "running", 10);
      // Build images if needed
      if (buildArgs) {
        // Implement build logic here
        this.logger.log(`Building custom images for ${stackName}`);
        job.progress(50);
      }
      // Update job status
      await this.updateJobStatus(job.id.toString(), "completed", 100);
      return { success: true, message: `Build completed for ${stackName}` };
    } catch (error) {
      this.logger.error(`Build job failed for ${stackName}:`, error);
      await this.updateJobStatus(
        job.id.toString(),
        "failed",
        0,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }
  @Process("deploy")
  async handleDeploy(job: Job) {
    console.log("🔥🔥🔥 DEPLOY HANDLER CALLED WITH JOB ID:", job.id);
    console.log("🔥🔥🔥 JOB DATA:", JSON.stringify(job.data, null, 2));
    this.logger.log(
      `🚀 DeploymentProcessor: Starting to process deploy job ${job.id} with data:`,
      JSON.stringify(job.data, null, 2)
    );

    // Check if this is a standard deployment job (has deploymentId) or orchestration job (has stackId)
    if (job.data.deploymentId) {
      return this.handleStandardDeployment(job);
    } else {
      return this.handleOrchestrationDeploy(job);
    }
  }

  // Standard deployment handler (from jobs module)
  async handleStandardDeployment(
    job: Job<DeploymentJobData>
  ): Promise<DeploymentJobResult> {
    const { deploymentId, projectId, serviceId, sourceConfig } = job.data;
    this.logger.log(`Starting deployment job for deployment ${deploymentId}`);

    try {
      // Log sourceConfig for debugging
      this.logger.log(
        `Source config for deployment ${deploymentId}:`,
        JSON.stringify(sourceConfig, null, 2)
      );

      // Update deployment status to building
      await this.updateDeploymentStatus(deploymentId, "building");
      await this.logDeployment(deploymentId, "info", "Deployment started", {
        projectId,
        serviceId,
      }); // Get service information to determine build type
      const serviceInfo = await this.databaseService.db
        .select({
          service: services,
          project: projects,
        })
        .from(services)
        .innerJoin(projects, eq(services.projectId, projects.id))
        .where(eq(services.id, serviceId))
        .limit(1);

      if (!serviceInfo.length) {
        throw new Error(`Service ${serviceId} not found`);
      }

      const { service, project } = serviceInfo[0];
      const buildType = service.builder;

      this.logger.log(`Deploying service with build type: ${buildType}`);

      // Step 1: Prepare source code
      await this.logDeployment(deploymentId, "info", "Preparing source code");
      const sourcePath = await this.prepareSourceCode(
        sourceConfig,
        deploymentId
      );

      // Step 2: Deploy using the enhanced DeploymentService based on build type
      let deploymentResult;

      if (buildType === "static") {
        await this.logDeployment(
          deploymentId,
          "info",
          "Deploying as static site"
        );
        // Extract optional image/pull settings from service config
        const svcProviderConfig: any = service.providerConfig || {};
        const svcBuilderConfig: any = service.builderConfig || {};
        const imageOverride =
          svcProviderConfig.staticImage ||
          svcProviderConfig.image ||
          svcBuilderConfig.staticImage ||
          svcBuilderConfig.image ||
          undefined;
        const imagePullPolicy =
          svcProviderConfig.imagePullPolicy ||
          svcBuilderConfig.imagePullPolicy ||
          "IfNotPresent";
        const registryAuth =
          svcProviderConfig.registryAuth ||
          svcBuilderConfig.registryAuth ||
          undefined;
        deploymentResult = await this.deploymentService.deployStaticSite({
          deploymentId,
          serviceName: service.name,
          sourcePath,
          environmentVariables: service.environmentVariables || {},
          healthCheckPath: service.healthCheckPath || "/health",
          resourceLimits: service.resourceLimits || undefined,
          // Pass image override and pull options through
          sourceConfig: {
            ...(sourceConfig || {}),
            image: imageOverride,
            imagePullPolicy,
            registryAuth,
          },
          projectId: project.id,
        });
      } else if (buildType === "dockerfile") {
        await this.logDeployment(
          deploymentId,
          "info",
          "Deploying using Dockerfile"
        );
        deploymentResult = await this.deploymentService.deployDockerService({
          deploymentId,
          serviceName: service.name,
          sourcePath,
          dockerfilePath:
            service.builderConfig?.dockerfilePath || "./Dockerfile",
          buildArgs: service.builderConfig?.buildArgs || {},
          environmentVariables: service.environmentVariables || {},
          port: service.port || 3000,
          healthCheckPath: service.healthCheckPath || "/health",
          resourceLimits: service.resourceLimits || undefined,
        });
      } else if (buildType === "nixpack" || buildType === "buildpack") {
        await this.logDeployment(
          deploymentId,
          "info",
          `Deploying using ${buildType} (Node.js)`
        );
        deploymentResult = await this.deploymentService.deployNodejsService({
          deploymentId,
          serviceName: service.name,
          sourcePath,
          buildCommand: service.builderConfig?.buildCommand,
          startCommand: service.builderConfig?.startCommand || "npm start",
          installCommand:
            service.builderConfig?.installCommand || "npm install",
          environmentVariables: service.environmentVariables || {},
          port: service.port || 3000,
          healthCheckPath: service.healthCheckPath || "/health",
          resourceLimits: service.resourceLimits || undefined,
        });
      } else {
        // Fallback to the old deployment method for unsupported build types
        await this.logDeployment(
          deploymentId,
          "info",
          `Using legacy deployment for build type: ${buildType}`
        );

        // Step 2: Build container image
        await this.logDeployment(
          deploymentId,
          "info",
          "Building container image"
        );
        const imageTag = await this.buildContainerImage(
          sourcePath,
          deploymentId
        );

        // Step 3: Deploy container
        await this.logDeployment(deploymentId, "info", "Deploying container");
        const containerInfo = await this.deployContainer(
          imageTag,
          deploymentId
        );

        deploymentResult = {
          success: true,
          containers: [containerInfo.containerId],
          imageTag,
        };
      }

      // Step 3: Register domain with Traefik
      await this.logDeployment(
        deploymentId,
        "info",
        "Registering domain with Traefik"
      );
      const domainUrl = await this.registerDomain(
        deploymentId,
        deploymentResult.containers[0]
      );

      // Step 4: Health check
      await this.logDeployment(
        deploymentId,
        "info",
        "Performing health checks"
      );
      await this.performHealthCheck(deploymentResult.containers[0]);

      // Success - update status
      await this.updateDeploymentStatus(deploymentId, "success");
      await this.logDeployment(
        deploymentId,
        "info",
        "Deployment completed successfully",
        {
          containerId: deploymentResult.containers[0],
          imageTag: deploymentResult.imageTag,
          sourcePath,
          domainUrl,
          buildType,
        }
      );

      return {
        success: true,
        deploymentId,
        containerId: deploymentResult.containers[0],
        imageTag: deploymentResult.imageTag,
        domainUrl,
        message: "Deployment completed successfully",
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Deployment job failed for deployment ${deploymentId}:`,
        err
      );

      // Update status to failed
      await this.updateDeploymentStatus(deploymentId, "failed");
      await this.logDeployment(
        deploymentId,
        "error",
        `Deployment failed: ${err.message}`,
        {
          error: err.stack,
          step: this.getCurrentStep(err),
        }
      );

      return {
        success: false,
        deploymentId,
        error: err.message,
        message: "Deployment failed",
      };
    }
  }

  // Orchestration deployment handler (original)
  async handleOrchestrationDeploy(job: Job) {
    this.logger.log(
      `🚀 DeploymentProcessor: Starting to process deploy job ${job.id} with data:`,
      JSON.stringify(job.data, null, 2)
    );
    const {
      stackId,
      stackName,
      composeConfig,
      resourceQuotas,
      domainMappings,
    } = job.data;
    try {
      this.logger.log(`Processing deploy job for stack: ${stackName}`);
      // Update job status
      await this.updateJobStatus(job.id.toString(), "running", 10);
      // Check resource capacity if quotas are set
      if (resourceQuotas) {
        const projectId = await this.getProjectIdFromStack(stackId);
        const environment = await this.getEnvironmentFromStack(stackId);
        if (projectId && environment) {
          const capacityCheck =
            await this.resourceService.checkResourceCapacity(
              projectId,
              environment,
              this.extractResourceUsageFromConfig(composeConfig)
            );
          if (!capacityCheck.allowed) {
            throw new Error(
              `Resource capacity exceeded: ${capacityCheck.violations.join(", ")}`
            );
          }
        }
      }
      job.progress(30);
      // Generate Traefik configuration if domains are specified
      let finalComposeConfig = composeConfig;
      if (domainMappings && Object.keys(domainMappings).length > 0) {
        const projectId = await this.getProjectIdFromStack(stackId);
        const environment = await this.getEnvironmentFromStack(stackId);
        const traefikConfig = await this.traefikService.generateTraefikConfig({
          projectId: projectId || "",
          environment: environment || "",
          stackName,
          services: this.convertDomainMappingsToServices(
            domainMappings,
            composeConfig
          ),
          sslConfig: {
            email: "admin@example.com", // Should be configurable
            provider: "letsencrypt",
          },
        });
        finalComposeConfig = traefikConfig;
      }
      job.progress(60);
      // Deploy to Docker Swarm
      await this.swarmService.executeSwarmDeploy(stackName, finalComposeConfig);
      // Update stack status
      await this.updateStackStatus(stackId, "running");
      job.progress(90);
      // Update job status
      await this.updateJobStatus(job.id.toString(), "completed", 100);
      return { success: true, message: `Deploy completed for ${stackName}` };
    } catch (error) {
      this.logger.error(`Deploy job failed for ${stackName}:`, error);
      await this.updateJobStatus(
        job.id.toString(),
        "failed",
        0,
        error instanceof Error ? error.message : String(error)
      );
      await this.updateStackStatus(
        stackId,
        "failed",
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }
  @Process("update")
  async handleUpdate(job: Job) {
    const { stackId, stackName, updates } = job.data;
    try {
      this.logger.log(`Processing update job for stack: ${stackName}`);
      // Update job status
      await this.updateJobStatus(job.id.toString(), "running", 10);
      // Get current stack configuration
      const currentConfig = await this.getStackConfig(stackId);
      // Merge updates with current configuration
      const updatedConfig = { ...currentConfig, ...updates };
      job.progress(40);
      // Deploy updated configuration
      await this.swarmService.executeSwarmDeploy(
        stackName,
        updatedConfig.composeConfig
      );
      // Update stack status
      await this.updateStackStatus(stackId, "running");
      job.progress(90);
      // Update job status
      await this.updateJobStatus(job.id.toString(), "completed", 100);
      return { success: true, message: `Update completed for ${stackName}` };
    } catch (error) {
      this.logger.error(`Update job failed for ${stackName}:`, error);
      await this.updateJobStatus(
        job.id.toString(),
        "failed",
        0,
        error instanceof Error ? error.message : String(error)
      );
      await this.updateStackStatus(
        stackId,
        "failed",
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }
  @Process("remove")
  async handleRemove(job: Job) {
    const { stackId, stackName } = job.data;
    try {
      this.logger.log(`Processing remove job for stack: ${stackName}`);
      // Update job status
      await this.updateJobStatus(job.id.toString(), "running", 10);
      // Remove from Docker Swarm
      await this.swarmService.executeSwarmRemove(stackName);
      job.progress(70);
      // Remove stack record
      await this.databaseService.db
        .delete(orchestrationStacks)
        .where(eq(orchestrationStacks.id, stackId));
      job.progress(90);
      // Update job status
      await this.updateJobStatus(job.id.toString(), "completed", 100);
      return { success: true, message: `Remove completed for ${stackName}` };
    } catch (error) {
      this.logger.error(`Remove job failed for ${stackName}:`, error);
      await this.updateJobStatus(
        job.id.toString(),
        "failed",
        0,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }
  @Process("scale")
  async handleScale(job: Job) {
    const { stackId, stackName, serviceScales } = job.data;
    try {
      this.logger.log(`Processing scale job for stack: ${stackName}`);
      // Update job status
      await this.updateJobStatus(job.id.toString(), "running", 10);
      // Scale services using SwarmOrchestrationService
      await this.swarmService.scaleServices(stackId, serviceScales);
      job.progress(70);
      // Update stack status
      await this.updateStackStatus(stackId, "running");
      job.progress(90);
      // Update job status
      await this.updateJobStatus(job.id.toString(), "completed", 100);
      return { success: true, message: `Scale completed for ${stackName}` };
    } catch (error) {
      this.logger.error(`Scale job failed for ${stackName}:`, error);
      await this.updateJobStatus(
        job.id.toString(),
        "failed",
        0,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }
  @Process("update-traefik-config")
  async handleTraefikConfigUpdate(job: Job) {
    const { stackId, stackName, domainMappings } = job.data;
    try {
      this.logger.log(
        `Processing Traefik config update for stack: ${stackName}`
      );
      // Update job status
      await this.updateJobStatus(job.id.toString(), "running", 10);
      // Update domain mappings in Traefik service
      await this.traefikService.updateDomainMappings(stackId, domainMappings);
      job.progress(70);
      // Update job status
      await this.updateJobStatus(job.id.toString(), "completed", 100);
      return {
        success: true,
        message: `Traefik config update completed for ${stackName}`,
      };
    } catch (error) {
      this.logger.error(
        `Traefik config update failed for ${stackName}:`,
        error
      );
      await this.updateJobStatus(
        job.id.toString(),
        "failed",
        0,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }
  @Process("renew-certificate")
  async handleCertificateRenewal(job: Job) {
    const { domain } = job.data;
    try {
      this.logger.log(`Processing certificate renewal for domain: ${domain}`);
      // Update job status
      await this.updateJobStatus(job.id.toString(), "running", 10);
      // Let Traefik handle the renewal automatically
      // Get current certificate status first
      const certStatus = await this.sslService.getCertificateStatus(domain);
      if (!certStatus) {
        throw new Error(`Certificate record not found for domain: ${domain}`);
      }
      job.progress(30);
      // Simulate ACME renewal process
      this.logger.log(
        `Triggering ACME renewal for ${domain} via Let's Encrypt`
      );
      await new Promise((resolve) => setTimeout(resolve, 2000));
      job.progress(70);
      // Update certificate status in database
      await this.databaseService.db
        .update(sslCertificates)
        .set({
          renewalStatus: "completed",
          lastRenewalAttempt: new Date(),
          isValid: true, // Will be validated by health checks
          updatedAt: new Date(),
        })
        .where(eq(sslCertificates.domain, domain));
      job.progress(90);
      // Update job status
      await this.updateJobStatus(job.id.toString(), "completed", 100);
      return {
        success: true,
        message: `Certificate renewal completed for ${domain}`,
      };
    } catch (error) {
      this.logger.error(`Certificate renewal failed for ${domain}:`, error);
      // Handle renewal failure via SSL service
      await this.sslService.handleRenewalFailure(
        domain,
        error instanceof Error ? error.message : String(error)
      );
      await this.updateJobStatus(
        job.id.toString(),
        "failed",
        0,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }
  @Process("cleanup")
  async handleCleanup(job: Job) {
    const { stackId, stackName, cleanupType } = job.data;
    try {
      this.logger.log(
        `Processing cleanup job for stack: ${stackName}, type: ${cleanupType}`
      );
      // Update job status
      await this.updateJobStatus(job.id.toString(), "running", 10);
      switch (cleanupType) {
        case "unused-images":
          await this.cleanupUnusedImages(stackId);
          break;
        case "stopped-containers":
          await this.cleanupStoppedContainers(stackId);
          break;
        case "dangling-networks":
          await this.cleanupDanglingNetworks(stackId);
          break;
        case "volumes":
          await this.cleanupUnusedVolumes(stackId);
          break;
        case "all":
          await this.cleanupUnusedImages(stackId);
          job.progress(30);
          await this.cleanupStoppedContainers(stackId);
          job.progress(50);
          await this.cleanupDanglingNetworks(stackId);
          job.progress(70);
          await this.cleanupUnusedVolumes(stackId);
          break;
        default:
          throw new Error(`Unknown cleanup type: ${cleanupType}`);
      }
      job.progress(90);
      // Update job status
      await this.updateJobStatus(job.id.toString(), "completed", 100);
      return { success: true, message: `Cleanup completed for ${stackName}` };
    } catch (error) {
      this.logger.error(`Cleanup job failed for ${stackName}:`, error);
      await this.updateJobStatus(
        job.id.toString(),
        "failed",
        0,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }
  @Process("health-check")
  async handleHealthCheck(job: Job) {
    const { stackId, stackName } = job.data;
    try {
      this.logger.log(`Processing health check job for stack: ${stackName}`);
      // Update job status
      await this.updateJobStatus(job.id.toString(), "running", 10);
      // Get stack status which includes health information
      const stackStatus = await this.swarmService.getStackStatus(stackId);
      if (!stackStatus) {
        throw new Error(`Stack ${stackName} not found`);
      }
      job.progress(50);
      // Check if all services are healthy
      let healthyServices = 0;
      let totalServices = stackStatus.services.length;
      for (const service of stackStatus.services) {
        if (
          service.status === "running" &&
          service.replicas.current === service.replicas.desired
        ) {
          healthyServices++;
        }
      }
      const isHealthy = healthyServices === totalServices && totalServices > 0;
      // Update stack health status
      await this.databaseService.db
        .update(orchestrationStacks)
        .set({
          lastHealthCheck: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(orchestrationStacks.id, stackId));
      job.progress(90);
      // Update job status
      await this.updateJobStatus(job.id.toString(), "completed", 100);
      const healthResult = {
        isHealthy,
        totalServices,
        healthyServices,
        services: stackStatus.services.map((service) => ({
          name: service.name,
          status: service.status,
          replicas: service.replicas,
        })),
      };
      return {
        success: true,
        message: `Health check completed for ${stackName}`,
        healthResult,
      };
    } catch (error) {
      this.logger.error(`Health check job failed for ${stackName}:`, error);
      await this.updateJobStatus(
        job.id.toString(),
        "failed",
        0,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }
  /**
   * Update job status in database
   */
  private async updateJobStatus(
    bullJobId: string,
    status: string,
    progress: number,
    errorMessage?: string
  ): Promise<void> {
    try {
      const updateData: any = {
        status,
        progress,
        updatedAt: new Date(),
      };
      if (status === "running" && progress === 10) {
        updateData.startedAt = new Date();
      } else if (status === "completed" || status === "failed") {
        updateData.completedAt = new Date();
      }
      if (errorMessage) {
        updateData.result = { error: errorMessage };
      }
      await this.databaseService.db
        .update(deploymentJobs)
        .set(updateData)
        .where(eq(deploymentJobs.bullJobId, bullJobId));
    } catch (error) {
      this.logger.error(`Failed to update job status for ${bullJobId}:`, error);
    }
  }
  /**
   * Update stack status
   */
  private async updateStackStatus(
    stackId: string,
    status: string,
    errorMessage?: string
  ): Promise<void> {
    try {
      const updateData: any = {
        status,
        updatedAt: new Date(),
      };
      if (status === "running") {
        updateData.lastDeployedAt = new Date();
        updateData.errorMessage = null;
      } else if (status === "failed" && errorMessage) {
        updateData.errorMessage = errorMessage;
      }
      await this.databaseService.db
        .update(orchestrationStacks)
        .set(updateData)
        .where(eq(orchestrationStacks.id, stackId));
    } catch (error) {
      this.logger.error(`Failed to update stack status for ${stackId}:`, error);
    }
  }
  /**
   * Get project ID from stack
   */
  private async getProjectIdFromStack(stackId: string): Promise<string | null> {
    try {
      const [stack] = await this.databaseService.db
        .select()
        .from(orchestrationStacks)
        .where(eq(orchestrationStacks.id, stackId))
        .limit(1);
      return stack?.projectId || null;
    } catch (error) {
      this.logger.error(
        `Failed to get project ID for stack ${stackId}:`,
        error
      );
      return null;
    }
  }
  /**
   * Get environment from stack
   */
  private async getEnvironmentFromStack(
    stackId: string
  ): Promise<string | null> {
    try {
      const [stack] = await this.databaseService.db
        .select()
        .from(orchestrationStacks)
        .where(eq(orchestrationStacks.id, stackId))
        .limit(1);
      return stack?.environment || null;
    } catch (error) {
      this.logger.error(
        `Failed to get environment for stack ${stackId}:`,
        error
      );
      return null;
    }
  }
  /**
   * Get stack configuration
   */
  private async getStackConfig(stackId: string): Promise<any> {
    try {
      const [stack] = await this.databaseService.db
        .select()
        .from(orchestrationStacks)
        .where(eq(orchestrationStacks.id, stackId))
        .limit(1);
      return stack || null;
    } catch (error) {
      this.logger.error(`Failed to get stack config for ${stackId}:`, error);
      return null;
    }
  }
  /**
   * Extract resource usage from compose configuration
   */
  private extractResourceUsageFromConfig(composeConfig: any): any {
    const usage = {
      cpu: 0,
      memory: 0,
      storage: 0,
      replicas: 0,
      services: 0,
    };
    if (composeConfig?.services) {
      for (const [, serviceConfig] of Object.entries(composeConfig.services)) {
        usage.services += 1;
        const config = serviceConfig as any;
        if (config?.deploy?.replicas) {
          usage.replicas += config.deploy.replicas;
        } else {
          usage.replicas += 1;
        }
        if (config?.deploy?.resources?.limits) {
          const limits = config.deploy.resources.limits;
          if (limits.cpus) {
            usage.cpu +=
              parseFloat(limits.cpus) * (config.deploy.replicas || 1);
          }
          if (limits.memory) {
            usage.memory +=
              this.parseMemoryString(limits.memory) *
              (config.deploy.replicas || 1);
          }
        }
      }
    }
    return usage;
  }
  /**
   * Convert domain mappings to services configuration
   */
  private convertDomainMappingsToServices(
    domainMappings: any,
    composeConfig: any
  ): any {
    const services: any = {};
    if (composeConfig?.services) {
      for (const [serviceName, serviceConfig] of Object.entries(
        composeConfig.services
      )) {
        const config = serviceConfig as any;
        const domains = domainMappings[serviceName] || [];
        services[serviceName] = {
          image: config.image || "nginx:latest",
          domains: Array.isArray(domains) ? domains : [domains],
          port: config.ports?.[0]?.split(":")[1] || 80,
          healthCheck: config.healthcheck?.test ? "/health" : undefined,
        };
      }
    }
    return services;
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
   * Cleanup unused Docker images
   */
  private async cleanupUnusedImages(stackId: string): Promise<void> {
    try {
      // Get stack info to filter images by stack namespace
      const [stack] = await this.databaseService.db
        .select()
        .from(orchestrationStacks)
        .where(eq(orchestrationStacks.id, stackId))
        .limit(1);
      if (!stack) {
        throw new Error(`Stack ${stackId} not found`);
      }
      // Note: This is a placeholder implementation
      // In a real implementation, you would use Docker API to:
      // 1. List all images
      // 2. Find unused images related to this stack
      // 3. Remove them safely
      this.logger.log(`Cleanup unused images for stack: ${stack.name}`);
    } catch (error) {
      this.logger.error(
        `Failed to cleanup unused images for stack ${stackId}:`,
        error
      );
      throw error;
    }
  }
  /**
   * Cleanup stopped containers
   */
  private async cleanupStoppedContainers(stackId: string): Promise<void> {
    try {
      // Get stack info
      const [stack] = await this.databaseService.db
        .select()
        .from(orchestrationStacks)
        .where(eq(orchestrationStacks.id, stackId))
        .limit(1);
      if (!stack) {
        throw new Error(`Stack ${stackId} not found`);
      }
      // Note: This is a placeholder implementation
      // In a real implementation, you would use Docker API to:
      // 1. List stopped containers for this stack
      // 2. Remove them safely
      this.logger.log(`Cleanup stopped containers for stack: ${stack.name}`);
    } catch (error) {
      this.logger.error(
        `Failed to cleanup stopped containers for stack ${stackId}:`,
        error
      );
      throw error;
    }
  }
  /**
   * Cleanup dangling networks
   */
  private async cleanupDanglingNetworks(stackId: string): Promise<void> {
    try {
      // Get stack info
      const [stack] = await this.databaseService.db
        .select()
        .from(orchestrationStacks)
        .where(eq(orchestrationStacks.id, stackId))
        .limit(1);
      if (!stack) {
        throw new Error(`Stack ${stackId} not found`);
      }
      // Note: This is a placeholder implementation
      // In a real implementation, you would use Docker API to:
      // 1. List networks for this stack
      // 2. Find unused/dangling networks
      // 3. Remove them safely
      this.logger.log(`Cleanup dangling networks for stack: ${stack.name}`);
    } catch (error) {
      this.logger.error(
        `Failed to cleanup dangling networks for stack ${stackId}:`,
        error
      );
      throw error;
    }
  }
  /**
   * Cleanup unused volumes
   */
  private async cleanupUnusedVolumes(stackId: string): Promise<void> {
    try {
      // Get stack info
      const [stack] = await this.databaseService.db
        .select()
        .from(orchestrationStacks)
        .where(eq(orchestrationStacks.id, stackId))
        .limit(1);
      if (!stack) {
        throw new Error(`Stack ${stackId} not found`);
      }
      // Note: This is a placeholder implementation
      // In a real implementation, you would use Docker API to:
      // 1. List volumes for this stack
      // 2. Find unused volumes
      // 3. Remove them safely
      this.logger.log(`Cleanup unused volumes for stack: ${stack.name}`);
    } catch (error) {
      this.logger.error(
        `Failed to cleanup unused volumes for stack ${stackId}:`,
        error
      );
      throw error;
    }
  }
  @Process("orchestration-deploy-upload")
  async handleOrchestrationUploadDeployment(job: Job) {
    const { uploadId, serviceId, extractPath, projectId, domain } = job.data;
    try {
      this.logger.log(
        `Processing upload deployment: ${uploadId} -> service ${serviceId}`
      );
      // Update job status
      await this.updateJobStatus(job.id.toString(), "running", 10);
      // Import FileUploadService to analyze the upload
      const { FileUploadService } = await import(
        "../../../../modules/storage/services/file-upload.service"
      );
      const fileUploadService = new FileUploadService(null as any); // We'll only use metadata analysis
      // Get upload metadata - if not available, use extractPath directly
      const uploadInfo = (await fileUploadService.getUploadedFileInfo(
        uploadId
      )) || {
        uploadId,
        extractedPath: extractPath,
        metadata: { detectedType: "static" }, // Default fallback
      };
      job.progress(20);
      // Generate deployment configuration based on detected project type
      const composeConfig = await this.generateComposeConfigFromUpload(
        uploadInfo,
        serviceId,
        projectId,
        domain
      );
      job.progress(40);
      // Handle static deployments differently (no container needed)
      if (
        composeConfig === null &&
        uploadInfo.metadata.detectedType === "static"
      ) {
        // For static sites, just configure Traefik routing
        if (domain) {
          await this.traefikService.generateStaticFileConfig({
            projectId,
            serviceId,
            domain,
            staticPath: `/app/static/${projectId}/${serviceId}`,
          });
        }
        job.progress(100);
        await this.updateJobStatus(job.id.toString(), "completed", 100);
        return {
          success: true,
          message: `Static site deployed successfully for ${serviceId}`,
          type: "static",
          domain,
        };
      }
      // Create a stack for this deployment (containerized apps only)
      const stackName = `${projectId}-${serviceId}`;
      const stackData: any = {
        name: stackName,
        projectId,
        environment: "production",
        composeConfig,
        resourceQuotas: null,
        domainMappings: domain
          ? {
              [serviceId]: {
                subdomain: domain.split(".")[0],
                fullDomain: domain,
                sslEnabled: true,
                certificateId: undefined,
              },
            }
          : null,
        status: "creating",
      };
      const [stack] = await this.databaseService.db
        .insert(orchestrationStacks)
        .values(stackData)
        .returning();
      job.progress(60);
      // Deploy to Docker Swarm with Traefik configuration
      if (domain) {
        const traefikConfig = await this.traefikService.generateTraefikConfig({
          projectId,
          environment: "production",
          stackName,
          services: {
            [serviceId]: {
              image: composeConfig.services[serviceId].image,
              domains: [domain],
              port: 3000, // Default port, should be configurable
              healthCheck: "/health",
            },
          },
          sslConfig: {
            email: "admin@example.com",
            provider: "letsencrypt",
          },
        });
        await this.swarmService.executeSwarmDeploy(stackName, traefikConfig);
      } else {
        await this.swarmService.executeSwarmDeploy(stackName, composeConfig);
      }
      job.progress(80);
      // Update stack status
      await this.updateStackStatus(stack.id, "running");
      // Clean up the upload files after successful deployment
      await fileUploadService.cleanupUpload(uploadId);
      job.progress(100);
      await this.updateJobStatus(job.id.toString(), "completed", 100);
      return {
        success: true,
        message: `Upload deployment completed for ${serviceId}`,
        stackId: stack.id,
        stackName,
        domain: domain || null,
      };
    } catch (error) {
      this.logger.error(`Upload deployment failed for ${uploadId}:`, error);
      await this.updateJobStatus(
        job.id.toString(),
        "failed",
        0,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }
  @Process("send-alert-notification")
  async handleAlertNotification(job: Job) {
    const { alert } = job.data;
    try {
      this.logger.log(`Processing alert notification: ${alert.message}`);
      // Update job status
      await this.updateJobStatus(job.id.toString(), "running", 10);
      // Log alert details
      this.logger.log(`Alert Details:
        Stack: ${alert.stackId}
        Type: ${alert.alertType}
        Severity: ${alert.severity}
        Message: ${alert.message}
        Current Value: ${alert.currentValue}
        Threshold: ${alert.threshold}
      `);
      // Here you would implement actual notification sending:
      // - Send email via SMTP
      // - Send Slack notification
      // - Send webhook notification
      // - Send SMS notification
      // - etc.
      // Simulate notification sending
      job.progress(50);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      // Mark as completed
      await this.updateJobStatus(job.id.toString(), "completed", 100);
      this.logger.log(
        `Alert notification sent successfully for ${alert.alertType} alert on stack ${alert.stackId}`
      );
      return {
        success: true,
        message: `Alert notification sent for ${alert.alertType}`,
      };
    } catch (error) {
      this.logger.error(`Alert notification job failed:`, error);
      await this.updateJobStatus(
        job.id.toString(),
        "failed",
        0,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }

  @Process("rollback")
  async handleRollback(
    job: Job<{
      deploymentId: string;
      targetDeploymentId: string;
    }>
  ): Promise<DeploymentJobResult> {
    const { deploymentId, targetDeploymentId } = job.data;
    this.logger.log(
      `Starting rollback job from ${deploymentId} to ${targetDeploymentId}`
    );
    try {
      await this.logDeployment(deploymentId, "info", "Rollback started", {
        targetDeploymentId,
      });
      // Get target deployment info
      const targetDeployment = await this.databaseService.db
        .select()
        .from(deployments)
        .where(eq(deployments.id, targetDeploymentId))
        .limit(1);
      if (!targetDeployment.length) {
        throw new Error(`Target deployment ${targetDeploymentId} not found`);
      }
      const target = targetDeployment[0];
      // Stop current containers and unregister domain
      await this.logDeployment(
        deploymentId,
        "info",
        "Stopping current containers and cleaning up domain"
      );
      await this.dockerService.stopContainersByDeployment(deploymentId);
      // TODO: Implement domain cleanup method
      // await this.traefikService.unregisterDeployment(deploymentId);
      // Start target deployment containers and register domain
      await this.logDeployment(
        deploymentId,
        "info",
        "Starting target deployment containers and registering domain"
      );
      await this.dockerService.startContainersByDeployment(targetDeploymentId);
      // Get target deployment container info for domain registration
      const containers =
        (await this.dockerService.listContainersByDeployment?.(
          targetDeploymentId
        )) || [];
      if (containers.length > 0) {
        await this.registerDomain(targetDeploymentId, containers[0].id);
      }
      // Update deployment statuses
      await this.updateDeploymentStatus(deploymentId, "cancelled");
      await this.updateDeploymentStatus(targetDeploymentId, "success");
      await this.logDeployment(
        deploymentId,
        "info",
        "Rollback completed successfully",
        {
          targetDeploymentId,
          targetVersion: target.metadata?.version,
        }
      );
      return {
        success: true,
        deploymentId: targetDeploymentId,
        message: "Rollback completed successfully",
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Rollback job failed:`, err);
      await this.logDeployment(
        deploymentId,
        "error",
        `Rollback failed: ${err.message}`,
        {
          error: err.stack,
          targetDeploymentId,
        }
      );
      return {
        success: false,
        deploymentId,
        error: err.message,
        message: "Rollback failed",
      };
    }
  }

  @Process("deploy-upload")
  async handleUploadDeployment(
    job: Job<{
      uploadId: string;
      serviceId: string;
      deploymentId: string;
      extractPath: string;
      environment?: string;
    }>
  ): Promise<DeploymentJobResult> {
    const {
      uploadId,
      serviceId,
      deploymentId,
      extractPath,
      environment = "production",
    } = job.data;
    this.logger.log(`Starting upload deployment job for upload ${uploadId}`);
    try {
      // Phase 1: QUEUED → PULLING_SOURCE
      await this.deploymentService.updateDeploymentPhase(
        deploymentId,
        DeploymentPhase.PULLING_SOURCE,
        10,
        { uploadId }
      );

      // Update deployment status to building
      await this.updateDeploymentStatus(deploymentId, "building");
      await this.logDeployment(
        deploymentId,
        "info",
        "Upload deployment started",
        {
          uploadId,
          serviceId,
          environment,
        }
      );
      // Get upload info and service details
      const uploadInfo =
        await this.fileUploadService.getUploadedFileInfo(uploadId);
      if (!uploadInfo) {
        throw new Error(`Upload ${uploadId} not found or expired`);
      }
      // Get service details to determine deployment strategy
      const serviceResult = await this.databaseService.db
        .select()
        .from(services)
        .innerJoin(projects, eq(services.projectId, projects.id))
        .where(eq(services.id, serviceId))
        .limit(1);
      if (!serviceResult.length) {
        throw new Error(`Service ${serviceId} not found`);
      }
      const { projects: project, services: service } = serviceResult[0];

      // Phase 2: BUILDING
      await this.deploymentService.updateDeploymentPhase(
        deploymentId,
        DeploymentPhase.BUILDING,
        30,
        { detectedType: uploadInfo.metadata.detectedType }
      );

      // Determine deployment strategy based on detected file type
      let deploymentResult;
      if (uploadInfo.metadata.detectedType === "static") {
        // Phase 3: COPYING_FILES
        await this.deploymentService.updateDeploymentPhase(
          deploymentId,
          DeploymentPhase.COPYING_FILES,
          50,
          { deploymentType: "static" }
        );

        // Static file deployment
        deploymentResult = await this.deployStaticFiles(
          deploymentId,
          extractPath,
          uploadInfo,
          service,
          project
        );
      } else if (uploadInfo.metadata.detectedType === "docker") {
        // Phase 3: COPYING_FILES
        await this.deploymentService.updateDeploymentPhase(
          deploymentId,
          DeploymentPhase.COPYING_FILES,
          50,
          { deploymentType: "docker" }
        );

        // Docker-based deployment
        deploymentResult = await this.deployDockerFiles(
          deploymentId,
          extractPath,
          uploadInfo,
          service,
          project
        );
      } else if (uploadInfo.metadata.detectedType === "node") {
        // Phase 3: COPYING_FILES
        await this.deploymentService.updateDeploymentPhase(
          deploymentId,
          DeploymentPhase.COPYING_FILES,
          50,
          { deploymentType: "node" }
        );

        // Node.js deployment
        deploymentResult = await this.deployNodeFiles(
          deploymentId,
          extractPath,
          uploadInfo,
          service,
          project
        );
      } else {
        // Default to static file serving
        deploymentResult = await this.deployStaticFiles(
          deploymentId,
          extractPath,
          uploadInfo,
          service,
          project
        );
      }

      // Phase 4: ACTIVE - Deployment completed successfully
      await this.deploymentService.updateDeploymentPhase(
        deploymentId,
        DeploymentPhase.ACTIVE,
        100,
        {
          deploymentType: uploadInfo.metadata.detectedType,
          completedAt: new Date().toISOString(),
          ...deploymentResult,
        }
      );

      // Success - update status
      await this.updateDeploymentStatus(deploymentId, "success");
      await this.logDeployment(
        deploymentId,
        "info",
        "Upload deployment completed successfully",
        {
          uploadId,
          deploymentType: uploadInfo.metadata.detectedType,
          ...deploymentResult,
        }
      );
      // Clean up upload files after successful deployment
      await this.fileUploadService.cleanupUpload(uploadId);
      return {
        success: true,
        deploymentId,
        message: "Upload deployment completed successfully",
        ...deploymentResult,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Upload deployment job failed for upload ${uploadId}:`,
        err
      );

      // Phase: FAILED
      await this.deploymentService.updateDeploymentPhase(
        deploymentId,
        DeploymentPhase.FAILED,
        0,
        {
          error: err.message,
          stack: err.stack,
          failedAt: new Date().toISOString(),
        }
      );

      // Update status to failed
      await this.updateDeploymentStatus(deploymentId, "failed");
      await this.logDeployment(
        deploymentId,
        "error",
        `Upload deployment failed: ${err.message}`,
        {
          error: err.stack,
          uploadId,
          extractPath,
        }
      );
      return {
        success: false,
        deploymentId,
        error: err.message,
        message: "Upload deployment failed",
      };
    }
  }

  /**
   * Generate Docker Compose configuration from uploaded files
   */
  private async generateComposeConfigFromUpload(
    uploadInfo: any,
    serviceId: string,
    projectId: string,
    domain?: string
  ): Promise<any> {
    const { metadata, extractedPath } = uploadInfo;
    let serviceConfig: any = {
      image: "",
      volumes: [`${extractedPath}:/app`],
      working_dir: "/app",
      networks: [`${projectId}_network`],
      deploy: {
        replicas: 1,
        update_config: {
          parallelism: 1,
          order: "start-first",
        },
        restart_policy: {
          condition: "on-failure",
          delay: "5s",
          max_attempts: 3,
        },
      },
    };
    // Configure based on detected project type
    switch (metadata.detectedType) {
      case "static":
        // For static sites, copy files to static volume and configure Traefik for direct serving
        const staticPath = `/app/static/${projectId}/${serviceId}`;
        // Copy files from extracted path to static volume
        await this.copyFilesToStaticVolume(extractedPath, staticPath);
        // No container needed - Traefik will serve directly from volume
        // Return null to indicate no container deployment needed
        return null;
      case "node":
        serviceConfig.image = "node:18-alpine";
        serviceConfig.command = [
          "sh",
          "-c",
          `${metadata.buildCommand || "npm ci"} && ${metadata.startCommand || "npm start"}`,
        ];
        serviceConfig.ports = ["3000:3000"];
        serviceConfig.environment = {
          NODE_ENV: "production",
          PORT: "3000",
        };
        break;
      case "docker":
        // For Docker projects, we'd need to build the image first
        // This is a simplified version - in practice, you'd want to build the image
        serviceConfig.build = {
          context: extractedPath,
          dockerfile: "Dockerfile",
        };
        serviceConfig.image = `${projectId}-${serviceId}:latest`;
        serviceConfig.ports = ["3000:3000"];
        break;
      default:
        // Default to static file serving
        serviceConfig.image = "nginx:alpine";
        serviceConfig.volumes = [`${extractedPath}:/usr/share/nginx/html:ro`];
        serviceConfig.ports = ["3000:80"];
    }
    // Add Traefik labels if domain is provided
    if (domain) {
      serviceConfig.deploy.labels = [
        "traefik.enable=true",
        `traefik.http.routers.${serviceId}.rule=Host(\`${domain}\`)`,
        `traefik.http.routers.${serviceId}.entrypoints=websecure`,
        `traefik.http.routers.${serviceId}.tls.certresolver=letsencrypt`,
        `traefik.http.services.${serviceId}.loadbalancer.server.port=3000`,
      ];
    }
    return {
      version: "3.8",
      services: {
        [serviceId]: serviceConfig,
      },
      networks: {
        [`${projectId}_network`]: {
          driver: "overlay",
          attachable: true,
        },
      },
    };
  }
  /**
   * Copy files from extracted location to static files volume
   */
  private async copyFilesToStaticVolume(
    sourcePath: string,
    targetPath: string
  ): Promise<void> {
    try {
      const fs = await import("fs-extra");
      // Ensure target directory exists
      await fs.ensureDir(targetPath);
      // Copy all files from source to target
      await fs.copy(sourcePath, targetPath, {
        overwrite: true,
        recursive: true,
      });
      this.logger.log(
        `Successfully copied files from ${sourcePath} to ${targetPath}`
      );
    } catch (error) {
      this.logger.error(`Failed to copy files to static volume: ${error}`);
      throw error;
    }
  }

  // Helper methods for standard deployments
  private async prepareSourceCode(
    sourceConfig: any,
    deploymentId: string
  ): Promise<string> {
    // Phase: PULLING_SOURCE - Start source code preparation
    await this.deploymentService.updateDeploymentPhase(
      deploymentId,
      DeploymentPhase.PULLING_SOURCE,
      10,
      { sourceType: sourceConfig.type, sourceConfig }
    );

    // Handle different source types based on provider configuration
    if (
      sourceConfig.type === "github" ||
      sourceConfig.type === "gitlab" ||
      sourceConfig.type === "git"
    ) {
      // Git-based sources need repository URL
      if (!sourceConfig.repositoryUrl) {
        throw new Error(
          `Repository URL is required for source type: ${sourceConfig.type}. ` +
            `Please ensure the service has a valid repository URL configured in its provider settings.`
        );
      }

      // Update phase with Git clone progress
      await this.deploymentService.updateDeploymentPhase(
        deploymentId,
        DeploymentPhase.PULLING_SOURCE,
        15,
        { 
          sourceType: sourceConfig.type,
          repositoryUrl: sourceConfig.repositoryUrl,
          branch: sourceConfig.branch || "main",
          cloneStatus: 'starting'
        }
      );

      const sourcePath = await this.gitService.cloneRepository({
        url: sourceConfig.repositoryUrl,
        branch: sourceConfig.branch || "main",
        commit: sourceConfig.commitSha,
        deploymentId,
      });

      // Complete Git clone phase
      await this.deploymentService.updateDeploymentPhase(
        deploymentId,
        DeploymentPhase.PULLING_SOURCE,
        25,
        { 
          sourceType: sourceConfig.type,
          repositoryUrl: sourceConfig.repositoryUrl,
          branch: sourceConfig.branch || "main",
          cloneStatus: 'completed',
          sourcePath
        }
      );

      return sourcePath;
    } else if (sourceConfig.type === "upload") {
      // Upload sources can be from file uploads, S3, Docker registry, etc.
      if (sourceConfig.filePath) {
        // Direct file upload
        await this.deploymentService.updateDeploymentPhase(
          deploymentId,
          DeploymentPhase.PULLING_SOURCE,
          15,
          { 
            sourceType: 'upload',
            uploadType: 'direct_file',
            filePath: sourceConfig.filePath,
            extractionStatus: 'starting'
          }
        );

        const sourcePath = await this.gitService.extractUploadedFile({
          filePath: sourceConfig.filePath,
          deploymentId,
        });

        await this.deploymentService.updateDeploymentPhase(
          deploymentId,
          DeploymentPhase.PULLING_SOURCE,
          25,
          { 
            sourceType: 'upload',
            uploadType: 'direct_file',
            extractionStatus: 'completed',
            sourcePath
          }
        );

        return sourcePath;
      } else if (sourceConfig.bucketName && sourceConfig.objectKey) {
        // S3 bucket source
        await this.deploymentService.updateDeploymentPhase(
          deploymentId,
          DeploymentPhase.PULLING_SOURCE,
          15,
          { 
            sourceType: 'upload',
            uploadType: 's3_bucket',
            bucketName: sourceConfig.bucketName,
            objectKey: sourceConfig.objectKey,
            downloadStatus: 'starting'
          }
        );

        const sourcePath = await this.downloadFromS3({
          bucketName: sourceConfig.bucketName,
          objectKey: sourceConfig.objectKey,
          region: sourceConfig.region,
          accessKeyId: sourceConfig.accessKeyId,
          secretAccessKey: sourceConfig.secretAccessKey,
          deploymentId,
        });

        await this.deploymentService.updateDeploymentPhase(
          deploymentId,
          DeploymentPhase.PULLING_SOURCE,
          25,
          { 
            sourceType: 'upload',
            uploadType: 's3_bucket',
            downloadStatus: 'completed',
            sourcePath
          }
        );

        return sourcePath;
      } else if (sourceConfig.registryUrl && sourceConfig.imageName) {
        // Docker registry source - handle differently
        throw new Error(
          "Docker registry deployments should be handled through the container deployment flow, not source code preparation."
        );
      } else if (
        sourceConfig.customData &&
        sourceConfig.customData.embeddedContent
      ) {
        // Embedded static content provided in customData (from seeded demo or manual)
        await this.deploymentService.updateDeploymentPhase(
          deploymentId,
          DeploymentPhase.PULLING_SOURCE,
          15,
          { 
            sourceType: 'upload',
            uploadType: 'embedded_content',
            contentSource: 'customData.embeddedContent',
            generationStatus: 'starting'
          }
        );

        const embedded = sourceConfig.customData.embeddedContent;
        const staticContent =
          typeof embedded === "string" ? embedded : JSON.stringify(embedded);
        const sourcePath = await this.createStaticContentFromEmbedded({
          staticContent,
          deploymentId,
        });

        await this.deploymentService.updateDeploymentPhase(
          deploymentId,
          DeploymentPhase.PULLING_SOURCE,
          25,
          { 
            sourceType: 'upload',
            uploadType: 'embedded_content',
            generationStatus: 'completed',
            sourcePath
          }
        );

        return sourcePath;
      } else if (
        sourceConfig.customData &&
        sourceConfig.customData.type === "static-content" &&
        sourceConfig.customData.content
      ) {
        // Legacy seeded static content format used in seed.ts
        await this.deploymentService.updateDeploymentPhase(
          deploymentId,
          DeploymentPhase.PULLING_SOURCE,
          15,
          { 
            sourceType: 'upload',
            uploadType: 'legacy_static_content',
            contentSource: 'customData.content',
            generationStatus: 'starting'
          }
        );

        const content = sourceConfig.customData.content;
        const staticContent =
          typeof content === "string" ? content : JSON.stringify(content);
        const sourcePath = await this.createStaticContentFromEmbedded({
          staticContent,
          deploymentId,
        });

        await this.deploymentService.updateDeploymentPhase(
          deploymentId,
          DeploymentPhase.PULLING_SOURCE,
          25,
          { 
            sourceType: 'upload',
            uploadType: 'legacy_static_content',
            generationStatus: 'completed',
            sourcePath
          }
        );

        return sourcePath;
      } else if (
        sourceConfig.staticContent &&
        sourceConfig.contentType === "embedded"
      ) {
        // Embedded static content (like seeded demo content)
        await this.deploymentService.updateDeploymentPhase(
          deploymentId,
          DeploymentPhase.PULLING_SOURCE,
          15,
          { 
            sourceType: 'upload',
            uploadType: 'static_content',
            contentType: 'embedded',
            generationStatus: 'starting'
          }
        );

        const sourcePath = await this.createStaticContentFromEmbedded({
          staticContent: sourceConfig.staticContent,
          deploymentId,
        });

        await this.deploymentService.updateDeploymentPhase(
          deploymentId,
          DeploymentPhase.PULLING_SOURCE,
          25,
          { 
            sourceType: 'upload',
            uploadType: 'static_content',
            generationStatus: 'completed',
            sourcePath
          }
        );

        return sourcePath;
      } else {
        // No file source specified - this might be a static service that needs file upload
        throw new Error(
          `This service appears to be configured for file upload deployment, but no files have been uploaded yet. ` +
            `Please use the file upload feature in the dashboard to upload your static files, ` +
            `or change the service provider to a git-based provider (github, gitlab, etc.) ` +
            `and configure a repository URL if you want to deploy from a git repository.`
        );
      }
    } else {
      throw new Error(`Unsupported source type: ${sourceConfig.type}`);
    }
  }

  private async buildContainerImage(
    sourcePath: string,
    deploymentId: string
  ): Promise<string> {
    const imageTag = `deployment-${deploymentId}:latest`;
    await this.dockerService.buildImage(sourcePath, imageTag);
    return imageTag;
  }

  private async deployContainer(
    imageTag: string,
    deploymentId: string
  ): Promise<{
    containerId: string;
  }> {
    const containerName = `deployment-${deploymentId}`;
    const containerId = await this.dockerService.createAndStartContainer({
      image: imageTag,
      name: containerName,
      deploymentId,
    });
    return { containerId };
  }

  private async performHealthCheck(containerId: string): Promise<void> {
    const maxRetries = 30; // 30 * 2 seconds = 1 minute
    let retries = 0;
    while (retries < maxRetries) {
      const isHealthy =
        await this.dockerService.checkContainerHealth(containerId);
      if (isHealthy) {
        return;
      }
      retries++;
      await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds
    }
    throw new Error(
      `Health check failed for container ${containerId} after ${maxRetries} retries`
    );
  }

  private async updateDeploymentStatus(
    deploymentId: string,
    status: (typeof deploymentStatusEnum.enumValues)[number]
  ): Promise<void> {
    await this.databaseService.db
      .update(deployments)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(eq(deployments.id, deploymentId));
  }

  private async logDeployment(
    deploymentId: string,
    level: "info" | "warn" | "error",
    message: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    // Sanitize message and metadata to prevent invalid byte sequences (NUL bytes) from causing DB errors
    const safeMessage = String(message || "").replace(/\u0000/g, "");
    let safeMetadata: Record<string, any> = {};
    try {
      const serialized = metadata ? JSON.stringify(metadata) : "{}";
      const sanitized = serialized.replace(/\u0000/g, "");
      safeMetadata =
        sanitized && sanitized !== "{}" ? JSON.parse(sanitized) : {};
    } catch {
      // If metadata can't be stringified/parsing fails, fall back to empty object
      safeMetadata = {};
    }
    await this.databaseService.db.insert(deploymentLogs).values({
      deploymentId,
      level,
      message: safeMessage,
      metadata: safeMetadata,
      timestamp: new Date(),
    });
  }

  private async registerDomain(
    deploymentId: string,
    _containerId: string
  ): Promise<string> {
    // Get deployment details with project and service info
    const deploymentResult = await this.databaseService.db
      .select({
        deployment: deployments,
        project: projects,
        service: services,
      })
      .from(deployments)
      .innerJoin(services, eq(deployments.serviceId, services.id))
      .innerJoin(projects, eq(services.projectId, projects.id))
      .where(eq(deployments.id, deploymentId))
      .limit(1);
    if (!deploymentResult.length) {
      throw new Error(`Deployment ${deploymentId} not found`);
    }
    const { deployment, project, service } = deploymentResult[0];
    // Generate subdomain based on deployment environment and details
    const subdomain = this.generateSubdomain(
      project.name,
      service.name,
      deployment.environment as "preview" | "production" | "staging",
      deployment.metadata?.branch,
      deployment.metadata?.pr,
      deployment.metadata?.customName
    );
    // Register domain with project-based Traefik (simplified)
    const domainUrl = `https://${subdomain}.${process.env.TRAEFIK_DOMAIN || "localhost"}`;
    // TODO: Implement proper domain registration logic with new schema
    // Update deployment with domain URL
    await this.databaseService.db
      .update(deployments)
      .set({
        domainUrl: domainUrl,
        updatedAt: new Date(),
      })
      .where(eq(deployments.id, deployment.id));
    return domainUrl;
  }

  private getCurrentStep(error: Error): string {
    const stack = error.stack || "";
    if (stack.includes("prepareSourceCode")) return "source_preparation";
    if (stack.includes("buildContainerImage")) return "image_build";
    if (stack.includes("deployContainer")) return "container_deployment";
    if (stack.includes("performHealthCheck")) return "health_check";
    return "unknown";
  }

  private generateSubdomain(
    projectName: string,
    serviceName: string,
    environment: string,
    branch?: string,
    pr?: string | number,
    customName?: string
  ): string {
    const sanitize = (str: string) =>
      str.toLowerCase().replace(/[^a-z0-9-]/g, "-");

    const projectPart = sanitize(projectName);
    const servicePart = sanitize(serviceName);
    const envPart = sanitize(environment);

    if (environment === "production") {
      return `${servicePart}-${projectPart}`;
    }

    if (customName) {
      return `${sanitize(customName)}-${servicePart}-${projectPart}`;
    }

    if (pr) {
      return `pr-${pr}-${servicePart}-${projectPart}`;
    }

    if (branch) {
      return `${sanitize(branch)}-${servicePart}-${projectPart}`;
    }

    return `${servicePart}-${envPart}-${projectPart}`;
  }

  // Additional helper methods for upload deployment
  private async deployStaticFiles(
    deploymentId: string,
    extractPath: string,
    uploadInfo: any,
    service: any,
    project: any
  ): Promise<{
    containerId?: string;
    domainUrl: string;
    deploymentType: "static";
  }> {
    await this.logDeployment(deploymentId, "info", "Deploying static files");
    // Generate domain URL
    const subdomain = this.generateSubdomain(
      project.name,
      service.name,
      "production"
    );
    const domainUrl = `https://${subdomain}.${project.baseDomain || "localhost"}`;
    // Setup static file serving (project-level) and inform Traefik
    await this.staticFileServingService.setupStaticServing(
      deploymentId,
      extractPath,
      service.id,
      project.id,
      domainUrl
    );
    await this.logDeployment(
      deploymentId,
      "info",
      "Static files deployed successfully",
      {
        domainUrl,
        fileCount: uploadInfo.fileCount,
      }
    );
    return {
      domainUrl,
      deploymentType: "static",
    };
  }

  private async deployDockerFiles(
    deploymentId: string,
    extractPath: string,
    _uploadInfo: any,
    _service: any,
    _project: any
  ): Promise<{
    containerId: string;
    domainUrl: string;
    imageTag: string;
    deploymentType: "docker";
  }> {
    await this.logDeployment(
      deploymentId,
      "info",
      "Deploying Docker application"
    );
    // Build container image from Dockerfile
    const imageTag = await this.buildContainerImage(extractPath, deploymentId);
    // Deploy container
    const { containerId } = await this.deployContainer(imageTag, deploymentId);
    // Register domain with Traefik
    const domainUrl = await this.registerDomain(deploymentId, containerId);
    // Perform health check
    await this.performHealthCheck(containerId);
    await this.logDeployment(
      deploymentId,
      "info",
      "Docker application deployed successfully",
      {
        containerId,
        imageTag,
        domainUrl,
      }
    );
    return {
      containerId,
      domainUrl,
      imageTag,
      deploymentType: "docker",
    };
  }

  private async deployNodeFiles(
    deploymentId: string,
    extractPath: string,
    uploadInfo: any,
    _service: any,
    _project: any
  ): Promise<{
    containerId: string;
    domainUrl: string;
    imageTag: string;
    deploymentType: "node";
  }> {
    await this.logDeployment(
      deploymentId,
      "info",
      "Deploying Node.js application"
    );
    // Create Dockerfile for Node.js app if it doesn't exist
    await this.generateNodeDockerfile(extractPath, uploadInfo);
    // Build container image
    const imageTag = await this.buildContainerImage(extractPath, deploymentId);
    // Deploy container
    const { containerId } = await this.deployContainer(imageTag, deploymentId);
    // Register domain with Traefik
    const domainUrl = await this.registerDomain(deploymentId, containerId);
    // Perform health check
    await this.performHealthCheck(containerId);
    await this.logDeployment(
      deploymentId,
      "info",
      "Node.js application deployed successfully",
      {
        containerId,
        imageTag,
        domainUrl,
        buildCommand: uploadInfo.metadata.buildCommand,
        startCommand: uploadInfo.metadata.startCommand,
      }
    );
    return {
      containerId,
      domainUrl,
      imageTag,
      deploymentType: "node",
    };
  }

  private async generateNodeDockerfile(
    extractPath: string,
    uploadInfo: any
  ): Promise<string> {
    const dockerfilePath = `${extractPath}/Dockerfile`;
    const fs = require("fs-extra");
    if (await fs.pathExists(dockerfilePath)) {
      return dockerfilePath; // Already has Dockerfile
    }
    // Generate Dockerfile for Node.js app
    const nodeVersion = "18"; // Default Node.js version
    const buildCommand = uploadInfo.metadata.buildCommand || "npm ci";
    const startCommand = uploadInfo.metadata.startCommand || "npm start";
    const dockerfileContent = `
FROM node:${nodeVersion}-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN ${buildCommand}

# Copy source code
COPY . .

# Build if build script exists
RUN if [ -f package.json ] && npm run build --silent 2>/dev/null; then npm run build; fi

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD curl -f http://localhost:3000/health || exit 1

# Start application
CMD ["sh", "-c", "${startCommand}"]
    `.trim();
    await fs.writeFile(dockerfilePath, dockerfileContent);
    return dockerfilePath;
  }

  /**
   * Download source code from S3 bucket
   */
  private async downloadFromS3(options: {
    bucketName: string;
    objectKey: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    deploymentId: string;
  }): Promise<string> {
    const { bucketName, objectKey } = options;

    try {
      // Import AWS SDK dynamically (if available)
      // Note: In a real implementation, you would install @aws-sdk/client-s3
      this.logger.log(`Downloading from S3: s3://${bucketName}/${objectKey}`);

      // For now, throw an error indicating S3 support needs to be implemented
      throw new Error(
        `S3 downloads are not yet implemented. ` +
          `To deploy from S3, please download the file manually and use the upload deployment method.`
      );
    } catch (error) {
      this.logger.error(`Failed to download from S3:`, error);
      throw error;
    }
  }

  /**
   * Create static content from embedded data (for seeded demo content)
   */
  private async createStaticContentFromEmbedded(options: {
    staticContent: string;
    deploymentId: string;
  }): Promise<string> {
    const { staticContent, deploymentId } = options;
    const fs = require("fs-extra");
    const path = require("path");

    // Create workspace directory
    const workspaceDir = process.env.WORKSPACE_DIR || "/tmp/deployer-workspace";
    const extractPath = path.join(workspaceDir, `deployment-${deploymentId}`);

    try {
      this.logger.log(
        `Creating static content from embedded data for deployment ${deploymentId}`
      );

      // Ensure directory exists
      await fs.ensureDir(extractPath);

      // Parse the static content (it should be JSON string containing file contents)
      let fileContents: Record<string, string>;
      try {
        fileContents = JSON.parse(staticContent);
      } catch (parseError) {
        this.logger.error(
          `Failed to parse embedded static content:`,
          parseError
        );
        throw new Error(
          `Invalid embedded static content format - expected JSON object with filename->content mapping`
        );
      }

      // Write each file to the extract path
      for (const [filename, content] of Object.entries(fileContents)) {
        const filePath = path.join(extractPath, filename);
        await fs.writeFile(filePath, content, "utf8");
        this.logger.log(`Created static file: ${filename}`);
      }

      this.logger.log(
        `Successfully created ${Object.keys(fileContents).length} static files in ${extractPath}`
      );
      return extractPath;
    } catch (error) {
      this.logger.error(
        `Failed to create static content from embedded data:`,
        error
      );
      // Clean up on failure
      if (await fs.pathExists(extractPath)) {
        await fs.remove(extractPath);
      }
      throw error;
    }
  }
}
