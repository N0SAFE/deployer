import { createModuleContext } from "@deployer/nest-effect";
import { ConfigurationCoreModule } from "@deployer/shared/core/modules/configuration/configuration-core.module";

import { ProviderSchemaController } from "./controllers/provider-schema.controller";
import { ProviderSchemaService } from "./services/provider-schema.service";

/**
 * The provider and builder schema catalogs.
 *
 * `ProviderSchemaService` is a Layer (see `provider-schema.layers.ts`) built by the app's Effect
 * runtime; the module declares the controller and which services its handlers may use.
 */
export class ProviderSchemaModule extends createModuleContext(
    { imports: [ConfigurationCoreModule], controllers: [ProviderSchemaController] },
    ProviderSchemaService,
) {}
