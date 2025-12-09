import { Module, forwardRef } from '@nestjs/common';
import { SetupController } from './controllers/setup.controller';
import { SetupService } from './services/setup.service';
import { SetupAdapter } from './adapters/setup-adapter.service';
import { CoreModule } from '@/core/core.module';

@Module({
  imports: [forwardRef(() => CoreModule)],
  controllers: [SetupController],
  providers: [SetupService, SetupAdapter],
  exports: [SetupService],
})
export class SetupModule {}
