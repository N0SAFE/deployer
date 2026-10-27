import { Module } from "@nestjs/common";
import { ConfigurationDefinitionService } from "./services/configuration-definition.service";
import { ConfigurationResolverService } from "./services/configuration-resolver.service";
import { ConfigurationStateMachineBuilderService } from "./services/configuration-state-machine-builder.service";
import { RuntimeConfigurationAccessorService } from "./services/runtime-configuration-accessor.service";

@Module({
    providers: [
        ConfigurationDefinitionService,
        ConfigurationResolverService,
        ConfigurationStateMachineBuilderService,
        RuntimeConfigurationAccessorService,
    ],
    exports: [
        ConfigurationDefinitionService,
        ConfigurationResolverService,
        ConfigurationStateMachineBuilderService,
        RuntimeConfigurationAccessorService,
    ],
})
export class ConfigurationCoreModule {}
