/**
 * PlatformConsoleController — the API-served management console for the
 * managed web app (concept doc: "Management console page").
 *
 * Server-rendered with `@nestjs-ssr/react` (@Render + React views that use
 * the SAME Tailwind theme + @repo/ui as the web app). This is the FALLBACK
 * visual of the single console URL (`/manage/web-app`): rendered by the API
 * itself — works when NO web app is running at all. When the web app IS
 * running, Traefik's `PathPrefix(/manage/web-app)` rule routes the SAME URL
 * to the beautiful web page instead — one URL, two visuals, selected by
 * `managed_web_app.enabled` (see TraefikPlatformConfigService).
 *
 * DATA: this controller ONLY renders views (@Render). Every action
 * (toggle/restart/origin/tunnel) is a typed ORPC implementation in
 * PlatformManagedWebController — the views call them through React Query
 * (no HTTP form POSTs / redirects anywhere). All logic lives in
 * PlatformManagedWebService.
 *
 * AUTH: pages are guarded server-side by SsrAuthGuardMiddleware (AppModule) —
 * every /manage/* route except /manage/login requires a session.
 */

import { Controller, Get, HttpException, HttpStatus } from "@nestjs/common";
import { Render as SsrRender } from "@nestjs-ssr/react";

import { EnvService } from "@/config/env/env.service";
import ManagedWebAppView from "@/views/pages/manage-web-app";
import LoginView from "@/views/pages/login";
import { PlatformManagedWebService } from "../services/platform-managed-web.service";

@Controller("manage")
export class PlatformConsoleController {
	constructor(
		private readonly env: EnvService,
		private readonly managedWeb: PlatformManagedWebService,
	) {}

	/** The single console URL — SSR React view (fallback visual of the API).
	 *  SSR-seeds the initial state; the view keeps it live via ORPC. */
	@Get("web-app")
	@SsrRender(ManagedWebAppView)
	async consolePage(): Promise<{
		state: Awaited<ReturnType<PlatformManagedWebService["state"]>>;
	}> {
		if (this.env.get("MANAGED_WEB_APP_EXTERNAL")) {
			throw new HttpException(
				"Management console disabled: MANAGED_WEB_APP_EXTERNAL=true (an externally managed dev web app is running)",
				HttpStatus.NOT_FOUND,
			);
		}
		return { state: await this.managedWeb.state() };
	}

	/** Login screen — public (excluded from SsrAuthGuardMiddleware). */
	@Get("login")
	@SsrRender(LoginView)
	login(): { redirect: string; error: string | null } {
		return { redirect: "/manage/web-app", error: null };
	}
}