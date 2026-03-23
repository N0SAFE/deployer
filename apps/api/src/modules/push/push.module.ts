import { Module } from "@nestjs/common";
import { PushService } from "./services/push.service";
import { PushRepository } from "./repositories/push.repository";
import { PushController } from "./controllers/push.controller";
import { DatabaseModule } from "@/core/modules/database/database.module";
import { ConfigurationCoreModule } from "@/core/modules/configuration/configuration-core.module";

@Module({
  imports: [DatabaseModule, ConfigurationCoreModule],
  controllers: [PushController],
  providers: [PushService, PushRepository],
  exports: [PushService],
})
export class PushModule {}
