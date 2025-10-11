import { z } from 'zod';
// Import shared schemas
import { environmentTypeSchema, environmentVariableSchema, dynamicVariableSchema, variableDefinitionSchema, createVariableTemplateSchema, updateVariableTemplateSchema, } from '../../shared';
// Note: Shared schemas are imported but not re-exported from this module
// They should be imported directly from '../../shared' or from the environment module
// Project specific schemas
export const projectRoleSchema = z.enum(['owner', 'admin', 'developer', 'viewer']);
export const projectSettingsSchema = z.object({
    autoCleanupDays: z.number().optional(),
    maxPreviewEnvironments: z.number().optional(),
    defaultEnvironmentVariables: z.record(z.string(), z.string()).optional(),
    webhookSecret: z.string().optional(),
});
// Configuration schemas
export const projectGeneralConfigSchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().optional(),
    baseDomain: z.string().optional(),
    defaultBranch: z.string().default('main'),
    autoDeployEnabled: z.boolean().default(true),
    enablePreviewEnvironments: z.boolean().default(true),
});
export const projectEnvironmentConfigSchema = z.object({
    defaultEnvironmentVariables: z.record(z.string(), z.string()).optional(),
    productionEnvironmentVariables: z.record(z.string(), z.string()).optional(),
    stagingEnvironmentVariables: z.record(z.string(), z.string()).optional(),
    developmentEnvironmentVariables: z.record(z.string(), z.string()).optional(),
});
export const projectDeploymentConfigSchema = z.object({
    autoCleanupDays: z.number().min(1).max(365).default(30),
    maxPreviewEnvironments: z.number().min(1).max(50).default(10),
    deploymentStrategy: z.enum(['rolling', 'blue_green', 'canary']).default('rolling'),
    healthCheckTimeout: z.number().min(5).max(600).default(60),
    deploymentTimeout: z.number().min(60).max(3600).default(600),
    enableRollback: z.boolean().default(true),
    requireApprovalForProduction: z.boolean().default(false),
});
export const projectSecurityConfigSchema = z.object({
    webhookSecret: z.string().optional(),
    enableHttpsRedirect: z.boolean().default(true),
    allowedDomains: z.array(z.string()).optional(),
    ipWhitelist: z.array(z.string()).optional(),
    enableBasicAuth: z.boolean().default(false),
    basicAuthUsername: z.string().optional(),
    basicAuthPassword: z.string().optional(),
});
export const projectResourceConfigSchema = z.object({
    defaultCpuLimit: z.string().default('0.5'),
    defaultMemoryLimit: z.string().default('512MB'),
    defaultStorageLimit: z.string().default('10GB'),
    maxServicesPerProject: z.number().min(1).max(100).default(20),
});
export const projectNotificationConfigSchema = z.object({
    enableEmailNotifications: z.boolean().default(true),
    enableSlackNotifications: z.boolean().default(false),
    slackWebhookUrl: z.string().optional(),
    emailRecipients: z.array(z.string().email()).optional(),
    notifyOnDeploymentSuccess: z.boolean().default(false),
    notifyOnDeploymentFailure: z.boolean().default(true),
    notifyOnServiceDown: z.boolean().default(true),
});
// Project main schemas
export const createProjectSchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().optional(),
    baseDomain: z.string().optional(),
    settings: projectSettingsSchema.optional(),
});
export const updateProjectSchema = createProjectSchema.partial();
export const projectSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    baseDomain: z.string().nullable(),
    ownerId: z.string(),
    settings: projectSettingsSchema.nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
});
export const projectWithStatsSchema = projectSchema.extend({
    _count: z.object({
        services: z.number(),
        deployments: z.number(),
        collaborators: z.number(),
    }),
    latestDeployment: z.object({
        id: z.string(),
        status: z.enum(['pending', 'queued', 'building', 'deploying', 'success', 'failed', 'cancelled']),
        createdAt: z.date(),
    }).nullable(),
});
// Collaborator schemas
export const collaboratorSchema = z.object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    userId: z.string(),
    role: projectRoleSchema,
    permissions: z.object({
        canDeploy: z.boolean().optional(),
        canManageServices: z.boolean().optional(),
        canManageCollaborators: z.boolean().optional(),
        canViewLogs: z.boolean().optional(),
        canDeleteDeployments: z.boolean().optional(),
    }).optional(),
    invitedBy: z.string().nullable(),
    invitedAt: z.date(),
    acceptedAt: z.date().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
});
export const inviteCollaboratorSchema = z.object({
    email: z.string().email(),
    role: projectRoleSchema,
    permissions: z.object({
        canDeploy: z.boolean().default(false),
        canManageServices: z.boolean().default(false),
        canManageCollaborators: z.boolean().default(false),
        canViewLogs: z.boolean().default(true),
        canDeleteDeployments: z.boolean().default(false),
    }).optional(),
});
// Variable template schemas
export const variableTemplateSchema = z.object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    name: z.string(),
    description: z.string().optional(),
    template: z.string(),
    variables: z.array(dynamicVariableSchema).default([]),
    variableDefinitions: z.array(variableDefinitionSchema).default([]),
    tags: z.array(z.string()).default([]),
    createdBy: z.string().uuid(),
    createdAt: z.date(),
    updatedAt: z.date(),
});
// Local createVariableTemplateSchema and updateVariableTemplateSchema removed
// They are now imported from shared schemas
