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

// Static Configuration Management Contracts

export const traefikGetStaticConfigContract = oc
  .route({
    method: 'GET',
    path: '/instances/:instanceId/static-config',
    summary: 'Get static configuration for a Traefik instance',
  })
  .input(z.object({
    instanceId: z.string(),
  }))
  .output(z.object({
    id: z.string(),
    traefikInstanceId: z.string(),
    // Core configuration sections
    globalConfig: z.any().nullable(),
    apiConfig: z.any().nullable(),
    entryPointsConfig: z.any().nullable(),
    providersConfig: z.any().nullable(),
    // Observability
    logConfig: z.any().nullable(),
    accessLogConfig: z.any().nullable(),
    metricsConfig: z.any().nullable(),
    tracingConfig: z.any().nullable(),
    // Security and TLS
    tlsConfig: z.any().nullable(),
    certificateResolversConfig: z.any().nullable(),
    // Advanced features
    experimentalConfig: z.any().nullable(),
    serversTransportConfig: z.any().nullable(),
    hostResolverConfig: z.any().nullable(),
    clusterConfig: z.any().nullable(),
    // Full configuration cache
    fullConfig: z.any().nullable(),
    configVersion: z.number().nullable(),
    // File sync status
    syncStatus: z.string().nullable(),
    lastSyncedAt: z.date().nullable(),
    syncErrorMessage: z.string().nullable(),
    // Validation
    isValid: z.boolean().nullable(),
    validationErrors: z.any().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  }).nullable());

export const traefikSaveStaticConfigContract = oc
  .route({
    method: 'POST',
    path: '/instances/:instanceId/static-config',
    summary: 'Create or update static configuration for a Traefik instance',
  })
  .input(z.object({
    instanceId: z.string(),
    // Core configuration sections
    globalConfig: z.any().optional(),
    apiConfig: z.any().optional(),
    entryPointsConfig: z.any().optional(),
    providersConfig: z.any().optional(),
    // Observability
    logConfig: z.any().optional(),
    accessLogConfig: z.any().optional(),
    metricsConfig: z.any().optional(),
    tracingConfig: z.any().optional(),
    // Security and TLS
    tlsConfig: z.any().optional(),
    certificateResolversConfig: z.any().optional(),
    // Advanced features
    experimentalConfig: z.any().optional(),
    serversTransportConfig: z.any().optional(),
    hostResolverConfig: z.any().optional(),
    clusterConfig: z.any().optional(),
  }))
  .output(z.object({
    id: z.string(),
    traefikInstanceId: z.string(),
    configVersion: z.number().nullable(),
    syncStatus: z.string().nullable(),
    isValid: z.boolean().nullable(),
    validationErrors: z.any().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  }));

export const traefikGetStaticConfigYamlContract = oc
  .route({
    method: 'GET',
    path: '/instances/:instanceId/static-config/yaml',
    summary: 'Get compiled YAML static configuration for a Traefik instance',
  })
  .input(z.object({
    instanceId: z.string(),
  }))
  .output(z.object({
    yaml: z.string(),
    configVersion: z.number(),
    lastUpdated: z.date(),
  }));

export const traefikUpdateStaticConfigSectionContract = oc
  .route({
    method: 'PUT',
    path: '/instances/:instanceId/static-config/:section',
    summary: 'Update a specific section of static configuration',
  })
  .input(z.object({
    instanceId: z.string(),
    section: z.enum([
      'globalConfig',
      'apiConfig', 
      'entryPointsConfig',
      'providersConfig',
      'logConfig',
      'accessLogConfig',
      'metricsConfig',
      'tracingConfig',
      'tlsConfig',
      'certificateResolversConfig',
      'experimentalConfig',
      'serversTransportConfig',
      'hostResolverConfig',
      'clusterConfig'
    ]),
    config: z.any(),
  }))
  .output(z.object({
    success: z.boolean(),
    configVersion: z.number(),
    validationErrors: z.array(z.string()).optional(),
  }));

export const traefikCreateDefaultStaticConfigContract = oc
  .route({
    method: 'POST',
    path: '/instances/:instanceId/static-config/default',
    summary: 'Create default static configuration for a Traefik instance',
  })
  .input(z.object({
    instanceId: z.string(),
  }))
  .output(z.object({
    id: z.string(),
    traefikInstanceId: z.string(),
    configVersion: z.number().nullable(),
    isValid: z.boolean().nullable(),
    validationErrors: z.any().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  }));

export const traefikValidateStaticConfigContract = oc
  .route({
    method: 'GET',
    path: '/instances/:instanceId/static-config/validate',
    summary: 'Validate static configuration for a Traefik instance',
  })
  .input(z.object({
    instanceId: z.string(),
  }))
  .output(z.object({
    isValid: z.boolean(),
    errors: z.array(z.string()),
    warnings: z.array(z.string()).optional(),
  }));