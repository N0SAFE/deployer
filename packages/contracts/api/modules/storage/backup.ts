import { oc } from '@orpc/contract';
import { z } from 'zod';
import { DatabaseBackupSchema, CreateBackupSchema, RestoreBackupSchema, } from './schemas';
// Database backup contracts
export const storageCreateBackupContract = oc
    .route({
    method: 'POST',
    path: '/backups',
    summary: 'Create a database backup',
})
    .input(CreateBackupSchema)
    .output(DatabaseBackupSchema);
export const storageListBackupsContract = oc
    .route({
    method: 'GET',
    path: '/backups',
    summary: 'List database backups',
})
    .input(z.object({
    databaseName: z.string().optional(),
    status: z.enum(['in-progress', 'completed', 'failed', 'cancelled']).optional(),
    limit: z.number().min(1).max(100).default(20),
    offset: z.number().min(0).default(0),
}))
    .output(z.object({
    backups: z.array(DatabaseBackupSchema),
    total: z.number(),
    hasMore: z.boolean(),
}));
export const storageGetBackupContract = oc
    .route({
    method: 'GET',
    path: '/backups/:backupId',
    summary: 'Get backup details',
})
    .input(z.object({
    backupId: z.string().min(1),
}))
    .output(DatabaseBackupSchema);
export const storageRestoreBackupContract = oc
    .route({
    method: 'POST',
    path: '/backups/:backupId/restore',
    summary: 'Restore a database from backup',
})
    .input(z.object({
    backupId: z.string().min(1),
}).merge(RestoreBackupSchema.omit({ backupId: true })))
    .output(z.object({
    restoreId: z.string(),
    status: z.enum(['in-progress', 'completed', 'failed', 'cancelled']),
    message: z.string(),
}));
export const storageDeleteBackupContract = oc
    .route({
    method: 'DELETE',
    path: '/backups/:backupId',
    summary: 'Delete a backup',
})
    .input(z.object({
    backupId: z.string().min(1),
}))
    .output(z.void());
export const storageCancelBackupContract = oc
    .route({
    method: 'POST',
    path: '/backups/:backupId/cancel',
    summary: 'Cancel an in-progress backup',
})
    .input(z.object({
    backupId: z.string().min(1),
}))
    .output(z.object({
    cancelled: z.boolean(),
    message: z.string(),
}));
export const storageDownloadBackupContract = oc
    .route({
    method: 'GET',
    path: '/backups/:backupId/download',
    summary: 'Download a backup file',
})
    .input(z.object({
    backupId: z.string().min(1),
}))
    .output(z.object({
    downloadUrl: z.string().url(),
    expiresAt: z.date(),
}));
