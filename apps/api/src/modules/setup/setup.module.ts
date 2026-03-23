import { Module } from "@nestjs/common";
import { DatabaseModule } from "@/core/modules/database/database.module";
import { LocalDatabaseModule } from "@/core/modules/local-database/local-database.module";
import { SetupController } from "./controllers/setup.controller";
import { SetupService } from "./services/setup.service";
import { NodeConfigRepository } from "./repositories/node-config.repository";

@Module({
    imports: [DatabaseModule, LocalDatabaseModule],
    controllers: [SetupController],
    providers: [SetupService, NodeConfigRepository],
    exports: [SetupService, NodeConfigRepository],
})
export class SetupModule {}