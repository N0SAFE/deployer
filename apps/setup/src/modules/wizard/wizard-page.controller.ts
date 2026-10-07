import { Controller, Get } from "@nestjs/common";
import { Render as SsrRender } from "@nestjs-ssr/react";

import SetupView from "@/views/pages/setup";

/**
 * The wizard PAGE — the only non-oRPC route the setup app serves.
 *
 * ── WHY THIS IS SEPARATE FROM `WizardController` ────────────────────────────
 * Every other wizard endpoint is an oRPC procedure on `setupAppContract`. This
 * one cannot be: oRPC returns data, and this returns an HTML document.
 *
 * Keeping it in its own controller means `WizardController` is a pure contract
 * implementation — every method on it maps 1:1 to a procedure, so a missing
 * implementation is a compile error rather than a route nobody notices is
 * absent. That property is what the wildcard proxy lacked, and mixing one page
 * route into the contract router would weaken it again.
 *
 * ── WHY `layout: null` ──────────────────────────────────────────────────────
 * The wizard is a full-page, focused experience with no console chrome,
 * matching what the web app used to render. The library honours this by
 * returning `[]` from `resolveLayoutChain`, and the CLIENT must respect that
 * empty array rather than substituting the auto-discovered `RootLayout` —
 * otherwise the server renders bare and the client adds a header, which is a
 * hydration mismatch on the whole page body.
 *
 * ── WHY GET / (THE ROOT) ────────────────────────────────────────────────────
 * Traefik routes `setup.<host>` here, and the operator's first request is for
 * `/`. The API's done page later takes over this same path during the handover,
 * so the hostname never changes owner — it changes BACKEND.
 */
@Controller()
export class WizardPageController {
  /**
   * `GET /` — the onboarding page.
   *
   * `needsSetup` is always `true`: this app only exists while setup is pending,
   * so the "already done" branch the API needed is unreachable. The page keeps
   * its own guard so the component stays usable from either host.
   */
  @Get()
  @SsrRender(SetupView, { layout: null })
  setupPage(): { needsSetup: boolean } {
    return { needsSetup: true };
  }
}
