import { createModuleContext } from '@deployer/nest-effect'

import {
    ConfigurationDefinitionService,
    makeConfigurationDefinitionService,
    type ConfigurationDefinitionServiceShape,
} from './services/configuration-definition.service'
import {
    ConfigurationResolverService,
    makeConfigurationResolverService,
    type ConfigurationResolverServiceShape,
} from './services/configuration-resolver.service'
import {
    ConfigurationStateMachineBuilderService,
    makeConfigurationStateMachineBuilderService,
} from './services/configuration-state-machine-builder.service'
import {
    makeRuntimeConfigurationAccessorService,
    RuntimeConfigurationAccessorService,
} from './services/runtime-configuration-accessor.service'

export class ConfigurationCoreModule extends createModuleContext({
    providers: [
        {
            provide: ConfigurationDefinitionService,
            useFactory: () => makeConfigurationDefinitionService(),
        },
        {
            provide: ConfigurationResolverService,
            useFactory: (definitions: ConfigurationDefinitionServiceShape) =>
                makeConfigurationResolverService(definitions),
            inject: [ConfigurationDefinitionService],
        },
        {
            provide: ConfigurationStateMachineBuilderService,
            useFactory: () => makeConfigurationStateMachineBuilderService(),
        },
        {
            provide: RuntimeConfigurationAccessorService,
            useFactory: (resolver: ConfigurationResolverServiceShape) =>
                makeRuntimeConfigurationAccessorService(resolver),
            inject: [ConfigurationResolverService],
        },
    ],
    exports: [
        ConfigurationDefinitionService,
        ConfigurationResolverService,
        ConfigurationStateMachineBuilderService,
        RuntimeConfigurationAccessorService,
    ],
}) {}
