import { Module } from '@nestjs/common';
import { CoreModule } from '../../core/core.module';
import { OrchestrationController } from './controllers/orchestration.controller';

@Module({
  imports: [CoreModule],
  controllers: [OrchestrationController],
  providers: [],
  exports: [],
})
export class OrchestrationModule {}