import { Module } from "@nestjs/common";
import { ConfigurationCoreModule } from "@/core/modules/configuration/configuration-core.module";
import { ProviderSchemaController } from "./controllers/provider-schema.controller";
import { ProviderSchemaService } from "./services/provider-schema.service";

@Module({
    imports: [ConfigurationCoreModule],
    controllers: [ProviderSchemaController],
    providers: [ProviderSchemaService],
    exports: [ProviderSchemaService],
})
export class ProviderSchemaModule {}
