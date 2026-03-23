import { Module } from "@nestjs/common";
import { ConfigurationDefinitionService } from "./services/configuration-definition.service";
import { ConfigurationResolverService } from "./services/configuration-resolver.service";
import { ConfigurationStateMachineBuilderService } from "./services/configuration-state-machine-builder.service";

@Module({
    providers: [
        ConfigurationDefinitionService,
        ConfigurationResolverService,
        ConfigurationStateMachineBuilderService,
    ],
    exports: [
        ConfigurationDefinitionService,
        ConfigurationResolverService,
        ConfigurationStateMachineBuilderService,
    ],
})
export class ConfigurationCoreModule {}
