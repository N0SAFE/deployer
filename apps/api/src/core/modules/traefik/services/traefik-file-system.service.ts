import { Injectable, Logger } from '@nestjs/common';
import { join, basename, relative } from 'path';
import * as crypto from 'crypto';
import { TraefikRepository } from '../repositories/traefik.repository';
import { EnvService } from '@/config/env/env.service';

interface FileSystemItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  lastModified?: string;
  extension?: string;
  permissions?: string;
  isReadable?: boolean;
  isWritable?: boolean;
  content?: string; // For virtual files from database
  projectId?: string;
  configId?: string;
}

interface DirectoryTree {
  name: string;
  path: string;
  files: FileSystemItem[];
  subdirectories: DirectoryTree[];
}

export interface TraefikFileSystemPaths {
  basePath: string;
  dynamicPath: string;
  staticPath: string;
  projectsPath: string;
  standalonePath: string;
  sslPath: string;
  middlewarePath: string;
  backupPath: string;
  certsPath: string;
  pluginsPath: string;
}

export interface FileSystemNamingConventions {
  serviceConfigPrefix: string;
  middlewarePrefix: string;
  sslPrefix: string;
  fileExtension: string;
  backupSuffix: string;
}

export interface FileOperationResult {
  success: boolean;
  filePath: string;
  action: 'created' | 'updated' | 'deleted' | 'read' | 'error';
  message?: string;
  size?: number;
  checksum?: string;
}


@Injectable()
export class TraefikFileSystemService {
  private readonly logger = new Logger(TraefikFileSystemService.name);
  private readonly paths: TraefikFileSystemPaths;
  private readonly naming: FileSystemNamingConventions;

  constructor(
    private envService: EnvService,
    private traefikRepository: TraefikRepository
  ) {
    const basePath = this.envService.get('TRAEFIK_CONFIG_BASE_PATH');

    this.paths = {
      basePath,
      dynamicPath: join(basePath, 'dynamic'),
      staticPath: join(basePath, 'static'),
      projectsPath: join(basePath, 'dynamic', 'projects'),
      standalonePath: join(basePath, 'dynamic', 'standalone'),
      sslPath: join(basePath, 'ssl'),
      certsPath: join(basePath, 'certs'),
      middlewarePath: join(basePath, 'middleware'),
      pluginsPath: join(basePath, 'plugins'),
      backupPath: this.envService.get('TRAEFIK_BACKUP_PATH')
    };

    this.naming = {
      serviceConfigPrefix: 'service',
      middlewarePrefix: 'middleware',
      sslPrefix: 'ssl',
      fileExtension: 'yml',
      backupSuffix: 'backup',
    };
  }

  // ============================================================================
  // FILESYSTEM PATH CONVENTIONS
  // ============================================================================

  /**
   * Get all filesystem paths
   */
  getFileSystemPaths(): TraefikFileSystemPaths {
    return { ...this.paths };
  }

  /**
   * Get naming conventions
   */
  getNamingConventions(): FileSystemNamingConventions {
    return { ...this.naming };
  }

  /**
   * Generate file path for a service configuration
   */
  generateServiceConfigPath(serviceId: string, configId: string, projectName?: string): string {
    const fileName = this.generateServiceConfigFileName(serviceId, configId);
    
    if (projectName) {
      return join(this.paths.projectsPath, projectName, fileName);
    } else {
      return join(this.paths.standalonePath, fileName);
    }
  }

  /**
   * Generate file name for a service configuration
   */
  generateServiceConfigFileName(serviceId: string, configId: string): string {
    const serviceShort = serviceId.slice(0, 8);
    const configShort = configId.slice(0, 8);
    return `${this.naming.serviceConfigPrefix}-${serviceShort}-${configShort}.${this.naming.fileExtension}`;
  }

  /**
   * Generate file path for middleware configuration
   */
  generateMiddlewarePath(middlewareName: string, middlewareId: string, isGlobal: boolean = false): string {
    const fileName = this.generateMiddlewareFileName(middlewareName, middlewareId);
    
    if (isGlobal) {
      return join(this.paths.middlewarePath, 'global', fileName);
    } else {
      return join(this.paths.middlewarePath, 'local', fileName);
    }
  }

  /**
   * Generate file name for middleware
   */
  generateMiddlewareFileName(middlewareName: string, middlewareId: string): string {
    const sanitizedName = this.sanitizeFileName(middlewareName);
    const middlewareShort = middlewareId.slice(0, 8);
    return `${this.naming.middlewarePrefix}-${sanitizedName}-${middlewareShort}.${this.naming.fileExtension}`;
  }

  /**
   * Generate file path for SSL certificate
   */
  generateSSLCertificatePath(domain: string, certificateId: string): string {
    const fileName = this.generateSSLCertificateFileName(domain, certificateId);
    return join(this.paths.sslPath, fileName);
  }

