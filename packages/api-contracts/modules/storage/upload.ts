import { oc } from '@orpc/contract';
import { z } from 'zod';
import { uploadFileDeploymentSchema, uploadResultSchema, deployUploadSchema, staticFileInfoSchema, setupStaticServingSchema, staticServingStatsSchema } from './schemas';
// File upload contracts
export const uploadFileInput = uploadFileDeploymentSchema;
export const uploadFileOutput = uploadResultSchema;
export const uploadFileContract = oc
    .route({
    method: 'POST',
    path: '/upload',
    summary: 'Upload and process file for deployment',
    description: 'Upload a ZIP/TAR file, extract it, analyze contents, and prepare for deployment',
})
    .input(uploadFileInput)
    .output(uploadFileOutput);
export const deployUploadInput = deployUploadSchema;
export const deployUploadOutput = z.object({
    deploymentId: z.string().uuid(),
    jobId: z.string(),
    status: z.enum(['queued', 'processing']),
});
export const deployUploadContract = oc
    .route({
    method: 'POST',
    path: '/upload/{uploadId}/deploy',
    summary: 'Deploy uploaded files',
    description: 'Deploy previously uploaded and processed files to a service',
})
    .input(deployUploadInput)
    .output(deployUploadOutput);
export const getUploadInfoInput = z.object({
    uploadId: z.string().uuid(),
});
export const getUploadInfoOutput = uploadResultSchema;
export const getUploadInfoContract = oc
    .route({
    method: 'GET',
    path: '/upload/{uploadId}',
    summary: 'Get upload information',
    description: 'Retrieve information about a previously uploaded file',
})
    .input(getUploadInfoInput)
    .output(getUploadInfoOutput);
export const deleteUploadInput = z.object({
    uploadId: z.string().uuid(),
});
export const deleteUploadOutput = z.object({
    success: z.boolean(),
    message: z.string(),
});
export const deleteUploadContract = oc
    .route({
    method: 'DELETE',
    path: '/upload/{uploadId}',
    summary: 'Delete uploaded files',
    description: 'Clean up uploaded files and extracted content',
})
    .input(deleteUploadInput)
    .output(deleteUploadOutput);
// Static file serving contracts
export const getStaticFileInput = z.object({
    serviceId: z.string().uuid(),
    filePath: z.string(),
});
export const getStaticFileOutput = z.object({
    content: z.string(), // Binary content as base64
    contentType: z.string(),
    headers: z.record(z.string(), z.string()),
});
export const getStaticFileContract = oc
    .route({
    method: 'GET',
    path: '/static/{serviceId}/{filePath}',
    summary: 'Serve static file',
    description: 'Serve a static file for a deployed service with proper caching headers',
})
    .input(getStaticFileInput)
    .output(getStaticFileOutput);
export const listStaticFilesInput = z.object({
    serviceId: z.string().uuid(),
    path: z.string().optional(),
});
export const listStaticFilesOutput = z.object({
    files: z.array(staticFileInfoSchema),
    directories: z.array(z.string()),
    totalCount: z.number(),
});
export const listStaticFilesContract = oc
    .route({
    method: 'GET',
    path: '/static/{serviceId}/list',
    summary: 'List static files',
    description: 'List all static files for a service deployment',
})
    .input(listStaticFilesInput)
    .output(listStaticFilesOutput);
export const setupStaticServingInput = setupStaticServingSchema;
export const setupStaticServingOutput = z.object({
    deploymentId: z.string(),
    staticPath: z.string(),
    manifestFile: z.string(),
    fileCount: z.number(),
});
export const setupStaticServingContract = oc
    .route({
    method: 'POST',
    path: '/static/setup',
    summary: 'Setup static file serving',
    description: 'Configure static file serving for a deployment',
})
    .input(setupStaticServingInput)
    .output(setupStaticServingOutput);
export const getStaticServingStatsInput = z.object({
    serviceId: z.string().uuid(),
});
export const getStaticServingStatsOutput = staticServingStatsSchema;
export const getStaticServingStatsContract = oc
    .route({
    method: 'GET',
    path: '/static/{serviceId}/stats',
    summary: 'Get static serving statistics',
    description: 'Retrieve statistics about static file serving for a service',
})
    .input(getStaticServingStatsInput)
    .output(getStaticServingStatsOutput);
// File management contracts
export const cleanupOldUploadsInput = z.object({
    olderThanDays: z.number().min(1).max(365).default(7),
    includeExtracted: z.boolean().default(true),
    dryRun: z.boolean().default(false),
});
export const cleanupOldUploadsOutput = z.object({
    deletedCount: z.number(),
    freedSpace: z.number(),
    deletedFiles: z.array(z.string()),
});
export const cleanupOldUploadsContract = oc
    .route({
    method: 'POST',
    path: '/cleanup/uploads',
    summary: 'Cleanup old uploads',
    description: 'Remove old uploaded files and extracted content',
})
    .input(cleanupOldUploadsInput)
    .output(cleanupOldUploadsOutput);
export const getUploadStatsInput = z.object({
    serviceId: z.string().uuid().optional(),
    projectId: z.string().uuid().optional(),
    days: z.number().min(1).max(365).default(30),
});
export const getUploadStatsOutput = z.object({
    totalUploads: z.number(),
    totalSize: z.number(),
    averageFileCount: z.number(),
    uploadsByType: z.record(z.string(), z.number()),
    recentUploads: z.array(z.object({
        uploadId: z.string(),
        fileName: z.string(),
        uploadTime: z.string(),
        size: z.number(),
    })),
});
export const getUploadStatsContract = oc
    .route({
    method: 'GET',
    path: '/stats/uploads',
    summary: 'Get upload statistics',
    description: 'Retrieve statistics about file uploads',
})
    .input(getUploadStatsInput)
    .output(getUploadStatsOutput);
