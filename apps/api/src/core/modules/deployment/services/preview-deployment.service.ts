import { Injectable, Logger } from '@nestjs/common';
import { DeploymentService } from './deployment.service';

/**
 * Manage preview deployments lifecycle: create, update, delete, and cleanup.
 * This service provides a small abstraction so preview-specific logic is
 * centralized (e.g., naming conventions, auto-cleanup policies).
 */
@Injectable()
export class PreviewDeploymentService {
  private readonly logger = new Logger(PreviewDeploymentService.name);
  constructor(private readonly deploymentService: DeploymentService) {}

  async createPreviewDeployment(options: {
    serviceId: string;
    repositoryUrl: string;
    branch: string;
    commitSha: string;
    previewId: string | number;
    builder?: string;
    provider?: any;
  }) {
    this.logger.log(`Creating preview deployment for ${options.serviceId} preview ${options.previewId}`);
    const deploymentId = await this.deploymentService.createDeployment({
      serviceId: options.serviceId,
      sourceType: 'github',
      sourceConfig: {
        repositoryUrl: options.repositoryUrl,
        branch: options.branch,
        commitSha: options.commitSha,
        customData: {
          preview: options.previewId,
        },
      },
      triggeredBy: 'preview-service',
      environment: 'preview',
      metadata: {
        previewId: String(options.previewId),
      },
    });

    await this.deploymentService.deployService(
      {
        deploymentId,
        serviceName: options.serviceId,
        sourcePath: `/tmp/deployments/${deploymentId}`,
        buildType: options.builder || 'static',
        environmentVariables: {},
      },
      options.provider
    );

    return deploymentId;
  }

  async updatePreviewDeployment(deploymentId: string, opts: any) {
    // Placeholder - in future will support in-place updates for previews
    this.logger.log(`Updating preview deployment ${deploymentId} (placeholder)`);
    // For now, just trigger a new deploy via DeploymentService
    await this.deploymentService.deployService({ deploymentId, ...opts }, opts.provider);
  }

  async deletePreviewDeployment(deploymentId: string) {
    this.logger.log(`Deleting preview deployment ${deploymentId} (placeholder)`);
    // Placeholder: Call deploymentService to mark / cleanup
    // TODO: Implement actual resource cleanup and Traefik deregistration
    // Mark the deployment as cancelled/deleted so other systems can react.
    await this.deploymentService.updateDeploymentStatus(deploymentId, 'cancelled');
    return { success: true };
  }
}
