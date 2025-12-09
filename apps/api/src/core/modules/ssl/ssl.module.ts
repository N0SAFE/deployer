import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '../database/database.module';
import { SslCertificateService } from './services/ssl-certificate.service';
import { SslCertificateRepository } from './repositories/ssl-certificate.repository';

/**
 * CORE MODULE: SSL Certificate Management
 * 
 * Provides SSL certificate lifecycle management including:
 * - Certificate monitoring and expiry tracking
 * - Auto-renewal scheduling
 * - Certificate validation
 * 
 * Services:
 * - SslCertificateService: Certificate lifecycle management
 * 
 * Repositories:
 * - SslCertificateRepository: Certificate data access
 * 
 * Dependencies:
 * - DatabaseModule: For certificate storage
 * - BullModule: For async certificate operations (uses 'deployment' queue)
 * - ScheduleModule: For cron-based expiry monitoring
 */
@Module({
  imports: [
    DatabaseModule,
    BullModule.registerQueue({ name: 'deployment' }),
    ScheduleModule.forRoot(),
  ],
  providers: [
    SslCertificateService,
    SslCertificateRepository,
  ],
  exports: [
    SslCertificateService,
    SslCertificateRepository,
  ],
})
export class CoreSslModule {}
