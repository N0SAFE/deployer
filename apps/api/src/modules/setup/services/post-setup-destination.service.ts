import { Injectable, Logger } from "@nestjs/common";
import type { SetupPostSetupDestination } from "@repo/contracts-entities";

import { EnvService } from "@/config/env/env.module";
import { HostnameService } from "@/core/modules/platform-ingress/services/hostname.service";
import { PlatformConfigService } from "@/core/modules/platform-ingress/services/platform-config.service";

/**
 * Decides where the wizard's final "continue to dashboard" click lands.
 *
 * ── WHY THE SERVER OWNS THIS ─────────────────────────────────────────────────
 * The client used to derive the destination from `window.location`, which is
 * only ever a guess about deployment shape. That guess was wrong in exactly the
 * case that matters: when the operator chose "API only" during onboarding there
 * is no dashboard, but the wizard would still send them to `web.<host>` — a
 * hostname with no router, so a 404 on the last click of a successful setup.
 *
 * The answer depends on state the client cannot see: whether the managed web app
 * is enabled (a DB flag the API owns), and which hostname that implies. So the
 * API answers, and the client follows.
 *
 * ── THE TWO DESTINATIONS ─────────────────────────────────────────────────────
 *   dashboard    the platform's own web app — used when the flag is on. It is
 *                the product surface, so it wins whenever it exists.
 *   api-console  the API's `/manage/web-app` page, which the API serves ITSELF
 *                and which offers to enable a dashboard. Chosen when no web app
 *                is running, because it cannot 404 the way `web.<host>` would:
 *                the CLI went to real trouble to make the fallback honest, and
 *                pointing at a non-existent host would undo that.
 *
 * A failure to READ the flag is treated as "no dashboard" rather than thrown:
 * the operator has just completed setup and needs somewhere to go, and the
 * console page is always answerable.
 */
@Injectable()
export class PostSetupDestinationService {
  private readonly logger = new Logger(PostSetupDestinationService.name);

  constructor(
    private readonly env: EnvService,
    private readonly hostnameService: HostnameService,
    private readonly platformConfig: PlatformConfigService,
  ) {}

  async resolve(): Promise<SetupPostSetupDestination> {
    const managedWebEnabled = await this.readManagedWebEnabled();

    if (managedWebEnabled) {
      // An explicit operator origin (custom domain / tunnel) wins over the
      // derived hostname — the same precedence the ingress uses to publish the
      // web router, so the URL and the route cannot disagree.
      const origin = await this.readManagedWebOrigin();
      const webUrl = origin ?? this.hostnameService.webOrigin();
      return { kind: "dashboard", url: webUrl, managedWebEnabled: true };
    }

    return {
      kind: "api-console",
      // Served by this API, on the API's own public origin.
      url: `${this.hostnameService.apiOrigin()}${PostSetupDestinationService.CONSOLE_PATH}`,
      managedWebEnabled: false,
    };
  }

  /** The API's own management page for the web app. */
  private static readonly CONSOLE_PATH = "/manage/web-app";

  private async readManagedWebEnabled(): Promise<boolean> {
    try {
      return await this.platformConfig.isManagedWebAppEnabled();
    } catch (error: unknown) {
      // The flag lives in the global DB, which is provisioned DURING setup. A
      // read can legitimately fail if this is called before that finished — the
      // console page is the safe answer, and it is the page that lets the
      // operator turn a dashboard on.
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not read the managed-web flag (${reason}) — directing to the API console`);
      return false;
    }
  }

  private async readManagedWebOrigin(): Promise<string | null> {
    try {
      const origin = await this.platformConfig.getManagedWebOrigin();
      if (origin === null || origin.trim().length === 0) return null;
      // `getManagedWebOrigin` stores a bare host (scheme stripped when set), so
      // it must be given one back before it can be navigated to.
      return /^https?:\/\//i.test(origin) ? origin : `http://${origin}`;
    } catch {
      return null;
    }
  }
}
