import { oc } from '@orpc/contract';
import { z } from 'zod';
import { FileMetadataSchema, CreateDirectorySchema, UploadFileSchema, MoveFileSchema, CopyFileSchema, } from './schemas';
// File management contracts
export const storageListFilesContract = oc
    .route({
    method: 'GET',
    path: '/files',
    summary: 'List files and directories in a path',
})
    .input(z.object({
    path: z.string().default('/'),
    recursive: z.boolean().default(false),
    includeHidden: z.boolean().default(false),
}))
    .output(z.array(FileMetadataSchema));
export const storageGetFileContract = oc
    .route({
    method: 'GET',
    path: '/files/content',
    summary: 'Get file content',
})
    .input(z.object({
    path: z.string().min(1),
    encoding: z.enum(['utf8', 'base64', 'binary']).default('utf8'),
}))
    .output(z.object({
    content: z.string(),
    metadata: FileMetadataSchema,
}));
export const storageCreateDirectoryContract = oc
    .route({
    method: 'POST',
    path: '/directories',
    summary: 'Create a new directory',
})
    .input(CreateDirectorySchema)
    .output(FileMetadataSchema);
export const storageUploadFileContract = oc
    .route({
    method: 'POST',
    path: '/files',
    summary: 'Upload a file',
})
    .input(UploadFileSchema)
    .output(FileMetadataSchema);
export const storageMoveFileContract = oc
    .route({
    method: 'PATCH',
    path: '/files/move',
    summary: 'Move a file or directory',
})
    .input(MoveFileSchema)
    .output(FileMetadataSchema);
export const storageCopyFileContract = oc
    .route({
    method: 'POST',
    path: '/files/copy',
    summary: 'Copy a file or directory',
})
    .input(CopyFileSchema)
    .output(FileMetadataSchema);
export const storageDeleteFileContract = oc
    .route({
    method: 'DELETE',
    path: '/files',
    summary: 'Delete a file or directory',
})
    .input(z.object({
    path: z.string().min(1),
    recursive: z.boolean().default(false),
}))
    .output(z.void());
