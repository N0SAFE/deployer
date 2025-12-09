import { Module } from "@nestjs/common";
import { StorageService } from "./services/storage.service";
import { FileUploadService } from "./services/file-upload.service";

/**
 * CORE MODULE: Storage
 * Provides core storage infrastructure services
 *
 * This is a CORE module - it provides infrastructure services used by:
 * - Deployment processing (file uploads for deployments)
 *
 * Services exported:
 * - StorageService: File storage operations
 * - FileUploadService: Handles file uploads and deployment creation (uses Bull queue)
 *
 * Dependencies:
 * - BullModule: Queue access for FileUploadService (queue registered in OrchestrationModule)
 *
 * Note: StaticFileServingService has been moved to StaticProviderModule
 * ProvidersModule import removed - it was causing a circular dependency and wasn't actually needed
 */
@Module({
  imports: [],
  providers: [StorageService, FileUploadService],
  exports: [StorageService, FileUploadService],
})
export class CoreStorageModule {}
