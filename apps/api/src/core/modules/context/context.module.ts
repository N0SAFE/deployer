import { Module } from '@nestjs/common';
import { ServiceContextService } from './services/service-context.service';
import { CoreDomainModule } from '../domain/domain.module';

@Module({
  imports: [CoreDomainModule], // Import CoreDomainModule to access repository providers
  providers: [ServiceContextService],
  exports: [ServiceContextService],
})
export class ContextModule {}
