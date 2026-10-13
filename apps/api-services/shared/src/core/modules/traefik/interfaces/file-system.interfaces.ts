/**
 * Traefik Virtual File System Interfaces
 *
 * Types for the database-backed virtual filesystem.
 *
 * @module traefik/interfaces/file-system
 */

// ============================================================================
// FILE ITEM TYPES
// ============================================================================

/**
 * Virtual file system item
 */
export interface VirtualFileItem {
  /** File or directory name */
  name: string;
  /** Full path in virtual filesystem */
  path: string;
  /** Item type */
  type: 'file' | 'directory';
  /** File size in bytes */
  size?: number;
  /** Last modification timestamp */
  lastModified?: string;
  /** File extension (e.g., '.yml') */
  extension?: string;
  /** MIME type */
  mimeType?: string;
  /** Whether file can be read */
  isReadable: boolean;
  /** Whether file can be written */
  isWritable: boolean;
  /** File content (if loaded) */
  content?: string;
  /** Associated project ID */
  projectId?: string;
  /** Associated config ID */
  configId?: string;
}

/**
 * Directory tree structure
 */
export interface VirtualDirectoryTree {
  /** Directory name */
  name: string;
  /** Full path */
  path: string;
  /** Files in directory */
  files: VirtualFileItem[];
  /** Subdirectories */
  subdirectories: VirtualDirectoryTree[];
}

// ============================================================================
// PATH CONFIGURATION
// ============================================================================

/**
 * File system paths configuration
 */
export interface TraefikFileSystemPaths {
  /** Base path for all Traefik configs */
  basePath: string;
  /** Path for dynamic configurations */
  dynamicPath: string;
  /** Path for static configurations */
  staticPath: string;
  /** Path for project-specific configs */
  projectsPath: string;
  /** Path for standalone configs */
  standalonePath: string;
  /** Path for SSL certificates */
  sslPath: string;
  /** Path for middleware configs */
  middlewarePath: string;
  /** Path for backups */
  backupPath: string;
  /** Path for certificate files */
  certsPath: string;
  /** Path for plugins */
  pluginsPath: string;
}

/**
 * File naming conventions
 */
export interface FileSystemNamingConventions {
  /** Prefix for service config files */
  serviceConfigPrefix: string;
  /** Prefix for middleware files */
  middlewarePrefix: string;
  /** Prefix for SSL config files */
  sslPrefix: string;
  /** Default file extension */
  fileExtension: string;
  /** Suffix for backup files */
  backupSuffix: string;
}

// ============================================================================
// OPERATION RESULTS
// ============================================================================

/**
 * File operation result
 */
export interface FileOperationResult {
  /** Whether operation succeeded */
  success: boolean;
  /** Path of affected file */
  filePath: string;
  /** Action that was performed */
  action: 'created' | 'updated' | 'deleted' | 'read' | 'error';
  /** Optional message */
  message?: string;
  /** File size in bytes */
  size?: number;
  /** Content checksum */
  checksum?: string;
}

/**
 * File content result
 */
export interface FileContentResult {
  /** File content */
  content: string;
  /** Size in bytes */
  size: number;
  /** MIME type */
  mimeType: string;
}

/**
 * Download result
 */
export interface DownloadResult extends FileContentResult {
  /** Filename for download */
  filename: string;
}

// ============================================================================
// PARSED FILENAMES
// ============================================================================

/**
 * Parsed service config filename
 */
export interface ParsedServiceConfigFileName {
  /** Service ID (short) */
  serviceId: string;
  /** Config ID (short) */
  configId: string;
}
