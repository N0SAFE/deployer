import { z } from 'zod';

// File management schemas
export const FileMetadataSchema = z.object({
  name: z.string(),
  path: z.string(),
  size: z.number(),
  type: z.enum(['file', 'directory']),
  mimeType: z.string().optional(),
  lastModified: z.date(),
  permissions: z.string().optional(),
  owner: z.string().optional(),
});

export const CreateDirectorySchema = z.object({
  path: z.string().min(1),
  permissions: z.string().optional(),
});

export const UploadFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(), // Base64 encoded content
  overwrite: z.boolean().default(false),
  permissions: z.string().optional(),
});

export const MoveFileSchema = z.object({
  sourcePath: z.string().min(1),
  destinationPath: z.string().min(1),
  overwrite: z.boolean().default(false),
});

export const CopyFileSchema = z.object({
  sourcePath: z.string().min(1),
  destinationPath: z.string().min(1),
  overwrite: z.boolean().default(false),
});

// Database backup schemas
export const DatabaseBackupSchema = z.object({
  id: z.string(),
  databaseName: z.string(),
  backupType: z.enum(['full', 'incremental', 'differential']),
  filePath: z.string(),
  size: z.number(),
  status: z.enum(['in-progress', 'completed', 'failed', 'cancelled']),
  startedAt: z.date(),
  completedAt: z.date().optional(),
  error: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export const CreateBackupSchema = z.object({
  databaseName: z.string().min(1),
  backupType: z.enum(['full', 'incremental', 'differential']).default('full'),
  compression: z.boolean().default(true),
  encryption: z.boolean().default(false),
  metadata: z.record(z.string(), z.any()).optional(),
});

export const RestoreBackupSchema = z.object({
  backupId: z.string().min(1),
  targetDatabaseName: z.string().optional(),
  overwrite: z.boolean().default(false),
  options: z.record(z.string(), z.any()).optional(),
});

// Storage monitoring schemas
export const StorageUsageSchema = z.object({
  total: z.number(),
  used: z.number(),
  available: z.number(),
  percentage: z.number(),
  mountPoint: z.string(),
  fileSystem: z.string().optional(),
});

export const StorageQuotaSchema = z.object({
  path: z.string(),
  softLimit: z.number(),
  hardLimit: z.number(),
  currentUsage: z.number(),
  filesUsed: z.number().optional(),
  filesLimit: z.number().optional(),
  owner: z.string().optional(),
});

export const StorageMetricsSchema = z.object({
  timestamp: z.date(),
  diskUsage: z.array(StorageUsageSchema),
  quotas: z.array(StorageQuotaSchema),
  ioStats: z.object({
    readOps: z.number(),
    writeOps: z.number(),
    readBytes: z.number(),
    writeBytes: z.number(),
  }),
  topFiles: z.array(z.object({
    path: z.string(),
    size: z.number(),
    type: z.string(),
  })),
});

export const CreateQuotaSchema = z.object({
  path: z.string().min(1),
  softLimit: z.number().min(0),
  hardLimit: z.number().min(0),
  filesLimit: z.number().optional(),
  owner: z.string().optional(),
});

export const UpdateQuotaSchema = z.object({
  softLimit: z.number().min(0).optional(),
  hardLimit: z.number().min(0).optional(),
  filesLimit: z.number().optional(),
});

// File upload and deployment schemas
export const uploadFileDeploymentSchema = z.object({
  fileName: z.string().min(1),
  fileContent: z.string().min(1), // Base64 encoded content
  projectId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export const uploadResultSchema = z.object({
  uploadId: z.string().uuid(),
  fileName: z.string(),
  fileSize: z.number(),
  projectType: z.enum(['node', 'static', 'docker', 'unknown']),
  fileCount: z.number(),
  extractedSize: z.number(),
  entryPoint: z.string().optional(),
  dependencies: z.array(z.string()).optional(),
  hash: z.string(),
  uploadPath: z.string(),
  extractedPath: z.string().optional(),
});

export const deployUploadSchema = z.object({
  uploadId: z.string().uuid(),
  serviceId: z.string().uuid(),
  environment: z.enum(['production', 'staging', 'preview', 'development']).default('production'),
  environmentVariables: z.record(z.string(), z.string()).optional(),
});

// Static file serving schemas
export const staticFileInfoSchema = z.object({
  filePath: z.string(),
  size: z.number(),
  lastModified: z.string().datetime(),
  contentType: z.string(),
  etag: z.string(),
  isDirectory: z.boolean(),
});

export const setupStaticServingSchema = z.object({
  deploymentId: z.string().uuid(),
  sourcePath: z.string(),
  indexFiles: z.array(z.string()).default(['index.html', 'index.htm']),
  compressionEnabled: z.boolean().default(true),
  cachingEnabled: z.boolean().default(true),
  errorPages: z.record(z.string(), z.string()).optional(),
});

export const staticServingStatsSchema = z.object({
  totalFiles: z.number(),
  totalSize: z.number(),
  cacheHitRate: z.number().optional(),
  requestCount: z.number().optional(),
  lastAccessed: z.string().datetime().optional(),
});