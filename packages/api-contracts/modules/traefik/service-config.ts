import { oc } from '@orpc/contract';
import { z } from 'zod';

// Service-based Traefik Configuration Contracts
export const traefikGetServiceConfigContract = oc
  .route({
    method: 'GET',
    path: '/services/:serviceId/traefik-config',
    summary: 'Get Traefik configuration for a specific service',
  })
  .input(z.object({
    serviceId: z.string(),
  }))
  .output(z.object({
    id: z.string(),
    serviceId: z.string(),
    serviceName: z.string(),
    domain: z.string(),
    subdomain: z.string().optional(),
    fullDomain: z.string(),
    sslEnabled: z.boolean(),
    sslProvider: z.enum(['letsencrypt', 'selfsigned', 'custom']).optional(),
    pathPrefix: z.string().optional(),
    port: z.number(),
    middleware: z.any().optional(),
    healthCheck: z.object({
      enabled: z.boolean(),
      path: z.string(),
      interval: z.number().optional(),
      timeout: z.number().optional(),
    }).optional(),
    isActive: z.boolean(),
    configContent: z.string(), // Generated YAML configuration
    lastSyncedAt: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }));

export const traefikCreateServiceConfigContract = oc
  .route({
    method: 'POST',
    path: '/services/:serviceId/traefik-config',
    summary: 'Create Traefik configuration for a service',
  })
  .input(z.object({
    serviceId: z.string(),
    domain: z.string(),
    subdomain: z.string().optional(),
    sslEnabled: z.boolean().default(false),
    sslProvider: z.enum(['letsencrypt', 'selfsigned', 'custom']).optional(),
    pathPrefix: z.string().optional(),
    middleware: z.any().optional(),
    healthCheck: z.object({
      enabled: z.boolean(),
      path: z.string(),
      interval: z.number().optional(),
      timeout: z.number().optional(),
    }).optional(),
  }))
  .output(z.object({
    id: z.string(),
    serviceId: z.string(),
    serviceName: z.string(),
    domain: z.string(),
    subdomain: z.string().optional(),
    fullDomain: z.string(),
    sslEnabled: z.boolean(),
    sslProvider: z.enum(['letsencrypt', 'selfsigned', 'custom']).optional(),
    pathPrefix: z.string().optional(),
    port: z.number(),
    middleware: z.any().optional(),
    healthCheck: z.object({
      enabled: z.boolean(),
      path: z.string(),
      interval: z.number().optional(),
      timeout: z.number().optional(),
    }).optional(),
    isActive: z.boolean(),
    configContent: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }));

export const traefikUpdateServiceConfigContract = oc
  .route({
    method: 'PUT',
    path: '/services/:serviceId/traefik-config',
    summary: 'Update Traefik configuration for a service',
  })
  .input(z.object({
    serviceId: z.string(),
    domain: z.string().optional(),
    subdomain: z.string().optional(),
    sslEnabled: z.boolean().optional(),
    sslProvider: z.enum(['letsencrypt', 'selfsigned', 'custom']).optional(),
    pathPrefix: z.string().optional(),
    middleware: z.any().optional(),
    healthCheck: z.object({
      enabled: z.boolean(),
      path: z.string(),
      interval: z.number().optional(),
      timeout: z.number().optional(),
    }).optional(),
    isActive: z.boolean().optional(),
  }))
  .output(z.object({
    id: z.string(),
    serviceId: z.string(),
    serviceName: z.string(),
    domain: z.string(),
    subdomain: z.string().optional(),
    fullDomain: z.string(),
    sslEnabled: z.boolean(),
    sslProvider: z.enum(['letsencrypt', 'selfsigned', 'custom']).optional(),
    pathPrefix: z.string().optional(),
    port: z.number(),
    middleware: z.any().optional(),
    healthCheck: z.object({
      enabled: z.boolean(),
      path: z.string(),
      interval: z.number().optional(),
      timeout: z.number().optional(),
    }).optional(),
    isActive: z.boolean(),
    configContent: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }));

export const traefikDeleteServiceConfigContract = oc
  .route({
    method: 'DELETE',
    path: '/services/:serviceId/traefik-config',
    summary: 'Delete Traefik configuration for a service',
  })
  .input(z.object({
    serviceId: z.string(),
  }))
  .output(z.object({
    success: z.boolean(),
    message: z.string(),
  }));

export const traefikListServiceConfigsContract = oc
  .route({
    method: 'GET',
    path: '/services/traefik-configs',
    summary: 'List all Traefik configurations for services',
  })
  .input(z.object({
    projectId: z.string().optional(),
    domain: z.string().optional(),
    isActive: z.boolean().optional(),
    limit: z.number().default(20),
    offset: z.number().default(0),
  }))
  .output(z.object({
    configs: z.array(z.object({
      id: z.string(),
      serviceId: z.string(),
      serviceName: z.string(),
      projectId: z.string(),
      projectName: z.string(),
      domain: z.string(),
      subdomain: z.string().optional(),
      fullDomain: z.string(),
      sslEnabled: z.boolean(),
      pathPrefix: z.string().optional(),
      port: z.number(),
      isActive: z.boolean(),
      lastSyncedAt: z.string().optional(),
      createdAt: z.string(),
    })),
    total: z.number(),
    hasMore: z.boolean(),
  }));

