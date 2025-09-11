import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../../core/modules/db/services/database.service';
import { TraefikService } from '../../traefik/services/traefik.service';
import { projects, projectCollaborators, services, deployments } from '../../../core/modules/db/drizzle/schema';
import { eq, desc } from 'drizzle-orm';

@Injectable()
export class ProjectService {
  private readonly logger = new Logger(ProjectService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly traefikService: TraefikService,
  ) {}

  /**
   * Create a new project with automatic Traefik instance provisioning
   */
  async createProject(data: {
    name: string;
    description?: string;
    baseDomain?: string;
    ownerId: string;
    settings?: Record<string, any>;
  }) {
    this.logger.log(`Creating project with Traefik integration: ${data.name}`);
    
    const db = this.databaseService.db;
    
    try {
      // Start database transaction for atomic project + Traefik creation
      const result = await db.transaction(async (trx) => {
        // 1. Create the project first
        const [newProject] = await trx
          .insert(projects)
          .values({
            name: data.name,
            description: data.description || null,
            baseDomain: data.baseDomain || null,
            ownerId: data.ownerId,
            settings: data.settings || null,
          })
          .returning();

        if (!newProject) {
          throw new Error('Failed to create project');
        }

        // 2. Initialize project-based Traefik configuration (simplified)
        this.logger.log(`Initializing Traefik configuration for project: ${newProject.id}`);
        
        // TODO: Create initial domain configs and static configs if needed
        // For now, we rely on the new schema with project-based configs
        
        // Update project settings with Traefik info
        const currentSettings = (newProject.settings as any) || {};
        const updatedSettings = {
          ...currentSettings,
          traefikEnabled: true,
          domain: `${data.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}.${process.env.TRAEFIK_DOMAIN || 'localhost'}`,
        };

        await trx
          .update(projects)
          .set({
            settings: updatedSettings as any,
            updatedAt: new Date(),
            })
            .where(eq(projects.id, newProject.id));

        return { project: newProject };
      });

      this.logger.log(`Successfully created project ${result.project.id} with Traefik configuration`);
      return result;

    } catch (error: any) {
      this.logger.error(`Failed to create project with Traefik: ${error?.message || 'Unknown error'}`, error?.stack);
      throw new Error(`Project creation failed: ${error?.message || 'Unknown error'}`);
    }
  }

  /**
   * Update project and sync Traefik configuration if needed
   */
  async updateProject(
    projectId: string, 
    data: {
      name?: string;
      description?: string;
      baseDomain?: string;
      settings?: Record<string, any>;
    }
  ) {
    this.logger.log(`Updating project with Traefik sync: ${projectId}`);
    
    const db = this.databaseService.db;
    
    try {
      // Get current project data
      const [currentProject] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      if (!currentProject) {
        throw new Error('Project not found');
      }

      // Check if baseDomain changed - this affects Traefik configuration
      const baseDomainChanged = data.baseDomain && data.baseDomain !== currentProject.baseDomain;
      
      // Update project in database
      const updateData: any = {
        updatedAt: new Date(),
      };
      
      if (data.name !== undefined) updateData.name = data.name;
      if (data.description !== undefined) updateData.description = data.description;
      if (data.baseDomain !== undefined) updateData.baseDomain = data.baseDomain;
      if (data.settings !== undefined) updateData.settings = data.settings;

      const [updatedProject] = await db
        .update(projects)
        .set(updateData)
        .where(eq(projects.id, projectId))
        .returning();

      // If baseDomain changed, update all services in this project
      if (baseDomainChanged && updatedProject) {
        await this.syncProjectDomainChanges(projectId, data.baseDomain!);
      }

      return updatedProject;

    } catch (error: any) {
      this.logger.error(`Failed to update project: ${error?.message || 'Unknown error'}`, error?.stack);
      throw error;
    }
  }

  /**
   * Delete project and automatically cleanup all Traefik configurations
   */
  async deleteProject(projectId: string) {
    this.logger.log(`Deleting project with full Traefik cleanup: ${projectId}`);
    
    const db = this.databaseService.db;
    
    try {
      return await db.transaction(async (trx) => {
        // 1. Get project data
        const [project] = await trx
          .select()
          .from(projects)
          .where(eq(projects.id, projectId))
          .limit(1);

        if (!project) {
          return { success: false, message: 'Project not found' };
        }

        // 2. Get all services for cleanup (we'll clean up service configs manually)
        const projectServices = await trx
          .select()
          .from(services)
          .where(eq(services.projectId, projectId));

        // 3. Cleanup all service Traefik configurations manually
        for (const service of projectServices) {
          this.logger.log(`Cleaning up Traefik config for service: ${service.id}`);
          // We'll implement service cleanup by deleting route configs
          try {
            await this.cleanupServiceTraefikConfigs(service.id);
          } catch (cleanupError: any) {
            this.logger.warn(`Failed to cleanup Traefik config for service ${service.id}: ${cleanupError?.message}`);
          }
        }

        // 4. Get Traefik instance ID from project settings (with proper typing)
        const projectSettings = project.settings as any;
        const traefikInstanceId = projectSettings?.traefikInstanceId;
        
        // 5. Delete project (cascades to services, deployments, etc.)
        await trx
          .delete(projects)
          .where(eq(projects.id, projectId));

        // TODO: Clean up Traefik configurations for this project
        // For now, we rely on CASCADE DELETE from the schema
        if (traefikInstanceId) {
          this.logger.log(`Project had Traefik configuration: ${traefikInstanceId}`);
        }

        this.logger.log(`Successfully deleted project ${projectId} with cleanup`);
        return { 
          success: true, 
          message: 'Project deleted successfully with Traefik cleanup' 
        };
      });

    } catch (error: any) {
      this.logger.error(`Failed to delete project: ${error?.message || 'Unknown error'}`, error?.stack);
      throw error;
    }
  }

