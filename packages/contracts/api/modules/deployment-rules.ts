import { oc } from '@orpc/contract';
import { z } from 'zod';

// Deployment rule trigger enum
const deploymentRuleTriggerSchema = z.enum([
    'push',
    'pull_request',
    'tag',
    'release',
    'manual'
]);

// Deployment environment enum
const deploymentEnvironmentSchema = z.enum([
    'production',
    'staging',
    'preview',
    'development'
]);

// Deployment rule schema
export const deploymentRuleSchema = z.object({
    id: z.string().uuid(),
    serviceId: z.string().uuid(),
    name: z.string(),
    trigger: deploymentRuleTriggerSchema,
    isEnabled: z.boolean(),
    priority: z.number(),
    
    // Branch/Tag matching
    branchPattern: z.string().nullable(),
    excludeBranchPattern: z.string().nullable(),
    tagPattern: z.string().nullable(),
    
    // PR-specific rules
    prLabels: z.array(z.string()).nullable(),
    prTargetBranches: z.array(z.string()).nullable(),
    requireApproval: z.boolean(),
    minApprovals: z.number(),
    
    // Deployment configuration
    environment: deploymentEnvironmentSchema,
    autoMergeOnSuccess: z.boolean(),
    autoDeleteOnMerge: z.boolean(),
    
    // Custom configuration overrides
    environmentVariables: z.record(z.string(), z.string()).nullable(),
    builderConfigOverride: z.record(z.string(), z.any()).nullable(),
    
    metadata: z.record(z.string(), z.any()).nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
});

export const createDeploymentRuleSchema = z.object({
    serviceId: z.string().uuid(),
    name: z.string().min(1).max(100),
    trigger: deploymentRuleTriggerSchema,
    isEnabled: z.boolean().default(true),
    priority: z.number().int().min(0).max(100).default(0),
    
    // Branch/Tag matching
    branchPattern: z.string().optional(),
    excludeBranchPattern: z.string().optional(),
    tagPattern: z.string().optional(),
    
    // PR-specific rules
    prLabels: z.array(z.string()).optional(),
    prTargetBranches: z.array(z.string()).optional(),
    requireApproval: z.boolean().default(false),
    minApprovals: z.number().int().min(1).max(10).default(1),
    
    // Deployment configuration
    environment: deploymentEnvironmentSchema,
    autoMergeOnSuccess: z.boolean().default(false),
    autoDeleteOnMerge: z.boolean().default(true),
    
    // Custom configuration overrides
    environmentVariables: z.record(z.string(), z.string()).optional(),
    builderConfigOverride: z.record(z.string(), z.any()).optional(),
    
    metadata: z.record(z.string(), z.any()).optional(),
});

export const updateDeploymentRuleSchema = createDeploymentRuleSchema.partial().extend({
    id: z.string().uuid(),
});

export const deploymentRulesContract = {
    // Create a deployment rule
    create: oc
        .route({
            method: 'POST',
            path: '/deployment-rules',
            summary: 'Create deployment rule',
            description: 'Create a new deployment rule for automatic deployments'
        })
        .input(createDeploymentRuleSchema)
        .output(deploymentRuleSchema),

    // Get deployment rule by ID
    get: oc
        .route({
            method: 'GET',
            path: '/deployment-rules/{id}',
            summary: 'Get deployment rule',
        })
        .input(z.object({
            id: z.string().uuid(),
        }))
        .output(deploymentRuleSchema),

    // List deployment rules for a service
    list: oc
        .route({
            method: 'GET',
            path: '/deployment-rules',
            summary: 'List deployment rules',
        })
        .input(z.object({
            serviceId: z.string().uuid(),
        }))
        .output(z.object({
            rules: z.array(deploymentRuleSchema),
            total: z.number(),
        })),

    // Update deployment rule
    update: oc
        .route({
            method: 'PATCH',
            path: '/deployment-rules/{id}',
            summary: 'Update deployment rule',
        })
        .input(updateDeploymentRuleSchema)
        .output(deploymentRuleSchema),

    // Delete deployment rule
    delete: oc
        .route({
            method: 'DELETE',
            path: '/deployment-rules/{id}',
            summary: 'Delete deployment rule',
        })
        .input(z.object({
            id: z.string().uuid(),
        }))
        .output(z.object({
            success: z.boolean(),
        })),

    // Toggle deployment rule enabled status
    toggle: oc
        .route({
            method: 'POST',
            path: '/deployment-rules/{id}/toggle',
            summary: 'Toggle deployment rule',
        })
        .input(z.object({
            id: z.string().uuid(),
            isEnabled: z.boolean(),
        }))
        .output(deploymentRuleSchema),

    // Test a deployment rule against sample event
    test: oc
        .route({
            method: 'POST',
            path: '/deployment-rules/{id}/test',
            summary: 'Test deployment rule',
            description: 'Test if a deployment rule matches a sample GitHub event'
        })
        .input(z.object({
            id: z.string().uuid(),
            event: z.object({
                type: z.enum(['push', 'pull_request', 'tag', 'release']),
                branch: z.string().optional(),
                tag: z.string().optional(),
                prNumber: z.number().optional(),
                prTargetBranch: z.string().optional(),
                prLabels: z.array(z.string()).optional(),
            }),
        }))
        .output(z.object({
            matches: z.boolean(),
            reason: z.string(),
        })),
};
