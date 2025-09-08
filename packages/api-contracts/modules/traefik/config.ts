import { oc } from '@orpc/contract';
import { z } from 'zod';

// Configuration management contracts

export const traefikGetInstanceConfigsContract = oc
  .route({
    method: 'GET',
    path: '/instances/:instanceId/configs',
    summary: 'Get all configurations for a Traefik instance',
  })
  .input(z.object({
    instanceId: z.string(),
  }))
  .output(z.array(z.object({
    id: z.string(),
    configName: z.string(),
    configType: z.string(),
    syncStatus: z.string().optional(),
    requiresFile: z.boolean().optional(),
    lastSyncedAt: z.date().optional(),
    configVersion: z.number().optional(),
    metadata: z.any().optional(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })));

export const traefikGetConfigSyncStatusContract = oc
  .route({
    method: 'GET',
    path: '/instances/:instanceId/config-status',
    summary: 'Get configuration sync status for a Traefik instance',
  })
  .input(z.object({
    instanceId: z.string(),
  }))
  .output(z.object({
    total: z.number(),
    synced: z.number(),
    pending: z.number(),
    failed: z.number(),
    outdated: z.number(),
    configurations: z.array(z.object({
      id: z.string(),
      name: z.string(),
      type: z.string(),
      syncStatus: z.string(),
      lastSyncedAt: z.date().optional(),
      errorMessage: z.string().optional(),
    })),
  }));

export const traefikForceSyncConfigsContract = oc
  .route({
    method: 'POST',
    path: '/instances/:instanceId/force-sync',
    summary: 'Force sync all configurations for a Traefik instance',
  })
  .input(z.object({
    instanceId: z.string(),
  }))
  .output(z.object({
    total: z.number(),
    successful: z.number(),
    failed: z.number(),
    results: z.array(z.object({
      configId: z.string(),
      configName: z.string(),
      success: z.boolean(),
      action: z.string(),
      message: z.string().optional(),
    })),
  }));

export const traefikCleanupOrphanedFilesContract = oc
  .route({
    method: 'POST',
    path: '/instances/:instanceId/cleanup',
    summary: 'Clean up orphaned configuration files',
  })
  .input(z.object({
    instanceId: z.string(),
  }))
  .output(z.object({
    cleanedFiles: z.array(z.string()),
    count: z.number(),
  }));

export const traefikValidateConfigFilesContract = oc
  .route({
    method: 'GET',
    path: '/instances/:instanceId/validate',
    summary: 'Validate all configuration files for an instance',
  })
  .input(z.object({
    instanceId: z.string(),
  }))
  .output(z.object({
    valid: z.number(),
    invalid: z.number(),
    configurations: z.array(z.object({
      configId: z.string(),
      configName: z.string(),
      isValid: z.boolean(),
      issues: z.array(z.string()),
    })),
  }));

export const traefikGetInstanceStatusContract = oc
  .route({
    method: 'GET',
    path: '/instances/:instanceId/status',
    summary: 'Get comprehensive status for a Traefik instance',
  })
  .input(z.object({
    instanceId: z.string(),
  }))
  .output(z.object({
    instance: z.object({
      id: z.string(),
      name: z.string(),
      status: z.enum(['error', 'stopped', 'starting', 'running', 'stopping']),
      containerId: z.string().nullable(),
      dashboardPort: z.number().nullable(),
      httpPort: z.number().nullable(),
      httpsPort: z.number().nullable(),
      acmeEmail: z.string().nullable(),
      logLevel: z.string().nullable(),
      insecureApi: z.boolean().nullable(),
      config: z.any().nullable(),
      createdAt: z.date(),
      updatedAt: z.date(),
    }),
    configurations: z.object({
      total: z.number(),
      static: z.number(),
      dynamic: z.number(),
      synced: z.number(),
      pending: z.number(),
      failed: z.number(),
    }),
    files: z.object({
      total: z.number(),
      exists: z.number(),
      writable: z.number(),
      orphaned: z.number(),
    }),
    lastUpdate: z.date(),
  }));

export const traefikSyncSingleConfigContract = oc
  .route({
    method: 'POST',
    path: '/configs/:configId/sync',
    summary: 'Sync a specific configuration to file',
  })
  .input(z.object({
    configId: z.string(),
    forceSync: z.boolean().optional(),
    createDirectories: z.boolean().optional(),
    backupExisting: z.boolean().optional(),
  }))
  .output(z.object({
    success: z.boolean(),
    filePath: z.string(),
    action: z.enum(['created', 'updated', 'skipped', 'error']),
    message: z.string().optional(),
    checksum: z.string().optional(),
    fileSize: z.number().optional(),
  }));

export const traefikValidateSingleConfigContract = oc
  .route({
    method: 'GET',
    path: '/configs/:configId/validate',
    summary: 'Validate a specific configuration',
  })
  .input(z.object({
    configId: z.string(),
  }))
  .output(z.object({
    isValid: z.boolean(),
    issues: z.array(z.string()),
    lastSyncedAt: z.date().optional(),
  }));