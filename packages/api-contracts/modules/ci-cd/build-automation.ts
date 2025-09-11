import { oc } from '@orpc/contract';
import { z } from 'zod';
import { BuildSchema, CreateBuildInput, BuildQuerySchema, BuildStatsSchema, } from './schemas';
export const buildAutomationContract = oc.router({
    // Build Management
    createBuild: oc
        .route({
        method: 'POST',
        path: '/builds',
        summary: 'Create a new build',
    })
        .input(CreateBuildInput)
        .output(BuildSchema)
        .meta({
        description: 'Create a new build',
        tags: ['Build Automation'],
    }),
    getBuild: oc
        .route({
        method: 'GET',
        path: '/builds/{id}',
        summary: 'Get build by ID',
    })
        .input(z.object({ id: z.string() }))
        .output(BuildSchema)
        .meta({
        description: 'Get build by ID',
        tags: ['Build Automation'],
    }),
    listBuilds: oc
        .route({
        method: 'GET',
        path: '/builds',
        summary: 'List builds with filtering',
    })
        .input(BuildQuerySchema)
        .output(z.object({
        builds: z.array(BuildSchema),
        total: z.number(),
        page: z.number(),
        limit: z.number(),
    }))
        .meta({
        description: 'List builds with filtering',
        tags: ['Build Automation'],
    }),
    cancelBuild: oc
        .route({
        method: 'POST',
        path: '/builds/{id}/cancel',
        summary: 'Cancel a running build',
    })
        .input(z.object({ id: z.string() }))
        .output(z.object({ success: z.boolean() }))
        .meta({
        description: 'Cancel a running build',
        tags: ['Build Automation'],
    }),
    retryBuild: oc
        .route({
        method: 'POST',
        path: '/builds/{id}/retry',
        summary: 'Retry a failed build',
    })
        .input(z.object({ id: z.string() }))
        .output(BuildSchema)
        .meta({
        description: 'Retry a failed build',
        tags: ['Build Automation'],
    }),
    // Build Logs and Artifacts
    getBuildLogs: oc
        .route({
        method: 'GET',
        path: '/builds/{id}/logs',
        summary: 'Get build logs with optional filtering',
    })
        .input(z.object({
        id: z.string(),
        stage: z.string().optional(),
        startLine: z.number().optional(),
        endLine: z.number().optional(),
    }))
        .output(z.object({
        logs: z.string(),
        totalLines: z.number(),
        hasMore: z.boolean(),
    }))
        .meta({
        description: 'Get build logs with optional filtering',
        tags: ['Build Automation'],
    }),
    getBuildArtifacts: oc
        .route({
        method: 'GET',
        path: '/builds/{id}/artifacts',
        summary: 'Get build artifacts',
    })
        .input(z.object({ id: z.string() }))
        .output(z.object({
        artifacts: z.array(z.object({
            id: z.string(),
            name: z.string(),
            path: z.string(),
            size: z.number(),
            type: z.string(),
            downloadUrl: z.string(),
            createdAt: z.date(),
        })),
    }))
        .meta({
        description: 'Get build artifacts',
        tags: ['Build Automation'],
    }),
    downloadArtifact: oc
        .route({
        method: 'GET',
        path: '/builds/{buildId}/artifacts/{artifactId}/download',
        summary: 'Get download URL for build artifact',
    })
        .input(z.object({
        buildId: z.string(),
        artifactId: z.string(),
    }))
        .output(z.object({
        downloadUrl: z.string(),
        expiresAt: z.date(),
    }))
        .meta({
        description: 'Get download URL for build artifact',
        tags: ['Build Automation'],
    }),
    // Build Configuration
    getBuildConfig: oc
        .route({
        method: 'GET',
        path: '/pipelines/{pipelineId}/build-config',
        summary: 'Get build configuration for pipeline',
    })
        .input(z.object({ pipelineId: z.string() }))
        .output(z.object({
        buildCommand: z.string().optional(),
        testCommand: z.string().optional(),
        environment: z.record(z.string(), z.string()).optional(),
        timeout: z.number().optional(),
        retryCount: z.number().optional(),
        cacheConfig: z.object({
            enabled: z.boolean(),
            paths: z.array(z.string()).optional(),
            key: z.string().optional(),
        }).optional(),
        dockerConfig: z.object({
            enabled: z.boolean(),
            image: z.string().optional(),
            dockerfile: z.string().optional(),
            context: z.string().optional(),
            args: z.record(z.string(), z.string()).optional(),
        }).optional(),
    }))
        .meta({
        description: 'Get build configuration for pipeline',
        tags: ['Build Automation'],
    }),
    updateBuildConfig: oc
        .route({
        method: 'PUT',
        path: '/pipelines/{pipelineId}/build-config',
        summary: 'Update build configuration',
    })
        .input(z.object({
        pipelineId: z.string(),
        config: z.object({
            buildCommand: z.string().optional(),
            testCommand: z.string().optional(),
            environment: z.record(z.string(), z.string()).optional(),
            timeout: z.number().optional(),
            retryCount: z.number().optional(),
            cacheConfig: z.object({
                enabled: z.boolean(),
                paths: z.array(z.string()).optional(),
                key: z.string().optional(),
            }).optional(),
            dockerConfig: z.object({
                enabled: z.boolean(),
                image: z.string().optional(),
                dockerfile: z.string().optional(),
                context: z.string().optional(),
                args: z.record(z.string(), z.string()).optional(),
            }).optional(),
        }),
    }))
        .output(z.object({ success: z.boolean() }))
        .meta({
        description: 'Update build configuration',
        tags: ['Build Automation'],
    }),
    // Build Queue Management
    getBuildQueue: oc
        .route({
        method: 'GET',
        path: '/build-queue',
        summary: 'Get build queue status',
    })
        .input(z.object({
        pipelineId: z.string().optional(),
        status: z.enum(['queued', 'running']).optional(),
    }))
        .output(z.object({
        queue: z.array(z.object({
            id: z.string(),
            pipelineId: z.string(),
            pipelineName: z.string(),
            branch: z.string(),
            queuedAt: z.date(),
            estimatedStartTime: z.date().optional(),
            priority: z.number(),
        })),
        totalQueued: z.number(),
        currentlyRunning: z.number(),
        averageWaitTime: z.number(), // minutes
    }))
        .meta({
        description: 'Get build queue status',
        tags: ['Build Automation'],
    }),
    updateBuildPriority: oc
        .route({
        method: 'PUT',
        path: '/builds/{id}/priority',
        summary: 'Update build priority in queue',
    })
        .input(z.object({
        id: z.string(),
        priority: z.number(),
    }))
        .output(z.object({ success: z.boolean() }))
        .meta({
        description: 'Update build priority in queue',
        tags: ['Build Automation'],
    }),
    // Build Statistics
    getBuildStats: oc
        .route({
        method: 'GET',
        path: '/builds/stats',
        summary: 'Get build statistics and metrics',
    })
        .input(z.object({
        pipelineId: z.string().optional(),
        timeRange: z.enum(['day', 'week', 'month', 'quarter']).default('week'),
    }))
        .output(BuildStatsSchema)
        .meta({
        description: 'Get build statistics and metrics',
        tags: ['Build Automation'],
    }),
    // Build Environment Management
    listBuildEnvironments: oc
        .route({
        method: 'GET',
        path: '/build-environments',
        summary: 'List available build environments',
    })
        .input(z.object({
        pipelineId: z.string().optional(),
    }))
        .output(z.object({
        environments: z.array(z.object({
            id: z.string(),
            name: z.string(),
            image: z.string(),
            version: z.string(),
            description: z.string().optional(),
            capabilities: z.array(z.string()),
            resources: z.object({
                cpu: z.string(),
                memory: z.string(),
                storage: z.string(),
            }),
            isDefault: z.boolean(),
        })),
    }))
        .meta({
        description: 'List available build environments',
        tags: ['Build Automation'],
    }),
});
