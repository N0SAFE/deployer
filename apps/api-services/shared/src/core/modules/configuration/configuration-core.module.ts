import { Module } from "@nestjs/common";
import { ConfigurationDefinitionService } from "@/core/modules/configuration/services/configuration-definition.service";
import { ConfigurationResolverService } from "@/core/modules/configuration/services/configuration-resolver.service";
import { ConfigurationStateMachineBuilderService } from "@/core/modules/configuration/services/configuration-state-machine-builder.service";
import { RuntimeConfigurationAccessorService } from "@/core/modules/configuration/services/runtime-configuration-accessor.service";

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
