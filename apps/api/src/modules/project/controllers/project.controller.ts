import { Controller, Logger } from '@nestjs/common';
import { Implement, implement } from '@orpc/nest';
import { projectContract } from '@repo/api-contracts';
import { ProjectService } from '../services/project.service';
import { ProjectAdapter } from '../adapters/project-adapter.service';
import { Session } from '@/core/modules/auth/decorators/decorators';
import type { UserSession } from '@/core/modules/auth/guards/auth.guard';
import { projectCollaborators } from '@/config/drizzle/schema/deployment';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '@/core/modules/database/services/database.service';

@Controller()
export class ProjectController {
    private readonly logger = new Logger(ProjectController.name);
    
    constructor(
        private readonly projectService: ProjectService,
        private readonly projectAdapter: ProjectAdapter,
        private readonly databaseService: DatabaseService,
    ) { }

    @Implement(projectContract.list)
    list() {
        return implement(projectContract.list).handler(async ({ input }) => {
            this.logger.log('Listing projects');
            
            const limit = input?.limit || 20;
            const offset = input?.offset || 0;
            const search = input?.search;
            const sortBy = input?.sortBy || 'updatedAt';
            const sortOrder = input?.sortOrder || 'desc';
            
            // Use service layer for business logic
            const result = await this.projectService.findMany({
                limit,
                offset,
                search,
                sortBy,
                sortOrder,
            });
            
            // Use adapter to transform to contract
            return this.projectAdapter.adaptProjectListToContract(
                { projects: result.projects, total: result.total },
                limit,
                offset,
            );
        });
    }
    @Implement(projectContract.getById)
    getById() {
        return implement(projectContract.getById).handler(async ({ input }) => {
            this.logger.log(`Getting project by id: ${input.id}`);
            
            // Use service layer
            const project = await this.projectService.findById(input.id);
            
            if (!project) {
                throw new Error('Project not found');
            }
            
            // Use adapter to transform to contract
            return this.projectAdapter.adaptProjectToContract(project);
        });
    }
    @Implement(projectContract.create)
    create(
    @Session()
    session?: UserSession) {
        return implement(projectContract.create).handler(async ({ input }) => {
            this.logger.log(`Creating project with automatic Traefik provisioning: ${input.name}`);
            
            // For testing purposes, use a default owner ID if no session
            const ownerId = session?.user?.id || 'OpIctJdhFisLZRi2UBl0E1x9f3KUEcsg';
            
            // Use ProjectService to create project with automatic Traefik setup
            const result = await this.projectService.create({
                name: input.name,
                description: input.description || undefined,
                baseDomain: input.baseDomain || undefined,
                ownerId: ownerId,
                settings: input.settings || undefined,
            });

            const newProject = result.project;
            return {
                id: newProject.id,
                name: newProject.name,
                description: newProject.description,
                baseDomain: newProject.baseDomain,
                ownerId: newProject.ownerId,
                settings: newProject.settings,
                createdAt: new Date(newProject.createdAt),
                updatedAt: new Date(newProject.updatedAt),
            };
        });
    }
    @Implement(projectContract.update)
    update() {
        return implement(projectContract.update).handler(async ({ input }) => {
            this.logger.log(`Updating project with automatic Traefik update: ${input.id}`);
            
            // Build update object dynamically
            const updateData: any = {};
            if (input.name !== undefined) updateData.name = input.name;
            if (input.description !== undefined) updateData.description = input.description;
            if (input.baseDomain !== undefined) updateData.baseDomain = input.baseDomain;
            if (input.settings !== undefined) updateData.settings = input.settings;

            // Use ProjectService to update project with automatic Traefik handling
            const updatedProject = await this.projectService.update(input.id, updateData);
            
            return updatedProject;
        });
    }
    @Implement(projectContract.delete)
    delete() {
        return implement(projectContract.delete).handler(async ({ input }) => {
            this.logger.log(`Deleting project with automatic Traefik cleanup: ${input.id}`);
            
            // Use ProjectService to delete project with automatic Traefik cleanup
            const result = await this.projectService.delete(input.id);
            
            return result;
        });
    }
    @Implement(projectContract.getCollaborators)
    getCollaborators() {
        return implement(projectContract.getCollaborators).handler(async ({ input }) => {
            this.logger.log(`Getting collaborators for project: ${input.id}`);
            // Get database connection
            const db = this.databaseService.db;
            // Get all collaborators for the project
            const collaborators = await db
                .select()
                .from(projectCollaborators)
                .where(eq(projectCollaborators.projectId, input.id));
            // Transform to match contract schema - convert null permissions to undefined
            const transformedCollaborators = collaborators.map(collaborator => ({
                ...collaborator,
                permissions: collaborator.permissions || undefined
            }));
            return { collaborators: transformedCollaborators };
        });
    }
    @Implement(projectContract.inviteCollaborator)
    inviteCollaborator(
    @Session()
    session?: UserSession) {
        return implement(projectContract.inviteCollaborator).handler(async ({ input }) => {
            this.logger.log(`Inviting collaborator ${input.email} to project ${input.id}`);
            
            // First, find or create user by email
            const user = await this.projectService.findUserByEmail(input.email);
            
            if (!user) {
                throw new Error('User not found');
            }
            
            // Use service layer for business logic
            const result = await this.projectService.inviteCollaborator(input.id, {
                userId: user.id,
                role: input.role,
                permissions: input.permissions,
                invitedBy: session?.user?.id ?? null,
            });
            
            // Use adapter to transform to contract
            return this.projectAdapter.adaptInviteCollaboratorToContract(result.id, 'Collaborator invited successfully');
        });
    }
    @Implement(projectContract.updateCollaborator)
    updateCollaborator() {
        return implement(projectContract.updateCollaborator).handler(async ({ input }) => {
            this.logger.log(`Updating collaborator ${input.userId} in project ${input.id}`);
            
            // Use service layer
            const updated = await this.projectService.updateCollaborator(input.id, input.userId, {
                role: input.role,
                permissions: input.permissions,
            });
            
            // Use adapter to transform to contract
            return this.projectAdapter.adaptUpdateCollaboratorToContract(updated);
        });
    }
    @Implement(projectContract.removeCollaborator)
    removeCollaborator() {
        return implement(projectContract.removeCollaborator).handler(async ({ input }) => {
            this.logger.log(`Removing collaborator ${input.userId} from project ${input.id}`);
            
            // Use service layer
            await this.projectService.removeCollaborator(input.id, input.userId);
            
            // Use adapter to transform to contract
            return this.projectAdapter.adaptRemoveCollaboratorToContract();
        });
    }
    // Configuration endpoints
    @Implement(projectContract.getGeneralConfig)
    getGeneralConfig() {
        return implement(projectContract.getGeneralConfig).handler(async ({ input }) => {
            this.logger.log(`Getting general config for project: ${input.id}`);
            
            // Use service layer
            const project = await this.projectService.findById(input.id);
            
            if (!project) {
                throw new Error('Project not found');
            }
            
            // Use adapter to transform to contract
            return this.projectAdapter.adaptGeneralConfigToContract(project);
        });
    }
    @Implement(projectContract.updateGeneralConfig)
    updateGeneralConfig() {
        return implement(projectContract.updateGeneralConfig).handler(async ({ input }) => {
            this.logger.log(`Updating general config for project: ${input.id}`);
            
            // Use service layer to update project
            const updatedProject = await this.projectService.update(input.id, {
                name: input.name,
                description: input.description,
                baseDomain: input.baseDomain,
            });
            
            if (!updatedProject) {
                throw new Error('Project not found');
            }
            
            // Use adapter to transform to contract
            return this.projectAdapter.adaptGeneralConfigToContract(updatedProject);
        });
    }
    @Implement(projectContract.getEnvironmentConfig)
    getEnvironmentConfig() {
        return implement(projectContract.getEnvironmentConfig).handler(async ({ input }) => {
            this.logger.log(`Getting environment config for project: ${input.id}`);
            
            // Use adapter to return default environment config
            // TODO: Load actual config from database when available
            return this.projectAdapter.adaptEnvironmentConfigToContract();
        });
    }
    @Implement(projectContract.updateEnvironmentConfig)
    updateEnvironmentConfig() {
        return implement(projectContract.updateEnvironmentConfig).handler(async ({ input }) => {
            this.logger.log(`Updating environment config for project: ${input.id}`);
            
            // Use adapter to return updated environment config
            // TODO: Update actual config in database when available
            return this.projectAdapter.adaptEnvironmentConfigToContract();
        });
    }
    @Implement(projectContract.getDeploymentConfig)
    getDeploymentConfig() {
        return implement(projectContract.getDeploymentConfig).handler(async ({ input }) => {
            this.logger.log(`Getting deployment config for project: ${input.id}`);
            
            // Use adapter to return default deployment config
            // TODO: Load actual config from database when available
            return this.projectAdapter.adaptDeploymentConfigToContract();
        });
    }
    @Implement(projectContract.updateDeploymentConfig)
    updateDeploymentConfig() {
        return implement(projectContract.updateDeploymentConfig).handler(async ({ input }) => {
            this.logger.log(`Updating deployment config for project: ${input.id}`);
            
            // Use adapter to return updated deployment config
            // TODO: Update actual config in database when available
            return this.projectAdapter.adaptDeploymentConfigToContract(input as any);
        });
    }
    @Implement(projectContract.getSecurityConfig)
    getSecurityConfig() {
        return implement(projectContract.getSecurityConfig).handler(async ({ input }) => {
            this.logger.log(`Getting security config for project: ${input.id}`);
            
            // Use adapter to return default security config
            // TODO: Load actual config from database when available
            return this.projectAdapter.adaptSecurityConfigToContract();
        });
    }
    @Implement(projectContract.updateSecurityConfig)
    updateSecurityConfig() {
        return implement(projectContract.updateSecurityConfig).handler(async ({ input }) => {
            this.logger.log(`Updating security config for project: ${input.id}`);
            
            // Use adapter to return updated security config
            // TODO: Update actual config in database when available
            return this.projectAdapter.adaptSecurityConfigToContract(input as any);
        });
    }
    @Implement(projectContract.getResourceConfig)
    getResourceConfig() {
        return implement(projectContract.getResourceConfig).handler(async ({ input }) => {
            this.logger.log(`Getting resource config for project: ${input.id}`);
            
            // Use adapter to return default resource config
            // TODO: Load actual config from database when available
            return this.projectAdapter.adaptResourceLimitsToContract();
        });
    }
    @Implement(projectContract.updateResourceConfig)
    updateResourceConfig() {
        return implement(projectContract.updateResourceConfig).handler(async ({ input }) => {
            this.logger.log(`Updating resource config for project: ${input.id}`);
            
            // Use adapter to return updated resource config
            // TODO: Update actual config in database when available
            return this.projectAdapter.adaptResourceLimitsToContract(input as any);
        });
    }
    @Implement(projectContract.getNotificationConfig)
    getNotificationConfig() {
        return implement(projectContract.getNotificationConfig).handler(async ({ input }) => {
            this.logger.log(`Getting notification config for project: ${input.id}`);
            
            // Use adapter to return default notification config
            // TODO: Load actual config from database when available
            return this.projectAdapter.adaptNotificationConfigToContract();
        });
    }
    @Implement(projectContract.updateNotificationConfig)
    updateNotificationConfig() {
        return implement(projectContract.updateNotificationConfig).handler(async ({ input }) => {
            this.logger.log(`Updating notification config for project: ${input.id}`);
            
            // Use adapter to return updated notification config
            // TODO: Update actual config in database when available
            return this.projectAdapter.adaptNotificationConfigToContract(input as any);
        });
    }
    // Environment Management endpoints
    @Implement(projectContract.listEnvironments)
    listEnvironments() {
        return implement(projectContract.listEnvironments).handler(async ({ input }) => {
            this.logger.log(`Listing environments for project: ${input.id}`);
            
            // Use service layer
            const environmentList = await this.projectService.getEnvironments(input.id, input.type);
            
            // Use adapter to transform to contract
            return this.projectAdapter.adaptEnvironmentsToContract(environmentList);
        });
    }
    @Implement(projectContract.getEnvironment)
    getEnvironment() {
        return implement(projectContract.getEnvironment).handler(async ({ input }) => {
            this.logger.log(`Getting environment ${input.environmentId} for project: ${input.id}`);
            
            // Use service layer
            const env = await this.projectService.getEnvironment(input.environmentId);
            
            if (!env) {
                throw new Error('Environment not found');
            }
            
            // Verify environment belongs to project
            if (env.projectId !== input.id) {
                throw new Error('Environment not found in this project');
            }
            
            // Use adapter to transform to contract
            return this.projectAdapter.adaptEnvironmentToContract(env);
        });
    }
    @Implement(projectContract.createEnvironment)
    createEnvironment(
    @Session()
    session?: UserSession) {
        return implement(projectContract.createEnvironment).handler(async ({ input: inputData }) => {
            this.logger.log(`Creating environment for project: ${inputData.id}`);
            
            const userId = session?.user?.id || 'OpIctJdhFisLZRi2UBl0E1x9f3KUEcsg';
            
            // Use service layer to create environment
            const newEnvironment = await this.projectService.createEnvironment({
                projectId: inputData.id,
                name: inputData.name,
                type: inputData.type,
                slug: inputData.name.toLowerCase().replace(/\s+/g, '-'),
                description: '',
                status: 'active',
                deploymentConfig: inputData.deploymentConfig as any,
                metadata: inputData.metadata,
                createdBy: userId,
            });
            
            // Use adapter to transform to contract
            return this.projectAdapter.adaptCreateEnvironmentToContract(newEnvironment);
        });
    }
    @Implement(projectContract.updateEnvironment)
    updateEnvironment() {
        return implement(projectContract.updateEnvironment).handler(async ({ input: inputData }) => {
            this.logger.log(`Updating environment ${inputData.environmentId} for project: ${inputData.id}`);
            
            // Use service layer to update environment
            const updatedEnvironment = await this.projectService.updateEnvironment(inputData.environmentId, {
                name: inputData.name,
                type: inputData.type,
                deploymentConfig: inputData.deploymentConfig as any,
                metadata: inputData.metadata,
            });
            
            if (!updatedEnvironment || updatedEnvironment.projectId !== inputData.id) {
                throw new Error('Environment not found in this project');
            }
            
            // Use adapter to transform to contract
            return this.projectAdapter.adaptUpdateEnvironmentToContract(updatedEnvironment);
        });
    }
    @Implement(projectContract.deleteEnvironment)
    deleteEnvironment() {
        return implement(projectContract.deleteEnvironment).handler(async ({ input }) => {
            this.logger.log(`Deleting environment ${input.environmentId} for project: ${input.id}`);
            
            // Use service layer to delete environment
            const success = await this.projectService.deleteEnvironment(input.environmentId);
            
            // Use adapter to transform to contract
            return this.projectAdapter.adaptDeleteEnvironmentToContract(success.success);
        });
    }
    @Implement(projectContract.cloneEnvironment)
    cloneEnvironment(
    @Session()
    session?: UserSession) {
        return implement(projectContract.cloneEnvironment).handler(async ({ input }) => {
            this.logger.log(`Cloning environment ${input.environmentId} for project: ${input.id}`);
            
            const userId = session?.user?.id || 'OpIctJdhFisLZRi2UBl0E1x9f3KUEcsg';
            
            // Use service layer to clone environment
            const clonedEnvironment = await this.projectService.cloneEnvironment(input.environmentId, {
                name: input.name,
                slug: `${input.name.toLowerCase().replace(/\s+/g, '-')}-clone`,
                createdBy: userId,
            });
            
            if (!clonedEnvironment || clonedEnvironment.projectId !== input.id) {
                throw new Error('Source environment not found in this project');
            }
            
            // Use adapter to transform to contract
            return this.projectAdapter.adaptCloneEnvironmentToContract(clonedEnvironment);
        });
    }

