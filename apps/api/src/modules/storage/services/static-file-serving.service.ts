import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { StaticFileService } from "../../../core/services/static-file.service";
import { services, deployments } from "../../../config/drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import * as fs from "fs-extra";
import * as path from "path";
import * as mime from "mime-types";
import { DatabaseService } from "@/core/modules/database/services/database.service";
export interface StaticFileInfo {
  filePath: string;
  contentType: string;
  size: number;
  lastModified: Date;
  etag: string;
}
export interface StaticServingConfig {
  serviceId: string;
  deploymentId: string;
  basePath: string;
  indexFiles: string[];
  cacheHeaders: {
    maxAge: number;
    immutable: boolean;
  };
  compressionEnabled: boolean;
  directoryListing: boolean;
}
@Injectable()
export class StaticFileServingService {
  private readonly logger = new Logger(StaticFileServingService.name);
  private readonly staticFilesDir = "/app/static";
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly staticFileService: StaticFileService
  ) {}
  async onModuleInit() {
    // Ensure static files directory exists
    await fs.ensureDir(this.staticFilesDir);
    this.logger.log("Static file serving service initialized");
  }
  /**
   * Get static file content and metadata
   */
  async getStaticFile(
    serviceId: string,
    filePath: string
  ): Promise<{
    content: Buffer;
    contentType: string;
    headers: Record<string, string>;
  }> {
    try {
      // Get service and latest successful deployment
      const service = await this.getServiceWithLatestDeployment(serviceId);
      if (!service) {
        throw new NotFoundException(`Service ${serviceId} not found`);
      }
      const deployment = service.latestDeployment;
      if (!deployment) {
        throw new NotFoundException(
          `No successful deployment found for service ${serviceId}`
        );
      }
      // Resolve file path
      const resolvedPath = await this.resolveFilePath(deployment.id, filePath);
      const fileInfo = await this.getFileInfo(resolvedPath);
      // Determine content type
      const contentType =
        mime.lookup(resolvedPath) || "application/octet-stream";
      // Generate cache headers
      const headers = this.generateCacheHeaders(fileInfo, service.cacheConfig);
      // Read file content
      const content = await fs.readFile(resolvedPath);
      this.logger.log(
        `Served static file: ${filePath} for service ${serviceId}`
      );
      return {
        content,
        contentType,
        headers,
      };
    } catch (error) {
      this.logger.error(
        `Failed to serve static file ${filePath} for service ${serviceId}:`,
        error
      );
      throw error;
    }
  }
  /**
   * Setup static file serving for a deployment
   */
  async setupStaticServing(
    deploymentId: string,
    sourcePath: string,
    serviceId?: string,
    projectId?: string,
    domain?: string
  ): Promise<void> {
    try {
      // If serviceId not provided, attempt to lookup from deployments table
      let svcId = serviceId;
      if (!svcId) {
        const row = await this.databaseService.db
          .select({ id: deployments.id, serviceId: deployments.serviceId })
          .from(deployments)
          .where(eq(deployments.id, deploymentId))
          .limit(1);
        if (row && row.length) {
          svcId = row[0].serviceId;
        }
      }
      if (!svcId) {
        throw new NotFoundException(
          "Service ID could not be determined for deployment"
        );
      }
      // Delegate to core StaticFileService which implements project server flow
      await this.staticFileService.deployStaticFiles({
        serviceName: svcId,
        deploymentId,
        projectId,
        domain: domain || "localhost",
        sourcePath,
      } as any);
      this.logger.log(
        `Static serving setup complete for deployment: ${deploymentId}`
      );
    } catch (error) {
      this.logger.error(
        `Failed to setup static serving for deployment ${deploymentId}:`,
        error
      );
      throw error;
    }
  }
  /**
   * Copy files to static serving directory
   */
  private async copyStaticFiles(
    sourcePath: string,
    targetPath: string
  ): Promise<void> {
    try {
      // Check if source has a build output directory
      const buildDirs = ["dist", "build", "public", "out", ".next/static"];
      let sourceDir = sourcePath;
      for (const buildDir of buildDirs) {
        const potentialPath = path.join(sourcePath, buildDir);
        if (await fs.pathExists(potentialPath)) {
          sourceDir = potentialPath;
          this.logger.log(`Using build directory: ${buildDir}`);
          break;
        }
      }
      // Copy all files, preserving directory structure
      await fs.copy(sourceDir, targetPath, {
        overwrite: true,
        dereference: true,
        filter: (src) => {
          // Skip certain files/directories
          const basename = path.basename(src);
          const skipPatterns = [
            ".git",
            "node_modules",
            ".env",
            ".DS_Store",
            "Thumbs.db",
            "*.log",
          ];
          return !skipPatterns.some((pattern) =>
            pattern.includes("*")
              ? basename.match(new RegExp(pattern.replace("*", ".*")))
              : basename === pattern
          );
        },
      });
      this.logger.log(`Files copied from ${sourceDir} to ${targetPath}`);
    } catch (error) {
      this.logger.error(
        `Failed to copy static files from ${sourcePath} to ${targetPath}:`,
        error
      );
      throw error;
    }
  }
  /**
   * Generate file manifest for deployment
   */
  private async generateManifest(
    deploymentId: string,
    staticDir: string
  ): Promise<void> {
    try {
      const files = await this.getAllFiles(staticDir);
      const manifest: Record<
        string,
        {
          size: number;
          lastModified: string;
          etag: string;
        }
      > = {};
      for (const file of files) {
        const relativePath = path.relative(staticDir, file);
        const stats = await fs.stat(file);
        const etag = this.generateETag(stats);
        manifest[relativePath] = {
          size: stats.size,
          lastModified: stats.mtime.toISOString(),
          etag,
        };
      }
      const manifestPath = path.join(staticDir, ".manifest.json");
      await fs.writeJson(manifestPath, manifest, { spaces: 2 });
      this.logger.log(
        `Generated manifest for deployment ${deploymentId} (${files.length} files)`
      );
    } catch (error) {
      this.logger.error(
        `Failed to generate manifest for deployment ${deploymentId}:`,
        error
      );
      throw error;
    }
  }
  /**
   * Resolve file path for static serving
   */
  private async resolveFilePath(
    deploymentId: string,
    requestPath: string
  ): Promise<string> {
    const staticDir = path.join(this.staticFilesDir, deploymentId);
    let filePath = path.join(staticDir, requestPath);
    // Security check: ensure path is within static directory
    if (!path.resolve(filePath).startsWith(path.resolve(staticDir))) {
      throw new NotFoundException("Invalid file path");
    }
    // Check if file exists
    if (await fs.pathExists(filePath)) {
      const stats = await fs.stat(filePath);
      if (stats.isDirectory()) {
        // Try index files for directories
        const indexFiles = ["index.html", "index.htm", "default.html"];
        for (const indexFile of indexFiles) {
          const indexPath = path.join(filePath, indexFile);
          if (await fs.pathExists(indexPath)) {
            filePath = indexPath;
            break;
          }
        }
      }
      if (stats.isDirectory()) {
        // Directory without index file
        throw new NotFoundException("Directory listing not allowed");
      }
    } else {
      // Try with .html extension for SPAs
      const htmlPath = filePath + ".html";
      if (await fs.pathExists(htmlPath)) {
        filePath = htmlPath;
      } else {
        // Fallback to index.html for SPA routing
        const indexPath = path.join(staticDir, "index.html");
        if (await fs.pathExists(indexPath)) {
          filePath = indexPath;
        } else {
          throw new NotFoundException("File not found");
        }
      }
    }
    return filePath;
  }
  /**
   * Get file information
   */
  private async getFileInfo(filePath: string): Promise<StaticFileInfo> {
    const stats = await fs.stat(filePath);
    const etag = this.generateETag(stats);
    return {
      filePath,
      contentType: mime.lookup(filePath) || "application/octet-stream",
      size: stats.size,
      lastModified: stats.mtime,
      etag,
    };
  }
  /**
   * Generate cache headers
   */
  private generateCacheHeaders(
    fileInfo: StaticFileInfo,
    _cacheConfig?: any
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": fileInfo.contentType,
      "Content-Length": fileInfo.size.toString(),
      "Last-Modified": fileInfo.lastModified.toUTCString(),
      ETag: fileInfo.etag,
    };
    // Set cache headers based on file type
    const ext = path.extname(fileInfo.filePath).toLowerCase();
    const staticAssets = [
      ".css",
      ".js",
      ".png",
      ".jpg",
      ".jpeg",
      ".gif",
      ".svg",
      ".ico",
      ".woff",
      ".woff2",
    ];
    if (staticAssets.includes(ext)) {
      // Cache static assets for 1 year
      headers["Cache-Control"] = "public, max-age=31536000, immutable";
    } else if (ext === ".html") {
      // Don't cache HTML files (for SPA routing)
      headers["Cache-Control"] = "no-cache, must-revalidate";
    } else {
      // Default cache for other files
      headers["Cache-Control"] = "public, max-age=86400"; // 24 hours
    }
    // Security headers
    headers["X-Content-Type-Options"] = "nosniff";
    headers["X-Frame-Options"] = "DENY";
    headers["X-XSS-Protection"] = "1; mode=block";
    // CORS headers for static assets
    if (staticAssets.includes(ext)) {
      headers["Access-Control-Allow-Origin"] = "*";
      headers["Access-Control-Allow-Methods"] = "GET, HEAD, OPTIONS";
    }
    return headers;
  }
  /**
   * Generate ETag for file
   */
  private generateETag(stats: fs.Stats): string {
    return `"${stats.size}-${stats.mtime.getTime().toString(16)}"`;
  }
  /**
   * Get all files recursively
   */
  private async getAllFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    const items = await fs.readdir(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        files.push(...(await this.getAllFiles(fullPath)));
      } else {
        files.push(fullPath);
      }
    }
    return files;
  }
  /**
   * Get service with latest deployment
   */
  private async getServiceWithLatestDeployment(serviceId: string) {
    const result = await this.databaseService.db
      .select({
        service: services,
        latestDeployment: {
          id: deployments.id,
          status: deployments.status,
          deployCompletedAt: deployments.deployCompletedAt,
        },
      })
      .from(services)
      .leftJoin(deployments, eq(services.id, deployments.serviceId))
      .where(and(eq(services.id, serviceId), eq(deployments.status, "success")))
      .orderBy(desc(deployments.deployCompletedAt))
      .limit(1);
    if (!result.length) {
      return null;
    }
    return {
      ...result[0].service,
      latestDeployment: result[0].latestDeployment,
      cacheConfig: { maxAge: 86400 }, // Default cache config
    };
  }
  /**
   * Clean up static files for a deployment
   */
  async cleanupStaticFiles(deploymentId: string): Promise<void> {
    try {
      const staticDir = path.join(this.staticFilesDir, deploymentId);
      await fs.remove(staticDir);
      this.logger.log(
        `Cleaned up static files for deployment: ${deploymentId}`
      );
    } catch (error) {
      this.logger.error(
        `Failed to cleanup static files for deployment ${deploymentId}:`,
        error
      );
    }
  }
  /**
   * Get deployment manifest
   */
  async getDeploymentManifest(deploymentId: string): Promise<any> {
    try {
      const manifestPath = path.join(
        this.staticFilesDir,
        deploymentId,
        ".manifest.json"
      );
      if (await fs.pathExists(manifestPath)) {
        return await fs.readJson(manifestPath);
      }
      return null;
    } catch (error) {
      this.logger.error(
        `Failed to get manifest for deployment ${deploymentId}:`,
        error
      );
      return null;
    }
  }
  /**
   * Get static serving stats
   */
  async getServingStats(serviceId: string): Promise<{
    totalFiles: number;
    totalSize: number;
    lastAccessed: Date | null;
  }> {
    try {
      // Get latest deployment
      const service = await this.getServiceWithLatestDeployment(serviceId);
      if (!service || !service.latestDeployment) {
        return { totalFiles: 0, totalSize: 0, lastAccessed: null };
      }
      const manifest = await this.getDeploymentManifest(
        service.latestDeployment.id
      );
      if (!manifest) {
        return { totalFiles: 0, totalSize: 0, lastAccessed: null };
      }
      const files = Object.values(manifest) as Array<{
        size: number;
      }>;
      const totalFiles = files.length;
      const totalSize = files.reduce((sum, file) => sum + file.size, 0);
      return {
        totalFiles,
        totalSize,
        lastAccessed: new Date(), // TODO: Implement access tracking
      };
    } catch (error) {
      this.logger.error(
        `Failed to get serving stats for service ${serviceId}:`,
        error
      );
      return { totalFiles: 0, totalSize: 0, lastAccessed: null };
    }
  }
}
