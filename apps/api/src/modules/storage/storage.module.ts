import { Module, forwardRef } from '@nestjs/common';
import { StorageController } from './controllers/storage.controller';
import { UploadController } from './controllers/upload.controller';
import { CoreModule } from '@/core/core.module';
import { ProvidersModule } from '@/core/modules/providers/providers.module';
// import { CoreStorageModule } from '@/core/modules/storage/storage.module';  // Not loading due to circular dependency
import { StorageService } from '@/core/modules/storage/services/storage.service';  // Import StorageService directly

/**
 * FEATURE MODULE: Storage
 * Handles HTTP endpoints for file storage operations
 * 
 * Dependencies (Core Modules):
 * - CoreModule: For Docker, Deployment services
 * - ProvidersModule: For deployment providers
 * - CoreStorageModule: For storage infrastructure services (currently not working due to circular dependency)
 * 
 * Note: Storage business logic moved to CoreStorageModule.
 * This module only contains HTTP controllers for storage operations.
 * 
 * WORKAROUND: StorageService is provided directly here to avoid circular dependency issues
 */
@Module({
    imports: [
        forwardRef(() => CoreModule),
        ProvidersModule,
    ],
    controllers: [StorageController, UploadController],
    providers: [StorageService],  // Provide StorageService directly to work around circular dependency
    exports: [],  // No exports needed - import CoreStorageModule instead
})
export class StorageModule {
}
