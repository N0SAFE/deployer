/**
 * Project Adapter Service
 * 
 * PURPOSE: Transform entities to contract types
 * 
 * RESPONSIBILITIES:
 * - Entity → Contract transformations
 * - Fixed return types (no generics)
 * - Pure transformations (no service dependencies)
 * - Handle null cases with NotFoundException
 * 
 * PATTERN: Service-Adapter Pattern
 * - Receives data as parameters
 * - Returns contract types
 * - Zero business logic
 * - Zero database calls
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import type { projects, projectCollaborators, environments, variableTemplates } from '@/config/drizzle/schema';
import type { ProjectSettings } from '../interfaces/project.types';
import type {
    ProjectListContract,
    ProjectContract,
    ProjectCreateContract,
    ProjectUpdateContract,
    ProjectDeleteContract,
    ProjectCollaboratorsContract,
    ProjectInviteCollaboratorContract,
    ProjectUpdateCollaboratorContract,
    ProjectRemoveCollaboratorContract,
    ProjectGeneralConfigContract,
    ProjectEnvironmentConfigContract,
    ProjectDeploymentConfigContract,
    ProjectSecurityConfigContract,
    ProjectResourceConfigContract,
    ProjectNotificationConfigContract,
    ProjectEnvironmentsContract,
    ProjectEnvironmentContract,
    ProjectCreateEnvironmentContract,
    ProjectUpdateEnvironmentContract,
    ProjectDeleteEnvironmentContract,
    ProjectCloneEnvironmentContract,
    ProjectVariableTemplatesContract,
    ProjectVariableTemplateContract,
    ProjectCreateVariableTemplateContract,
    ProjectUpdateVariableTemplateContract,
    ProjectDeleteVariableTemplateContract,
    ProjectResolveVariablesContract,
    ProjectAvailableVariablesContract,
    ProjectEnvironmentStatusContract,
    ProjectAllEnvironmentStatusesContract,
    ProjectRefreshEnvironmentStatusContract,
} from '../interfaces/project.types';

@Injectable()
export class ProjectAdapter {
    
    // ========================================
    // CORE CRUD ADAPTERS
    // ========================================

    adaptProjectListToContract(
        data: { projects: Array<typeof projects.$inferSelect>; total: number }, 
        limit: number, 
        offset: number
    ): ProjectListContract {
        const projectsWithStats = data.projects.map(project => ({
            ...project,
            _count: {
                services: 0,
                deployments: 0,
                collaborators: 0,
            },
            latestDeployment: null,
        }));

        return {
            projects: projectsWithStats,
            total: data.total,
            hasMore: offset + limit < data.total,
        };
    }

    adaptProjectToContract(
        project: typeof projects.$inferSelect | null, 
        stats?: { 
            services: number; 
            deployments: number; 
            collaborators: number; 
            latestDeployment: unknown | null;
        }
    ): ProjectContract {
        if (!project) {
            throw new NotFoundException('Project not found');
        }

        // Safely handle settings field
        let safeSettings: ProjectSettings | null = null;
        try {
            if (project.settings) {
                safeSettings = typeof project.settings === 'object' 
                    ? project.settings as ProjectSettings
                    : JSON.parse(project.settings as string);
            }
        } catch {
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
                services: stats?.services ?? 0,
                deployments: stats?.deployments ?? 0,
                collaborators: stats?.collaborators ?? 0,
            },
            latestDeployment: stats?.latestDeployment && typeof stats.latestDeployment === 'object' && 'id' in stats.latestDeployment
                ? stats.latestDeployment as { id: string; status: 'pending' | 'queued' | 'building' | 'deploying' | 'success' | 'failed' | 'cancelled'; createdAt: Date; }
                : null,
        };
    }

    adaptProjectCreateToContract(project: typeof projects.$inferSelect): ProjectCreateContract {
        return {
            id: project.id,
            name: project.name,
            description: project.description,
            baseDomain: project.baseDomain,
            ownerId: project.ownerId,
            settings: project.settings,
            createdAt: new Date(project.createdAt),
            updatedAt: new Date(project.updatedAt),
        };
    }

    adaptProjectUpdateToContract(project: typeof projects.$inferSelect | null): ProjectUpdateContract {
        if (!project) {
            throw new NotFoundException('Project not found');
        }
        return project;
    }

    adaptProjectDeleteToContract(result: { success: boolean }): ProjectDeleteContract {
        return {
            success: result.success,
            message: 'Project deleted successfully with Traefik cleanup'
        };
    }

    // ========================================
    // COLLABORATOR ADAPTERS
    // ========================================

    adaptCollaboratorsToContract(collaborators: Array<typeof projectCollaborators.$inferSelect>): ProjectCollaboratorsContract {
        const transformedCollaborators = collaborators.map(collaborator => ({
            ...collaborator,
            permissions: collaborator.permissions || undefined
        }));
        return { collaborators: transformedCollaborators };
    }

    adaptInviteCollaboratorToContract(inviteId: string, message: string): ProjectInviteCollaboratorContract {
        return { inviteId, message };
    }

    adaptUpdateCollaboratorToContract(collaborator: typeof projectCollaborators.$inferSelect): ProjectUpdateCollaboratorContract {
        return {
            id: collaborator.id,
            projectId: collaborator.projectId,
            userId: collaborator.userId,
            role: collaborator.role,
            permissions: collaborator.permissions || undefined,
            invitedBy: collaborator.invitedBy ?? null,
            invitedAt: collaborator.invitedAt,
            acceptedAt: collaborator.acceptedAt ?? null,
            createdAt: collaborator.createdAt,
            updatedAt: collaborator.updatedAt,
        };
    }

    adaptRemoveCollaboratorToContract(): ProjectRemoveCollaboratorContract {
        return {
            success: true,
            message: 'Collaborator removed successfully'
        };
    }

    // ========================================
    // CONFIGURATION ADAPTERS
    // ========================================

    adaptGeneralConfigToContract(project: typeof projects.$inferSelect): ProjectGeneralConfigContract {
        return {
            name: project.name,
            description: project.description || undefined,
            baseDomain: project.baseDomain || undefined,
            defaultBranch: 'main',
            autoDeployEnabled: true,
            enablePreviewEnvironments: true,
        };
    }

    adaptEnvironmentConfigToContract(): ProjectEnvironmentConfigContract {
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
    }

    adaptDeploymentConfigToContract(config?: Record<string, unknown>): ProjectDeploymentConfigContract {
        return (config || {
            autoCleanupDays: 30,
            maxPreviewEnvironments: 10,
            deploymentStrategy: 'rolling' as const,
            healthCheckTimeout: 60,
            deploymentTimeout: 600,
            enableRollback: true,
            requireApprovalForProduction: false,
        }) as ProjectDeploymentConfigContract;
    }

    adaptSecurityConfigToContract(config?: Record<string, unknown>): ProjectSecurityConfigContract {
        return (config || {
            webhookSecret: undefined,
            enableHttpsRedirect: true,
            allowedDomains: undefined,
            ipWhitelist: undefined,
            enableBasicAuth: false,
            basicAuthUsername: undefined,
            basicAuthPassword: undefined,
        }) as ProjectSecurityConfigContract;
    }

    adaptResourceLimitsToContract(config?: Record<string, unknown>): ProjectResourceConfigContract {
        return (config || {
            defaultCpuLimit: '1000m',
            defaultMemoryLimit: '512Mi',
            defaultStorageLimit: '10Gi',
            maxServicesPerProject: 10,
        }) as ProjectResourceConfigContract;
    }

    adaptNotificationConfigToContract(config?: Record<string, unknown>): ProjectNotificationConfigContract {
        return (config || {
            enableEmailNotifications: true,
            enableSlackNotifications: false,
            slackWebhookUrl: undefined,
            emailRecipients: undefined,
            notifyOnDeploymentSuccess: false,
            notifyOnDeploymentFailure: true,
            notifyOnServiceDown: true,
        }) as ProjectNotificationConfigContract;
    }

    // ========================================
    // ENVIRONMENT ADAPTERS
    // ========================================

    adaptEnvironmentsToContract(envList: Array<typeof environments.$inferSelect>): ProjectEnvironmentsContract {
        const transformedEnvironments = envList.map(env => this.transformEnvironmentToContract(env));
        return { environments: transformedEnvironments };
    }

    adaptEnvironmentToContract(environment: typeof environments.$inferSelect | null): ProjectEnvironmentContract {
        if (!environment) {
            throw new NotFoundException('Environment not found');
        }
        return this.transformEnvironmentToContract(environment);
    }

    adaptCreateEnvironmentToContract(environment: typeof environments.$inferSelect): ProjectCreateEnvironmentContract {
        return this.transformEnvironmentToContract(environment);
    }

    adaptUpdateEnvironmentToContract(environment: typeof environments.$inferSelect | null): ProjectUpdateEnvironmentContract {
        if (!environment) {
            throw new NotFoundException('Environment not found in this project');
        }
        return this.transformEnvironmentToContract(environment);
    }

    adaptDeleteEnvironmentToContract(success: boolean): ProjectDeleteEnvironmentContract {
        return {
            success,
            message: success ? 'Environment deleted successfully' : 'Environment not found in this project'
        };
    }

    adaptCloneEnvironmentToContract(environment: typeof environments.$inferSelect): ProjectCloneEnvironmentContract {
        return this.transformEnvironmentToContract(environment);
    }

    /**
     * Transform database environment to contract schema format
     */
    private transformEnvironmentToContract(dbEnv: typeof environments.$inferSelect) {
        if (!dbEnv.projectId) {
            throw new Error('Environment must belong to a project');
        }

        const contractType = dbEnv.type === 'development' ? 'preview' : dbEnv.type;
        if (!['production', 'staging', 'preview'].includes(contractType)) {
            throw new Error(`Invalid environment type: ${dbEnv.type}`);
        }

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
            strategy: mapDeploymentStrategy((dbEnv.deploymentConfig as Record<string, unknown>).deploymentStrategy as string || 'rolling'),
            healthCheckPath: '/health',
            healthCheckTimeout: 30,
            deploymentTimeout: (dbEnv.deploymentConfig as Record<string, unknown>).deployTimeoutMinutes 
                ? ((dbEnv.deploymentConfig as Record<string, unknown>).deployTimeoutMinutes as number) * 60 
                : 600,
            replicas: (dbEnv.deploymentConfig as Record<string, unknown>).maxInstances as number || 1,
            resources: {
                cpu: (dbEnv.resourceLimits as Record<string, unknown> | null)?.cpu as string || '0.5',
                memory: (dbEnv.resourceLimits as Record<string, unknown> | null)?.memory as string || '512MB',
                storage: (dbEnv.resourceLimits as Record<string, unknown> | null)?.storage as string | undefined,
            },
            scaling: undefined,
        } : undefined;

        return {
            id: dbEnv.id,
            projectId: dbEnv.projectId,
            name: dbEnv.name,
            type: contractType as 'production' | 'staging' | 'preview',
            url: this.extractDomainUrl(dbEnv.domainConfig),
            branch: (dbEnv.previewSettings as Record<string, unknown> | null)?.sourceBranch as string | undefined,
            isActive: dbEnv.isActive,
            autoDeloy: (dbEnv.deploymentConfig as Record<string, unknown> | null)?.autoDeployEnabled as boolean || false,
            variables: [],
            dynamicVariables: [],
            deploymentConfig,
            metadata: (dbEnv.metadata as Record<string, unknown>) || {},
            tags: ((dbEnv.metadata as Record<string, unknown> | null)?.tags as string[]) || [],
            protectionRules: undefined,
            createdBy: dbEnv.createdBy || undefined,
            createdAt: dbEnv.createdAt,
            updatedAt: dbEnv.updatedAt,
        };
    }

    /**
     * Extract URL from domain configuration
     */
    private extractDomainUrl(domainConfig: unknown): string | undefined {
        if (!domainConfig || typeof domainConfig !== 'object') return undefined;

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

    // ========================================
    // VARIABLE TEMPLATE ADAPTERS
    // ========================================

    adaptVariableTemplatesToContract(templates: Array<typeof variableTemplates.$inferSelect>): ProjectVariableTemplatesContract {
        return {
            templates: templates.map(template => this.transformVariableTemplateToContract(template))
        };
    }

    adaptVariableTemplateToContract(template: typeof variableTemplates.$inferSelect | null): ProjectVariableTemplateContract {
        if (!template) {
            throw new NotFoundException('Variable template not found');
        }
        return this.transformVariableTemplateToContract(template);
    }

    adaptCreateVariableTemplateToContract(template: typeof variableTemplates.$inferSelect): ProjectCreateVariableTemplateContract {
        return this.transformVariableTemplateToContract(template);
    }

    adaptUpdateVariableTemplateToContract(template: typeof variableTemplates.$inferSelect | null): ProjectUpdateVariableTemplateContract {
        if (!template) {
            throw new NotFoundException('Variable template not found');
        }
        return this.transformVariableTemplateToContract(template);
    }

    adaptDeleteVariableTemplateToContract(success: boolean): ProjectDeleteVariableTemplateContract {
        return {
            success,
            message: success ? 'Variable template deleted successfully' : 'Variable template not found'
        };
    }

    /**
     * Transform database variable template to contract schema format
     */
    private transformVariableTemplateToContract(dbTemplate: typeof variableTemplates.$inferSelect) {
        return {
            id: dbTemplate.id,
            projectId: '',
            name: dbTemplate.name,
            description: dbTemplate.description || undefined,
            template: JSON.stringify(dbTemplate.variables || []),
            variables: [],
            variableDefinitions: [],
            tags: [],
            createdBy: dbTemplate.createdBy,
            createdAt: dbTemplate.createdAt,
            updatedAt: dbTemplate.updatedAt,
        };
    }

    // ========================================
    // UTILITY ADAPTERS
    // ========================================

    adaptResolveVariablesToContract(): ProjectResolveVariablesContract {
        return {
            resolvedVariables: {},
            unresolvedVariables: [],
            resolutionStatus: 'success',
            resolutionLog: []
        };
    }

    adaptAvailableVariablesToContract(): ProjectAvailableVariablesContract {
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
    }

    adaptEnvironmentStatusToContract(env: typeof environments.$inferSelect): ProjectEnvironmentStatusContract {
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
    }

    adaptAllEnvironmentStatusesToContract(envList: Array<typeof environments.$inferSelect>): ProjectAllEnvironmentStatusesContract {
        const environmentStatuses = envList.map(env => ({
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
    }

    adaptRefreshEnvironmentStatusToContract(env: typeof environments.$inferSelect): ProjectRefreshEnvironmentStatusContract {
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
    }
}
