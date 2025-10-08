import { oc } from '@orpc/contract';

// Import only the file management contracts we need
import {
  traefikGetFileSystemContract,
  traefikGetProjectFileSystemContract,
  traefikGetFileContentContract,
  traefikDownloadFileContract,
  traefikListProjectsContract,
  traefikForceSyncConfigsContract,
  traefikCleanupOrphanedFilesContract
} from './file-management';

// Import service config validation
import { traefikValidateServiceConfigContract } from './service-config';

// Main traefik contract with only the minimal file management API
export const traefikContract = oc.tag("Traefik").prefix("/traefik").router({
  // ============================================================================= 
  // MINIMAL FILE MANAGEMENT API
  // =============================================================================
  
  // File system operations
  getFileSystem: traefikGetFileSystemContract,
  getProjectFileSystem: traefikGetProjectFileSystemContract,
  getFileContent: traefikGetFileContentContract,
  downloadFile: traefikDownloadFileContract,
  listProjects: traefikListProjectsContract,
  
  // Configuration synchronization
  forceSyncConfigs: traefikForceSyncConfigsContract,
  cleanupOrphanedFiles: traefikCleanupOrphanedFilesContract,
  
  // Service configuration validation
  validateServiceConfig: traefikValidateServiceConfigContract,
});

export type TraefikContract = typeof traefikContract;

// Re-export file management contracts
export * from './file-management';
export * from './service-config';

