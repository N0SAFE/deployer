import { Controller, Logger } from '@nestjs/common';
import { Implement, implement } from '@orpc/nest';
import { projectContract } from '@repo/api-contracts';
import { DatabaseService } from '../../../core/modules/database/services/database.service';
import { ProjectService } from '../services/project.service';
import { projects, projectCollaborators, environments, variableTemplates } from '../../../config/drizzle/schema';
import { eq, desc, count, ilike, asc, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { Session } from '@/core/modules/auth/decorators/decorators';
import type { UserSession } from '@/core/modules/auth/guards/auth.guard';
// Define the database environment type from Drizzle schema
type DatabaseEnvironment = typeof environments.$inferSelect;
type DatabaseVariableTemplate = typeof variableTemplates.$inferSelect;
@Controller()
export class ProjectController {
    private readonly logger = new Logger(ProjectController.name);
    constructor(
        private readonly databaseService: DatabaseService,
        private readonly projectService: ProjectService
    ) { }
    /**
     * Transform database environment to contract schema format
     */
    private transformEnvironmentToContract(dbEnv: DatabaseEnvironment) {
        // Ensure projectId is not null since this is for project environments
        if (!dbEnv.projectId) {
            throw new Error('Environment must belong to a project');
        }
        // Map database type to contract type (filter out 'development' which is not in shared schema)
        const contractType = dbEnv.type === 'development' ? 'preview' : dbEnv.type;
        if (!['production', 'staging', 'preview'].includes(contractType)) {
            throw new Error(`Invalid environment type: ${dbEnv.type}`);
        }
        // Map database deployment strategy to contract format
        const mapDeploymentStrategy = (strategy: string): 'rolling' | 'blue_green' | 'canary' => {
            switch (strategy) {
                case 'blue-green':
                    return 'blue_green';
                case 'rolling':
                case 'canary':
                    return strategy as 'rolling' | 'canary';
                default:
                    return 'rolling';
            }
        };
        const deploymentConfig = dbEnv.deploymentConfig ? {
            strategy: mapDeploymentStrategy((dbEnv.deploymentConfig as {
                deploymentStrategy?: string;
            }).deploymentStrategy || 'rolling'),
            healthCheckPath: '/health',
            healthCheckTimeout: 30,
            deploymentTimeout: (dbEnv.deploymentConfig as {
                deployTimeoutMinutes?: number;
            }).deployTimeoutMinutes ?
                (dbEnv.deploymentConfig as {
                    deployTimeoutMinutes: number;
                }).deployTimeoutMinutes * 60 : 600,
            replicas: (dbEnv.deploymentConfig as {
                maxInstances?: number;
            }).maxInstances || 1,
            resources: {
                cpu: (dbEnv.resourceLimits as {
                    cpu?: string;
                } | null)?.cpu || '0.5',
                memory: (dbEnv.resourceLimits as {
                    memory?: string;
                } | null)?.memory || '512MB',
                storage: (dbEnv.resourceLimits as {
                    storage?: string;
                } | null)?.storage,
            },
            scaling: undefined, // Not in current DB schema - would need to be added
        } : undefined;
        return {
            id: dbEnv.id,
            projectId: dbEnv.projectId,
            name: dbEnv.name,
            type: contractType as 'production' | 'staging' | 'preview',
            url: this.extractDomainUrl(dbEnv.domainConfig),
            branch: (dbEnv.previewSettings as {
                sourceBranch?: string;
            } | null)?.sourceBranch,
            isActive: dbEnv.isActive,
            autoDeloy: (dbEnv.deploymentConfig as {
                autoDeployEnabled?: boolean;
            } | null)?.autoDeployEnabled || false,
            variables: [], // TODO: Load from environmentVariables table
            dynamicVariables: [], // TODO: Load dynamic variables
            deploymentConfig,
            metadata: (dbEnv.metadata as Record<string, unknown>) || {},
            tags: ((dbEnv.metadata as {
                tags?: string[];
            } | null)?.tags) || [],
            protectionRules: undefined, // Not in current DB schema  
            createdBy: dbEnv.createdBy || undefined,
            createdAt: dbEnv.createdAt,
            updatedAt: dbEnv.updatedAt,
        };
    }
    /**
     * Extract URL from domain configuration
     */
    private extractDomainUrl(domainConfig: unknown): string | undefined {
        if (!domainConfig || typeof domainConfig !== 'object')
            return undefined;
        const config = domainConfig as {
            sslEnabled?: boolean;
            customDomain?: string;
            baseDomain?: string;
            subdomain?: string;
        };
        const protocol = config.sslEnabled ? 'https' : 'http';
        if (config.customDomain) {
            return `${protocol}://${config.customDomain}`;
        }
        if (config.baseDomain && config.subdomain) {
            return `${protocol}://${config.subdomain}.${config.baseDomain}`;
        }
        return undefined;
    }
    /**
     * Transform database variable template to contract schema format
     */
    private transformVariableTemplateToContract(dbTemplate: DatabaseVariableTemplate) {
        return {
            id: dbTemplate.id,
            projectId: '', // Variable templates are not currently project-specific in DB, but contract expects it
            name: dbTemplate.name,
            description: dbTemplate.description || undefined,
            template: JSON.stringify(dbTemplate.variables || []), // Convert variables array to template string
            variables: [], // TODO: Transform database variables to contract format
            variableDefinitions: [], // TODO: Transform database variables to variable definitions
            tags: [], // Not in current DB schema
            createdBy: dbTemplate.createdBy,
            createdAt: dbTemplate.createdAt,
            updatedAt: dbTemplate.updatedAt,
        };
    }
    @Implement(projectContract.list)
    list() {
        return implement(projectContract.list).handler(async ({ input }) => {
            this.logger.log('Listing projects');
            // Handle optional input with defaults - properly type the input parameter
            const limit = input?.limit || 20;
            const offset = input?.offset || 0;
            const search = input?.search;
            const sortBy = input?.sortBy || 'updatedAt';
            const sortOrder = input?.sortOrder || 'desc';
            // Get database connection
            const db = this.databaseService.db;
            // Create conditions and sorting
            const whereCondition = search ? ilike(projects.name, `%${search}%`) : undefined;
            // Determine sort column and order
            const sortColumn = sortBy === 'name' ? projects.name :
                sortBy === 'createdAt' ? projects.createdAt :
                    projects.updatedAt;
            const orderBy = sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);
            // Execute queries directly without chaining to avoid TypeScript issues
            const projectList = await (whereCondition
                ? db.select().from(projects).where(whereCondition).orderBy(orderBy).limit(limit).offset(offset)
                : db.select().from(projects).orderBy(orderBy).limit(limit).offset(offset));
            const countResult = await (whereCondition
                ? db.select({ count: count() }).from(projects).where(whereCondition)
                : db.select({ count: count() }).from(projects));
            const total = countResult[0]?.count ?? 0;
            // Calculate hasMore for pagination
            const hasMore = offset + limit < total;
            // Transform to match projectWithStatsSchema
            const projectsWithStats = projectList.map(project => ({
                ...project,
                _count: {
                    services: 0, // TODO: Implement service count
                    deployments: 0, // TODO: Implement deployment count  
                    collaborators: 0, // TODO: Implement collaborator count
                },
                latestDeployment: null, // TODO: Implement latest deployment
            }));
            return {
                projects: projectsWithStats,
                total,
                hasMore,
            };
        });
    }
    @Implement(projectContract.getById)
    getById() {
        return implement(projectContract.getById).handler(async ({ input }) => {
            this.logger.log(`Getting project by id: ${input.id}`);
            
            try {
                // Get database connection
                const db = this.databaseService.db;
                
                // Find the project
                const projectResult = await db
                    .select()
                    .from(projects)
                    .where(eq(projects.id, input.id))
                    .limit(1);
                
                if (projectResult.length === 0) {
                    throw new Error('Project not found');
                }
                
                const project = projectResult[0];
                
                // Safely handle the settings field
                let safeSettings: any = null;
                try {
                    if (project.settings) {
                        // Ensure settings is properly serializable
                        safeSettings = typeof project.settings === 'object' 
                            ? project.settings 
                            : JSON.parse(project.settings as string);
                    }
                } catch (settingsError) {
                    this.logger.warn(`Failed to parse project settings for ${input.id}:`, settingsError);
                    safeSettings = null;
                }
                
                return {
                    id: project.id,
                    name: project.name,
                    description: project.description,
                    baseDomain: project.baseDomain,
                    ownerId: project.ownerId,
                    settings: safeSettings,
                    createdAt: project.createdAt,
                    updatedAt: project.updatedAt,
                    _count: {
                        services: 0, // TODO: Implement service count
                        deployments: 0, // TODO: Implement deployment count  
                        collaborators: 0, // TODO: Implement collaborator count
                    },
                    latestDeployment: null, // TODO: Implement latest deployment
                };
            } catch (error) {
                this.logger.error(`Error getting project by id ${input.id}:`, error);
                // Ensure we throw a serializable error
                throw new Error(error instanceof Error ? error.message : 'Failed to get project');
            }
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
            const result = await this.projectService.createProject({
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
            const updatedProject = await this.projectService.updateProject(input.id, updateData);
            
            return updatedProject;
        });
    }
    @Implement(projectContract.delete)
    delete() {
        return implement(projectContract.delete).handler(async ({ input }) => {
            this.logger.log(`Deleting project with automatic Traefik cleanup: ${input.id}`);
            
            // Use ProjectService to delete project with automatic Traefik cleanup
            const result = await this.projectService.deleteProject(input.id);
            
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
    inviteCollaborator() {
        return implement(projectContract.inviteCollaborator).handler(async ({ input: _input }) => {
            // TODO: Implement collaborator invitation logic
            this.logger.log('Inviting collaborator (not implemented)');
            return {
                inviteId: randomUUID(),
                message: 'Invitation sent successfully (mock implementation)'
            };
        });
    }
    @Implement(projectContract.updateCollaborator)
    updateCollaborator() {
        return implement(projectContract.updateCollaborator).handler(async ({ input: _input }) => {
            // TODO: Implement collaborator update logic
            this.logger.log('Updating collaborator (not implemented)');
            // Return a mock collaborator object that matches collaboratorSchema
            return {
                id: randomUUID(),
                projectId: 'mock-project-id',
                userId: 'mock-user-id',
                role: 'viewer' as const,
                invitedBy: 'system',
                invitedAt: new Date(),
                acceptedAt: new Date(),
                createdAt: new Date(),
                updatedAt: new Date(),
                permissions: {
                    canDeploy: false,
                    canManageServices: false,
                    canManageCollaborators: false,
                    canViewLogs: true,
                    canDeleteDeployments: false,
                }
            };
        });
    }
    @Implement(projectContract.removeCollaborator)
    removeCollaborator() {
        return implement(projectContract.removeCollaborator).handler(async ({ input: _input }) => {
            // TODO: Implement collaborator removal logic
            this.logger.log('Removing collaborator (not implemented)');
            return {
                success: true,
                message: 'Collaborator removed successfully (mock implementation)'
            };
        });
    }
    // Configuration endpoints
    @Implement(projectContract.getGeneralConfig)
    getGeneralConfig() {
        return implement(projectContract.getGeneralConfig).handler(async ({ input }) => {
            this.logger.log(`Getting general config for project: ${input.id}`);
            // Get database connection
            const db = this.databaseService.db;
            // Find the project
            const projectResult = await db
                .select()
                .from(projects)
                .where(eq(projects.id, input.id))
                .limit(1);
            if (projectResult.length === 0) {
                throw new Error('Project not found');
            }
            const project = projectResult[0];
            // Return general configuration based on project data
            return {
                name: project.name,
                description: project.description || undefined,
                baseDomain: project.baseDomain || undefined,
                defaultBranch: 'main',
                autoDeployEnabled: true,
                enablePreviewEnvironments: true,
            };
        });
    }
    @Implement(projectContract.updateGeneralConfig)
    updateGeneralConfig() {
        return implement(projectContract.updateGeneralConfig).handler(async ({ input }) => {
            this.logger.log(`Updating general config for project: ${input.id}`);
            const db = this.databaseService.db;
            // Build update object from configuration
            const updateData: any = {
                updatedAt: new Date()
            };
            if (input.name !== undefined)
                updateData.name = input.name;
            if (input.description !== undefined)
                updateData.description = input.description;
            if (input.baseDomain !== undefined)
                updateData.baseDomain = input.baseDomain;
            // Update project
            const [updatedProject] = await db
                .update(projects)
                .set(updateData)
                .where(eq(projects.id, input.id))
                .returning();
            if (!updatedProject) {
                throw new Error('Project not found');
            }
            // Return updated general configuration
            return {
                name: updatedProject.name,
                description: updatedProject.description || undefined,
                baseDomain: updatedProject.baseDomain || undefined,
                defaultBranch: 'main',
                autoDeployEnabled: true,
                enablePreviewEnvironments: true,
            };
        });
    }
    @Implement(projectContract.getEnvironmentConfig)
    getEnvironmentConfig() {
        return implement(projectContract.getEnvironmentConfig).handler(async ({ input }) => {
            this.logger.log(`Getting environment config for project: ${input.id}`);
            // TODO: Implement environment configuration retrieval from database
            return {
                defaultEnvironmentVariables: {
                    NODE_ENV: 'development',
                    PORT: '3000',
                },
                productionEnvironmentVariables: {
                    NODE_ENV: 'production',
                    PORT: '3000',
                },
                stagingEnvironmentVariables: {
                    NODE_ENV: 'staging',
                    PORT: '3000',
                },
                developmentEnvironmentVariables: {
                    NODE_ENV: 'development',
                    PORT: '3000',
                    DEBUG: 'true',
                },
            };
        });
    }
    @Implement(projectContract.updateEnvironmentConfig)
    updateEnvironmentConfig() {
        return implement(projectContract.updateEnvironmentConfig).handler(async ({ input }) => {
            this.logger.log(`Updating environment config for project: ${input.id}`);
            // TODO: Implement environment configuration update in database
            return {
                defaultEnvironmentVariables: input.defaultEnvironmentVariables,
                productionEnvironmentVariables: input.productionEnvironmentVariables,
                stagingEnvironmentVariables: input.stagingEnvironmentVariables,
                developmentEnvironmentVariables: input.developmentEnvironmentVariables,
            };
        });
    }
    @Implement(projectContract.getDeploymentConfig)
    getDeploymentConfig() {
        return implement(projectContract.getDeploymentConfig).handler(async ({ input }) => {
            this.logger.log(`Getting deployment config for project: ${input.id}`);
            // TODO: Implement deployment configuration retrieval from database
            return {
                autoCleanupDays: 30,
                maxPreviewEnvironments: 10,
                deploymentStrategy: 'rolling' as const,
                healthCheckTimeout: 60,
                deploymentTimeout: 600,
                enableRollback: true,
                requireApprovalForProduction: false,
            };
        });
    }
    @Implement(projectContract.updateDeploymentConfig)
    updateDeploymentConfig() {
        return implement(projectContract.updateDeploymentConfig).handler(async ({ input }) => {
            this.logger.log(`Updating deployment config for project: ${input.id}`);
            // TODO: Implement deployment configuration update in database
            return {
                autoCleanupDays: input.autoCleanupDays,
                maxPreviewEnvironments: input.maxPreviewEnvironments,
                deploymentStrategy: input.deploymentStrategy,
                healthCheckTimeout: input.healthCheckTimeout,
                deploymentTimeout: input.deploymentTimeout,
                enableRollback: input.enableRollback,
                requireApprovalForProduction: input.requireApprovalForProduction,
            };
        });
    }
    @Implement(projectContract.getSecurityConfig)
    getSecurityConfig() {
        return implement(projectContract.getSecurityConfig).handler(async ({ input }) => {
            this.logger.log(`Getting security config for project: ${input.id}`);
            // TODO: Implement security configuration retrieval from database
            return {
                webhookSecret: undefined,
                enableHttpsRedirect: true,
                allowedDomains: undefined,
                ipWhitelist: undefined,
                enableBasicAuth: false,
                basicAuthUsername: undefined,
                basicAuthPassword: undefined,
            };
        });
    }
    @Implement(projectContract.updateSecurityConfig)
    updateSecurityConfig() {
        return implement(projectContract.updateSecurityConfig).handler(async ({ input }) => {
            this.logger.log(`Updating security config for project: ${input.id}`);
            // TODO: Implement security configuration update in database
            return {
                webhookSecret: input.webhookSecret,
                enableHttpsRedirect: input.enableHttpsRedirect,
                allowedDomains: input.allowedDomains,
                ipWhitelist: input.ipWhitelist,
                enableBasicAuth: input.enableBasicAuth,
                basicAuthUsername: input.basicAuthUsername,
                basicAuthPassword: input.basicAuthPassword,
            };
        });
    }
    @Implement(projectContract.getResourceConfig)
    getResourceConfig() {
        return implement(projectContract.getResourceConfig).handler(async ({ input }) => {
            this.logger.log(`Getting resource config for project: ${input.id}`);
            // TODO: Implement resource configuration retrieval from database
            return {
                defaultCpuLimit: '0.5',
                defaultMemoryLimit: '512MB',
                defaultStorageLimit: '10GB',
                maxServicesPerProject: 20,
            };
        });
    }
    @Implement(projectContract.updateResourceConfig)
    updateResourceConfig() {
        return implement(projectContract.updateResourceConfig).handler(async ({ input }) => {
            this.logger.log(`Updating resource config for project: ${input.id}`);
            // TODO: Implement resource configuration update in database
            return {
                defaultCpuLimit: input.defaultCpuLimit,
                defaultMemoryLimit: input.defaultMemoryLimit,
                defaultStorageLimit: input.defaultStorageLimit,
                maxServicesPerProject: input.maxServicesPerProject,
            };
        });
    }
    @Implement(projectContract.getNotificationConfig)
    getNotificationConfig() {
        return implement(projectContract.getNotificationConfig).handler(async ({ input }) => {
            this.logger.log(`Getting notification config for project: ${input.id}`);
            // TODO: Implement notification configuration retrieval from database
            return {
                enableEmailNotifications: true,
                enableSlackNotifications: false,
                slackWebhookUrl: undefined,
                emailRecipients: undefined,
                notifyOnDeploymentSuccess: false,
                notifyOnDeploymentFailure: true,
                notifyOnServiceDown: true,
            };
        });
    }
    @Implement(projectContract.updateNotificationConfig)
    updateNotificationConfig() {
        return implement(projectContract.updateNotificationConfig).handler(async ({ input }) => {
            this.logger.log(`Updating notification config for project: ${input.id}`);
            // TODO: Implement notification configuration update in database
            return {
                enableEmailNotifications: input.enableEmailNotifications,
                enableSlackNotifications: input.enableSlackNotifications,
                slackWebhookUrl: input.slackWebhookUrl,
                emailRecipients: input.emailRecipients,
                notifyOnDeploymentSuccess: input.notifyOnDeploymentSuccess,
                notifyOnDeploymentFailure: input.notifyOnDeploymentFailure,
                notifyOnServiceDown: input.notifyOnServiceDown,
            };
        });
    }
    // Environment Management endpoints
    @Implement(projectContract.listEnvironments)
    listEnvironments() {
        return implement(projectContract.listEnvironments).handler(async ({ input }) => {
            this.logger.log(`Listing environments for project: ${input.id}`);
            const db = this.databaseService.db;
            // Build conditions array
            const conditions = [eq(environments.projectId, input.id)];
            if (input.type) {
                conditions.push(eq(environments.type, input.type));
            }
            // Execute query with combined conditions
            const environmentList = await db
                .select()
                .from(environments)
                .where(and(...conditions))
                .orderBy(desc(environments.createdAt));
            // Transform database results to contract format
            const transformedEnvironments = environmentList.map(env => this.transformEnvironmentToContract(env));
            return { environments: transformedEnvironments };
        });
    }
    @Implement(projectContract.getEnvironment)
    getEnvironment() {
        return implement(projectContract.getEnvironment).handler(async ({ input }) => {
            this.logger.log(`Getting environment ${input.environmentId} for project: ${input.id}`);
            const db = this.databaseService.db;
            // Get environment
            const environmentResult = await db
                .select()
                .from(environments)
                .where(eq(environments.id, input.environmentId))
                .limit(1);
            if (environmentResult.length === 0) {
                throw new Error('Environment not found');
            }
            const env = environmentResult[0];
            // Verify environment belongs to project
            if (env.projectId !== input.id) {
                throw new Error('Environment not found in this project');
            }
            // Transform and return environment
            return this.transformEnvironmentToContract(env);
        });
    }
    @Implement(projectContract.createEnvironment)
    createEnvironment(
    @Session()
    session?: UserSession) {
        return implement(projectContract.createEnvironment).handler(async ({ input: inputData }) => {
            this.logger.log(`Creating environment for project: ${inputData.id}`);
            const db = this.databaseService.db;
            const userId = session?.user?.id || 'OpIctJdhFisLZRi2UBl0E1x9f3KUEcsg';
            // Create environment with proper typing
            const [newEnvironment] = await db
                .insert(environments)
                .values({
                projectId: inputData.id,
                name: inputData.name,
                slug: inputData.name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
                description: `Environment for ${inputData.name}`, // Generate description since it's not in input
                type: inputData.type,
                status: 'pending',
                // Store URL and branch in domain/preview config
                domainConfig: inputData.url ? { customDomain: inputData.url } : undefined,
                previewSettings: inputData.branch ? { sourceBranch: inputData.branch } : undefined,
                deploymentConfig: inputData.deploymentConfig ? {
                    autoDeployEnabled: inputData.autoDeloy,
                    deploymentStrategy: inputData.deploymentConfig.strategy === 'blue_green' ? 'blue-green' : inputData.deploymentConfig.strategy,
                    healthCheckEnabled: !!inputData.deploymentConfig.healthCheckPath,
                    deployTimeoutMinutes: Math.ceil(inputData.deploymentConfig.deploymentTimeout / 60)
                } : undefined,
                metadata: {
                    tags: inputData.tags || []
                },
                createdBy: userId,
            })
                .returning();
            if (!newEnvironment) {
                throw new Error('Failed to create environment');
            }
            // Transform database result to contract schema
            return this.transformEnvironmentToContract(newEnvironment);
        });
    }
    @Implement(projectContract.updateEnvironment)
    updateEnvironment() {
        return implement(projectContract.updateEnvironment).handler(async ({ input: inputData }) => {
            this.logger.log(`Updating environment ${inputData.environmentId} for project: ${inputData.id}`);
            const db = this.databaseService.db;
            // Build update data
            const updateData: any = { updatedAt: new Date() };
            if (inputData.name) {
                updateData.name = inputData.name;
                updateData.slug = inputData.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
            }
            if (inputData.type)
                updateData.type = inputData.type;
            // Handle JSON fields
            if (inputData.url) {
                updateData.domainConfig = { customDomain: inputData.url };
            }
            if (inputData.branch) {
                updateData.previewSettings = { sourceBranch: inputData.branch };
            }
            if (inputData.deploymentConfig) {
                updateData.deploymentConfig = {
                    autoDeployEnabled: inputData.autoDeloy,
                    deploymentStrategy: inputData.deploymentConfig.strategy === 'blue_green' ? 'blue-green' : inputData.deploymentConfig.strategy,
                    healthCheckEnabled: !!inputData.deploymentConfig.healthCheckPath,
                    deployTimeoutMinutes: Math.ceil(inputData.deploymentConfig.deploymentTimeout / 60)
                };
            }
            // Update environment
            const [updatedEnvironment] = await db
                .update(environments)
                .set(updateData)
                .where(eq(environments.id, inputData.environmentId))
                .returning();
            if (!updatedEnvironment || updatedEnvironment.projectId !== inputData.id) {
                throw new Error('Environment not found in this project');
            }
            return this.transformEnvironmentToContract(updatedEnvironment);
        });
    }
    @Implement(projectContract.deleteEnvironment)
    deleteEnvironment() {
        return implement(projectContract.deleteEnvironment).handler(async ({ input }) => {
            this.logger.log(`Deleting environment ${input.environmentId} for project: ${input.id}`);
            const db = this.databaseService.db;
            // Check if environment exists and belongs to project
            const environmentResult = await db
                .select({ id: environments.id, projectId: environments.projectId })
                .from(environments)
                .where(eq(environments.id, input.environmentId))
                .limit(1);
            if (environmentResult.length === 0 || environmentResult[0].projectId !== input.id) {
                return {
                    success: false,
                    message: 'Environment not found in this project'
                };
            }
            // Delete environment (this will cascade delete variables)
            await db
                .delete(environments)
                .where(eq(environments.id, input.environmentId));
            return {
                success: true,
                message: 'Environment deleted successfully'
            };
        });
    }
    @Implement(projectContract.cloneEnvironment)
    cloneEnvironment(
    @Session()
    session?: UserSession) {
        return implement(projectContract.cloneEnvironment).handler(async ({ input }) => {
            this.logger.log(`Cloning environment ${input.environmentId} for project: ${input.id}`);
            const db = this.databaseService.db;
            const userId = session?.user?.id || 'OpIctJdhFisLZRi2UBl0E1x9f3KUEcsg';
            // Get source environment
            const sourceEnvironment = await db
                .select()
                .from(environments)
                .where(eq(environments.id, input.environmentId))
                .limit(1);
            if (sourceEnvironment.length === 0 || sourceEnvironment[0].projectId !== input.id) {
                throw new Error('Source environment not found in this project');
            }
            const sourceEnv = sourceEnvironment[0];
            // Create cloned environment
            const [clonedEnvironment] = await db
                .insert(environments)
                .values({
                projectId: input.id,
                name: input.name,
                slug: input.name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
                description: `Cloned from ${sourceEnv.name}`,
                type: input.type || sourceEnv.type,
                status: 'pending',
                deploymentConfig: sourceEnv.deploymentConfig,
                domainConfig: sourceEnv.domainConfig,
                networkConfig: sourceEnv.networkConfig,
                resourceLimits: sourceEnv.resourceLimits,
                metadata: sourceEnv.metadata,
                createdBy: userId,
            })
                .returning();
            if (!clonedEnvironment) {
                throw new Error('Failed to clone environment');
            }
            return this.transformEnvironmentToContract(clonedEnvironment);
        });
    }
    // Variable Template Management Routes
    @Implement(projectContract.listVariableTemplates)
    listVariableTemplates() {
        return implement(projectContract.listVariableTemplates).handler(async ({ input }) => {
            this.logger.log(`Listing variable templates for project: ${input.id}`);
            const db = this.databaseService.db;
            // Get all variable templates (currently not project-specific in DB schema)
            const templates = await db
                .select()
                .from(variableTemplates)
                .orderBy(desc(variableTemplates.updatedAt));
            return {
                templates: templates.map(template => this.transformVariableTemplateToContract(template))
            };
        });
    }
    @Implement(projectContract.getVariableTemplate)
    getVariableTemplate() {
        return implement(projectContract.getVariableTemplate).handler(async ({ input }) => {
            this.logger.log(`Getting variable template ${input.templateId} for project: ${input.id}`);
            const db = this.databaseService.db;
            const template = await db
                .select()
                .from(variableTemplates)
                .where(eq(variableTemplates.id, input.templateId))
                .limit(1);
            if (template.length === 0) {
                throw new Error('Variable template not found');
            }
            return this.transformVariableTemplateToContract(template[0]);
        });
    }
    @Implement(projectContract.createVariableTemplate)
    createVariableTemplate(
    @Session()
    session?: UserSession) {
        return implement(projectContract.createVariableTemplate).handler(async ({ input: inputData }) => {
            this.logger.log(`Creating variable template for project: ${inputData.id}`);
            const db = this.databaseService.db;
            const userId = session?.user?.id || 'OpIctJdhFisLZRi2UBl0E1x9f3KUEcsg';
            // Create variable template
            const [newTemplate] = await db
                .insert(variableTemplates)
                .values({
                name: inputData.name,
                description: inputData.description,
                variables: inputData.variables || [],
                createdBy: userId,
            })
                .returning();
            if (!newTemplate) {
                throw new Error('Failed to create variable template');
            }
            return this.transformVariableTemplateToContract(newTemplate);
        });
    }
    @Implement(projectContract.updateVariableTemplate)
    updateVariableTemplate() {
        return implement(projectContract.updateVariableTemplate).handler(async ({ input: inputData }) => {
            this.logger.log(`Updating variable template ${inputData.templateId} for project: ${inputData.id}`);
            const db = this.databaseService.db;
            // Build update data
            const updateData: any = { updatedAt: new Date() };
            if (inputData.name)
                updateData.name = inputData.name;
            if (inputData.description !== undefined)
                updateData.description = inputData.description;
            if (inputData.variables)
                updateData.variables = inputData.variables;
            // Update template
            const [updatedTemplate] = await db
                .update(variableTemplates)
                .set(updateData)
                .where(eq(variableTemplates.id, inputData.templateId))
                .returning();
            if (!updatedTemplate) {
                throw new Error('Variable template not found');
            }
            return this.transformVariableTemplateToContract(updatedTemplate);
        });
    }
    @Implement(projectContract.deleteVariableTemplate)
    deleteVariableTemplate() {
        return implement(projectContract.deleteVariableTemplate).handler(async ({ input }) => {
            this.logger.log(`Deleting variable template ${input.templateId} for project: ${input.id}`);
            const db = this.databaseService.db;
            // Check if template exists
            const templateResult = await db
                .select({ id: variableTemplates.id })
                .from(variableTemplates)
                .where(eq(variableTemplates.id, input.templateId))
                .limit(1);
            if (templateResult.length === 0) {
                return {
                    success: false,
                    message: 'Variable template not found'
                };
            }
            // Delete template
            await db
                .delete(variableTemplates)
                .where(eq(variableTemplates.id, input.templateId));
            return {
                success: true,
                message: 'Variable template deleted successfully'
            };
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
            const db = this.databaseService.db;
            // Get environment from database
            const environment = await db
                .select()
                .from(environments)
                .where(and(eq(environments.id, input.environmentId), eq(environments.projectId, input.id)))
                .limit(1);
            if (environment.length === 0) {
                throw new Error('Environment not found');
            }
            const env = environment[0];
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
            const db = this.databaseService.db;
            // Get all environments for the project
            const projectEnvironments = await db
                .select()
                .from(environments)
                .where(eq(environments.projectId, input.id))
                .orderBy(desc(environments.updatedAt));
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
            const db = this.databaseService.db;
            // Get environment from database
            const environment = await db
                .select()
                .from(environments)
                .where(and(eq(environments.id, input.environmentId), eq(environments.projectId, input.id)))
                .limit(1);
            if (environment.length === 0) {
                throw new Error('Environment not found');
            }
            const env = environment[0];
            // Update the updatedAt timestamp to simulate refresh
            await db
                .update(environments)
                .set({ updatedAt: new Date() })
                .where(eq(environments.id, input.environmentId));
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
