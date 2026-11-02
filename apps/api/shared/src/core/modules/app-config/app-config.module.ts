/**
 * AppConfigModule
 *
 * Provides runtime application configuration from the `app_config` table.
 * Replaces env-var-based configuration for settings like GitHub OAuth.
 */
import { createGlobalModule } from "@deployer/nest-effect";

import { AppConfigService } from "./app-config.service";

export const AppConfigModule = createGlobalModule({
  providers: [AppConfigService],
  exports: [AppConfigService],
});