  /**
   * Generate file name for SSL certificate
   */
  generateSSLCertificateFileName(domain: string, certificateId: string): string {
    const sanitizedDomain = this.sanitizeDomainName(domain);
    const certShort = certificateId.slice(0, 8);
    return `${this.naming.sslPrefix}-${sanitizedDomain}-${certShort}.${this.naming.fileExtension}`;
  }

  // ============================================================================
  // FILESYSTEM OPERATIONS
  // ============================================================================

  /**
   * Generate backup file path
   */
  generateBackupPath(originalPath: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = basename(originalPath);
    const backupFileName = `${fileName}.${this.naming.backupSuffix}.${timestamp}`;
    return join(this.paths.backupPath, backupFileName);
  }

  /**
   * Sanitize file name to be filesystem safe
   */
  sanitizeFileName(name: string): string {
    return name.replace(/[^a-zA-Z0-9\-_.]/g, '_').toLowerCase();
  }

  /**
   * Sanitize domain name for file naming
   */
  sanitizeDomainName(domain: string): string {
    return domain.replace(/[^a-zA-Z0-9\-_.]/g, '_').toLowerCase();
  }

  /**
   * Parse service config file name to extract IDs
   */
  parseServiceConfigFileName(fileName: string): { serviceId: string; configId: string } | null {
    const pattern = new RegExp(`^${this.naming.serviceConfigPrefix}-(\\w{8})-(\\w{8})\\.${this.naming.fileExtension}$`);
    this.logger.debug(`Parsing fileName: ${fileName} with pattern: ${pattern.source}`);
    
    const match = fileName.match(pattern);
    
    if (match) {
      this.logger.debug(`Successfully parsed - serviceId: ${match[1]}, configId: ${match[2]}`);
      return {
        serviceId: match[1],
        configId: match[2],
      };
    }
    
    this.logger.debug(`Failed to match pattern for fileName: ${fileName}`);
    return null;
  }

  /**
   * Check if file path belongs to a specific project
   */
  isProjectFile(filePath: string, projectName: string): boolean {
    const projectPath = join(this.paths.projectsPath, projectName);
    return filePath.startsWith(projectPath);
  }