    // Variable Template Management Routes
    @Implement(projectContract.listVariableTemplates)
    listVariableTemplates() {
        return implement(projectContract.listVariableTemplates).handler(async ({ input }) => {
            this.logger.log(`Listing variable templates for project: ${input.id}`);
            
            // Use service layer
            const templates = await this.projectService.getVariableTemplates();
            
            // Use adapter to transform to contract
            return this.projectAdapter.adaptVariableTemplatesToContract(templates);
        });
    }
    @Implement(projectContract.getVariableTemplate)
    getVariableTemplate() {
        return implement(projectContract.getVariableTemplate).handler(async ({ input }) => {
            this.logger.log(`Getting variable template ${input.templateId} for project: ${input.id}`);
            
            // Use service layer
            const template = await this.projectService.getVariableTemplate(input.templateId);
            
            if (!template) {
                throw new Error('Variable template not found');
            }
            
            // Use adapter to transform to contract
            return this.projectAdapter.adaptVariableTemplateToContract(template);
        });
    }
    @Implement(projectContract.createVariableTemplate)
    createVariableTemplate(
    @Session()
    session?: UserSession) {
        return implement(projectContract.createVariableTemplate).handler(async ({ input: inputData }) => {
            this.logger.log(`Creating variable template for project: ${inputData.id}`);
            
            const userId = session?.user?.id || 'OpIctJdhFisLZRi2UBl0E1x9f3KUEcsg';
            
            // Use service layer to create template
            const newTemplate = await this.projectService.createVariableTemplate({
                name: inputData.name,
                description: inputData.description,
                variables: inputData.variables,
                createdBy: userId,
            });
            
            // Use adapter to transform to contract
            return this.projectAdapter.adaptCreateVariableTemplateToContract(newTemplate);
        });
    }
    @Implement(projectContract.updateVariableTemplate)
    updateVariableTemplate() {
        return implement(projectContract.updateVariableTemplate).handler(async ({ input: inputData }) => {
            this.logger.log(`Updating variable template ${inputData.templateId} for project: ${inputData.id}`);
            
            // Use service layer to update template
            const updatedTemplate = await this.projectService.updateVariableTemplate(inputData.templateId, {
                name: inputData.name,
                description: inputData.description,
                variables: inputData.variables,
            });
            
            if (!updatedTemplate) {
                throw new Error('Variable template not found');
            }
            
            // Use adapter to transform to contract
            return this.projectAdapter.adaptUpdateVariableTemplateToContract(updatedTemplate);
        });
    }
    @Implement(projectContract.deleteVariableTemplate)
    deleteVariableTemplate() {
        return implement(projectContract.deleteVariableTemplate).handler(async ({ input }) => {
            this.logger.log(`Deleting variable template ${input.templateId} for project: ${input.id}`);
            
            // Use service layer to delete template
            const success = await this.projectService.deleteVariableTemplate(input.templateId);
            
            // Use adapter to transform to contract
            return this.projectAdapter.adaptDeleteVariableTemplateToContract(success.success);
        });
    }