// File System Management for Service Configs
export const traefikGetServiceFileSystemContract = oc
  .route({
    method: 'GET',
    path: '/services/:serviceId/traefik-config/files',
    summary: 'Get Traefik configuration files for a service',
  })
  .input(z.object({
    serviceId: z.string(),
    path: z.string().optional(),
  }))
  .output(z.object({
    serviceName: z.string(),
    configPath: z.string(),
    files: z.array(z.object({
      name: z.string(),
      path: z.string(),
      type: z.enum(['file', 'directory']),
      size: z.number().optional(),
      lastModified: z.string().optional(),
      extension: z.string().optional(),
      permissions: z.string().optional(),
      isReadable: z.boolean().optional(),
      isWritable: z.boolean().optional(),
    })),
    subdirectories: z.array(z.object({
      name: z.string(),
      path: z.string(),
      files: z.array(z.object({
        name: z.string(),
        path: z.string(),
        type: z.enum(['file', 'directory']),
        size: z.number().optional(),
        lastModified: z.string().optional(),
        extension: z.string().optional(),
        permissions: z.string().optional(),
        isReadable: z.boolean().optional(),
        isWritable: z.boolean().optional(),
      })),
      subdirectories: z.array(z.any()),
    })),
  }));

export const traefikGetServiceFileContentContract = oc
  .route({
    method: 'GET',
    path: '/services/:serviceId/traefik-config/files/content',
    summary: 'Get content of a Traefik configuration file for a service',
  })
  .input(z.object({
    serviceId: z.string(),
    filePath: z.string(),
    encoding: z.enum(['utf8', 'base64']).optional().default('utf8'),
  }))
  .output(z.object({
    content: z.string(),
    encoding: z.string(),
    size: z.number(),
    lastModified: z.string(),
    mimeType: z.string().optional(),
    isText: z.boolean(),
  }));

export const traefikDownloadServiceFileContract = oc
  .route({
    method: 'GET',
    path: '/services/:serviceId/traefik-config/files/download',
    summary: 'Download a Traefik configuration file for a service',
  })
  .input(z.object({
    serviceId: z.string(),
    filePath: z.string(),
  }))
  .output(z.object({
    filename: z.string(),
    content: z.string(),
    mimeType: z.string(),
    size: z.number(),
  }));

// Global File System View
export const traefikGetAllServiceFilesContract = oc
  .route({
    method: 'GET',
    path: '/traefik/service-files',
    summary: 'Get all Traefik configuration files across all services',
  })
  .input(z.object({
    projectId: z.string().optional(),
  }))
  .output(z.array(z.object({
    serviceId: z.string(),
    serviceName: z.string(),
    projectId: z.string(),
    projectName: z.string(),
    configPath: z.string(),
    hasFiles: z.boolean(),
    files: z.array(z.object({
      name: z.string(),
      path: z.string(),
      type: z.enum(['file', 'directory']),
      size: z.number().optional(),
      lastModified: z.string().optional(),
      extension: z.string().optional(),
    })),
    subdirectories: z.array(z.object({
      name: z.string(),
      path: z.string(),
      files: z.array(z.object({
        name: z.string(),
        path: z.string(),
        type: z.enum(['file', 'directory']),
        size: z.number().optional(),
        lastModified: z.string().optional(),
        extension: z.string().optional(),
      })),
      subdirectories: z.array(z.any()),
    })),
    lastScan: z.string().optional(),
  })));

// Configuration Sync and Management
export const traefikSyncServiceConfigContract = oc
  .route({
    method: 'POST',
    path: '/services/:serviceId/traefik-config/sync',
    summary: 'Sync Traefik configuration for a service',
  })
  .input(z.object({
    serviceId: z.string(),
  }))
  .output(z.object({
    success: z.boolean(),
    syncStatus: z.string(),
    message: z.string(),
    configPath: z.string().optional(),
  }));

export const traefikValidateServiceConfigContract = oc
  .route({
    method: 'POST',
    path: '/services/:serviceId/traefik-config/validate',
    summary: 'Validate Traefik configuration (either stored or custom YAML content)',
  })
  .input(z.object({
    serviceId: z.string(),
    configContent: z.string().optional(), // Optional YAML content to validate (if not provided, validates stored config)
  }))
  .output(z.object({
    isValid: z.boolean(),
    errors: z.array(z.object({
      path: z.string(),
      message: z.string(),
      code: z.string(),
    })).optional(),
    warnings: z.array(z.object({
      path: z.string(),
      message: z.string(),
    })).optional(),
    variables: z.array(z.object({
      name: z.string(),
      resolved: z.boolean(),
      value: z.any().optional(),
      error: z.string().optional(),
    })).optional(),
  }));