import z from "zod/v4";
import { PROJECT_ROLES } from "@repo/auth";

export const projectSettingsSchema = z.object({
    // General config (supplementary fields; name/description/baseDomain are top-level columns)
    defaultBranch: z.string().optional(),
    autoDeployEnabled: z.boolean().optional(),
    enablePreviewEnvironments: z.boolean().optional(),
    // Environment config
    defaultEnvironmentVariables: z.record(z.string(), z.string()).optional(),
    productionEnvironmentVariables: z.record(z.string(), z.string()).optional(),
    stagingEnvironmentVariables: z.record(z.string(), z.string()).optional(),
    developmentEnvironmentVariables: z.record(z.string(), z.string()).optional(),
    // Deployment config
    autoCleanupDays: z.number().optional(),
    maxPreviewEnvironments: z.number().optional(),
    deploymentStrategy: z.enum(["rolling", "blue_green", "canary"]).optional(),
    healthCheckTimeout: z.number().optional(),
    deploymentTimeout: z.number().optional(),
    enableRollback: z.boolean().optional(),
    requireApprovalForProduction: z.boolean().optional(),
    // Security config
    webhookSecret: z.string().optional(),
    enableHttpsRedirect: z.boolean().optional(),
    allowedDomains: z.array(z.string()).optional(),
    ipWhitelist: z.array(z.string()).optional(),
    enableBasicAuth: z.boolean().optional(),
    basicAuthUsername: z.string().optional(),
    basicAuthPassword: z.string().optional(),
    // Resource config
    defaultCpuLimit: z.string().optional(),
    defaultMemoryLimit: z.string().optional(),
    defaultStorageLimit: z.string().optional(),
    maxServicesPerProject: z.number().optional(),
    // Notification config
    enableEmailNotifications: z.boolean().optional(),
    enableSlackNotifications: z.boolean().optional(),
    slackWebhookUrl: z.string().optional(),
    emailRecipients: z.array(z.string()).optional(),
    notifyOnDeploymentSuccess: z.boolean().optional(),
    notifyOnDeploymentFailure: z.boolean().optional(),
    notifyOnServiceDown: z.boolean().optional(),
});

export type ProjectSettings = z.infer<typeof projectSettingsSchema>;

export const projectSchema = z.object({
    id: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    baseDomain: z.string().nullable(),
    ownerId: z.string(),
    settings: projectSettingsSchema.nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
});

/** Extended project with aggregated stats — used by findById */
export const projectWithStatsSchema = projectSchema.extend({
    _count: z.object({
        services: z.number(),
        deployments: z.number(),
        collaborators: z.number(),
    }),
    latestDeployment: z
        .object({
            id: z.string(),
            status: z.enum(["pending", "queued", "building", "deploying", "success", "failed", "cancelled"]),
            createdAt: z.iso.datetime(),
        })
        .nullable(),
});

// ============================================================================
// Collaborators
// ============================================================================

export const projectRoleSchema = z.enum(["owner", "admin", "developer", "viewer"]);

export const collaboratorSchema = z.object({
    id: z.uuid(),
    projectId: z.uuid(),
    userId: z.string(),
    role: projectRoleSchema,
    permissions: z
        .object({
            canDeploy: z.boolean().optional(),
            canManageServices: z.boolean().optional(),
            canManageCollaborators: z.boolean().optional(),
            canViewLogs: z.boolean().optional(),
            canDeleteDeployments: z.boolean().optional(),
        })
        .nullable(),
    invitedBy: z.string().nullable(),
    invitedAt: z.iso.datetime(),
    acceptedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
});

export const inviteCollaboratorSchema = z.object({
    email: z.email(),
    role: projectRoleSchema,
    permissions: z
        .object({
            canDeploy: z.boolean().default(false),
            canManageServices: z.boolean().default(false),
            canManageCollaborators: z.boolean().default(false),
            canViewLogs: z.boolean().default(true),
            canDeleteDeployments: z.boolean().default(false),
        })
        .optional(),
});

// ============================================================================
// Environments
// ============================================================================

export const environmentTypeSchema = z.enum(["production", "staging", "preview", "development"]);
export const environmentStatusSchema = z.enum(["healthy", "updating", "error", "pending", "inactive"]);

export const projectEnvironmentSchema = z.object({
    id: z.uuid(),
    projectId: z.uuid(),
    name: z.string(),
    slug: z.string(),
    description: z.string().nullable(),
    type: environmentTypeSchema,
    status: environmentStatusSchema,
    isActive: z.boolean(),
    domainConfig: z
        .object({
            baseDomain: z.string().optional(),
            subdomain: z.string().optional(),
            customDomain: z.string().optional(),
            sslEnabled: z.boolean().optional(),
        })
        .nullable(),
    deploymentConfig: z
        .object({
            autoDeployEnabled: z.boolean().optional(),
            deploymentStrategy: z.enum(["rolling", "blue-green", "canary", "recreate"]).optional(),
            maxInstances: z.number().optional(),
            deployTimeoutMinutes: z.number().optional(),
        })
        .nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    createdBy: z.string(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
});

// ============================================================================
// Variable Templates
// ============================================================================

export const templateVariableSchema = z.object({
    key: z.string(),
    template: z.string(),
    description: z.string().nullable(),
    category: z.string().nullable(),
    required: z.boolean().default(false),
    defaultValue: z.string().nullable(),
});

export const variableTemplateSchema = z.object({
    id: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    variables: z.array(templateVariableSchema),
    isSystem: z.boolean(),
    createdBy: z.string(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
});

// ============================================================================
// Project Config Sections
// ============================================================================

export const projectGeneralConfigSchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().optional(),
    baseDomain: z.string().optional(),
    defaultBranch: z.string().default("main"),
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
    deploymentStrategy: z.enum(["rolling", "blue_green", "canary"]).default("rolling"),
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
    defaultCpuLimit: z.string().default("0.5"),
    defaultMemoryLimit: z.string().default("512MB"),
    defaultStorageLimit: z.string().default("10GB"),
    maxServicesPerProject: z.number().min(1).max(100).default(20),
});

export const projectNotificationConfigSchema = z.object({
    enableEmailNotifications: z.boolean().default(true),
    enableSlackNotifications: z.boolean().default(false),
    slackWebhookUrl: z.string().optional(),
    emailRecipients: z.array(z.email()).optional(),
    notifyOnDeploymentSuccess: z.boolean().default(false),
    notifyOnDeploymentFailure: z.boolean().default(true),
    notifyOnServiceDown: z.boolean().default(true),
});

