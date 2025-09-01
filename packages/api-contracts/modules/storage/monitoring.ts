import { oc } from '@orpc/contract';
import { z } from 'zod';
import { 
  StorageMetricsSchema,
  StorageUsageSchema,
  StorageQuotaSchema,
  CreateQuotaSchema,
  UpdateQuotaSchema,
} from './schemas';

// Storage monitoring contracts
export const storageGetUsageContract = oc
  .route({
    method: 'GET',
    path: '/usage',
    summary: 'Get current storage usage',
  })
  .input(z.object({
    path: z.string().optional(),
    includeSubdirectories: z.boolean().default(true),
  }))
  .output(z.array(StorageUsageSchema));

export const storageGetMetricsContract = oc
  .route({
    method: 'GET',
    path: '/metrics',
    summary: 'Get storage metrics and statistics',
  })
  .input(z.object({
    timeRange: z.enum(['1h', '6h', '24h', '7d', '30d']).default('24h'),
    includeIoStats: z.boolean().default(true),
    topFilesLimit: z.number().min(1).max(100).default(10),
  }))
  .output(StorageMetricsSchema);

export const storageGetHistoricalUsageContract = oc
  .route({
    method: 'GET',
    path: '/usage/historical',
    summary: 'Get historical storage usage data',
  })
  .input(z.object({
    path: z.string().optional(),
    startDate: z.date().optional(),
    endDate: z.date().optional(),
    granularity: z.enum(['hourly', 'daily', 'weekly']).default('daily'),
  }))
  .output(z.array(z.object({
    timestamp: z.date(),
    usage: StorageUsageSchema,
  })));

export const storageListQuotasContract = oc
  .route({
    method: 'GET',
    path: '/quotas',
    summary: 'List storage quotas',
  })
  .input(z.object({
    owner: z.string().optional(),
    path: z.string().optional(),
  }))
  .output(z.array(StorageQuotaSchema));

export const storageCreateQuotaContract = oc
  .route({
    method: 'POST',
    path: '/quotas',
    summary: 'Create a storage quota',
  })
  .input(CreateQuotaSchema)
  .output(StorageQuotaSchema);

export const storageUpdateQuotaContract = oc
  .route({
    method: 'PATCH',
    path: '/quotas/:path',
    summary: 'Update a storage quota',
  })
  .input(z.object({
    path: z.string().min(1),
  }).merge(UpdateQuotaSchema))
  .output(StorageQuotaSchema);

export const storageDeleteQuotaContract = oc
  .route({
    method: 'DELETE',
    path: '/quotas/:path',
    summary: 'Delete a storage quota',
  })
  .input(z.object({
    path: z.string().min(1),
  }))
  .output(z.void());

export const storageCleanupContract = oc
  .route({
    method: 'POST',
    path: '/cleanup',
    summary: 'Perform storage cleanup operations',
  })
  .input(z.object({
    paths: z.array(z.string()).optional(),
    removeEmptyDirectories: z.boolean().default(false),
    removeTempFiles: z.boolean().default(true),
    removeOldLogs: z.boolean().default(false),
    olderThanDays: z.number().min(1).default(30),
    dryRun: z.boolean().default(false),
  }))
  .output(z.object({
    filesRemoved: z.number(),
    bytesFreed: z.number(),
    directoriesRemoved: z.number(),
    errors: z.array(z.string()),
    summary: z.string(),
  }));