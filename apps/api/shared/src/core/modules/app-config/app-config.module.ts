/**
 * AppConfigModule
 *
 * Provides runtime application configuration from the `app_config` table.
 * Replaces env-var-based configuration for settings like GitHub OAuth.
 */
import { Module, Global } from "@nestjs/common";
import { AppConfigService } from "./app-config.service";

@Global()
@Module({
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
