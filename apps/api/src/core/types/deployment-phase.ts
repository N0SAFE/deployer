// Deployment phase tracking for reconciliation and crash recovery
export enum DeploymentPhase {
  QUEUED = 'queued',
  PULLING_SOURCE = 'pulling_source',
  BUILDING = 'building',
  COPYING_FILES = 'copying_files',
  CREATING_SYMLINKS = 'creating_symlinks',
  UPDATING_ROUTES = 'updating_routes',
  HEALTH_CHECK = 'health_check',
  ACTIVE = 'active',
  FAILED = 'failed',
}

export interface PhaseMetadata {
  // Source code metadata
  sourceCommit?: string;
  uploadId?: string;
  
  // File operation metadata  
  filesCopied?: number;
  totalFiles?: number;
  
  // Container metadata
  containerId?: string;
  
  // Deployment type metadata
  deploymentType?: string;
  detectedType?: string;
  
  // Error metadata
  error?: string;
  stack?: string;
  
  // Allow additional custom metadata
  [key: string]: any;
}