  /**
   * Extract project name from file path
   */
  extractProjectFromPath(filePath: string): string | null {
    if (!filePath.startsWith(this.paths.projectsPath)) {
      return null;
    }
    
    const relativePath = relative(this.paths.projectsPath, filePath);
    const pathParts = relativePath.split('/');
    
    return pathParts[0] || null;
  }
  async getTraefikFileSystem(path?: string): Promise<DirectoryTree> {
    try {
      this.logger.debug(`Getting virtual Traefik file system for path: ${path || '/'}`);
      
      // Build virtual file system from database
      return await this.buildVirtualDirectoryTree(path || '/');
    } catch (error) {
      this.logger.error('Failed to get virtual Traefik file system:', error);
      throw new Error(`Failed to access virtual Traefik file system: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get virtual file system structure for a specific project from database
   */
  async getProjectFileSystem(projectName: string): Promise<DirectoryTree> {
    try {
      this.logger.debug(`Getting virtual project file system for: ${projectName}`);
      
      // Build virtual project directory from database
      return await this.buildVirtualProjectTree(projectName);
    } catch (error) {
      this.logger.error(`Failed to get virtual project file system for ${projectName}:`, error);
      throw new Error(`Failed to access virtual project file system: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get virtual file content from database
   */
  async getFileContent(filePath: string): Promise<{
    content: string;
    size: number;
    mimeType: string;
  }> {
    try {
      this.logger.debug(`Getting virtual file content for: ${filePath}`);
      
      // Get content from database based on file path
      const content = await this.getVirtualFileContent(filePath);
      
      // Determine MIME type based on extension
      const extension = filePath.split('.').pop()?.toLowerCase() || '';
      const mimeType = this.getMimeType(extension);

      return {
        content,
        size: Buffer.byteLength(content, 'utf8'),
        mimeType
      };
    } catch (error) {
      this.logger.error(`Failed to read virtual file ${filePath}:`, error);
      throw new Error(`Failed to read virtual file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Download file (same as getFileContent but with proper filename)
   */
  async downloadFile(filePath: string): Promise<{
    filename: string;
    content: string;
    mimeType: string;
    size: number;
  }> {
    const fileContent = await this.getFileContent(filePath);
    const filename = filePath.split('/').pop() || 'unknown';

    return {
      filename,
      ...fileContent
    };
  }

  /**
   * List all available projects from database
   */
  async listProjects(): Promise<string[]> {
    try {
      this.logger.debug('Getting virtual projects list from database');
      
      // Get projects from database
      const projects = await this.traefikRepository.getAllProjects();
      return projects.map(project => project.name).sort();
    } catch (error) {
      this.logger.error('Failed to list virtual projects:', error);
      throw new Error(`Failed to list virtual projects: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // ============================================================================
  // FILE MANAGEMENT OPERATIONS
  // ============================================================================

  /**
   * Write virtual file content to database
   */
  async writeFile(filePath: string, content: string, _createDirectories: boolean = true): Promise<FileOperationResult> {
    try {
      this.logger.debug(`Writing virtual file: ${filePath}`);
      
      // Check if virtual file exists to determine action
      const fileExists = await this.virtualFileExists(filePath);
      
      // Write content to database
      await this.writeVirtualFileContent(filePath, content);
      
      // Calculate checksum
      const checksum = this.calculateChecksum(content);
      const size = Buffer.byteLength(content, 'utf8');

      return {
        success: true,
        filePath: filePath,
        action: fileExists ? 'updated' : 'created',
        size,
        checksum,
      };
    } catch (error) {
      this.logger.error(`Failed to write virtual file ${filePath}:`, error);
      return {
        success: false,
        filePath,
        action: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Delete virtual file from database
   */
  async deleteFile(filePath: string): Promise<FileOperationResult> {
    try {
      this.logger.debug(`Deleting virtual file: ${filePath}`);
      
      // Check if virtual file exists
      const fileExists = await this.virtualFileExists(filePath);
      if (!fileExists) {
        return {
          success: true,
          filePath: filePath,
          action: 'deleted',
          message: 'Virtual file did not exist',
        };
      }

      // Delete from database
      await this.deleteVirtualFile(filePath);

      return {
        success: true,
        filePath: filePath,
        action: 'deleted',
      };
    } catch (error) {
      this.logger.error(`Failed to delete virtual file ${filePath}:`, error);
      return {
        success: false,
        filePath,
        action: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Backup virtual file in database
   */
  async backupFile(filePath: string): Promise<FileOperationResult> {
    try {
      this.logger.debug(`Creating virtual backup for: ${filePath}`);
      
      // Check if virtual file exists
      const fileExists = await this.virtualFileExists(filePath);
      if (!fileExists) {
        return {
          success: true,
          filePath: filePath,
          action: 'read',
          message: 'Virtual file does not exist, no backup needed',
        };
      }

      // Get current content
      const content = await this.getVirtualFileContent(filePath);
      
      // Create backup in database
      const backupResult = await this.createVirtualBackup(filePath, content);
      
      this.logger.debug(`Created virtual backup for ${filePath}`);
      
      return {
        success: true,
        filePath: backupResult.backupPath,
        action: 'created',
        size: Buffer.byteLength(content, 'utf8'),
      };
    } catch (error) {
      this.logger.error(`Failed to backup virtual file ${filePath}:`, error);
      return {
        success: false,
        filePath,
        action: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get all virtual configuration files from database
   */
  async getAllConfigFiles(directoryPath?: string): Promise<string[]> {
    try {
      this.logger.debug(`Getting all virtual config files for path: ${directoryPath || '/'}`);
      return await this.getAllVirtualConfigFiles(directoryPath);
    } catch (error) {
      this.logger.error('Failed to get virtual config files:', error);
      return [];
    }
  }

  /**
   * Get all virtual configuration files for a specific project from database
   */
  async getProjectConfigFiles(projectName: string): Promise<string[]> {
    try {
      this.logger.debug(`Getting virtual config files for project: ${projectName}`);
      return await this.getVirtualProjectConfigFiles(projectName);
    } catch (error) {
      this.logger.error(`Failed to get virtual project config files for ${projectName}:`, error);
      return [];
    }
  }

  /**
   * Check if virtual file exists in database
   */
  async fileExists(filePath: string): Promise<boolean> {
    return this.virtualFileExists(filePath);
  }

  /**
   * Calculate virtual file checksum
   */
  async calculateFileChecksum(filePath: string): Promise<string> {
    const content = await this.getVirtualFileContent(filePath);
    return this.calculateChecksum(content);
  }

  /**
   * Calculate content checksum
   */
  calculateChecksum(content: string): string {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  }

  /**
   * Ensure virtual directory exists (no-op for virtual filesystem)
   */
  async ensureDirectoryExists(dirPath: string): Promise<void> {
    // Virtual directories don't need explicit creation
    this.logger.debug(`Virtual directory ensured: ${dirPath}`);
  }

  /**
   * Initialize virtual filesystem structure (no-op for database-driven system)
   */
  async initializeFileSystemStructure(): Promise<void> {
    this.logger.log('Virtual Traefik filesystem structure initialized (database-driven)');
  }
  // ============================================================================
  // VIRTUAL FILESYSTEM METHODS
  // ============================================================================

  /**
   * Build virtual directory tree from database data
   */
  private async buildVirtualDirectoryTree(path: string): Promise<DirectoryTree> {
    const name = path === '/' ? 'traefik-configs' : path.split('/').pop() || '';
    
    // Build virtual structure based on database content
    const files: FileSystemItem[] = [];
    const subdirectories: DirectoryTree[] = [];

    // Add virtual directories based on Traefik structure
    if (path === '/') {
      subdirectories.push(
        await this.buildVirtualDirectoryTree('/dynamic'),
        await this.buildVirtualDirectoryTree('/static'),
        await this.buildVirtualDirectoryTree('/ssl'),
        await this.buildVirtualDirectoryTree('/middleware'),
        await this.buildVirtualDirectoryTree('/backups')
      );
      
      // Add main traefik.yml file
      const mainConfig = await this.getVirtualMainConfig();
      if (mainConfig && typeof mainConfig === 'string') {
        files.push({
          name: 'traefik.yml',
          path: '/traefik.yml',
          type: 'file',
          size: Buffer.byteLength(mainConfig, 'utf8'),
          lastModified: new Date().toISOString(),
          extension: '.yml',
          isReadable: true,
          isWritable: true,
          content: mainConfig
        });
      } else {
        this.logger.error(`Invalid mainConfig type: ${typeof mainConfig}`, mainConfig);
      }
    } else if (path === '/dynamic') {
      subdirectories.push(
        await this.buildVirtualDirectoryTree('/dynamic/projects'),
        await this.buildVirtualDirectoryTree('/dynamic/standalone')
      );
    } else if (path === '/dynamic/projects') {
      // Add project subdirectories
      const projects = await this.traefikRepository.getAllProjects();
      for (const project of projects) {
        subdirectories.push(await this.buildVirtualProjectTree(project.name));
      }
    } else if (path.startsWith('/dynamic/projects/')) {
      const projectName = path.split('/')[3];
      if (projectName) {
        return await this.buildVirtualProjectTree(projectName);
      }
    } else {
      // Handle other virtual directories (ssl, middleware, etc.)
      const virtualFiles = await this.getVirtualFilesForPath(path);
      files.push(...virtualFiles);
    }

    return {
      name,
      path,
      files: files.sort((a, b) => a.name.localeCompare(b.name)),
      subdirectories: subdirectories.sort((a, b) => a.name.localeCompare(b.name))
    };
  }

  /**
   * Build virtual project tree from database
   */
  private async buildVirtualProjectTree(projectName: string): Promise<DirectoryTree> {
    const files: FileSystemItem[] = [];
    
    this.logger.debug(`Building virtual project tree for: ${projectName}`);
    
    // First resolve project name to project ID
    const projectId = await this.traefikRepository.getProjectIdByName(projectName);
    
    if (!projectId) {
      this.logger.warn(`Project not found in database: ${projectName}`);
      return {
        name: projectName,
        path: `/dynamic/projects/${projectName}`,
        files: [],
        subdirectories: [],
      };
    }
    
    this.logger.debug(`Found project ID: ${projectId} for project: ${projectName}`);
    
    // Get service configs for this project using project ID
    const serviceConfigs = await this.traefikRepository.getServiceConfigsByProject(projectId);
    
    this.logger.debug(`Found ${serviceConfigs.length} service configs for project ${projectName} (ID: ${projectId})`);
    
    if (serviceConfigs.length === 0) {
      this.logger.warn(`No Traefik service configurations found for project: ${projectName} (ID: ${projectId}). This project may not have services with Traefik configs yet.`);
    }
    
    for (const config of serviceConfigs) {
      try {
        this.logger.debug(`Processing service config - serviceId: ${config.serviceId}, configId: ${config.id}, domain: ${config.domain}`);
        
        const fileName = this.generateServiceConfigFileName(config.serviceId, config.id);
        // Service configs from traefik-service schema don't have configuration property
        const content = `# Service Config for ${config.serviceId || 'unknown'}\ndomain: ${config.domain || 'unknown'}\nfullDomain: ${config.fullDomain || 'unknown'}\nsslEnabled: ${config.sslEnabled || false}`;
        
        this.logger.debug(`Generated filename: ${fileName} for service config ${config.id}`);
        
        // Ensure content is actually a string
        if (typeof content === 'string') {
          files.push({
            name: fileName,
            path: `/dynamic/projects/${projectName}/${fileName}`,
            type: 'file',
            size: Buffer.byteLength(content, 'utf8'),
            lastModified: config.updatedAt?.toISOString() || new Date().toISOString(),
            extension: '.yml',
            isReadable: true,
            isWritable: true,
            content
          });
          this.logger.debug(`Added file ${fileName} to project ${projectName}`);
        } else {
          this.logger.error(`Invalid content type for config ${config.id}:`, typeof content);
        }
      } catch (error) {
        this.logger.error(`Error processing service config ${config.id}:`, error);
        // Continue with next config instead of failing entirely
      }
    }

    this.logger.debug(`Built project tree for ${projectName} with ${files.length} files`);

    return {
      name: projectName,
      path: `/dynamic/projects/${projectName}`,
      files: files.sort((a, b) => a.name.localeCompare(b.name)),
      subdirectories: []
    };
  }

  /**
   * Get MIME type based on file extension
   */
  private getMimeType(extension: string): string {
    const mimeTypes: Record<string, string> = {
      'yml': 'application/x-yaml',
      'yaml': 'application/x-yaml',
      'json': 'application/json',
      'toml': 'application/toml',
      'conf': 'text/plain',
      'config': 'text/plain',
      'txt': 'text/plain',
      'log': 'text/plain',
      'md': 'text/markdown',
      'crt': 'application/x-x509-ca-cert',
      'key': 'application/x-pem-file',
      'pem': 'application/x-pem-file'
    };

    return mimeTypes[extension] || 'text/plain';
  }

  // ============================================================================
  // VIRTUAL FILESYSTEM HELPER METHODS
  // ============================================================================

  /**
   * Check if virtual file exists in database
   */
  private async virtualFileExists(filePath: string): Promise<boolean> {
    try {
      await this.getVirtualFileContent(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get virtual file content from database based on path
   */
  private async getVirtualFileContent(filePath: string): Promise<string> {
    this.logger.debug(`Getting virtual file content for: ${filePath}`);
    
    // Handle main traefik.yml file
    if (filePath === '/traefik.yml' || filePath === 'traefik.yml') {
      return await this.getVirtualMainConfig();
    }

    // Handle service config files
    if (filePath.includes('/dynamic/projects/') && filePath.endsWith('.yml')) {
      const pathParts = filePath.split('/');
      const fileName = pathParts[pathParts.length - 1];
      const projectName = pathParts[3];
      
      this.logger.debug(`Parsed file path - fileName: ${fileName}, projectName: ${projectName}`);
      
      const parsed = this.parseServiceConfigFileName(fileName);
      if (parsed && projectName) {
        this.logger.debug(`Parsed service config - serviceId: ${parsed.serviceId}, configId: ${parsed.configId}`);
        
        // First resolve project name to project ID
        const projectId = await this.traefikRepository.getProjectIdByName(projectName);
        
        if (!projectId) {
          this.logger.error(`Project not found: ${projectName}`);
          throw new Error(`Project not found: ${projectName}`);
        }
        
        this.logger.debug(`Found project ID: ${projectId} for project: ${projectName}`);
        
        const configs = await this.traefikRepository.getServiceConfigsByProject(projectId);
        this.logger.debug(`Found ${configs.length} service configs for project ${projectName}`);
        
        // Log available configs for debugging
        configs.forEach(config => {
          this.logger.debug(`Available config - serviceId: ${config.serviceId}, configId: ${config.id}`);
        });
        
        const config = configs.find(c => c.serviceId.startsWith(parsed.serviceId) && c.id.startsWith(parsed.configId));
        if (config) {
          this.logger.debug(`Found matching config for serviceId: ${parsed.serviceId}, configId: ${parsed.configId}`);
          return this.generateServiceConfigContent(config);
        } else {
          this.logger.error(`No matching service config found for serviceId: ${parsed.serviceId}, configId: ${parsed.configId} in project: ${projectName}`);
          // Generate a placeholder config instead of throwing an error immediately
          return this.generatePlaceholderServiceConfig(parsed.serviceId, parsed.configId, projectName);
        }
      } else {
        this.logger.error(`Failed to parse service config filename: ${fileName} or missing project name: ${projectName}`);
        // Generate a minimal placeholder config
        return this.generateMinimalPlaceholderConfig(fileName, projectName || 'unknown');
      }
    }

    // Handle SSL certificates
    if (filePath.includes('/ssl/') && filePath.endsWith('.yml')) {
      const fileName = filePath.split('/').pop();
      if (fileName?.startsWith('ssl-')) {
        const sslCerts = await this.traefikRepository.getAllNewSslCertificates();
        const cert = sslCerts.find(c => filePath.includes(c.domain.replace('.', '_')));
        if (cert) {
          return this.generateSslConfigContent(cert);
        }
      }
    }

    // Handle middleware files
    if (filePath.includes('/middleware/') && filePath.endsWith('.yml')) {
      const middlewares = await this.traefikRepository.getAllNewMiddleware();
      const middleware = middlewares.find(m => filePath.includes(m.middlewareName));
      if (middleware) {
        return this.generateMiddlewareConfigContent(middleware);
      }
    }

    // Handle static files
    if (filePath.includes('/static/') && filePath.endsWith('.yml')) {
      const staticFiles = await this.traefikRepository.getAllStaticFiles();
      const staticFile = staticFiles.find(sf => filePath.includes(sf.fileName));
      if (staticFile) {
        return staticFile.fileContent;
      }
    }

    this.logger.error(`Virtual file not found: ${filePath}. Checked paths: main config, service configs, SSL certs, middleware, static files`);
    throw new Error(`Virtual file not found: ${filePath}`);
  }

  /**
   * Write virtual file content to database
   */
  private async writeVirtualFileContent(filePath: string, content: string): Promise<void> {
    // Normalize the file path to ensure consistent format
    const normalizedPath = filePath.startsWith('/') ? filePath : `/${filePath}`;
    
    // Handle main traefik.yml file
    if (normalizedPath === '/traefik.yml' || filePath === 'traefik.yml') {
      // Store main config in static files table
      await this.traefikRepository.createStaticFile({
        fileName: 'traefik.yml',
        relativePath: normalizedPath,
        fileContent: content,
        mimeType: 'application/x-yaml',
        fileSize: Buffer.byteLength(content, 'utf8'),
        isPublic: false,
        projectId: null
      });
      return;
    }

    // Handle service config files (both with and without leading slash)
    if ((normalizedPath.includes('/dynamic/projects/') || filePath.includes('dynamic/projects/')) && filePath.endsWith('.yml')) {
      const pathParts = normalizedPath.split('/').filter(part => part.length > 0);
      let fileName, projectName;
      
      // Handle different path formats
      if (pathParts[0] === 'dynamic' && pathParts[1] === 'projects') {
        projectName = pathParts[2];
        fileName = pathParts[3];
      } else {
        // Fallback for other formats
        fileName = pathParts[pathParts.length - 1];
        projectName = pathParts[pathParts.length - 2];
      }
      
      const parsed = this.parseServiceConfigFileName(fileName);
      if (parsed && projectName) {
        // For now, just store as static file since service configs don't have configYaml field
        await this.traefikRepository.createStaticFile({
          fileName,
          relativePath: normalizedPath,
          fileContent: content,
          mimeType: 'application/x-yaml',
          fileSize: Buffer.byteLength(content, 'utf8'),
          isPublic: false,
          projectId: null
        });
        return;
      }
    }

    // Handle static files
    if (normalizedPath.includes('/static/')) {
      const fileName = normalizedPath.split('/').pop() || 'unknown';
      await this.traefikRepository.createStaticFile({
        fileName,
        relativePath: normalizedPath,
        fileContent: content,
        mimeType: 'application/x-yaml',
        fileSize: Buffer.byteLength(content, 'utf8'),
        isPublic: false,
        projectId: null
      });
      return;
    }

    this.logger.error(`Cannot write virtual file: ${filePath} (normalized: ${normalizedPath})`);
    throw new Error(`Cannot write virtual file: ${filePath}`);
  }

  /**
   * Delete virtual file from database
   */
  private async deleteVirtualFile(filePath: string): Promise<void> {
    // Handle service config files
    if (filePath.includes('/dynamic/projects/') && filePath.endsWith('.yml')) {
      const pathParts = filePath.split('/');
      const fileName = pathParts[pathParts.length - 1];
      const projectName = pathParts[3];
      
      const parsed = this.parseServiceConfigFileName(fileName);
      if (parsed && projectName) {
        // First resolve project name to project ID
        const projectId = await this.traefikRepository.getProjectIdByName(projectName);
        
        if (!projectId) {
          throw new Error(`Project not found: ${projectName}`);
        }
        
        const configs = await this.traefikRepository.getServiceConfigsByProject(projectId);
        const config = configs.find(c => c.serviceId.startsWith(parsed.serviceId) && c.id.startsWith(parsed.configId));
        if (config) {
          await this.traefikRepository.deleteServiceConfig(config.id);
          return;
        }
      }
    }

    // Handle static files
    if (filePath.includes('/static/')) {
      const staticFiles = await this.traefikRepository.getAllStaticFiles();
      const staticFile = staticFiles.find(sf => sf.relativePath === filePath);
      if (staticFile) {
        // Note: deleteStaticFile method doesn't exist yet, we'll need to add it
        this.logger.warn(`Cannot delete static file ${filePath} - delete method not implemented`);
        return;
      }
    }

    throw new Error(`Cannot delete virtual file: ${filePath}`);
  }

  /**
   * Create virtual backup in database
   */
  private async createVirtualBackup(filePath: string, content: string): Promise<{ backupPath: string }> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = filePath.split('/').pop() || 'unknown';
    const backupPath = `/backups/${fileName}.backup.${timestamp}`;
    
    await this.traefikRepository.createBackup({
      backupName: `${fileName}.backup.${timestamp}`,
      backupType: 'file',
      originalPath: filePath,
      backupContent: content,
      compressionType: null,
      backupSize: Buffer.byteLength(content, 'utf8'),
      metadata: { originalFileName: fileName },
      projectId: null
    });

    return { backupPath };
  }

  /**
   * Get virtual main config content
   */
  private async getVirtualMainConfig(): Promise<string> {
    try {
      // Try to get from static files first
      const staticFiles = await this.traefikRepository.getAllStaticFiles();
      const mainConfig = staticFiles.find(sf => sf.fileName === 'traefik.yml');
      
      if (mainConfig && typeof mainConfig.fileContent === 'string') {
        return mainConfig.fileContent;
      }

      // Return default main config
      return `# Traefik main configuration
api:
  dashboard: true
  insecure: true

entryPoints:
  web:
    address: ":80"
  websecure:
    address: ":443"

providers:
  file:
    directory: /etc/traefik/dynamic
    watch: true

certificatesResolvers:
  letsencrypt:
    acme:
      email: admin@example.com
      storage: /etc/traefik/acme.json
      httpChallenge:
        entryPoint: web
`;
    } catch (error) {
      this.logger.error('Error getting virtual main config:', error);
      // Return default config if database query fails
      return `# Traefik main configuration (default - database error)
api:
  dashboard: true
  insecure: true

entryPoints:
  web:
    address: ":80"
  websecure:
    address: ":443"

providers:
  file:
    directory: /etc/traefik/dynamic
    watch: true

certificatesResolvers:
  letsencrypt:
    acme:
      email: admin@example.com
      storage: /etc/traefik/acme.json
      httpChallenge:
        entryPoint: web
`;
    }
  }

  /**
   * Get virtual files for a specific path
   */
  private async getVirtualFilesForPath(path: string): Promise<FileSystemItem[]> {
    const files: FileSystemItem[] = [];

    if (path === '/ssl') {
      try {
        const sslCerts = await this.traefikRepository.getAllNewSslCertificates();
        for (const cert of sslCerts) {
          try {
            const fileName = this.generateSSLCertificateFileName(cert.domain, cert.id);
            const content = this.generateSslConfigContent(cert);
            
            // Ensure content is a string
            if (typeof content === 'string') {
              files.push({
                name: fileName,
                path: `/ssl/${fileName}`,
                type: 'file',
                size: Buffer.byteLength(content, 'utf8'),
                lastModified: cert.updatedAt?.toISOString() || new Date().toISOString(),
                extension: '.yml',
                isReadable: true,
                isWritable: true,
                content
              });
            } else {
              this.logger.error(`Invalid SSL content type for cert ${cert.id}:`, typeof content);
            }
          } catch (error) {
            this.logger.error(`Error processing SSL cert ${cert.id}:`, error);
          }
        }
      } catch (error) {
        this.logger.error('Error getting SSL certificates:', error);
      }
    }

    if (path === '/middleware') {
      try {
        const middlewares = await this.traefikRepository.getAllNewMiddleware();
        for (const middleware of middlewares) {
          try {
            const fileName = this.generateMiddlewareFileName(middleware.middlewareName, middleware.id);
            const content = this.generateMiddlewareConfigContent(middleware);
            
            // Ensure content is a string
            if (typeof content === 'string') {
              files.push({
                name: fileName,
                path: `/middleware/${fileName}`,
                type: 'file',
                size: Buffer.byteLength(content, 'utf8'),
                lastModified: middleware.updatedAt?.toISOString() || new Date().toISOString(),
                extension: '.yml',
                isReadable: true,
                isWritable: true,
                content
              });
            } else {
              this.logger.error(`Invalid middleware content type for ${middleware.id}:`, typeof content);
            }
          } catch (error) {
            this.logger.error(`Error processing middleware ${middleware.id}:`, error);
          }
        }
      } catch (error) {
        this.logger.error('Error getting middlewares:', error);
      }
    }

    if (path === '/static') {
      try {
        const staticFiles = await this.traefikRepository.getAllStaticFiles();
        for (const staticFile of staticFiles) {
          try {
            // Ensure fileContent is a string
            if (typeof staticFile.fileContent === 'string') {
              files.push({
                name: staticFile.fileName,
                path: staticFile.relativePath,
                type: 'file',
                size: Buffer.byteLength(staticFile.fileContent, 'utf8'),
                lastModified: staticFile.updatedAt?.toISOString() || new Date().toISOString(),
                extension: staticFile.fileName.includes('.') ? `.${staticFile.fileName.split('.').pop()}` : undefined,
                isReadable: true,
                isWritable: true,
                content: staticFile.fileContent
              });
            } else {
              this.logger.error(`Invalid static file content type for ${staticFile.fileName}:`, typeof staticFile.fileContent);
            }
          } catch (error) {
            this.logger.error(`Error processing static file ${staticFile.fileName}:`, error);
          }
        }
      } catch (error) {
        this.logger.error('Error getting static files:', error);
      }
    }

    return files;
  }

  /**
   * Get all virtual config files
   */
  private async getAllVirtualConfigFiles(directoryPath?: string): Promise<string[]> {
    const files: string[] = [];

    // Get all service configs
    const serviceConfigs = await this.traefikRepository.getAllServiceConfigs();
    for (const config of serviceConfigs) {
      try {
        // Get the service to find its project
        const service = await this.traefikRepository.getServiceById(config.serviceId);
        if (!service) {
          this.logger.warn(`Service ${config.serviceId} not found for config ${config.id}`);
          continue;
        }

        // Get the project to get its name
        const project = await this.traefikRepository.getProjectById(service.projectId);
        if (!project) {
          this.logger.warn(`Project ${service.projectId} not found for service ${config.serviceId}`);
          continue;
        }

        const fileName = this.generateServiceConfigFileName(config.serviceId, config.id);
        files.push(`/dynamic/projects/${project.name}/${fileName}`);
      } catch (error) {
        this.logger.error(`Failed to process service config ${config.id}:`, error);
        // Skip this config instead of using "unknown"
        continue;
      }
    }

    // Get all SSL certificates
    const sslCerts = await this.traefikRepository.getAllNewSslCertificates();
    for (const cert of sslCerts) {
      const fileName = this.generateSSLCertificateFileName(cert.domain, cert.id);
      files.push(`/ssl/${fileName}`);
    }

    // Get all middleware
    const middlewares = await this.traefikRepository.getAllNewMiddleware();
    for (const middleware of middlewares) {
      const fileName = this.generateMiddlewareFileName(middleware.middlewareName, middleware.id);
      files.push(`/middleware/${fileName}`);
    }

    // Get all static files
    const staticFiles = await this.traefikRepository.getAllStaticFiles();
    for (const staticFile of staticFiles) {
      files.push(staticFile.relativePath);
    }

    return files.filter(file => !directoryPath || file.startsWith(directoryPath));
  }

  /**
   * Get virtual config files for a specific project
   */
  private async getVirtualProjectConfigFiles(projectName: string): Promise<string[]> {
    const files: string[] = [];
    
    // First resolve project name to project ID
    const projectId = await this.traefikRepository.getProjectIdByName(projectName);
    
    if (!projectId) {
      this.logger.warn(`Project not found: ${projectName}`);
      return files;
    }
    
    // Get service configs for this project using project ID
    const serviceConfigs = await this.traefikRepository.getServiceConfigsByProject(projectId);
    for (const config of serviceConfigs) {
      const fileName = this.generateServiceConfigFileName(config.serviceId, config.id);
      files.push(`/dynamic/projects/${projectName}/${fileName}`);
    }

    return files;
  }

  /**
   * Generate service config content from database record
   */
  private generateServiceConfigContent(config: any): string {
    // Ensure configYaml is a string if it exists
    if (config.configYaml && typeof config.configYaml === 'string') {
      return config.configYaml;
    }
    
    // Return default service config
    return `# Service configuration for ${config.serviceId || 'unknown'}
http:
  routers:
    ${config.serviceId || 'unknown'}:
      rule: "Host(\`${config.fullDomain || config.domain || 'unknown'}\`)"
      service: ${config.serviceId || 'unknown'}
      ${config.sslEnabled ? 'tls: {}\n      ' : ''}

  services:
    ${config.serviceId || 'unknown'}:
      loadBalancer:
        servers:
          - url: "http://localhost:${config.targetPort || 3000}"
`;
  }

  /**
   * Generate SSL config content from database record
   */
  private generateSslConfigContent(cert: any): string {
    return `# SSL Certificate for ${cert.domain || 'unknown'}
tls:
  certificates:
    - certFile: "/etc/traefik/ssl/${cert.domain || 'unknown'}.crt"
      keyFile: "/etc/traefik/ssl/${cert.domain || 'unknown'}.key"
`;
  }

  /**
   * Generate middleware config content from database record
   */
  private generateMiddlewareConfigContent(middleware: any): string {
    // Ensure configuration is a string if it exists
    if (middleware.configuration && typeof middleware.configuration === 'string') {
      return middleware.configuration;
    }
    
    // Return default middleware config
    return `# Middleware: ${middleware.middlewareName || middleware.name || 'unknown'}
http:
  middlewares:
    ${middleware.middlewareName || middleware.name || 'unknown'}:
      ${middleware.middlewareType || middleware.type || 'unknown'}:
        # Configuration for ${middleware.middlewareName || middleware.name || 'unknown'}
`;
  }

  /**
   * Generate placeholder service config when no database record found
   */
  private generatePlaceholderServiceConfig(serviceId: string, configId: string, projectName: string): string {
    return `# Placeholder service configuration
# Service ID: ${serviceId}...
# Config ID: ${configId}...
# Project: ${projectName}
# Note: This is a placeholder because the actual configuration was not found in the database

http:
  routers:
    ${serviceId}-router:
      rule: "Host(\`placeholder.example.com\`)"
      service: ${serviceId}-service
      # entryPoints: [web]

  services:
    ${serviceId}-service:
      loadBalancer:
        servers:
          - url: "http://localhost:3000"
`;
  }

  /**
   * Generate minimal placeholder config when parsing fails
   */
  private generateMinimalPlaceholderConfig(fileName: string, projectName: string): string {
    return `# Minimal placeholder configuration
# File: ${fileName}
# Project: ${projectName}
# Note: This is a placeholder because the configuration could not be parsed or found

http:
  routers:
    placeholder-router:
      rule: "Host(\`placeholder.example.com\`)"
      service: placeholder-service

  services:
    placeholder-service:
      loadBalancer:
        servers:
          - url: "http://localhost:3000"
`;
  }
}