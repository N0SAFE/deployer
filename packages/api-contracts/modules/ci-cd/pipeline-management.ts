import { oc } from '@orpc/contract';
import { z } from 'zod';
import {
  PipelineConfigSchema,
  CreatePipelineConfigInput,
  UpdatePipelineConfigInput,
  PipelineQuerySchema,
  PipelineStatsSchema,
} from './schemas';

export const pipelineManagementContract = oc.router({
  // Pipeline Configuration CRUD
  createPipeline: oc
    .route({
      method: 'POST',
      path: '/pipelines',
      summary: 'Create a new CI/CD pipeline configuration',
    })
    .input(CreatePipelineConfigInput)
    .output(PipelineConfigSchema)
    .meta({
      description: 'Create a new CI/CD pipeline configuration',
      tags: ['Pipeline Management'],
    }),

  getPipeline: oc
    .route({
      method: 'GET',
      path: '/pipelines/{id}',
      summary: 'Get pipeline configuration by ID',
    })
    .input(z.object({ id: z.string() }))
    .output(PipelineConfigSchema)
    .meta({
      description: 'Get pipeline configuration by ID',
      tags: ['Pipeline Management'],
    }),

  updatePipeline: oc
    .route({
      method: 'PUT',
      path: '/pipelines/{id}',
      summary: 'Update pipeline configuration',
    })
    .input(z.object({ 
      id: z.string(),
      data: UpdatePipelineConfigInput 
    }))
    .output(PipelineConfigSchema)
    .meta({
      description: 'Update pipeline configuration',
      tags: ['Pipeline Management'],
    }),

  deletePipeline: oc
    .route({
      method: 'DELETE',
      path: '/pipelines/{id}',
      summary: 'Delete pipeline configuration',
    })
    .input(z.object({ id: z.string() }))
    .output(z.object({ success: z.boolean() }))
    .meta({
      description: 'Delete pipeline configuration',
      tags: ['Pipeline Management'],
    }),

  listPipelines: oc
    .route({
      method: 'GET',
      path: '/pipelines',
      summary: 'List pipeline configurations with filtering',
    })
    .input(PipelineQuerySchema)
    .output(z.object({
      pipelines: z.array(PipelineConfigSchema),
      total: z.number(),
      page: z.number(),
      limit: z.number(),
    }))
    .meta({
      description: 'List pipeline configurations with filtering',
      tags: ['Pipeline Management'],
    }),

  // Pipeline Control
  triggerPipeline: oc
    .route({
      method: 'POST',
      path: '/pipelines/{id}/trigger',
      summary: 'Trigger a pipeline run',
    })
    .input(z.object({
      id: z.string(),
      branch: z.string().optional(),
      commitSha: z.string().optional(),
      variables: z.record(z.string(), z.string()).optional(),
    }))
    .output(z.object({
      pipelineRunId: z.string(),
      status: z.string(),
      triggeredAt: z.date(),
    }))
    .meta({
      description: 'Trigger a pipeline run',
      tags: ['Pipeline Management'],
    }),

  cancelPipeline: oc
    .route({
      method: 'POST',
      path: '/pipelines/{pipelineId}/cancel',
      summary: 'Cancel a running pipeline or all runs for a pipeline',
    })
    .input(z.object({ 
      pipelineId: z.string(),
      runId: z.string().optional(),
    }))
    .output(z.object({ success: z.boolean() }))
    .meta({
      description: 'Cancel a running pipeline or all runs for a pipeline',
      tags: ['Pipeline Management'],
    }),

  getPipelineStatus: oc
    .route({
      method: 'GET',
      path: '/pipelines/{id}/status',
      summary: 'Get current status of a pipeline',
    })
    .input(z.object({ id: z.string() }))
    .output(z.object({
      id: z.string(),
      status: z.enum(['idle', 'running', 'success', 'failed', 'cancelled']),
      currentRun: z.object({
        id: z.string(),
        branch: z.string(),
        commitSha: z.string(),
        startedAt: z.date(),
        stages: z.array(z.object({
          name: z.string(),
          status: z.enum(['pending', 'running', 'success', 'failed', 'cancelled', 'skipped']),
          progress: z.number().min(0).max(100).optional(),
        })),
      }).optional(),
    }))
    .meta({
      description: 'Get current status of a pipeline',
      tags: ['Pipeline Management'],
    }),

  // Pipeline Templates
  createPipelineFromTemplate: oc
    .route({
      method: 'POST',
      path: '/pipelines/from-template',
      summary: 'Create pipeline from a predefined template',
    })
    .input(z.object({
      templateId: z.string(),
      name: z.string(),
      projectId: z.string(),
      customizations: z.record(z.string(), z.any()).optional(),
    }))
    .output(PipelineConfigSchema)
    .meta({
      description: 'Create pipeline from a predefined template',
      tags: ['Pipeline Management'],
    }),

  listPipelineTemplates: oc
    .route({
      method: 'GET',
      path: '/pipeline-templates',
      summary: 'List available pipeline templates',
    })
    .input(z.object({
      category: z.string().optional(),
      language: z.string().optional(),
    }))
    .output(z.object({
      templates: z.array(z.object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
        category: z.string(),
        language: z.string().optional(),
        complexity: z.enum(['simple', 'medium', 'advanced']),
        stages: z.array(z.string()),
        variables: z.array(z.string()).optional(),
      })),
    }))
    .meta({
      description: 'List available pipeline templates',
      tags: ['Pipeline Management'],
    }),

  // Pipeline Statistics
  getPipelineStats: oc
    .route({
      method: 'GET',
      path: '/pipelines/stats',
      summary: 'Get pipeline statistics and metrics',
    })
    .input(z.object({
      id: z.string().optional(),
      projectId: z.string().optional(),
      timeRange: z.enum(['day', 'week', 'month', 'quarter']).default('week'),
    }))
    .output(PipelineStatsSchema)
    .meta({
      description: 'Get pipeline statistics and metrics',
      tags: ['Pipeline Management'],
    }),

  validatePipelineConfig: oc
    .route({
      method: 'POST',
      path: '/pipelines/validate',
      summary: 'Validate pipeline configuration before creation',
    })
    .input(CreatePipelineConfigInput)
    .output(z.object({
      valid: z.boolean(),
      errors: z.array(z.object({
        field: z.string(),
        message: z.string(),
        severity: z.enum(['error', 'warning', 'info']),
      })),
      warnings: z.array(z.object({
        field: z.string(),
        message: z.string(),
        suggestion: z.string().optional(),
      })),
    }))
    .meta({
      description: 'Validate pipeline configuration before creation',
      tags: ['Pipeline Management'],
    }),
});