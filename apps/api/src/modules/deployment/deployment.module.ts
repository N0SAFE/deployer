import { Module, forwardRef } from "@nestjs/common";
import { DeploymentController } from "./controllers/deployment.controller";
import { DeploymentAdapter } from "./adapters/deployment-adapter.service";
import { CoreModule } from "@/core/core.module";
// Use the DB-backed DeploymentController implemented in the websocket module folder

/**
 * FEATURE MODULE: Deployment
 * Handles HTTP deployment endpoints
 *
 * Dependencies:
 * - CoreModule: For core deployment services and orchestration
 * - WebSocketModule: For real-time deployment notifications (feature module)
 * - BullModule: For DeploymentQueueService dependency
 */
@Module({
  imports: [forwardRef(() => CoreModule)],
  controllers: [DeploymentController],
  providers: [DeploymentAdapter],
})
export class DeploymentModule {}
