import { Controller, Logger, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { Implement, implement } from '@orpc/nest';
import { uploadFileContract, deployUploadContract, getUploadInfoContract, deleteUploadContract, getStaticFileContract, listStaticFilesContract, setupStaticServingContract, getStaticServingStatsContract, cleanupOldUploadsContract, getUploadStatsContract } from '@repo/api-contracts';
import { FileInterceptor } from '@nestjs/platform-express';
import { FileUploadService, type UploadedFile } from '../services/file-upload.service';
import { StaticFileServingService } from '../services/static-file-serving.service';
@Controller()
export class UploadController {
    private readonly logger = new Logger(UploadController.name);
    constructor(private readonly fileUploadService: FileUploadService, private readonly staticFileServingService: StaticFileServingService, 
    @InjectQueue('deployment')
    private readonly deploymentQueue: Queue) { }
    @Implement(uploadFileContract)
    uploadFile() {
        return implement(uploadFileContract).handler(async ({ input }) => {
            this.logger.log('Processing file upload request');
            // Convert base64 string to buffer
            const fileBuffer = Buffer.from(input.fileContent, 'base64');
            // Create UploadedFile object that matches the service expectation
            const uploadedFile: UploadedFile = {
                fieldname: 'file',
                originalname: input.fileName,
                encoding: '7bit',
                mimetype: this.detectMimeType(input.fileName),
                buffer: fileBuffer,
                size: fileBuffer.length,
            };
            const result = await this.fileUploadService.processUploadedFile(uploadedFile);
            this.logger.log(`File uploaded successfully: ${result.uploadId}`);
            // Convert service result to contract-expected format
            return {
                uploadId: result.uploadId,
                fileName: result.originalName,
                fileSize: result.totalSize,
                projectType: this.mapProjectType(result.metadata.detectedType),
                fileCount: result.fileCount,
                extractedSize: result.totalSize,
                entryPoint: result.metadata.startCommand,
                dependencies: [], // TODO: Extract from package.json analysis
                hash: result.hash,
                uploadPath: result.extractedPath,
                extractedPath: result.extractedPath,
            };
        });
    }
    @Implement(deployUploadContract)
    deployUpload() {
        return implement(deployUploadContract).handler(async ({ input }) => {
            this.logger.log(`Starting deployment for upload: ${input.uploadId}`);
            // Add deployment job to the queue
            const job = await this.deploymentQueue.add('deploy-upload', {
                uploadId: input.uploadId,
                serviceId: input.serviceId,
                environment: input.environment,
                environmentVariables: input.environmentVariables || {},
            }, {
                attempts: 3,
                backoff: {
                    type: 'exponential',
                    delay: 2000,
                },
            });
            this.logger.log(`Deployment job created with ID: ${job.id}`);
            return {
                deploymentId: `deploy-${job.id}`,
                status: 'queued' as const,
                jobId: String(job.id),
            };
        });
    }
    @Implement(getUploadInfoContract)
    getUploadInfo() {
        return implement(getUploadInfoContract).handler(async ({ input }) => {
            this.logger.log(`Getting upload info for: ${input.uploadId}`);
            const uploadInfo = await this.fileUploadService.getUploadedFileInfo(input.uploadId);
            if (!uploadInfo) {
                throw new BadRequestException(`Upload not found: ${input.uploadId}`);
            }
            // Convert service result to contract-expected format
            return {
                uploadId: uploadInfo.uploadId,
                fileName: uploadInfo.originalName,
                fileSize: uploadInfo.totalSize,
                projectType: this.mapProjectType(uploadInfo.metadata.detectedType),
                fileCount: uploadInfo.fileCount,
                extractedSize: uploadInfo.totalSize,
                entryPoint: uploadInfo.metadata.startCommand,
                dependencies: [], // TODO: Extract from package.json analysis
                hash: uploadInfo.hash,
                uploadPath: uploadInfo.extractedPath,
                extractedPath: uploadInfo.extractedPath,
            };
        });
    }
    @Implement(deleteUploadContract)
    deleteUpload() {
        return implement(deleteUploadContract).handler(async ({ input }) => {
            this.logger.log(`Deleting upload: ${input.uploadId}`);
            await this.fileUploadService.cleanupUpload(input.uploadId);
            this.logger.log(`Upload deleted successfully: ${input.uploadId}`);
            return {
                success: true,
                message: `Upload ${input.uploadId} deleted successfully`,
            };
        });
    }
    @Implement(getStaticFileContract)
    getStaticFile() {
        return implement(getStaticFileContract).handler(async ({ input }) => {
            this.logger.log(`Serving static file: ${input.filePath} for service: ${input.serviceId}`);
            const fileInfo = await this.staticFileServingService.getStaticFile(input.serviceId, input.filePath);
            // Convert buffer to string if needed
            return {
                content: fileInfo.content.toString('base64'),
                contentType: fileInfo.contentType,
                headers: fileInfo.headers,
            };
        });
    }
    @Implement(listStaticFilesContract)
    listStaticFiles() {
        return implement(listStaticFilesContract).handler(async ({ input }) => {
            this.logger.log(`Listing static files for service: ${input.serviceId}`);
            // TODO: Implement proper file listing using the service
            // For now, return empty result matching the contract
            return {
                files: [],
                directories: [],
                totalCount: 0,
            };
        });
    }
    @Implement(setupStaticServingContract)
    setupStaticServing() {
        return implement(setupStaticServingContract).handler(async ({ input }) => {
            this.logger.log(`Setting up static serving for deployment: ${input.deploymentId}`);
            await this.staticFileServingService.setupStaticServing(input.deploymentId, input.sourcePath);
            // TODO: Get actual metrics from the service
            return {
                deploymentId: input.deploymentId,
                staticPath: `/static/${input.deploymentId}`,
                manifestFile: `${input.deploymentId}/manifest.json`,
                fileCount: 0, // TODO: Get from service
            };
        });
    }
    @Implement(getStaticServingStatsContract)
    getStaticServingStats() {
        return implement(getStaticServingStatsContract).handler(async ({ input }) => {
            this.logger.log(`Getting static serving stats for service: ${input.serviceId}`);
            const stats = await this.staticFileServingService.getServingStats(input.serviceId);
            return {
                totalFiles: stats.totalFiles,
                totalSize: stats.totalSize,
                cacheHitRate: 0, // TODO: Add to service
                requestCount: 0, // TODO: Add to service
                lastAccessed: stats.lastAccessed?.toISOString(),
            };
        });
    }
    @Implement(cleanupOldUploadsContract)
    cleanupOldUploads() {
        return implement(cleanupOldUploadsContract).handler(async ({ input }) => {
            this.logger.log(`Cleaning up uploads older than ${input.olderThanDays} days`);
            const deletedCount = await this.fileUploadService.cleanupOldUploads(input.olderThanDays);
            return {
                deletedCount,
                freedSpace: 0, // TODO: Calculate freed space
                deletedFiles: [], // TODO: Return list of deleted files
            };
        });
    }
    @Implement(getUploadStatsContract)
    getUploadStats() {
        return implement(getUploadStatsContract).handler(async (_input) => {
            this.logger.log('Getting upload statistics');
            // TODO: Implement proper upload statistics
            return {
                totalUploads: 0,
                totalSize: 0,
                averageFileCount: 0,
                uploadsByType: {},
                recentUploads: [],
            };
        });
    }
    private detectMimeType(fileName: string): string {
        const ext = fileName.toLowerCase().split('.').pop();
        const mimeTypes: Record<string, string> = {
            'zip': 'application/zip',
            'tar': 'application/x-tar',
            'gz': 'application/gzip',
            'tgz': 'application/x-compressed-tar',
        };
        return mimeTypes[ext || ''] || 'application/octet-stream';
    }
    private mapProjectType(detectedType: string): 'node' | 'static' | 'docker' | 'unknown' {
        switch (detectedType) {
            case 'node': return 'node';
            case 'static': return 'static';
            case 'docker': return 'docker';
            default: return 'unknown';
        }
    }
}
