import { Module } from "@nestjs/common";
import { SystemFleetController } from "./controllers/system-fleet.controller";
import { SystemFleetService } from "./services/system-fleet.service";
import { SystemFleetRepository } from "./repositories/system-fleet.repository";

@Module({
    controllers: [SystemFleetController],
    providers: [SystemFleetService, SystemFleetRepository],
})
export class SystemFleetModule {}
