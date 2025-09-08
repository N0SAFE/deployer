import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { StorageController } from './controllers/storage.controller';
import { UploadController } from './controllers/upload.controller';
import { StorageService } from './services/storage.service';
import { FileUploadService } from './services/file-upload.service';
import { StaticFileServingService } from './services/static-file-serving.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'deployment',
    }),
  ],
  controllers: [StorageController, UploadController],
  providers: [StorageService, FileUploadService, StaticFileServingService],
  exports: [StorageService, FileUploadService, StaticFileServingService],
})
export class StorageModule {}