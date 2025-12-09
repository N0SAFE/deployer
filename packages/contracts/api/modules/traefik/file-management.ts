import { oc } from '@orpc/contract';
import { z } from 'zod/v4';

// ============================================================================= 
// MINIMAL PROJECT-BASED FILE MANAGEMENT API
// =============================================================================

// File system item schema
const FileSystemItemSchema = z.object({
    name: z.string(),
    path: z.string(),
    type: z.enum(['file', 'directory']),
    size: z.number().optional(),
    lastModified: z.string().optional(),
    extension: z.string().optional(),
    permissions: z.string().optional(),
    isReadable: z.boolean().optional(),
    isWritable: z.boolean().optional(),
});



// Directory tree schema (recursive)
const DirectoryTreeSchema = z.object({
    name: z.string(),
    path: z.string(),
    files: z.array(FileSystemItemSchema),
    get subdirectories() {
        return z.array(DirectoryTreeSchema);
    },
})

// File system contracts
export const traefikGetFileSystemContract = oc
    .route({
        method: 'GET',
        path: '/file-system',
        summary: 'Get Traefik file system structure',
    })
    .input(z.object({
        path: z.string().optional(),
    }))
    .output(DirectoryTreeSchema);

export const traefikGetProjectFileSystemContract = oc
    .route({
        method: 'GET',
        path: '/projects/:projectName/files',
        summary: 'Get file system structure for a specific project',
    })
    .input(z.object({
        projectName: z.string(),
    }))
    .output(DirectoryTreeSchema);

export const traefikGetFileContentContract = oc
    .route({
        method: 'GET',
        path: '/files/content',
        summary: 'Get content of a specific file',
    })
    .input(z.object({
        filePath: z.string(),
    }))
    .output(z.object({
        content: z.string(),
        size: z.number(),
        mimeType: z.string(),
    }));

export const traefikDownloadFileContract = oc
    .route({
        method: 'GET',
        path: '/files/download',
        summary: 'Download a file',
    })
    .input(z.object({
        filePath: z.string(),
    }))
    .output(z.object({
        filename: z.string(),
        content: z.string(),
        mimeType: z.string(),
        size: z.number(),
    }));

export const traefikListProjectsContract = oc
    .route({
        method: 'GET',
        path: '/projects',
        summary: 'List all available projects',
    })
    .input(z.object({}))
    .output(z.array(z.string()));

// Sync result schema
const SyncResultSchema = z.object({
    configId: z.string(),
    configName: z.string(),
    success: z.boolean(),
    action: z.string(),
    message: z.string().optional(),
});

// Sync contracts (using projectName instead of instanceId)
export const traefikForceSyncConfigsContract = oc
    .route({
        method: 'POST',
        path: '/projects/:projectName/sync',
        summary: 'Force sync all configurations for a project',
    })
    .input(z.object({
        projectName: z.string(),
    }))
    .output(z.object({
        total: z.number(),
        successful: z.number(),
        failed: z.number(),
        results: z.array(SyncResultSchema),
    }));

export const traefikCleanupOrphanedFilesContract = oc
    .route({
        method: 'POST',
        path: '/projects/:projectName/cleanup',
        summary: 'Clean up orphaned configuration files for a project',
    })
    .input(z.object({
        projectName: z.string(),
    }))
    .output(z.object({
        cleanedFiles: z.array(z.string()),
        count: z.number(),
    }));