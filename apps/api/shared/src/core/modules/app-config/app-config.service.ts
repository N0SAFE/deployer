/**
 * AppConfigService
 *
 * Reads runtime application configuration from the `app_config` table.
 * Replaces environment variables for settings that should be
 * configurable at runtime (e.g. GitHub OAuth credentials).
 */
import { Injectable, Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { appConfig } from "@deployer/nest-schema/global/platform/app-config";
import type { GlobalDatabase } from "../database/global/global-database.service";

export type GitHubOAuthConfig = {
  clientId: string;
  clientSecret: string;
}

export type GitHubWebhookConfig = {
  webhookSecret: string;
}

@Injectable()
export class AppConfigService {
  private readonly logger = new Logger(AppConfigService.name);

  constructor() {}

  async getGitHubOAuthConfig(db: GlobalDatabase): Promise<GitHubOAuthConfig | null> {
    try {
      const row = await db
        .select()
        .from(appConfig)
        .where(eq(appConfig.key, "github_oauth"))
        .limit(1);

      const config = row[0];
      if (!config?.value) return null;

      const parsed = JSON.parse(config.value) as { clientId?: string; clientSecret?: string };
      if (!parsed.clientId || !parsed.clientSecret) return null;

      return { clientId: parsed.clientId, clientSecret: parsed.clientSecret };
    } catch (err) {
      this.logger.warn(`Failed to load GitHub OAuth config: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  async getGitHubWebhookConfig(db: GlobalDatabase): Promise<GitHubWebhookConfig | null> {
    try {
      const row = await db
        .select()
        .from(appConfig)
        .where(eq(appConfig.key, "github_webhook"))
        .limit(1);

      const config = row[0];
      if (!config?.value) return null;

      const parsed = JSON.parse(config.value) as { webhookSecret?: string };
      if (!parsed.webhookSecret) return null;

      return { webhookSecret: parsed.webhookSecret };
    } catch (err) {
      this.logger.warn(`Failed to load GitHub webhook config: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}
