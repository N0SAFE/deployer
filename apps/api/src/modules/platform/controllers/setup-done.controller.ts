import { Controller, Get } from "@nestjs/common";
import { Render as SsrRender } from "@nestjs-ssr/react";

import { AllowAnonymous } from "@/core/modules/auth/decorators/decorators";
import { HostnameService } from "@/core/modules/platform-ingress/services/hostname.service";
import SetupDoneView from "@/views/pages/setup-done";
import { PlatformManagedWebService } from "../services/platform-managed-web.service";

/**
 * The page `setup.<host>` serves once onboarding is complete.
 *
 * ── WHY THIS IS A CONTROLLER AND NOT PART OF THE WIZARD ─────────────────────
 * The wizard is over by the time this renders: the setup app has retargeted the
 * ingress, published `ready`, and exited. What remains is a hostname that must
 * still answer (plan §9.2) and a process that must still be alive to answer it —
 * which is the API. So this is an ordinary public page, not a wizard step.
 *
 * It is served at the PATH the ingress points at (`/setup/done`), which is why
 * the full path is declared here rather than mounting this on a `setup`
 * controller prefix: the controller and the handover's ingress write cannot
 * drift apart if there is only one spelling of the path in play.
 *
 * ── WHY IT LIVES IN `modules/platform` AND NOT `modules/setup` ─────────────
 * It needs `PlatformManagedWebService` to decide where the operator goes next,
 * and that service belongs to the platform module. Putting this in
 * `modules/setup` would make one product module import another's service — the
 * cross-feature coupling the repo forbids. The setup module owns the wizard
 * CONTRACT (provisioning); this owns the post-setup landing page.
 *
 * ── WHY `@AllowAnonymous()` IS REQUIRED ────────────────────────────────────
 * The global `AuthGuard` runs at the Nest layer before anything else, and no
 * account exists yet when this first renders on a fresh install — during the
 * window between the API going green and the operator signing in. Without the
 * decorator this 401s and the operator is bounced to a login page whose
 * credentials they have not set up yet.
 */
@AllowAnonymous()
@Controller()
export class SetupDoneController {
  constructor(
    private readonly managedWeb: PlatformManagedWebService,
    private readonly hostnameService: HostnameService,
  ) {}

  /**
   * The static "setup complete" page.
   *
   * The DESTINATION IS DECIDED HERE, server-side, and passed to the view as
   * plain props. That keeps the "where does the operator go now" policy in one
   * place — it depends on whether the managed web app is actually enabled and
   * running, which only the server knows — instead of asking the browser to
   * fetch state and branch, which would flash the wrong button.
   *
   * The fallback is deliberate: when the web app is disabled or not running, the
   * primary action becomes the API's own console (`/manage/web-app`, routed by
   * `dynamic-web.yml`) rather than a dead link to a service that is not there.
   */
  @Get("setup/done")
  @SsrRender(SetupDoneView, { layout: null })
  async donePage(): Promise<{
    primaryHref: string;
    primaryLabel: string;
    webAppEnabled: boolean;
  }> {
    const state = await this.managedWeb.state();

    // `enabled` alone is not enough, and `external` is a separate concern:
    //   - an ENABLED app can still be stopped or degraded, and linking to its
    //     hostname then lands the operator on a 502;
    //   - `external` means compose owns the web app beside this one (the dev
    //     side-by-side profile), so its lifecycle is a developer's business and
    //     this page should not claim to have started it.
    // `healthy === true` is the only value that means "there is something to
    // open", and the console is always reachable, so it is the safe default.
    const webAppEnabled = state.enabled && !state.external && state.healthy === true;

    if (webAppEnabled) {
      return {
        primaryHref: this.hostnameService.webOrigin(),
        primaryLabel: "Open the dashboard",
        webAppEnabled: true,
      };
    }

    return {
      // Relative on purpose: the console is served by THIS API on every platform
      // hostname, so a relative path resolves against whichever host the operator
      // actually used — no cross-origin hop, and no hostname reconstruction.
      primaryHref: "/manage/web-app",
      primaryLabel: "Open the management console",
      webAppEnabled: false,
    };
  }
}
