import { Module } from '@nestjs/common';
import { ServiceContextService } from './services/service-context.service';
import { DomainModule } from '../domain/domain.module';

@Module({
  imports: [DomainModule], // Import DomainModule to access repository providers
  providers: [ServiceContextService],
  exports: [ServiceContextService],
})
export class ContextModule {}