    // Project Utils Routes
    @Implement(projectContract.resolveVariables)
    resolveVariables() {
        return implement(projectContract.resolveVariables).handler(async ({ input }) => {
            this.logger.log(`Resolving variables for project: ${input.id}`);
            // TODO: Implement proper variable resolution logic
            // For now, return a placeholder response
            return {
                resolvedVariables: {},
                unresolvedVariables: [],
                resolutionStatus: 'success',
                resolutionLog: []
            };
        });
    }
    @Implement(projectContract.getAvailableVariables)
    getAvailableVariables() {
        return implement(projectContract.getAvailableVariables).handler(async ({ input }) => {
            this.logger.log(`Getting available variables for project: ${input.id}`);
            // Return hardcoded available variables for now
            return {
                variables: [
                    {
                        key: 'project.name',
                        path: 'project.name',
                        scope: 'project',
                        description: 'Project name',
                        example: 'my-project'
                    },
                    {
                        key: 'environment.name',
                        path: 'environment.name',
                        scope: 'environment',
                        description: 'Environment name',
                        example: 'production'
                    },
                    {
                        key: 'environment.url',
                        path: 'environment.url',
                        scope: 'environment',
                        description: 'Environment URL',
                        example: 'https://my-project.example.com'
                    }
                ],
                scopes: [
                    {
                        scope: 'project',
                        description: 'Project-level variables',
                        variables: ['project.name', 'project.id']
                    },
                    {
                        scope: 'environment',
                        description: 'Environment-level variables',
                        variables: ['environment.name', 'environment.url', 'environment.type']
                    }
                ]
            };
        });
    }
    @Implement(projectContract.getEnvironmentStatus)
    getEnvironmentStatus() {
        return implement(projectContract.getEnvironmentStatus).handler(async ({ input }) => {
            this.logger.log(`Getting environment status for environment ${input.environmentId} in project: ${input.id}`);
            
            // Use service layer to get environment
            const env = await this.projectService.getEnvironment(input.environmentId);
            
            if (!env || env.projectId !== input.id) {
                throw new Error('Environment not found');
            }
            
            // Return basic status info - in real implementation, this would check actual deployment status
            return {
                environmentId: env.id,
                name: env.name,
                status: env.status,
                health: 'unknown',
                lastUpdated: env.updatedAt.toISOString(),
                services: [],
                metrics: {
                    cpu: 0,
                    memory: 0,
                    storage: 0,
                    network: 0
                },
                variables: {
                    resolved: 0,
                    unresolved: 0,
                    errors: 0
                }
            };
        });
    }
    @Implement(projectContract.getAllEnvironmentStatuses)
    getAllEnvironmentStatuses() {
        return implement(projectContract.getAllEnvironmentStatuses).handler(async ({ input }) => {
            this.logger.log(`Getting all environment statuses for project: ${input.id}`);
            
            // Use service layer to get all environments
            const projectEnvironments = await this.projectService.getEnvironments(input.id);
            
            const environmentStatuses = projectEnvironments.map(env => ({
                environmentId: env.id,
                name: env.name,
                status: env.status,
                health: 'unknown',
                lastUpdated: env.updatedAt.toISOString(),
                services: [],
                metrics: {
                    cpu: 0,
                    memory: 0,
                    storage: 0,
                    network: 0
                },
                variables: {
                    resolved: 0,
                    unresolved: 0,
                    errors: 0
                }
            }));
            
            // Calculate summary
            const total = environmentStatuses.length;
            const healthy = environmentStatuses.filter(env => env.status === 'healthy').length;
            const unhealthy = environmentStatuses.filter(env => env.status === 'error').length;
            const deploying = environmentStatuses.filter(env => env.status === 'updating').length;
            const failed = environmentStatuses.filter(env => env.status === 'error').length;
            
            return {
                environments: environmentStatuses,
                summary: {
                    total,
                    healthy,
                    unhealthy,
                    deploying,
                    failed
                }
            };
        });
    }
    @Implement(projectContract.refreshEnvironmentStatus)
    refreshEnvironmentStatus() {
        return implement(projectContract.refreshEnvironmentStatus).handler(async ({ input }) => {
            this.logger.log(`Refreshing environment status for environment ${input.environmentId} in project: ${input.id}`);
            
            // Use service layer to get environment
            const env = await this.projectService.getEnvironment(input.environmentId);
            
            if (!env || env.projectId !== input.id) {
                throw new Error('Environment not found');
            }
            
            // TODO: Implement actual status refresh logic via service layer
            // For now, just return current status
            
            // Return refreshed status - in real implementation, this would trigger actual status checks
            return {
                environmentId: env.id,
                name: env.name,
                status: env.status,
                health: 'unknown',
                lastUpdated: new Date().toISOString(),
                services: [],
                metrics: {
                    cpu: 0,
                    memory: 0,
                    storage: 0,
                    network: 0
                },
                variables: {
                    resolved: 0,
                    unresolved: 0,
                    errors: 0
                }
            };
        });
    }
}
