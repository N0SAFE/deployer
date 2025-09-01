import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { StorageController } from './controllers/storage.controller';
import { StorageService } from './services/storage.service';
import { FileUploadService } from './services/file-upload.service';
import { StaticFileServingService } from './services/static-file-serving.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'deployment',
    }),
  ],
  controllers: [StorageController],
  providers: [StorageService, FileUploadService, StaticFileServingService],
  exports: [StorageService, FileUploadService, StaticFileServingService],
})
export class StorageModule {}