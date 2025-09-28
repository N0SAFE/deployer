import { Module } from '@nestjs/common';
import { StorageController } from './controllers/storage.controller';
import { UploadController } from './controllers/upload.controller';
import { StorageService } from './services/storage.service';
import { FileUploadService } from './services/file-upload.service';
import { StaticFileServingService } from './services/static-file-serving.service';
import { CoreModule } from '../../core/core.module';

@Module({
    imports: [CoreModule],
    controllers: [StorageController, UploadController],
    providers: [StorageService, FileUploadService, StaticFileServingService],
    exports: [StorageService, FileUploadService, StaticFileServingService],
})
export class StorageModule {
}
