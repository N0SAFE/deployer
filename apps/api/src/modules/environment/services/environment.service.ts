import { Injectable, Logger, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { EnvironmentRepository, Environment, NewEnvironment, EnvironmentVariable } from '../repositories/environment.repository';

@Injectable()
export class EnvironmentService {
  private readonly logger = new Logger(EnvironmentService.name);

  constructor(private readonly environmentRepository: EnvironmentRepository) {}

  // Environment management
  async createEnvironment(data: {
    name: string;
    slug: string;
    description?: string;
    type: 'production' | 'staging' | 'preview' | 'development';
    projectId?: string;
    templateId?: string;
    domainConfig?: any;
    networkConfig?: any;
    deploymentConfig?: any;
    resourceLimits?: any;
    previewSettings?: any;
    createdBy: string;
  }): Promise<Environment> {
    this.logger.log(`Creating environment: ${data.name}`);

    // Validate slug uniqueness
    const isSlugAvailable = await this.environmentRepository.validateEnvironmentSlug(
      data.slug,
      data.projectId
    );

    if (!isSlugAvailable) {
      throw new ConflictException('Environment slug already exists in this project');
    }

    // Generate slug if not provided
    if (!data.slug) {
      data.slug = this.generateSlug(data.name);
    }

    const newEnvironment: NewEnvironment = {
      name: data.name,
      slug: data.slug,
      description: data.description,
      type: data.type,
      status: 'pending',
      templateId: data.templateId,
      projectId: data.projectId,
      domainConfig: data.domainConfig,
      networkConfig: data.networkConfig,
      deploymentConfig: data.deploymentConfig,
      resourceLimits: data.resourceLimits,
      previewSettings: data.previewSettings,
      metadata: {
        serviceCount: 0,
        deploymentCount: 0,
        accessCount: 0,
        tags: [],
      },
      isActive: true,
      createdBy: data.createdBy,
    };

    const environment = await this.environmentRepository.createEnvironment(newEnvironment);

    // If template is provided, apply template variables
    if (data.templateId) {
      await this.applyEnvironmentTemplate(environment.id, data.templateId, data.createdBy);
    }

    return environment;
  }

  async listEnvironments(params: {
    projectId?: string;
    type?: string;
    status?: string;
    search?: string;
    limit?: number;
    offset?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    return await this.environmentRepository.listEnvironments(params);
  }

  async getEnvironment(id: string): Promise<Environment> {
    const environment = await this.environmentRepository.findEnvironmentById(id);
    if (!environment) {
      throw new NotFoundException('Environment not found');
    }
    return environment;
  }

  async getEnvironmentBySlug(slug: string, projectId?: string): Promise<Environment> {
    const environment = await this.environmentRepository.findEnvironmentBySlug(slug, projectId);
    if (!environment) {
      throw new NotFoundException('Environment not found');
    }
    return environment;
  }

  async updateEnvironment(id: string, updates: {
    name?: string;
    slug?: string;
    description?: string;
    status?: 'healthy' | 'updating' | 'error' | 'pending' | 'inactive';
    domainConfig?: any;
    networkConfig?: any;
    deploymentConfig?: any;
    resourceLimits?: any;
    previewSettings?: any;
    metadata?: any;
  }): Promise<Environment> {
    const environment = await this.getEnvironment(id);

    // Validate slug uniqueness if changing
    if (updates.slug && updates.slug !== environment.slug) {
      const isSlugAvailable = await this.environmentRepository.validateEnvironmentSlug(
        updates.slug,
        environment.projectId || undefined,
        id
      );

      if (!isSlugAvailable) {
        throw new ConflictException('Environment slug already exists in this project');
      }
    }

    const updated = await this.environmentRepository.updateEnvironment(id, updates);
    if (!updated) {
      throw new NotFoundException('Environment not found');
    }

    return updated;
  }

  async deleteEnvironment(id: string): Promise<void> {
    const environment = await this.getEnvironment(id);
    
    // Check if environment has active deployments (you would implement this check)
    // For now, we'll just soft delete
    
    const deleted = await this.environmentRepository.deleteEnvironment(id);
    if (!deleted) {
      throw new NotFoundException('Environment not found');
    }

    this.logger.log(`Environment ${environment.name} (${id}) deleted`);
  }

  // Environment Variables management
  async getEnvironmentVariables(environmentId: string): Promise<EnvironmentVariable[]> {
    // Verify environment exists
    await this.getEnvironment(environmentId);
    return await this.environmentRepository.findEnvironmentVariables(environmentId);
  }

  async updateEnvironmentVariables(
    environmentId: string, 
    variables: Array<{
      key: string;
      value: string;
      isSecret?: boolean;
      description?: string;
      isDynamic?: boolean;
      template?: string;
    }>,
    userId: string
  ): Promise<EnvironmentVariable[]> {
    // Verify environment exists
    await this.getEnvironment(environmentId);

    // Validate variable keys are unique
    const keys = variables.map(v => v.key);
    const uniqueKeys = new Set(keys);
    if (keys.length !== uniqueKeys.size) {
      throw new BadRequestException('Variable keys must be unique');
    }

    // Validate dynamic variables have templates
    for (const variable of variables) {
      if (variable.isDynamic && !variable.template) {
        throw new BadRequestException(`Dynamic variable ${variable.key} must have a template`);
      }
    }

    const updatedVariables = await this.environmentRepository.bulkUpdateVariables(
      environmentId,
      variables,
      userId
    );

    // Trigger variable resolution for dynamic variables
    await this.resolveEnvironmentVariables(environmentId);

    return updatedVariables;
  }

  // Variable resolution
  async resolveEnvironmentVariables(environmentId: string): Promise<void> {
    this.logger.log(`Resolving variables for environment: ${environmentId}`);

    const variables = await this.environmentRepository.findEnvironmentVariables(environmentId);
    const dynamicVariables = variables.filter(v => v.isDynamic);

    for (const variable of dynamicVariables) {
      if (variable.template) {
        try {
          const resolvedValue = await this.resolveVariableTemplate(
            variable.template,
            environmentId
          );

          await this.environmentRepository.updateEnvironmentVariable(variable.id, {
            resolvedValue,
            resolutionStatus: 'resolved',
            resolutionError: null,
            lastResolved: new Date(),
          });
        } catch (error) {
          await this.environmentRepository.updateEnvironmentVariable(variable.id, {
            resolutionStatus: 'failed',
            resolutionError: error instanceof Error ? error.message : 'Unknown error',
            lastResolved: new Date(),
          });
        }
      }
    }
  }

  // Variable template resolution (simplified - you would implement full logic)
  private async resolveVariableTemplate(template: string, environmentId: string): Promise<string> {
    // This is a simplified version - you would implement full variable resolution logic
    // including references to services, projects, databases, etc.
    
    let resolved = template;
    
    // Simple placeholder resolution - replace with actual implementation
    const placeholderRegex = /\$\{([^}]+)\}/g;
    const matches = template.match(placeholderRegex);
    
    if (matches) {
      for (const match of matches) {
        const path = match.slice(2, -1); // Remove ${ and }
        const resolvedValue = await this.resolveVariablePath(path, environmentId);
        resolved = resolved.replace(match, resolvedValue);
      }
    }
    
    return resolved;
  }

  private async resolveVariablePath(path: string, environmentId: string): Promise<string> {
    // Parse path like "services.api.url" or "projects.name"
    // const parts = path.split('.');
    
    // This would be implemented based on your actual data model
    // For now, return a placeholder
    return `resolved_${path}_${environmentId}`;
  }

  // Environment status management
  async updateEnvironmentStatus(
    id: string, 
    status: 'healthy' | 'updating' | 'error' | 'pending' | 'inactive',
    metadata?: any
  ): Promise<Environment> {
    const updated = await this.environmentRepository.updateEnvironmentStatus(id, status, metadata);
    if (!updated) {
      throw new NotFoundException('Environment not found');
    }

    this.logger.log(`Environment ${id} status updated to: ${status}`);
    return updated;
  }

  // Preview environments
  async createPreviewEnvironment(data: {
    name: string;
    projectId?: string;
    sourceBranch?: string;
    sourcePR?: number;
    sourceCommit?: string;
    cleanupAfterDays?: number;
    customVariables?: Record<string, string>;
    createdBy: string;
  }): Promise<Environment> {
    // Generate unique slug for preview environment
    const baseSlug = data.sourceBranch 
      ? `preview-${data.sourceBranch}`
      : data.sourcePR 
      ? `preview-pr-${data.sourcePR}`
      : `preview-${Date.now()}`;
    
    const slug = this.generateUniqueSlug(baseSlug);

    // Calculate expiration date
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (data.cleanupAfterDays || 7));

    const previewSettings = {
      autoCleanupEnabled: true,
      cleanupAfterDays: data.cleanupAfterDays || 7,
      sourceType: data.sourceBranch ? 'branch' as const : data.sourcePR ? 'pr' as const : 'commit' as const,
      sourceBranch: data.sourceBranch,
      sourcePR: data.sourcePR,
      sourceCommit: data.sourceCommit,
      expiresAt: expiresAt.toISOString(),
    };

    const environment = await this.createEnvironment({
      name: data.name,
      slug,
      type: 'preview',
      projectId: data.projectId,
      previewSettings,
      deploymentConfig: {
        autoDeployEnabled: true,
        deploymentStrategy: 'recreate',
        healthCheckEnabled: true,
        rollbackEnabled: false,
        maxInstances: 1,
        deployTimeoutMinutes: 5,
      },
      resourceLimits: {
        memory: '512m',
        cpu: '0.5',
        storage: '1g',
        maxServices: 5,
      },
      createdBy: data.createdBy,
    });

    // Add custom variables if provided
    if (data.customVariables) {
      const variables = Object.entries(data.customVariables).map(([key, value]) => ({
        key,
        value,
        isSecret: false,
        description: `Custom variable for preview environment`,
      }));

      await this.updateEnvironmentVariables(environment.id, variables, data.createdBy);
    }

    return environment;
  }

  async listPreviewEnvironments(projectId?: string): Promise<Environment[]> {
    return await this.environmentRepository.findPreviewEnvironments(projectId);
  }

  async cleanupExpiredPreviewEnvironments(): Promise<string[]> {
    return await this.environmentRepository.cleanupExpiredPreviewEnvironments();
  }

  // Environment templates
  async applyEnvironmentTemplate(environmentId: string, templateId: string, _userId: string): Promise<void> {
    this.logger.log(`Applying template ${templateId} to environment ${environmentId}`);
    
    // This would load template and apply its configuration
    // For now, just a placeholder
  }

  // Helper methods
  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  private generateUniqueSlug(baseSlug: string): string {
    // Add timestamp to ensure uniqueness
    return `${baseSlug}-${Date.now()}`;
  }

  // Bulk operations
  async bulkDeleteEnvironments(ids: string[]): Promise<number> {
    if (ids.length === 0) {
      throw new BadRequestException('No environment IDs provided');
    }

    return await this.environmentRepository.bulkDeleteEnvironments(ids);
  }

  // Access logging
  async logAccess(environmentId: string, userId: string | undefined, action: string, metadata?: any): Promise<void> {
    await this.environmentRepository.logEnvironmentAccess({
      environmentId,
      userId,
      action,
      metadata,
    });
  }
}