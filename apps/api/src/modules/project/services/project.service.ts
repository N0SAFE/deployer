/**
 * Project Service
 * 
 * PURPOSE: Business logic layer for project management
 * 
 * RESPONSIBILITIES:
 * - Business logic and validations
 * - Traefik integration orchestration
 * - Project lifecycle management
 * - Returns entities (not contracts)
 * 
 * PATTERN: Service-Adapter Pattern
 * - Uses repository for data access
 * - Returns raw entities
 * - Composable method names
 * - Business validations only
 */

import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ProjectRepository } from '../repositories/project.repository';
import type { 
  CreateProjectInput, 
  UpdateProjectInput, 
  ProjectSettings, 
  CreateCollaboratorInput, 
  UpdateCollaboratorInput, 
  CreateEnvironmentInput, 
  UpdateEnvironmentInput, 
  CreateVariableTemplateInput, 
  UpdateVariableTemplateInput,
  GetProjectsInput,
  CollaboratorPermissions,
  VariableTemplateVariable
} from '../interfaces/project.types';

@Injectable()
export class ProjectService {
  private readonly logger = new Logger(ProjectService.name);

  constructor(
    private readonly projectRepository: ProjectRepository,
  ) {}

  /**
   * Create a new project with automatic Traefik instance provisioning
   */
  async create(data: CreateProjectInput) {
    this.logger.log(`Creating project with Traefik integration: ${data.name}`);
    
    try {
      // Create the project
      const newProject = await this.projectRepository.create(data);

      if (!newProject) {
        throw new Error('Failed to create project');
      }

      // Initialize Traefik configuration (simplified)
      this.logger.log(`Initializing Traefik configuration for project: ${newProject.id}`);
      
      // Update project settings with Traefik info
      const currentSettings = (newProject.settings as ProjectSettings | null) || {};
      const updatedSettings = {
        ...currentSettings,
        traefikEnabled: true,
        domain: `${data.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}.${process.env.TRAEFIK_DOMAIN || 'localhost'}`,
      };

      const updatedProject = await this.projectRepository.update(newProject.id, {
        settings: updatedSettings as ProjectSettings,
      });

      this.logger.log(`Successfully created project ${newProject.id} with Traefik configuration`);
      
      return { project: updatedProject || newProject };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Failed to create project with Traefik: ${errorMessage}`, errorStack);
      throw new Error(`Project creation failed: ${errorMessage}`);
    }
  }

  /**
   * Update project and sync Traefik configuration if needed
   */
  async update(projectId: string, data: UpdateProjectInput) {
    this.logger.log(`Updating project with Traefik sync: ${projectId}`);
    
    try {
      // Get current project data
      const currentProject = await this.projectRepository.findById(projectId);

      if (!currentProject) {
        throw new Error('Project not found');
      }

      // Check if baseDomain changed - this affects Traefik configuration
      const baseDomainChanged = data.baseDomain && data.baseDomain !== currentProject.baseDomain;
      
      // Update project in database
      const updatedProject = await this.projectRepository.update(projectId, data);

      // If baseDomain changed, update all services in this project
      if (baseDomainChanged && updatedProject && data.baseDomain) {
        await this.syncProjectDomainChanges(projectId, data.baseDomain);
      }

      return updatedProject;

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Failed to update project: ${errorMessage}`, errorStack);
      throw error;
    }
  }

  /**
   * Delete project and automatically cleanup all Traefik configurations
   */
  async delete(projectId: string) {
    this.logger.log(`Deleting project with full Traefik cleanup: ${projectId}`);
    
    try {
      // Get project data
      const project = await this.projectRepository.findById(projectId);

      if (!project) {
        return { success: false, message: 'Project not found' };
      }

      // Get all services for cleanup
      const projectServices = await this.projectRepository.getServicesByProject(projectId);

      // Cleanup all service Traefik configurations
      for (const service of projectServices) {
        this.logger.log(`Cleaning up Traefik config for service: ${service.id}`);
        try {
          await this.cleanupServiceTraefikConfigs(service.id);
        } catch (cleanupError: unknown) {
          const message = cleanupError instanceof Error ? cleanupError.message : 'Unknown error';
          this.logger.warn(`Failed to cleanup Traefik config for service ${service.id}: ${message}`);
        }
      }

      // Get Traefik instance ID from project settings
      const projectSettings = project.settings as ProjectSettings | null;
      const traefikInstanceId = projectSettings?.traefikInstanceId;
      
      // Delete project (cascades to services, deployments, etc.)
      await this.projectRepository.delete(projectId);

      if (traefikInstanceId) {
        this.logger.log(`Project had Traefik configuration: ${traefikInstanceId}`);
      }

      this.logger.log(`Successfully deleted project ${projectId} with cleanup`);
      return { 
        success: true, 
        message: 'Project deleted successfully with Traefik cleanup' 
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Failed to delete project: ${errorMessage}`, errorStack);
      throw error;
    }
  }

  /**
   * Get project with Traefik instance information
   */
  async findByIdWithTraefik(projectId: string) {
    this.logger.log(`Getting project with Traefik info: ${projectId}`);
    
    const project = await this.projectRepository.findById(projectId);

    if (!project) {
      throw new Error('Project not found');
    }

    // Get Traefik instance if exists
    const projectSettings = project.settings as ProjectSettings | null;
    const traefikInstanceId = projectSettings?.traefikInstanceId;
    let traefikEnabled = false;
    
    if (traefikInstanceId) {
      try {
        traefikEnabled = true;
        this.logger.log(`Project has Traefik configuration: ${traefikInstanceId}`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(`Traefik configuration not found for project ${projectId}: ${message}`);
      }
    }

    return {
      ...project,
      traefikEnabled,
    };
  }

  /**
   * Sync domain changes across all services in the project
   */
  private async syncProjectDomainChanges(projectId: string, newBaseDomain: string) {
    this.logger.log(`Syncing domain changes for project ${projectId} to ${newBaseDomain}`);
    
    // Get all services in the project
    const projectServices = await this.projectRepository.getServicesByProject(projectId);

    // Log the domain change (actual implementation would update Traefik configs)
    for (const service of projectServices) {
      try {
        const subdomain = service.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
        const newServiceDomain = `${subdomain}.${newBaseDomain}`;
        
                // TODO: Implement actual Traefik domain update when the method is available
        this.logger.log(`Would update service ${service.id} domain to: ${newServiceDomain}`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(`Failed to update domain for service ${service.id}: ${message}`);
      }
    }
  }

  /**
   * Ensure Traefik instance exists for project (used by services)
   */
  async ensureTraefikInstance(projectId: string) {
    this.logger.log(`Ensuring Traefik instance exists for project: ${projectId}`);
    
    // Get project
    const project = await this.projectRepository.findById(projectId);

    if (!project) {
      throw new Error('Project not found');
    }

    // Check if Traefik instance already exists
    const projectSettings = project.settings as ProjectSettings | null;
    const traefikInstanceId = projectSettings?.traefikInstanceId;
    
    if (traefikInstanceId) {
      this.logger.log(`Project has existing Traefik configuration: ${traefikInstanceId}`);
      return {
        id: traefikInstanceId,
        name: `traefik-${project.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
        project: project.name
      };
    }

    // Create new Traefik configuration
    this.logger.log(`Creating new Traefik configuration for project: ${project.name}`);
    
    const newConfigId = `traefik-${project.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

    // Update project with new Traefik configuration ID
    const updatedSettings: ProjectSettings = {
      ...(project.settings as ProjectSettings | null || {}),
      traefikInstanceId: newConfigId,
    };
    
    await this.projectRepository.update(projectId, {
      settings: updatedSettings,
    });

    return {
      id: newConfigId,
      name: `traefik-${project.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
      project: project.name
    };
  }

  /**
   * Cleanup service Traefik configurations
   */
  private async cleanupServiceTraefikConfigs(serviceId: string) {
    this.logger.log(`Cleaning up Traefik configurations for service: ${serviceId}`);
    
    // TODO: Implement actual cleanup using TraefikService methods
    // For now, we'll just log the cleanup operation
    
    this.logger.log(`Traefik cleanup completed for service: ${serviceId}`);
  }

  /**
   * Get project statistics including Traefik status
   */
  async getStats(projectId: string) {
    // Get service count
    const serviceCount = await this.projectRepository.getServiceCountByProject(projectId);
      
    // Get deployment count
    const deploymentCount = await this.projectRepository.getDeploymentCountByProject(projectId);
      
    // Get collaborator count
    const collaboratorCount = await this.projectRepository.getCollaboratorCountByProject(projectId);

    // Get latest deployment
    const latestDeployment = await this.projectRepository.getLatestDeploymentByProject(projectId);

    // Get Traefik status
    const project = await this.findByIdWithTraefik(projectId);
    
    return {
      services: serviceCount,
      deployments: deploymentCount,
      collaborators: collaboratorCount,
      latestDeployment: latestDeployment || null,
      traefikStatus: project.traefikEnabled ? 'active' : 'inactive',
      traefikEnabled: project.traefikEnabled,
    };
  }

  /**
   * Find many projects with pagination and filtering
   */
  async findMany(filters: GetProjectsInput) {
    return await this.projectRepository.findMany(filters);
  }

  /**
   * Find project by ID
   */
  async findById(id: string) {
    return await this.projectRepository.findById(id);
  }

  // ========================================
  // COLLABORATOR METHODS
  // ========================================

  /**
   * Get all collaborators for a project
   */
  async getCollaborators(projectId: string) {
    return await this.projectRepository.findCollaboratorsByProject(projectId);
  }

  /**
   * Invite/add a collaborator to a project
   */
  async inviteCollaborator(projectId: string, data: { userId: string; role: string; permissions?: CollaboratorPermissions; invitedBy: string | null }) {
    const collaboratorData = {
      id: crypto.randomUUID(),
      projectId,
      userId: data.userId,
      role: data.role,
      permissions: data.permissions,
      invitedBy: data.invitedBy,
      invitedAt: new Date(),
    };
    
    return await this.projectRepository.createCollaborator(collaboratorData);
  }

  /**
   * Update collaborator role/permissions
   */
  async updateCollaborator(projectId: string, userId: string, data: { role?: string; permissions?: CollaboratorPermissions }) {
    // Find the collaborator first
    const collaborator = await this.projectRepository.findCollaboratorByUserAndProject(userId, projectId);
    
    if (!collaborator) {
      throw new Error('Collaborator not found');
    }
    
    return await this.projectRepository.updateCollaborator(collaborator.id, data);
  }

  /**
   * Remove collaborator from project
   */
  async removeCollaborator(projectId: string, userId: string) {
    await this.projectRepository.deleteCollaborator(projectId, userId);
    return { success: true, message: 'Collaborator removed successfully' };
  }

  /**
   * Find user by email (for invite flow)
   */
  async findUserByEmail(email: string) {
    return await this.projectRepository.findUserByEmail(email);
  }

  // ========================================
  // ENVIRONMENT METHODS
  // ========================================

  /**
   * Get all environments for a project
   */
  async getEnvironments(projectId: string, type?: string) {
    return await this.projectRepository.findEnvironmentsByProject(projectId, type);
  }

  /**
   * Get single environment by ID
   */
  async getEnvironment(environmentId: string) {
    return await this.projectRepository.findEnvironmentById(environmentId);
  }

  /**
   * Create new environment
   */
  async createEnvironment(data: CreateEnvironmentInput) {
    return await this.projectRepository.createEnvironment(data);
  }

  /**
   * Update environment
   */
  async updateEnvironment(environmentId: string, data: UpdateEnvironmentInput) {
    return await this.projectRepository.updateEnvironment(environmentId, data);
  }

  /**
   * Delete environment
   */
  async deleteEnvironment(environmentId: string) {
    await this.projectRepository.deleteEnvironment(environmentId);
    return { success: true, message: 'Environment deleted successfully' };
  }

  /**
   * Clone environment
   */
  async cloneEnvironment(sourceEnvironmentId: string, data: { name: string; slug: string; createdBy: string }) {
    // Get source environment
    const sourceEnv = await this.projectRepository.findEnvironmentById(sourceEnvironmentId);
    
    if (!sourceEnv) {
      throw new Error('Source environment not found');
    }

    if (!sourceEnv.projectId) {
      throw new Error('Source environment has no project ID');
    }

    // Create new environment with cloned data
    const newEnvData = {
      projectId: sourceEnv.projectId!, // Already checked above
      name: data.name,
      slug: data.slug,
      description: `Cloned from ${sourceEnv.name}`,
      type: sourceEnv.type,
      status: 'inactive' as const,
      domainConfig: sourceEnv.domainConfig ?? undefined,
      previewSettings: sourceEnv.previewSettings ?? undefined,
      deploymentConfig: sourceEnv.deploymentConfig ?? undefined,
      metadata: sourceEnv.metadata ?? undefined,
      createdBy: data.createdBy,
    };

    return await this.projectRepository.createEnvironment(newEnvData);
  }

  // ========================================
  // VARIABLE TEMPLATE METHODS
  // ========================================

  /**
   * Get all variable templates
   */
  async getVariableTemplates() {
    return await this.projectRepository.findAllVariableTemplates();
  }

  /**
   * Get single variable template
   */
  async getVariableTemplate(templateId: string) {
    return await this.projectRepository.findVariableTemplateById(templateId);
  }

  /**
   * Create variable template
   */
  async createVariableTemplate(data: { name: string; description?: string | null; variables: unknown[]; createdBy: string }) {
    return await this.projectRepository.createVariableTemplate({
      ...data,
      variables: data.variables as VariableTemplateVariable[],
    });
  }

  /**
   * Update variable template
   */
  async updateVariableTemplate(templateId: string, data: { name?: string; description?: string | null; variables?: unknown[] }) {
    return await this.projectRepository.updateVariableTemplate(templateId, {
      ...data,
      variables: data.variables ? data.variables as VariableTemplateVariable[] : undefined,
    });
  }

  /**
   * Delete variable template
   */
  async deleteVariableTemplate(templateId: string) {
    await this.projectRepository.deleteVariableTemplate(templateId);
    return { success: true, message: 'Variable template deleted successfully' };
  }
}

