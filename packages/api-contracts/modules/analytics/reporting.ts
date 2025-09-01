import { oc } from '@orpc/contract';
import { z } from 'zod';
import {
  ReportConfigurationSchema,
  AnalyticsReportSchema,
  GenerateReportInputSchema,
  DateRangeSchema,
} from './schemas';

// Generate analytics report
export const analyticsGenerateReportContract = oc
  .route({
    method: 'POST',
    path: '/reports/generate',
  })
  .input(GenerateReportInputSchema)
  .output(z.object({
    reportId: z.string(),
    status: z.enum(['pending', 'generating', 'completed', 'failed']),
    message: z.string(),
    estimatedCompletion: z.date().optional(),
  }));

// Get generated report
export const analyticsGetReportContract = oc
  .route({
    method: 'GET',
    path: '/reports/{reportId}',
  })
  .input(z.object({
    reportId: z.string(),
  }))
  .output(z.union([
    AnalyticsReportSchema,
    z.object({
      id: z.string(),
      status: z.enum(['pending', 'generating', 'failed']),
      error: z.string().optional(),
      progress: z.number().min(0).max(100).optional(),
    }),
  ]));

// List reports
export const analyticsListReportsContract = oc
  .route({
    method: 'GET',
    path: '/reports',
  })
  .input(z.object({
    status: z.enum(['pending', 'generating', 'completed', 'failed']).optional(),
    limit: z.coerce.number().min(1).max(100).default(20),
    offset: z.coerce.number().min(0).default(0),
  }).optional())
  .output(z.object({
    data: z.array(z.object({
      id: z.string(),
      name: z.string(),
      status: z.enum(['pending', 'generating', 'completed', 'failed']),
      generatedAt: z.date().optional(),
      period: DateRangeSchema,
      format: z.enum(['json', 'pdf', 'csv']),
      size: z.number().optional(), // File size in bytes
    })),
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
  }));

// Delete report
export const analyticsDeleteReportContract = oc
  .route({
    method: 'DELETE',
    path: '/reports/{reportId}',
  })
  .input(z.object({
    reportId: z.string(),
  }))
  .output(z.object({
    success: z.boolean(),
    message: z.string(),
  }));

// Download report
export const analyticsDownloadReportContract = oc
  .route({
    method: 'GET',
    path: '/reports/{reportId}/download',
  })
  .input(z.object({
    reportId: z.string(),
  }))
  .output(z.object({
    downloadUrl: z.string(),
    expiresAt: z.date(),
    format: z.enum(['json', 'pdf', 'csv']),
    size: z.number(),
  }));

// Create report configuration
export const analyticsCreateReportConfigContract = oc
  .route({
    method: 'POST',
    path: '/reports/configurations',
  })
  .input(ReportConfigurationSchema)
  .output(z.object({
    id: z.string(),
    ...ReportConfigurationSchema.shape,
    createdAt: z.date(),
    updatedAt: z.date(),
  }));

// Get report configurations
export const analyticsListReportConfigsContract = oc
  .route({
    method: 'GET',
    path: '/reports/configurations',
  })
  .input(z.object({
    limit: z.coerce.number().min(1).max(100).default(20),
    offset: z.coerce.number().min(0).default(0),
  }).optional())
  .output(z.object({
    data: z.array(z.object({
      id: z.string(),
      ...ReportConfigurationSchema.shape,
      createdAt: z.date(),
      updatedAt: z.date(),
    })),
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
  }));

// Update report configuration
export const analyticsUpdateReportConfigContract = oc
  .route({
    method: 'PUT',
    path: '/reports/configurations/{configId}',
  })
  .input(z.object({
    configId: z.string(),
    ...ReportConfigurationSchema.partial().shape,
  }))
  .output(z.object({
    id: z.string(),
    ...ReportConfigurationSchema.shape,
    createdAt: z.date(),
    updatedAt: z.date(),
  }));

// Delete report configuration
export const analyticsDeleteReportConfigContract = oc
  .route({
    method: 'DELETE',
    path: '/reports/configurations/{configId}',
  })
  .input(z.object({
    configId: z.string(),
  }))
  .output(z.object({
    success: z.boolean(),
    message: z.string(),
  }));