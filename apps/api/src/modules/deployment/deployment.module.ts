import { Module } from '@nestjs/common';
import { CoreModule } from '../../core/core.module';
import { JobsModule } from '../jobs/jobs.module';
import { WebSocketModule } from '../websocket/websocket.module';
// Use the DB-backed DeploymentController implemented in the websocket module folder
import { DeploymentController as DeploymentHttpController } from '../websocket/controllers/deployment.controller';

@Module({
  imports: [CoreModule, JobsModule, WebSocketModule],
  controllers: [DeploymentHttpController],
})
export class DeploymentModule {}