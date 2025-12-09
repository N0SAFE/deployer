import { oc } from '@orpc/contract';
// Import all contracts
import { storageListFilesContract, storageGetFileContract, storageCreateDirectoryContract, storageUploadFileContract, storageMoveFileContract, storageCopyFileContract, storageDeleteFileContract, } from './file-management';
import { storageCreateBackupContract, storageListBackupsContract, storageGetBackupContract, storageRestoreBackupContract, storageDeleteBackupContract, storageCancelBackupContract, storageDownloadBackupContract, } from './backup';
import { storageGetUsageContract, storageGetMetricsContract, storageGetHistoricalUsageContract, storageListQuotasContract, storageCreateQuotaContract, storageUpdateQuotaContract, storageDeleteQuotaContract, storageCleanupContract, } from './monitoring';
import { uploadFileContract, deployUploadContract, getUploadInfoContract, deleteUploadContract, getStaticFileContract, listStaticFilesContract, setupStaticServingContract, getStaticServingStatsContract, cleanupOldUploadsContract, getUploadStatsContract, } from './upload';
// Combine into main storage contract
export const storageContract = oc.tag("Storage").prefix("/storage").router({
    // File management
    listFiles: storageListFilesContract,
    getFile: storageGetFileContract,
    createDirectory: storageCreateDirectoryContract,
    uploadFile: storageUploadFileContract,
    moveFile: storageMoveFileContract,
    copyFile: storageCopyFileContract,
    deleteFile: storageDeleteFileContract,
    // Database backup
    createBackup: storageCreateBackupContract,
    listBackups: storageListBackupsContract,
    getBackup: storageGetBackupContract,
    restoreBackup: storageRestoreBackupContract,
    deleteBackup: storageDeleteBackupContract,
    cancelBackup: storageCancelBackupContract,
    downloadBackup: storageDownloadBackupContract,
    // Storage monitoring
    getUsage: storageGetUsageContract,
    getMetrics: storageGetMetricsContract,
    getHistoricalUsage: storageGetHistoricalUsageContract,
    listQuotas: storageListQuotasContract,
    createQuota: storageCreateQuotaContract,
    updateQuota: storageUpdateQuotaContract,
    deleteQuota: storageDeleteQuotaContract,
    cleanup: storageCleanupContract,
    // File upload and deployment
    upload: uploadFileContract,
    deployUpload: deployUploadContract,
    getUploadInfo: getUploadInfoContract,
    deleteUpload: deleteUploadContract,
    // Static file serving
    getStaticFile: getStaticFileContract,
    listStaticFiles: listStaticFilesContract,
    setupStaticServing: setupStaticServingContract,
    getStaticServingStats: getStaticServingStatsContract,
    // Upload management
    cleanupOldUploads: cleanupOldUploadsContract,
    getUploadStats: getUploadStatsContract,
});
export type StorageContract = typeof storageContract;
// Re-export everything from individual contracts
export * from './schemas';
export * from './file-management';
export * from './backup';
export * from './monitoring';
export * from './upload';