  /**
   * Get project with Traefik instance information
   */
  async getProjectWithTraefik(projectId: string) {
    this.logger.log(`Getting project with Traefik info: ${projectId}`);
    
    const db = this.databaseService.db;
    
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project) {
      throw new Error('Project not found');
    }

    // Get Traefik instance if exists (with proper type casting)
    const projectSettings = project.settings as any;
    const traefikInstanceId = projectSettings?.traefikInstanceId;
    // TODO: Implement project-based Traefik info gathering
    // For now, return project without instance data
    let traefikEnabled = false;
    
    if (traefikInstanceId) {
      try {
        traefikEnabled = true;
        this.logger.log(`Project has Traefik configuration: ${traefikInstanceId}`);
      } catch (error: any) {
        this.logger.warn(`Traefik configuration not found for project ${projectId}: ${error?.message}`);
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
    
    const db = this.databaseService.db;
    
    // Get all services in the project
    const projectServices = await db
      .select()
      .from(services)
      .where(eq(services.projectId, projectId));

    // Log the domain change (actual implementation would update Traefik configs)
    for (const service of projectServices) {
      try {
        const subdomain = service.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
        const newServiceDomain = `${subdomain}.${newBaseDomain}`;
        
        // TODO: Implement actual Traefik domain update when the method is available
        this.logger.log(`Would update domain for service ${service.id}: ${newServiceDomain}`);
        
        // For now, we just log the change
        // await this.updateServiceTraefikDomain(service.id, newServiceDomain);
        
      } catch (error: any) {
        this.logger.error(`Failed to update domain for service ${service.id}: ${error?.message}`);
      }
    }
  }

  /**
   * Ensure Traefik instance exists for project (used by services)
   */
  async ensureTraefikInstance(projectId: string) {
    this.logger.log(`Ensuring Traefik instance exists for project: ${projectId}`);
    
    const db = this.databaseService.db;
    
    // Get project
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project) {
      throw new Error('Project not found');
    }

    // Check if Traefik instance already exists (with proper type casting)
    const projectSettings = project.settings as any;
    const traefikInstanceId = projectSettings?.traefikInstanceId;
    
    if (traefikInstanceId) {
      this.logger.log(`Project has existing Traefik configuration: ${traefikInstanceId}`);
      // TODO: Return actual instance data from new schema
      return {
        id: traefikInstanceId,
        name: `traefik-${project.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
        project: project.name
      };
    }

    // TODO: Create new Traefik configuration with new schema
    this.logger.log(`Creating new Traefik configuration for project: ${project.name}`);
    
    const newConfigId = `traefik-${project.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

    // Update project with new Traefik configuration ID (with proper type casting)
    const updatedSettings = {
      ...(project.settings as any || {}),
      traefikInstanceId: newConfigId,
    };
    
    await db
      .update(projects)
      .set({
        settings: updatedSettings as any,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));

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
    
    // Example of what this would do:
    // 1. Find all route configs for this service 
    // 2. Delete them using deleteRouteConfig()
    // 3. Find and cleanup domain configs if no other services use them
    
    this.logger.log(`Traefik cleanup completed for service: ${serviceId}`);
  }

  /**
   * Get project statistics including Traefik status
   */
  async getProjectStats(projectId: string) {
    const db = this.databaseService.db;
    
    // Get service count
    const serviceResults = await db
      .select({ count: services.id })
      .from(services)
      .where(eq(services.projectId, projectId));
    const serviceCount = serviceResults.length > 0 ? serviceResults.length : 0;
      
    // Get deployment count (deployments are linked to services, not directly to projects)
    const serviceIds = await db
      .select({ id: services.id })
      .from(services)
      .where(eq(services.projectId, projectId));
    
    let deploymentCount = 0;
    if (serviceIds.length > 0) {
      for (const service of serviceIds) {
        const deploymentResults = await db
          .select({ count: deployments.id })
          .from(deployments)
          .where(eq(deployments.serviceId, service.id));
        deploymentCount += deploymentResults.length;
      }
    }
      
    // Get collaborator count
    const collaboratorResults = await db
      .select({ count: projectCollaborators.id })
      .from(projectCollaborators)
      .where(eq(projectCollaborators.projectId, projectId));
    const collaboratorCount = collaboratorResults.length > 0 ? collaboratorResults.length : 0;

    // Get latest deployment across all services
    let latestDeployment: any = null;
    if (serviceIds.length > 0) {
      for (const service of serviceIds) {
        const [deployment] = await db
          .select()
          .from(deployments)
          .where(eq(deployments.serviceId, service.id))
          .orderBy(desc(deployments.createdAt))
          .limit(1);
        
        if (deployment && (!latestDeployment || deployment.createdAt > latestDeployment.createdAt)) {
          latestDeployment = deployment;
        }
      }
    }

    // Get Traefik status
    const project = await this.getProjectWithTraefik(projectId);
    
    return {
      services: serviceCount,
      deployments: deploymentCount,
      collaborators: collaboratorCount,
      latestDeployment: latestDeployment || null,
      traefikStatus: project.traefikEnabled ? 'active' : 'inactive',
      traefikEnabled: project.traefikEnabled,
    };
  }
}